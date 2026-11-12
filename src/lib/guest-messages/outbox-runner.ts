/**
 * 발송 작업 — 발송 큐 한 바퀴를 DB 에 잇는다(2단계, 2026-11-13). docs/product/47-guest-messaging.md §4 「발송 계약」 · §4-1
 *
 * 순서: 보낼 차례인 줄 읽기 → `sending` 으로 잡기(같은 줄을 두 작업이 동시에 보내지 않게, `status = queued` 조건) →
 * `processOutboxBatch`(순위 · 크레딧 선 · 429 · 보내기 전 실패 · uncertain) → 결과 저장(`status = sending` 조건) →
 * `sent` 면 메시지 줄을 `outbox_id` 로 잇고(되돌아옴이 먼저 만든 줄이 있으면 그 줄) 대화 상태를 DB 함수로 바꾼다.
 * 이번에 안 보낸 줄(크레딧 선 · 앞 묶음 멈춤)은 다시 `queued`.
 *
 * **실제 Beds24 호출은 `GUEST_MESSAGES_SEND_ENABLED=1` 일 때만**(기본 꺼짐). 꺼져 있으면 아무것도 하지 않는다 —
 * 줄은 `queued` 그대로, 화면은 「보낼 차례 기다림」. docs/engineering/07-environment-setup.md
 *
 * 서버 전용(service_role). 본문 · 손님 이름은 로그에 남기지 않는다.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createServerBeds24GuestMessageAdapter } from "@/lib/guest-messages/adapter-server";
import { processOutboxBatch, OUTBOX_BATCH_LIMIT, type OutboxRow } from "@/lib/guest-messages/outbox";
import { toChannelKey } from "@/lib/guest-messages/inbox-model";
import { AUTO_LATE_GRACE_MS, autoBookingStatus } from "@/lib/guest-messages/auto-model";
import type { GuestMessageChannelAdapter } from "@/lib/guest-messages/types";

type Client = SupabaseClient<Database>;

export function isGuestMessageSendEnabled(flag: string | undefined = process.env.GUEST_MESSAGES_SEND_ENABLED): boolean {
  return flag?.trim() === "1";
}

export type RunGuestOutboxResult =
  | { ran: false; reason: "disabled" | "empty" | "not_claimed" }
  | {
      ran: true;
      sent: number;
      failed: number;
      uncertain: number;
      requeued: number;
      stoppedReason: string | null;
    };

type DueRow = {
  id: string;
  kind: "reply" | "auto";
  attempts: number;
  next_try_at: string;
  created_at: string;
  body: string;
  conversation_id: string;
};

export async function runGuestOutbox(
  supabase: Client,
  organizationId: string,
  deps: {
    now?: Date;
    enabled?: boolean;
    adapter?: Pick<GuestMessageChannelAdapter, "send">;
  } = {},
): Promise<RunGuestOutboxResult> {
  if (!(deps.enabled ?? isGuestMessageSendEnabled())) return { ran: false, reason: "disabled" };
  const now = deps.now ?? new Date();
  const nowIso = now.toISOString();

  // 0. 멈춘 줄 풀기 — 잡은 뒤 결과를 저장하지 못하고 멈춘 sending 줄. 나갔을 수도 있으니 다시 보내지 않고 「모름」으로.
  await releaseStuckSending(supabase, organizationId, now);

  // 직원 답장을 먼저 읽고, 남은 자리를 자동 안내로 채운다 — 자동 안내가 수백 줄 밀려 있어도 답장이 밀려나지 않게.
  const slots = OUTBOX_BATCH_LIMIT * 2;
  const readDue = (kind: "reply" | "auto", limit: number) =>
    supabase
      .from("guest_message_outbox")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("status", "queued")
      .eq("kind", kind)
      .lte("next_try_at", nowIso)
      .order("created_at", { ascending: true })
      .limit(limit);
  const dueReplies = await readDue("reply", slots);
  if (dueReplies.error) throw new Error(`outbox due read failed: ${dueReplies.error.message}`);
  const dueIds = ((dueReplies.data ?? []) as Array<{ id: string }>).map((row) => row.id).slice(0, slots);
  if (dueIds.length < slots) {
    const dueAuto = await readDue("auto", slots - dueIds.length);
    if (dueAuto.error) throw new Error(`outbox due read failed: ${dueAuto.error.message}`);
    dueIds.push(...((dueAuto.data ?? []) as Array<{ id: string }>).map((row) => row.id).slice(0, slots - dueIds.length));
  }
  if (dueIds.length === 0) return { ran: false, reason: "empty" };

  // 잡기 — 다른 작업이 먼저 잡은 줄 · 그 사이 고치거나 취소한 줄은 빠진다. **보낼 글은 잡을 때 돌려받은 값**을 쓴다
  // (읽은 뒤 잡기 전에 직원이 글을 고치면 옛 글이 나가던 틈을 막는다).
  const claimed = await supabase
    .from("guest_message_outbox")
    .update({ status: "sending", claimed_at: nowIso })
    .eq("organization_id", organizationId)
    .in("id", dueIds)
    .eq("status", "queued")
    .select("id, kind, attempts, next_try_at, created_at, body, conversation_id");
  if (claimed.error) throw new Error(`outbox claim failed: ${claimed.error.message}`);
  const claimedRows = ((claimed.data ?? []) as DueRow[]).sort((x, y) => (x.created_at < y.created_at ? -1 : x.created_at > y.created_at ? 1 : 0));
  if (claimedRows.length === 0) return { ran: false, reason: "not_claimed" };

  // 자동 안내는 보내기 직전에 한 번 더 — 보낼 시각에서 6시간이 지났거나(크레딧 선 · 429 로 밀림) 예약이 취소됐으면 보내지 않는다.
  const dropped = await dropStaleAutoRows(supabase, organizationId, claimedRows.filter((row) => row.kind === "auto"), now);
  const rows = claimedRows.filter((row) => !dropped.has(row.id));
  const claimedIds = new Set(rows.map((row) => row.id));
  if (rows.length === 0) return { ran: true, sent: 0, failed: 0, uncertain: 0, requeued: 0, stoppedReason: null };

  const conversationIds = [...new Set(rows.map((row) => row.conversation_id))];
  const conversations = await supabase
    .from("guest_conversations")
    .select("id, provider, provider_booking_id, channel")
    .eq("organization_id", organizationId)
    .in("id", conversationIds);
  if (conversations.error) {
    await requeue(supabase, organizationId, [...claimedIds]);
    throw new Error(`outbox conversation read failed: ${conversations.error.message}`);
  }
  const byConversation = new Map(
    (
      (conversations.data ?? []) as Array<{
        id: string;
        provider: string;
        provider_booking_id: string;
        channel: string | null;
      }>
    ).map((row) => [row.id, row]),
  );

  const state = await supabase
    .from("guest_message_channel_state")
    .select("credit_reserve, last_credit_remaining, last_credit_reset_at, last_request_cost")
    .eq("organization_id", organizationId)
    .maybeSingle();
  const stateRow = (state.data ?? null) as {
    credit_reserve: number | null;
    last_credit_remaining: number | null;
    last_credit_reset_at: string | null;
    last_request_cost: number | null;
  } | null;

  const outboxRows: OutboxRow[] = rows.map((row) => {
    const conversation = byConversation.get(row.conversation_id);
    return {
      id: row.id,
      kind: row.kind,
      // processOutboxBatch 는 queued 만 본다 — 잡은 줄을 그대로 넘긴다.
      status: "queued",
      attempts: row.attempts,
      next_try_at: row.next_try_at,
      created_at: row.created_at,
      body: row.body,
      provider_booking_id: conversation?.provider_booking_id ?? "",
      channel: toChannelKey(conversation?.channel ?? null),
    };
  });

  const adapter = deps.adapter ?? createServerBeds24GuestMessageAdapter(supabase, organizationId);
  let result;
  try {
    result = await processOutboxBatch({
      rows: outboxRows,
      adapter,
      creditReserve: stateRow?.credit_reserve ?? 20,
      credit: {
        remaining: stateRow?.last_credit_remaining ?? null,
        resetsAt: stateRow?.last_credit_reset_at ? Date.parse(stateRow.last_credit_reset_at) : null,
        requestCost: stateRow?.last_request_cost ?? null,
      },
      now,
    });
  } catch (error) {
    // 어댑터는 던지지 않게 만들었지만, 던지면 잡은 줄을 「모름」으로 둔다 — 나갔을 수도 있으니 다시 보내지 않는다.
    await markUncertain(supabase, organizationId, [...claimedIds], "runner_error");
    throw error;
  }

  const counts = { sent: 0, failed: 0, uncertain: 0, requeued: 0 };
  const handled = new Set<string>();
  const rowById = new Map(rows.map((row) => [row.id, row]));

  for (const update of result.updates) {
    handled.add(update.id);
    const saved = await supabase
      .from("guest_message_outbox")
      .update({
        status: update.status,
        attempts: update.attempts,
        next_try_at: update.next_try_at,
        error_code: update.error_code,
        external_id: update.external_id,
        sent_at: update.sent_at,
      })
      .eq("organization_id", organizationId)
      .eq("id", update.id)
      .eq("status", "sending")
      .select("id");
    if (saved.error) {
      console.error("[guest-messages/outbox] result save failed", {
        outboxId: update.id,
        error: saved.error.message,
      });
      // 결과를 못 적었다 — sending 으로 두면 다음 바퀴가 못 집고, queued 로 되돌리면 두 번 나갈 수 있다. 「모름」으로.
      await markUncertain(supabase, organizationId, [update.id], "save_failed");
      counts.uncertain += 1;
      continue;
    }
    if ((saved.data ?? []).length === 0) {
      // 그 사이 멈춘 줄 풀기가 uncertain 으로 바꿨다(아주 느린 바퀴). 결과는 적지 않고 남긴다 — 되돌아온 host 메시지가 합친다.
      console.error("[guest-messages/outbox] result save matched no row", {
        outboxId: update.id,
        status: update.status,
      });
    } else if (update.status === "sent") counts.sent += 1;
    else if (update.status === "failed") counts.failed += 1;
    else if (update.status === "uncertain") counts.uncertain += 1;
    else counts.requeued += 1;

    // 실제로 나간 줄은 저장 결과와 상관없이 메시지 줄에 잇는다(나간 글이 화면에서 「보내는 중」으로 남지 않게).
    if (update.status === "sent" && update.sent_at) {
      const row = rowById.get(update.id);
      const conversation = row ? byConversation.get(row.conversation_id) : undefined;
      if (row && conversation) {
        await linkSentMessage(supabase, {
          organizationId,
          kind: row.kind,
          conversationId: row.conversation_id,
          provider: conversation.provider,
          outboxId: update.id,
          externalId: update.external_id,
          body: row.body,
          sentAt: update.sent_at,
        });
      }
    }
  }

  // 자동 안내 실행 줄의 결과(5단계) — 보냄 · 못 보냄만 옮긴다(모름은 queued 그대로, 화면이 큐 상태를 같이 본다).
  const autoResults = result.updates.filter(
    (update): update is typeof update & { status: "sent" | "failed" } =>
      (update.status === "sent" || update.status === "failed") && rowById.get(update.id)?.kind === "auto",
  );
  if (autoResults.length > 0) await syncAutoRuns(supabase, organizationId, autoResults);

  const leftover = [...claimedIds].filter((id) => !handled.has(id));
  if (leftover.length > 0) {
    await requeue(supabase, organizationId, leftover);
    counts.requeued += leftover.length;
  }

  return { ran: true, ...counts, stoppedReason: result.stoppedReason };
}

/**
 * 잡은 자동 안내 줄 중 보내면 안 되는 것 → 발송 큐 `cancelled`(이유 `auto_past_due` · `auto_cancelled`) · 대기 메시지 줄 지움 ·
 * 실행 줄 skipped past_due / cancelled. 밀린 자동 안내(크레딧 선 · 앞 묶음 멈춤)는 queued 로 돌아가 다음 발송 작업
 * (보내기 뒤 · `/api/guest-messages/outbox` · `/api/guest-messages/auto`)이 다시 집는데, 그때마다 이 검사를 지난다.
 * 실행 줄을 읽지 못하면 막지 않는다(실패로 보내기를 멈추지 않게 — 6시간 검사는 큐에 넣을 때도 했다).
 */
