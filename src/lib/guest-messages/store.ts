/**
 * 손님 메시지 DB 쓰기 — 서버 전용(service_role). docs/product/47-guest-messaging.md §4 · §7
 *
 * 웹훅 수신(`webhook-ingest.ts`)과 보정 조회(`reconcile.ts`)가 **같은 함수**로 넣는다 — 같은 메시지가 두 번 와도 하나
 * ((organization_id, provider, external_id) 제약 + upsert ignoreDuplicates). 무엇을 넣을지는 순수 함수 `planIngest` 가, 대화 상태는 DB 함수 `guest_conversation_apply_messages` 가 정한다.
 *
 * 메시지 본문 · 손님 이름은 로그에 남기지 않는다(개인정보) — 번호 · 건수만.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import {
  planIngest,
  summarizeAddedMessages,
  type ConversationStateFields,
  type EchoMerge,
  type SentOutboxRow,
} from "@/lib/guest-messages/ingest-plan";
import { resolveOutboundChannel } from "@/lib/guest-messages/beds24-normalize";
import type {
  ChannelCreditSnapshot,
  GuestChannelKey,
  GuestMessageProvider,
  NormalizedBookingContext,
  NormalizedMessage,
} from "@/lib/guest-messages/types";

type Client = SupabaseClient<Database>;
type ConversationInsert = Database["public"]["Tables"]["guest_conversations"]["Insert"];
type ChannelStateInsert = Database["public"]["Tables"]["guest_message_channel_state"]["Insert"];

/** 대화에 채울 예약 정보(없는 칸은 null — 있는 값을 null 로 덮지 않는다). */
export type ConversationSeed = {
  reservation_id: string | null;
  property_id: string | null;
  room_id: string | null;
  property_name: string | null;
  room_label: string | null;
  channel: string | null;
  booking_status: string | null;
  check_in_date: string | null;
  check_out_date: string | null;
  guest_name: string | null;
  guest_language: string | null;
};

export const EMPTY_SEED: ConversationSeed = {
  reservation_id: null,
  property_id: null,
  room_id: null,
  property_name: null,
  room_label: null,
  channel: null,
  booking_status: null,
  check_in_date: null,
  check_out_date: null,
  guest_name: null,
  guest_language: null,
};

const CONVERSATION_SELECT =
  "id, status, snooze_until, last_guest_at, last_reply_at, last_message_at, reservation_id, property_id, room_id, property_name, room_label, channel, booking_status, check_in_date, check_out_date, guest_name, guest_language";

type ConversationRow = ConversationStateFields & ConversationSeed & { id: string };

/** 연결 상태 한 줄을 고친다(없으면 만든다). 실패는 삼킨다 — 받기 · 보내기를 깨뜨리지 않는다. */
export async function recordChannelState(
  supabase: Client,
  organizationId: string,
  patch: Omit<ChannelStateInsert, "organization_id">,
): Promise<void> {
  try {
    const result = await supabase
      .from("guest_message_channel_state")
      .upsert({ organization_id: organizationId, ...patch }, { onConflict: "organization_id" });
    if (result.error) console.error("[guest-messages] channel state write failed", result.error.message);
  } catch (error) {
    console.error("[guest-messages] channel state write failed", error instanceof Error ? error.message : "unknown");
  }
}

/** 받은 크레딧 헤더를 기록한다(사용량 표시는 이 기록만 읽는다 — §6-2). 헤더가 없으면 아무것도 안 쓴다. */
export async function recordChannelCredit(
  supabase: Client,
  organizationId: string,
  credit: ChannelCreditSnapshot,
): Promise<void> {
  if (credit.remaining === null && credit.resetsAt === null && credit.requestCost === null) return;
  const patch: Omit<ChannelStateInsert, "organization_id"> = {};
  if (credit.remaining !== null) patch.last_credit_remaining = Math.round(credit.remaining);
  if (credit.resetsAt !== null) patch.last_credit_reset_at = new Date(credit.resetsAt).toISOString();
  if (credit.requestCost !== null) patch.last_request_cost = Math.round(credit.requestCost);
  await recordChannelState(supabase, organizationId, patch);
}

