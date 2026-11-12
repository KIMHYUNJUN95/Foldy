/**
 * 자동 안내 규칙 · 보낼 예정 — 읽기 · 쓰기(서버 전용, service_role + 조직 필터 명시). docs/product/47-guest-messaging.md §5-3 · §5-6
 * 권한은 부르는 쪽이 먼저 본다(규칙: `guest_messages.manage`, 멈추기: manage 또는 view + reply, 보기: view).
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  AUTO_LATE_GRACE_MS,
  AUTO_LIMITS,
  fillAutoVariables,
  nextScheduledAt,
  toAutoRule,
  type AutoRule,
  type AutoRuleInput,
  type AutoRunStatus,
  type AutoRunView,
  type AutoSkipReason,
  type AutoVariable,
} from "@/lib/guest-messages/auto-model";
import {
  RULE_COLUMNS,
  autoFillContextFor,
  loadAutoReservations,
  loadAutoRules,
  providerBookingIdOf,
  toAutoBooking,
} from "@/lib/guest-messages/auto-scheduler";
import { pickLocalized, type GuestLang, type Localized } from "@/lib/guest-messages/guest-info-model";
import { loadBuildingGuestInfo } from "@/lib/guest-messages/guest-info-server";
import type { OutboxDisplayStatus } from "@/lib/guest-messages/inbox-model";
import { tokyoDateOf } from "@/lib/tokyo-date";

type Client = SupabaseClient<Database>;

function untyped(client: Client): SupabaseClient {
  return client as unknown as SupabaseClient;
}

const SUMMARY_PAGE = 1000;
const SUMMARY_MAX_ROWS = 50_000;

export type AutoRuleSummary = AutoRule & { nextSendAt: string | null; scheduledCount: number; blockedCount: number };

export async function loadAutoRuleSummaries(db: Client, organizationId: string, now: Date = new Date()): Promise<AutoRuleSummary[]> {
  const rules = await loadAutoRules(db, organizationId);
  if (rules.length === 0) return [];
  const since = new Date(now.getTime() - AUTO_LATE_GRACE_MS).toISOString();
  // 1,000줄 상한에 잘리지 않게 끝까지 넘긴다(규칙이 많고 예약이 많으면 수천 줄 — 숫자가 조용히 작게 나오지 않게).
  const data: Array<{ rule_id: string; status: AutoRunStatus; scheduled_at: string; skip_reason: string | null }> = [];
  for (let from = 0; from < SUMMARY_MAX_ROWS; from += SUMMARY_PAGE) {
    const page = await untyped(db)
      .from("auto_message_runs")
      .select("id, rule_id, status, scheduled_at, skip_reason")
      .eq("organization_id", organizationId)
      .in("status", ["scheduled", "skipped"])
      .gte("scheduled_at", since)
      .order("id", { ascending: true })
      .range(from, from + SUMMARY_PAGE - 1);
    if (page.error) throw new Error(`auto runs read failed: ${page.error.code ?? page.error.message}`);
    const rows = (page.data ?? []) as typeof data;
    data.push(...rows);
    if (rows.length < SUMMARY_PAGE) break;
  }
  const byRule = new Map<string, Array<{ status: AutoRunStatus; scheduledAt: string; skipReason: string | null }>>();
  for (const row of data) {
    const list = byRule.get(row.rule_id) ?? [];
    list.push({ status: row.status, scheduledAt: row.scheduled_at, skipReason: row.skip_reason });
    byRule.set(row.rule_id, list);
  }
  return rules.map((rule) => {
    const runs = byRule.get(rule.id) ?? [];
    return {
      ...rule,
      nextSendAt: rule.enabled ? nextScheduledAt(runs, now) : null,
      scheduledCount: runs.filter((run) => run.status === "scheduled").length,
      blockedCount: runs.filter((run) => run.status === "skipped" && run.skipReason === "empty_variable").length,
    };
  });
}

function ruleRow(input: AutoRuleInput) {
  return {
    name: input.name,
    trigger: input.trigger,
    offset_days: input.offsetDays,
    send_time: input.sendTime,
    target_buildings: input.targetBuildings,
    target_channels: input.targetChannels,
    target_statuses: input.targetStatuses,
    body_ko: input.bodies.ko,
    body_ja: input.bodies.ja,
    body_en: input.bodies.en,
  };
}

export type SaveAutoRuleResult =
  | { ok: true; rule: AutoRule }
  | { ok: false; error: "conflict"; current: AutoRule }
  | { ok: false; error: "not_found" | "limit" | "save_failed" };

export async function createAutoRule(db: Client, organizationId: string, userId: string, input: AutoRuleInput): Promise<SaveAutoRuleResult> {
  const count = await untyped(db).from("auto_message_rules").select("id", { count: "exact", head: true }).eq("organization_id", organizationId);
  if (count.error) return { ok: false, error: "save_failed" };
  if ((count.count ?? 0) >= AUTO_LIMITS.count) return { ok: false, error: "limit" };
  const inserted = await untyped(db)
    .from("auto_message_rules")
    // 새 규칙은 꺼진 채로 — 문구 · 미리 보기를 확인한 뒤 켠다.
    .insert({ organization_id: organizationId, created_by: userId, enabled: false, sort_order: count.count ?? 0, ...ruleRow(input) })
    .select(RULE_COLUMNS)
    .single();
  if (inserted.error) {
    console.error("[guest-messages/auto] rule insert failed", { code: inserted.error.code });
    return { ok: false, error: "save_failed" };
  }
  const rule = toAutoRule(inserted.data as Parameters<typeof toAutoRule>[0]);
  return rule ? { ok: true, rule } : { ok: false, error: "save_failed" };
}

async function loadRule(db: Client, organizationId: string, id: string): Promise<AutoRule | null> {
  const { data, error } = await untyped(db).from("auto_message_rules").select(RULE_COLUMNS).eq("organization_id", organizationId).eq("id", id).maybeSingle();
  if (error) throw new Error(`auto rule read failed: ${error.code ?? error.message}`);
  return data ? toAutoRule(data as Parameters<typeof toAutoRule>[0]) : null;
}

/** 본 버전(`expectedUpdatedAt`)일 때만 고친다. 0줄 → 남이 먼저 고침(충돌 + 최신) 또는 지워짐. */
export async function updateAutoRule(
  db: Client,
  organizationId: string,
  id: string,
  input: AutoRuleInput,
  expectedUpdatedAt: string,
): Promise<SaveAutoRuleResult> {
  const updated = await untyped(db)
    .from("auto_message_rules")
    .update(ruleRow(input))
    .eq("organization_id", organizationId)
    .eq("id", id)
    .eq("updated_at", expectedUpdatedAt)
    .select(RULE_COLUMNS)
    .maybeSingle();
  if (updated.error) {
    console.error("[guest-messages/auto] rule update failed", { code: updated.error.code });
    return { ok: false, error: "save_failed" };
  }
  if (updated.data) {
    const rule = toAutoRule(updated.data as Parameters<typeof toAutoRule>[0]);
    return rule ? { ok: true, rule } : { ok: false, error: "save_failed" };
  }
  try {
    const current = await loadRule(db, organizationId, id);
    return current ? { ok: false, error: "conflict", current } : { ok: false, error: "not_found" };
  } catch {
    return { ok: false, error: "save_failed" };
  }
}