async function dropStaleAutoRows(supabase: Client, organizationId: string, rows: readonly DueRow[], now: Date): Promise<Set<string>> {
  const dropped = new Set<string>();
  if (rows.length === 0) return dropped;
  const client = supabase as unknown as SupabaseClient;
  const runs = await client
    .from("auto_message_runs")
    .select("id, outbox_id, scheduled_at, reservation_id")
    .eq("organization_id", organizationId)
    .in(
      "outbox_id",
      rows.map((row) => row.id),
    );
  if (runs.error) {
    console.error("[guest-messages/outbox] auto run read failed", runs.error.code ?? runs.error.message);
    return dropped;
  }
  const runRows = (runs.data ?? []) as Array<{ id: string; outbox_id: string; scheduled_at: string; reservation_id: string | null }>;
  const reservationIds = [...new Set(runRows.map((run) => run.reservation_id).filter((id): id is string => !!id))];
  const cancelledReservations = new Set<string>();
  if (reservationIds.length > 0) {
    const reservations = await client
      .from("reservations")
      .select("id, status, raw_status:raw_payload->>status")
      .eq("organization_id", organizationId)
      .in("id", reservationIds);
    if (!reservations.error) {
      for (const row of (reservations.data ?? []) as Array<{ id: string; status: string | null; raw_status: string | null }>) {
        if (autoBookingStatus(row.status, row.raw_status) === "cancelled") cancelledReservations.add(row.id);
      }
    }
  }
  const late = now.getTime() - AUTO_LATE_GRACE_MS;
  for (const reason of ["past_due", "cancelled"] as const) {
    const hit = runRows.filter((run) =>
      reason === "cancelled"
        ? !!run.reservation_id && cancelledReservations.has(run.reservation_id)
        : Date.parse(run.scheduled_at) < late && !(run.reservation_id && cancelledReservations.has(run.reservation_id)),
    );
    if (hit.length === 0) continue;
    const outboxIds = hit.map((run) => run.outbox_id);
    const cancelled = await supabase
      .from("guest_message_outbox")
      .update({ status: "cancelled", error_code: reason === "past_due" ? "auto_past_due" : "auto_cancelled" })
      .eq("organization_id", organizationId)
      .in("id", outboxIds)
      .eq("status", "sending")
      .select("id");
    if (cancelled.error) {
      console.error("[guest-messages/outbox] auto drop failed", cancelled.error.message);
      continue;
    }
    const ids = ((cancelled.data ?? []) as Array<{ id: string }>).map((row) => row.id);
    if (ids.length === 0) continue;
    for (const id of ids) dropped.add(id);
    await supabase.from("guest_messages").delete().eq("organization_id", organizationId).in("outbox_id", ids).is("external_id", null);
    await client
      .from("auto_message_runs")
      .update({ status: reason === "past_due" ? "skipped" : "cancelled", skip_reason: reason, updated_at: now.toISOString() })
      .eq("organization_id", organizationId)
      .in("outbox_id", ids)
      .eq("status", "queued");
  }
  return dropped;
}