/** 예약 정보 → 대화 칸. 우리 예약 행 · 건물 · 객실을 찾아 잇는다(Beds24 호출 없음). */
export async function resolveConversationSeed(
  supabase: Client,
  args: {
    organizationId: string;
    providerBookingId: string;
    booking: NormalizedBookingContext | null;
    externalPropertyId: string | null;
    externalRoomId: string | null;
    reservationId?: string | null;
  },
): Promise<ConversationSeed> {
  const seed: ConversationSeed = { ...EMPTY_SEED };
  const booking = args.booking;
  if (booking) {
    seed.channel = booking.channel;
    seed.booking_status = booking.bookingStatus;
    seed.check_in_date = booking.checkInDate;
    seed.check_out_date = booking.checkOutDate;
    seed.guest_name = booking.guestName;
    seed.guest_language = booking.guestLanguage;
  }

  try {
    type ReservationPick = {
      id: string;
      property_name: string;
      room_label: string;
      guest_name: string;
      check_in_date: string;
      check_out_date: string;
      source: string;
    };
    const select = "id, property_name, room_label, guest_name, check_in_date, check_out_date, source";
    let reservation: ReservationPick | null = null;
    if (args.reservationId) {
      const found = await supabase
        .from("reservations")
        .select(select)
        .eq("organization_id", args.organizationId)
        .eq("id", args.reservationId)
        .maybeSingle();
      reservation = (found.data as ReservationPick | null) ?? null;
    }
    if (!reservation) {
      // 예약 행의 원본(raw_payload)에 Beds24 자기 번호가 v2 `id` 또는 v1 `bookId` 로 있다.
      for (const path of ["raw_payload->>id", "raw_payload->>bookId"]) {
        const found = await supabase
          .from("reservations")
          .select(select)
          .eq("organization_id", args.organizationId)
          .filter(path, "eq", args.providerBookingId)
          .limit(1);
        const row = ((found.data ?? []) as ReservationPick[])[0];
        if (row) {
          reservation = row;
          break;
        }
      }
    }
    if (reservation) {
      seed.reservation_id = reservation.id;
      seed.property_name = reservation.property_name;
      seed.room_label = reservation.room_label;
      seed.guest_name = seed.guest_name ?? reservation.guest_name;
      seed.check_in_date = seed.check_in_date ?? reservation.check_in_date;
      seed.check_out_date = seed.check_out_date ?? reservation.check_out_date;
      // 채널을 모르면 우리 예약 행의 출처로(보내기는 OTA 허용 목록만 — 그래도 모르면 unknown_channel 로 거절).
      seed.channel = resolveOutboundChannel(seed.channel as GuestChannelKey | null, reservation.source);
    }

    const externalPropertyId = booking?.externalPropertyId ?? args.externalPropertyId;
    if (externalPropertyId) {
      const property = await supabase
        .from("properties")
        .select("id, name")
        .eq("organization_id", args.organizationId)
        .eq("external_provider", "beds24")
        .eq("external_property_id", externalPropertyId)
        .limit(1);
      const row = ((property.data ?? []) as Array<{ id: string; name: string }>)[0];
      if (row) {
        seed.property_id = row.id;
        seed.property_name = seed.property_name ?? row.name;
      }
    }
    const externalRoomId = booking?.externalRoomId ?? args.externalRoomId;
    if (externalRoomId) {
      const room = await supabase
        .from("rooms")
        .select("id")
        .eq("organization_id", args.organizationId)
        .eq("external_provider", "beds24")
        .eq("external_room_id", externalRoomId)
        .limit(1);
      const row = ((room.data ?? []) as Array<{ id: string }>)[0];
      if (row) seed.room_id = row.id;
    }
  } catch (error) {
    console.error("[guest-messages] seed lookup failed", error instanceof Error ? error.message : "unknown");
  }
  return seed;
}

function seedPatch(current: ConversationSeed, seed: ConversationSeed): Partial<ConversationSeed> {
  const patch: Partial<ConversationSeed> = {};
  for (const key of Object.keys(seed) as (keyof ConversationSeed)[]) {
    const value = seed[key];
    if (value !== null && value !== current[key]) patch[key] = value;
  }
  return patch;
}