export async function setAutoRuleEnabled(db: Client, organizationId: string, id: string, enabled: boolean): Promise<AutoRule | null | "failed"> {
  const updated = await untyped(db)
    .from("auto_message_rules")
    .update({ enabled })
    .eq("organization_id", organizationId)
    .eq("id", id)
    .select(RULE_COLUMNS)
    .maybeSingle();
  if (updated.error) return "failed";
  return updated.data ? toAutoRule(updated.data as Parameters<typeof toAutoRule>[0]) : null;
}

/** 하드 삭제(기본 삭제 정책). 실행 줄은 함께 지워지고, 이미 큐에 들어간 줄은 규칙 번호만 비운다(외래 키). */
export async function deleteAutoRule(db: Client, organizationId: string, id: string): Promise<"ok" | "not_found" | "failed"> {
  const removed = await untyped(db).from("auto_message_rules").delete().eq("organization_id", organizationId).eq("id", id).select("id");
  if (removed.error) return "failed";
  return (removed.data ?? []).length > 0 ? "ok" : "not_found";
}

// ── 보낼 예정 ────────────────────────────────────────────────────────────────

const RUN_VIEW_COLUMNS =
  "id, rule_id, provider_booking_id, conversation_id, guest_name, property_name, room_label, check_in_date, check_out_date, channel, scheduled_at, status, skip_reason, missing_variables, paused_at, outbox_id";