/** sending 으로 잡힌 채 이 시간이 지나면 멈춘 것으로 본다(보내기 한 번은 길어야 수십 초). */
export const OUTBOX_STUCK_MINUTES = 10;

async function releaseStuckSending(supabase: Client, organizationId: string, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - OUTBOX_STUCK_MINUTES * 60_000).toISOString();
  const released = await supabase
    .from("guest_message_outbox")
    .update({ status: "uncertain", error_code: "stuck" })
    .eq("organization_id", organizationId)
    .eq("status", "sending")
    .lt("claimed_at", cutoff)
    .select("id");
  if (released.error) console.error("[guest-messages/outbox] stuck release failed", released.error.message);
  else if ((released.data ?? []).length > 0) console.warn("[guest-messages/outbox] released stuck sending rows", released.data!.length);
}

async function markUncertain(supabase: Client, organizationId: string, ids: string[], code: string): Promise<void> {
  if (ids.length === 0) return;
  const marked = await supabase
    .from("guest_message_outbox")
    .update({ status: "uncertain", error_code: code })
    .eq("organization_id", organizationId)
    .in("id", ids)
    .eq("status", "sending");
  if (marked.error) console.error("[guest-messages/outbox] mark uncertain failed", marked.error.message);
}

async function requeue(supabase: Client, organizationId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const back = await supabase
    .from("guest_message_outbox")
    .update({ status: "queued" })
    .eq("organization_id", organizationId)
    .in("id", ids)
    .eq("status", "sending");
  if (back.error) console.error("[guest-messages/outbox] requeue failed", back.error.message);
}