async function ensureConversation(
  supabase: Client,
  args: { organizationId: string; provider: GuestMessageProvider; providerBookingId: string; seed: ConversationSeed },
): Promise<{ row: ConversationRow; created: boolean }> {
  const select = () =>
    supabase
      .from("guest_conversations")
      .select(CONVERSATION_SELECT)
      .eq("organization_id", args.organizationId)
      .eq("provider", args.provider)
      .eq("provider_booking_id", args.providerBookingId)
      .maybeSingle();

  const existing = await select();
  if (existing.error) throw new Error(`conversation read failed: ${existing.error.message}`);
  let row = existing.data as ConversationRow | null;
  let created = false;

  if (!row) {
    const insert: ConversationInsert = {
      organization_id: args.organizationId,
      provider: args.provider,
      provider_booking_id: args.providerBookingId,
      status: "done",
      ...args.seed,
    };
    const inserted = await supabase.from("guest_conversations").insert(insert).select(CONVERSATION_SELECT).single();
    if (!inserted.error) {
      return { row: inserted.data as ConversationRow, created: true };
    }
    // 같은 순간 다른 배달이 먼저 만들었다(고유 제약) — 다시 읽는다. 다시 읽기도 실패하면 던진다(실패 건수에 든다).
    if (inserted.error.code !== "23505") throw new Error(`conversation insert failed: ${inserted.error.message}`);
    const again = await select();
    if (again.error) throw new Error(`conversation re-read failed: ${again.error.message}`);
    row = (again.data as ConversationRow | null) ?? null;
    if (!row) throw new Error("conversation re-read found nothing after unique conflict");
    created = false;
  }

  const patch = seedPatch(row, args.seed);
  if (Object.keys(patch).length > 0) {
    const updated = await supabase
      .from("guest_conversations")
      .update(patch)
      .eq("id", row.id)
      .eq("organization_id", args.organizationId);
    if (updated.error) console.error("[guest-messages] conversation seed update failed", updated.error.message);
    else row = { ...row, ...patch };
  }
  return { row, created };
}

/**
 * 자동 안내(5단계)가 메시지 없이 대화를 만들 때 — 받기와 같은 규칙(고유 제약 · 있는 값을 null 로 덮지 않음).
 * 새 대화는 `done`(손님 말이 없으니 기다림이 아님). 대화 번호만 돌려준다.
 */
export async function ensureConversationForBooking(
  supabase: Client,
  args: { organizationId: string; provider: GuestMessageProvider; providerBookingId: string; seed: ConversationSeed },
): Promise<{ id: string; created: boolean }> {
  const { row, created } = await ensureConversation(supabase, args);
  return { id: row.id, created };
}

export type IngestResult = {
  conversationId: string;
  created: boolean;
  inserted: number;
  merged: number;
  duplicates: number;
  markedRead: number;
  failedMerges: number;
  /** 이번에 새로 들어간 메시지 줄 id — 웹훅 뒤 사진 사본(47 §5-8)을 이 줄들로만 좁힌다. */
  insertedIds?: string[];
};

const ECHO_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

/** 되돌아온 host 메시지 하나를 발송 큐 줄에 잇는다. 성공하면 true. */
async function mergeEcho(
  supabase: Client,
  args: { organizationId: string; conversationId: string; echo: EchoMerge; outbox: SentOutboxRow | undefined },
): Promise<boolean> {
  const { echo } = args;
  const linked = await supabase
    .from("guest_messages")
    .select("id, external_id")
    .eq("organization_id", args.organizationId)
    .eq("outbox_id", echo.outboxId)
    .limit(1);
  if (linked.error) throw new Error(`echo lookup failed: ${linked.error.message}`);
  const row = ((linked.data ?? []) as Array<{ id: string; external_id: string | null }>)[0];

  if (row && !row.external_id) {
    const updated = await supabase
      .from("guest_messages")
      .update({ external_id: echo.message.externalId, provider_source: echo.message.providerSource })
      .eq("id", row.id)
      .is("external_id", null);
    // 23505: 같은 번호 줄이 이미 따로 있다 — 이미 들어와 있으니 잇기만 끝난 것으로 본다.
    if (updated.error && updated.error.code !== "23505") throw new Error(`echo update failed: ${updated.error.message}`);
  } else if (!row) {
    // 발송 작업이 메시지 줄을 만들기 전에 웹훅이 먼저 왔다 — 큐 줄에 이어 붙인 메시지 줄을 만든다.
    // 발송 작업은 나중에 outbox_id 로 upsert 하므로 이 줄에 잇고 새로 넣지 않는다(guest_messages_outbox_key).
    const inserted = await supabase.from("guest_messages").insert({
      organization_id: args.organizationId,
      conversation_id: args.conversationId,
      provider: echo.message.provider,
      external_id: echo.message.externalId,
      provider_source: echo.message.providerSource,
      direction: "host",
      body: echo.message.body,
      sent_at: echo.message.sentAt,
      attachments: echo.message.attachments as unknown as Json,
      outbox_id: echo.outboxId,
    });
    if (inserted.error) {
      if (inserted.error.code !== "23505") throw new Error(`echo insert failed: ${inserted.error.message}`);
      // 같은 번호 줄이 이미 있다(다른 배달이 먼저 넣음) — 그 줄에 큐 번호만 잇는다.
      const link = await supabase
        .from("guest_messages")
        .update({ outbox_id: echo.outboxId })
        .eq("organization_id", args.organizationId)
        .eq("provider", echo.message.provider)
        .eq("external_id", echo.message.externalId)
        .is("outbox_id", null);
      if (link.error && link.error.code !== "23505") throw new Error(`echo link failed: ${link.error.message}`);
    }
  }

  const outboxExternal = await supabase
    .from("guest_message_outbox")
    .update({ external_id: echo.message.externalId })
    .eq("id", echo.outboxId)
    .eq("organization_id", args.organizationId)
    .is("external_id", null);
  if (outboxExternal.error) throw new Error(`outbox external id update failed: ${outboxExternal.error.message}`);

  // 보내는 중 · 결과 모름이던 줄은 되돌아옴이 「나갔다」는 증거다.
  if (args.outbox && args.outbox.status && args.outbox.status !== "sent") {
    const settled = await supabase
      .from("guest_message_outbox")
      .update({ status: "sent", sent_at: args.outbox.sent_at ?? echo.message.sentAt, error_code: null })
      .eq("id", echo.outboxId)
      .eq("organization_id", args.organizationId)
      .in("status", ["sending", "uncertain"]);
    if (settled.error) throw new Error(`outbox settle failed: ${settled.error.message}`);
  }
  return true;
}