type RunViewRow = {
  id: string;
  rule_id: string;
  provider_booking_id: string;
  conversation_id: string | null;
  guest_name: string | null;
  property_name: string | null;
  room_label: string | null;
  check_in_date: string | null;
  check_out_date: string | null;
  channel: string | null;
  scheduled_at: string;
  status: AutoRunStatus;
  skip_reason: AutoSkipReason | null;
  missing_variables: string[] | null;
  paused_at: string | null;
  outbox_id: string | null;
};

async function toRunViews(db: Client, organizationId: string, rows: RunViewRow[]): Promise<AutoRunView[]> {
  if (rows.length === 0) return [];
  const ruleIds = [...new Set(rows.map((row) => row.rule_id))];
  const outboxIds = [...new Set(rows.map((row) => row.outbox_id).filter((id): id is string => !!id))];
  const [rules, outbox] = await Promise.all([
    untyped(db).from("auto_message_rules").select("id, name").eq("organization_id", organizationId).in("id", ruleIds),
    outboxIds.length
      ? untyped(db).from("guest_message_outbox").select("id, status").eq("organization_id", organizationId).in("id", outboxIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (rules.error) throw new Error(`auto rule names read failed: ${rules.error.code ?? rules.error.message}`);
  const names = new Map(((rules.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));
  const outboxStatus = new Map(((outbox.data ?? []) as Array<{ id: string; status: OutboxDisplayStatus }>).map((row) => [row.id, row.status]));
  return rows.map((row) => ({
    id: row.id,
    ruleId: row.rule_id,
    ruleName: names.get(row.rule_id) ?? "",
    providerBookingId: row.provider_booking_id,
    conversationId: row.conversation_id,
    guestName: row.guest_name,
    propertyName: row.property_name,
    roomLabel: row.room_label,
    checkInDate: row.check_in_date,
    checkOutDate: row.check_out_date,
    channel: row.channel,
    scheduledAt: row.scheduled_at,
    status: row.status,
    skipReason: row.skip_reason,
    missingVariables: row.missing_variables ?? [],
    paused: !!row.paused_at,
    outboxStatus: row.outbox_id ? (outboxStatus.get(row.outbox_id) ?? null) : null,
  }));
}

/** 「보낼 예정」 — 지난 하루 + 앞으로(시각 순). 취소 · 대상 아님은 빼고, 규칙 꺼짐도 뺀다. */
export async function loadUpcomingAutoRuns(
  db: Client,
  organizationId: string,
  options: { now?: Date; ruleId?: string | null; limit?: number } = {},
): Promise<AutoRunView[]> {
  const now = options.now ?? new Date();
  let query = untyped(db)
    .from("auto_message_runs")
    .select(RUN_VIEW_COLUMNS)
    .eq("organization_id", organizationId)
    .neq("status", "cancelled")
    .gte("scheduled_at", new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(options.limit ?? 300);
  if (options.ruleId) query = query.eq("rule_id", options.ruleId);
  const { data, error } = await query;
  if (error) throw new Error(`auto upcoming read failed: ${error.code ?? error.message}`);
  return toRunViews(db, organizationId, (data ?? []) as RunViewRow[]);
}

/** 한 예약(대화)의 자동 안내 — 대화 오른쪽 패널 · 모바일 예약 정보 시트. 취소된 것은 뺀다. 표가 없으면 빈 목록. */
export async function loadBookingAutoRuns(db: Client, organizationId: string, providerBookingId: string): Promise<AutoRunView[]> {
  const { data, error } = await untyped(db)
    .from("auto_message_runs")
    .select(RUN_VIEW_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("provider", "beds24")
    .eq("provider_booking_id", providerBookingId)
    .neq("status", "cancelled")
    .order("scheduled_at", { ascending: true })
    .limit(50);
  if (error) return [];
  try {
    return await toRunViews(db, organizationId, (data ?? []) as RunViewRow[]);
  } catch {
    return [];
  }
}

/**
 * 예약 하나만 멈추기 · 다시 보내기. 멈추면 scheduled · skipped → paused(멈춤 표시는 남는다), 다시 보내면 paused → scheduled
 * (다음 계획이 빈 변수 · 지난 시각을 다시 판단). 큐에 넣은 뒤는 바꾸지 않는다.
 */
export async function setAutoRunPaused(
  db: Client,
  organizationId: string,
  runId: string,
  paused: boolean,
  userId: string,
): Promise<"ok" | "not_found" | "locked" | "failed"> {
  const nowIso = new Date().toISOString();
  const patch = paused
    ? { paused_at: nowIso, paused_by: userId, status: "paused", skip_reason: null, missing_variables: [], updated_at: nowIso }
    : { paused_at: null, paused_by: null, status: "scheduled", skip_reason: null, missing_variables: [], updated_at: nowIso };
  const from = paused ? ["scheduled", "skipped", "paused"] : ["paused"];
  const updated = await untyped(db)
    .from("auto_message_runs")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("id", runId)
    .in("status", from)
    .select("id");
  if (updated.error) return "failed";
  if ((updated.data ?? []).length > 0) return "ok";
  const exists = await untyped(db).from("auto_message_runs").select("id").eq("organization_id", organizationId).eq("id", runId).maybeSingle();
  if (exists.error) return "failed";
  return exists.data ? "locked" : "not_found";
}

// ── 미리 보기 ────────────────────────────────────────────────────────────────

export type AutoPreviewBooking = {
  providerBookingId: string;
  guestName: string | null;
  propertyName: string | null;
  roomLabel: string | null;
  checkInDate: string | null;
};

/** 미리 보기에 고를 예약 — 오늘부터 체크인 순(취소 빼고) 40개. */
export async function loadAutoPreviewBookings(db: Client, organizationId: string, now: Date = new Date()): Promise<AutoPreviewBooking[]> {
  const today = tokyoDateOf(now.toISOString()) as string;
  const rows = await loadAutoReservations(db, organizationId, today);
  const seen = new Set<string>();
  const out: AutoPreviewBooking[] = [];
  for (const row of rows) {
    if (!row.check_in_date || row.check_in_date < today || row.status === "cancelled") continue;
    const id = providerBookingIdOf(row);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ providerBookingId: id, guestName: row.guest_name, propertyName: row.property_name, roomLabel: row.room_label, checkInDate: row.check_in_date });
    if (out.length >= 40) break;
  }
  return out;
}

export type AutoPreview = {
  text: string;
  lang: GuestLang;
  missing: AutoVariable[];
  /** 그 언어 본문이 비어 영어로 미리 봄. */
  fellBackToEnglish: boolean;
  noBody: boolean;
};

/** 고른 예약 · 고른 언어로 채운 글(손님 언어 대신 편집 중인 언어). 빈 변수는 그대로 두고 `missing`. */
export async function previewAutoRule(
  db: Client,
  organizationId: string,
  args: { bodies: Localized; lang: GuestLang; providerBookingId: string; now?: Date },
): Promise<AutoPreview | null> {
  const today = tokyoDateOf((args.now ?? new Date()).toISOString()) as string;
  const rows = (await loadAutoReservations(db, organizationId, today)).filter((row) => providerBookingIdOf(row) === args.providerBookingId);
  const row = rows[0];
  if (!row) return null;
  const conversation = await db
    .from("guest_conversations")
    .select("guest_language, channel")
    .eq("organization_id", organizationId)
    .eq("provider", "beds24")
    .eq("provider_booking_id", args.providerBookingId)
    .maybeSingle();
  const booking = toAutoBooking(row, (conversation.data as { guest_language: string | null; channel: string | null } | null) ?? null);
  if (!booking) return null;
  const building = await loadBuildingGuestInfo(db, organizationId, booking.propertyName);
  const ctx = autoFillContextFor(booking, building);
  const picked = pickLocalized(args.bodies, args.lang);
  if (!picked) return { text: "", lang: args.lang, missing: [], fellBackToEnglish: false, noBody: true };
  const filled = fillAutoVariables(picked.text, ctx, picked.lang);
  return { text: filled.text, lang: picked.lang, missing: filled.missing, fellBackToEnglish: picked.lang !== args.lang, noBody: false };
}