/**
 * 보낸 줄 → 메시지 줄(발송 계약). 보내기 때 만든 대기 줄(같은 `outbox_id`)에 번호 · 보낸 시각을 잇는다. 그 줄이 없으면
 * (지워졌거나 옛 줄) 새로 넣는다. 번호가 이미 다른 줄에 있으면(되돌아옴이 먼저 넣음 — 23505) 번호는 두고 넘어간다.
 * 그다음 대화 상태를 DB 함수로(답장 시각 → awaiting 이면 done).
 */
async function linkSentMessage(
  supabase: Client,
  args: {
    organizationId: string;
    kind: "reply" | "auto";
    conversationId: string;
    provider: string;
    outboxId: string;
    externalId: string | null;
    body: string;
    sentAt: string;
  },
): Promise<void> {
  const patch: { sent_at: string; external_id?: string } = {
    sent_at: args.sentAt,
  };
  if (args.externalId) patch.external_id = args.externalId;
  let linked = await supabase
    .from("guest_messages")
    .update(patch)
    .eq("organization_id", args.organizationId)
    .eq("outbox_id", args.outboxId)
    .select("id");
  if (linked.error?.code === "23505") {
    linked = await supabase
      .from("guest_messages")
      .update({ sent_at: args.sentAt })
      .eq("organization_id", args.organizationId)
      .eq("outbox_id", args.outboxId)
      .select("id");
  }
  if (linked.error) {
    console.error("[guest-messages/outbox] message link failed", {
      outboxId: args.outboxId,
      error: linked.error.message,
    });
  } else if ((linked.data ?? []).length === 0) {
    const inserted = await supabase.from("guest_messages").insert({
      organization_id: args.organizationId,
      conversation_id: args.conversationId,
      provider: args.provider,
      external_id: args.externalId,
      direction: "host",
      body: args.body,
      sent_at: args.sentAt,
      outbox_id: args.outboxId,
    });
    if (inserted.error && inserted.error.code !== "23505") {
      console.error("[guest-messages/outbox] message insert failed", {
        outboxId: args.outboxId,
        error: inserted.error.message,
      });
    }
  }

  const applied = await supabase.rpc("guest_conversation_apply_messages", {
    p_conversation_id: args.conversationId,
    p_organization_id: args.organizationId,
    p_guest_at: null,
    p_unread_guest_at: null,
    // 자동 안내는 직원 답장이 아니다 — 손님이 기다리는 대화를 「처리 끝」으로 닫지 않는다(마지막 말 시각만).
    p_reply_at: args.kind === "auto" ? null : args.sentAt,
    p_message_at: args.sentAt,
    p_now: new Date().toISOString(),
  });
  if (applied.error) console.error("[guest-messages/outbox] conversation state apply failed", applied.error.message);
}

/**
 * 자동 안내 실행 줄(`auto_message_runs`)을 큐 결과에 맞춘다. 실패는 로그만(발송 결과는 큐 줄에 이미 있다).
 * 보냄은 queued · failed 줄 모두 — 못 보낸 줄을 직원이 「다시 보내기」(`retryGuestOutbox`, 큐 줄만 queued 로 되돌림)로
 * 보내면 실행 줄은 failed 로 남아 있어서, 그대로 두면 자동 안내 목록에 「못 보냄」이 계속 보였다. 못 보냄은 queued 줄만.
 */
async function syncAutoRuns(
  supabase: Client,
  organizationId: string,
  results: ReadonlyArray<{ id: string; status: "sent" | "failed" }>,
): Promise<void> {
  for (const status of ["sent", "failed"] as const) {
    const ids = results.filter((row) => row.status === status).map((row) => row.id);
    if (ids.length === 0) continue;
    const saved = await (supabase as unknown as SupabaseClient)
      .from("auto_message_runs")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .in("outbox_id", ids)
      .in("status", status === "sent" ? ["queued", "failed"] : ["queued"]);
    if (saved.error) console.error("[guest-messages/outbox] auto run sync failed", saved.error.code ?? saved.error.message);
  }
}