/**
 * 한 예약의 메시지들을 넣는다. 대화가 없으면 만든다.
 * 대화 상태는 DB 함수 `guest_conversation_apply_messages` 가 한 문장으로 바꾼다. 들어온 메시지 **전부**(중복 포함)를 넘긴다 —
 * 함수가 시각을 뒤로 돌리지 않고 「새」 손님 말만 다시 열기 때문에 안전하고, 앞서 상태 저장이 실패했어도 다음 배달이 바로잡는다.
 */
export async function ingestConversationMessages(
  supabase: Client,
  args: {
    organizationId: string;
    provider: GuestMessageProvider;
    providerBookingId: string;
    seed: ConversationSeed;
    messages: readonly NormalizedMessage[];
    now: Date;
    /**
     * 과거 메시지 가져오기(backfill.ts)에서 부를 때 true. 「48시간 넘은 안 읽은 손님 말은 답장 기다림으로 열지 않기」 규칙을
     * 새 대화뿐 아니라 **이미 있는 대화에도** 적용한다 — 몇 년 전 말이 「답장 기다림 · 늦음」을 만들지 않게(47 「과거 메시지 가져오기」).
     */
    history?: boolean;
  },
): Promise<IngestResult> {
  const { row: conversation, created } = await ensureConversation(supabase, args);
  const result: IngestResult = {
    conversationId: conversation.id,
    created,
    inserted: 0,
    merged: 0,
    duplicates: 0,
    markedRead: 0,
    failedMerges: 0,
  };
  if (args.messages.length === 0) return result;

  const externalIds = [...new Set(args.messages.map((message) => message.externalId))];
  const existing = await supabase
    .from("guest_messages")
    .select("external_id, read_at")
    .eq("organization_id", args.organizationId)
    .eq("provider", args.provider)
    .in("external_id", externalIds);
  if (existing.error) throw new Error(`message read failed: ${existing.error.message}`);
  const existingRows = (existing.data ?? []) as Array<{ external_id: string | null; read_at: string | null }>;
  const existingIds = new Set(existingRows.map((row) => row.external_id).filter((id): id is string => !!id));
  const existingUnread = new Set(
    existingRows.filter((row) => row.external_id && !row.read_at).map((row) => row.external_id as string),
  );

  let sentOutbox: SentOutboxRow[] = [];
  if (args.messages.some((message) => message.direction === "host" && !existingIds.has(message.externalId))) {
    const since = new Date(args.now.getTime() - ECHO_LOOKBACK_MS).toISOString();
    const outbox = await supabase
      .from("guest_message_outbox")
      .select("id, status, external_id, body, sent_at, created_at")
      .eq("organization_id", args.organizationId)
      .eq("conversation_id", conversation.id)
      .in("status", ["sent", "sending", "uncertain"])
      .gte("created_at", since);
    if (outbox.error) throw new Error(`outbox read failed: ${outbox.error.message}`);
    sentOutbox = (outbox.data ?? []) as SentOutboxRow[];
  }

  const plan = planIngest({
    incoming: args.messages,
    existingExternalIds: existingIds,
    existingUnreadExternalIds: existingUnread,
    sentOutbox,
  });
  const nowIso = args.now.toISOString();
  result.duplicates = plan.duplicates;

  if (plan.inserts.length > 0) {
    const rows = plan.inserts.map((message) => ({
      organization_id: args.organizationId,
      conversation_id: conversation.id,
      provider: message.provider,
      external_id: message.externalId,
      provider_source: message.providerSource,
      direction: message.direction,
      body: message.body,
      sent_at: message.sentAt,
      read_at: message.read ? nowIso : null,
      attachments: message.attachments as unknown as Json,
    }));
    const inserted = await supabase
      .from("guest_messages")
      .upsert(rows, { onConflict: "organization_id,provider,external_id", ignoreDuplicates: true })
      .select("id, external_id");
    if (inserted.error) throw new Error(`message insert failed: ${inserted.error.message}`);
    result.inserted = (inserted.data ?? []).length;
    result.insertedIds = ((inserted.data ?? []) as Array<{ id?: string }>).map((row) => row.id).filter((id): id is string => typeof id === "string");
    result.duplicates += plan.inserts.length - result.inserted;
  }

  if (plan.markReadExternalIds.length > 0) {
    const marked = await supabase
      .from("guest_messages")
      .update({ read_at: nowIso })
      .eq("organization_id", args.organizationId)
      .eq("provider", args.provider)
      .in("external_id", plan.markReadExternalIds)
      .is("read_at", null)
      .select("id");
    if (marked.error) console.error("[guest-messages] read_at update failed", marked.error.message);
    else result.markedRead = (marked.data ?? []).length;
  }

  const outboxById = new Map(sentOutbox.map((row) => [row.id, row]));
  for (const echo of plan.echoMerges) {
    try {
      await mergeEcho(supabase, {
        organizationId: args.organizationId,
        conversationId: conversation.id,
        echo,
        outbox: outboxById.get(echo.outboxId),
      });
      result.merged += 1;
    } catch (error) {
      result.failedMerges += 1;
      console.error("[guest-messages] echo merge failed", {
        outboxId: echo.outboxId,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  // 자동 안내(5단계)가 되돌아온 host 메시지는 직원 답장이 아니다 — 손님이 기다리는 대화를 「처리 끝」으로 닫지 않게 답장 시각에서 뺀다.
  // 웹훅은 이력 전체를 싣으므로 매번 뺀다(큐 줄의 외부 번호 · 이번에 auto 큐 줄에 이은 것).
  let summarized: readonly NormalizedMessage[] = args.messages;
  if (args.messages.some((message) => message.direction === "host")) {
    const autoExternal = new Set<string>();
    const autoRows = await supabase
      .from("guest_message_outbox")
      .select("id, external_id")
      .eq("organization_id", args.organizationId)
      .eq("conversation_id", conversation.id)
      .eq("kind", "auto");
    if (autoRows.error) console.error("[guest-messages] auto outbox read failed", autoRows.error.message);
    const autoIds = new Set<string>();
    for (const row of (autoRows.data ?? []) as Array<{ id: string; external_id: string | null }>) {
      autoIds.add(row.id);
      if (row.external_id) autoExternal.add(row.external_id);
    }
    for (const echo of plan.echoMerges) if (autoIds.has(echo.outboxId)) autoExternal.add(echo.message.externalId);
    if (autoExternal.size > 0) {
      summarized = args.messages.filter((message) => !(message.direction === "host" && autoExternal.has(message.externalId)));
    }
  }

  const params = summarizeAddedMessages(summarized, {
    isNewConversation: created || args.history === true,
    now: args.now,
  });
  const applied = await supabase.rpc("guest_conversation_apply_messages", {
    p_conversation_id: conversation.id,
    p_organization_id: args.organizationId,
    p_guest_at: params.guestAt,
    p_unread_guest_at: params.unreadGuestAt,
    p_reply_at: params.replyAt,
    p_message_at: params.messageAt,
    p_now: nowIso,
  });
  if (applied.error) throw new Error(`conversation state apply failed: ${applied.error.message}`);
  return result;
}

/** 메시지를 예약별로 묶는다(순서 유지). */
export function groupMessagesByBooking(messages: readonly NormalizedMessage[]): Map<string, NormalizedMessage[]> {
  const groups = new Map<string, NormalizedMessage[]>();
  for (const message of messages) {
    const list = groups.get(message.providerBookingId) ?? [];
    list.push(message);
    groups.set(message.providerBookingId, list);
  }
  return groups;
}
