/**
 * 이모지가 「?」로 가려진 손님 메시지를 Beds24 API 로 다시 읽어 되살리기. docs/product/47-guest-messaging.md §4-0-3
 *
 * 웹훅 본문은 이모지를 「?」로 바꿔 싣는다(2026-11-13 부터). 같은 메시지를 `GET /bookings/messages?bookingId=` 로 읽으면 이모지가 그대로라,
 * 「?」가 들어간 줄이 있는 대화만 **예약마다** 읽어 `healEmojiDamagedMessages`(판정은 `emojiMaskMatches`)로 고친다.
 * 이 실행은 **고치기만** 한다 — 새 메시지를 넣거나 대화 상태를 바꾸지 않는다(그건 웹훅 · 보정 조회 몫).
 *
 * 두 곳에서 쓴다.
 * - 웹훅 직후(`healEmojiAfterWebhook`, 웹훅 라우트의 `after()`): 「?」가 든 새 줄이 들어간 **그 예약만** 한 번(이벤트 기반 — 폴링 아님).
 *   하루 요청 `EMOJI_HEAL_DAILY_MAX_REQUESTS`(조직마다) · 같은 예약을 이미 읽었으면 건너뜀(`settings.emojiHeal`).
 * - 되살리기 모드(`/api/beds24/messages-reconcile?mode=repair`): 정한 시각 이후 오래된 순서로 `maxBookings` 개씩, 응답의 `nextCursor` 로 이어서.
 *
 * 되살리기 모드 후보: 「?」가 들어간 Beds24 줄 중 발송 큐로 보낸 직원 줄(`outbox_id`)이 아닌 것.
 * 크레딧: 보정 조회와 같은 문(동기화 멈춤 · 계정 쿨다운 · 계정 마지막 기록 < 남겨 둘 선이면 부르지 않음), 응답마다 헤더 기록,
 * 선 아래로 내려가면 남은 예약은 미룸, 429 면 계정 쿨다운. 요청 하나 = 보통 1 크레딧(예약 하나는 1~3 페이지).
 * `bookingId` 필터가 무시돼 다른 예약 줄이 섞여 오면 그 응답은 쓰지 않고 멈춘다(`filter_ignored`) — 계정 전체 첫 페이지로 크레딧만 쓰지 않게.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { readBeds24AccountCredit } from "@/lib/beds24/account-credit";
import { resolveBeds24AccessToken, type Beds24TokenState } from "@/lib/beds24/access-token";
import { createBeds24LedgerFetch } from "@/lib/beds24/credit-ledger";
import { readBeds24Credits } from "@/lib/beds24/credits";
import { isBeds24SyncPaused } from "@/lib/beds24/sync-control";
import { activateBeds24Cooldown, getBeds24Cooldown } from "@/lib/beds24/sync-locks";
import { getOptionalBeds24ApiEnv } from "@/lib/env";
import { recordGuestMessageCredit } from "@/lib/guest-messages/adapter-server";
import { parseBeds24MessagesPage } from "@/lib/guest-messages/beds24-page";
import { normalizeBeds24Message } from "@/lib/guest-messages/beds24-normalize";
import { effectiveCreditReserve, knownRemainingCredit } from "@/lib/guest-messages/credit";
import {
  claimEmojiHeal,
  emojiHealCapReached,
  pickRepairConversations,
  readEmojiHealState,
  settleEmojiHeal,
  type EmojiHealState,
} from "@/lib/guest-messages/emoji-heal";
import { healEmojiDamagedMessages } from "@/lib/guest-messages/store";
import { readGuestMessageSettings, type ChannelCreditSnapshot, type NormalizedMessage } from "@/lib/guest-messages/types";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

type Client = SupabaseClient<Database>;

/** 웹훅 배달 하나에서 다시 읽는 예약 수 상한(보통 1 — 배달 하나에 예약 하나). */
export const EMOJI_HEAL_WEBHOOK_MAX_BOOKINGS = 3;
/**
 * 웹훅 뒤 다시 읽기의 시간 예산. 사진 복사(20초)와 **동시에** 돈다. 마감 `EMOJI_HEAL_MIN_REQUEST_MS` 안에서는 새 요청을 시작하지 않고
 * 요청 시간 제한도 남은 예산까지라, 꼬리는 마지막 고치기 · 맞추기 쓰기 ~2초 → 이것 전체 ~17초(사진 20초보다 짧다).
 */
export const EMOJI_HEAL_WEBHOOK_BUDGET_MS = 15_000;
/** 되살리기 모드 한 번의 예약 수 기본값 · 상한. */
export const EMOJI_REPAIR_DEFAULT_BOOKINGS = 20;
export const EMOJI_REPAIR_MAX_BOOKINGS = 50;
/** 후보를 고를 때 읽는 「?」 줄 수 상한. */
export const EMOJI_REPAIR_SCAN_ROWS = 500;
/** 예약 하나에서 읽는 페이지 상한(메시지가 아주 많은 예약도 크레딧이 끝없이 들지 않게). */
export const EMOJI_HEAL_BOOKING_MAX_PAGES = 3;
/** 되살리기 모드 한 번의 시간 예산 — 라우트 `maxDuration` 60초 안에서 응답 · 기록까지 끝나게. */
export const EMOJI_HEAL_TIME_BUDGET_MS = 45_000;
/** 요청 하나의 시간 제한. */
const EMOJI_HEAL_REQUEST_TIMEOUT_MS = 10_000;
/** 마감까지 이보다 적게 남았으면 새 요청을 시작하지 않는다 — 시작해도 시간 제한에 잘려 크레딧만 쓴다. */
const EMOJI_HEAL_MIN_REQUEST_MS = 2_000;
/** 맞추기(settle) 쓰기 시도 수 — 잡을 때 센 1 · 읽은 표시가 남지 않게 잡기(3번)보다 넉넉히. */
const EMOJI_HEAL_SETTLE_ATTEMPTS = 6;
/** 예약 하나의 메시지 전부 — `maxAge` 를 안 주면 Beds24 기본 기간만 올 수 있어 상한(999일)으로. */
const BOOKING_MAX_AGE_DAYS = 999;

/**
 * `created_at` 에는 인덱스가 없어 `(organization_id, sent_at)` 인덱스를 타게 `sent_at` 하한도 건다 — 웹훅으로 새로 들어간 줄은 보낸 직후에
 * 들어오니 하루 여유면 빠지는 줄이 없다(오래된 `sent_at` 으로 새로 들어간 줄은 과거 가져오기 = API 본문이라 망가지지 않았다).
 */
const SENT_AT_SLACK_MS = 24 * 60 * 60_000;
function sentAtFloor(since: string): string {
  return new Date(Date.parse(since) - SENT_AT_SLACK_MS).toISOString();
}

/**
 * DB 시각(`+00:00` · 마이크로초) → Z 시각, **소수 자리는 그대로**(줄이면 같은 시각 비교가 어긋나 커서가 안 움직인다).
 * 주소에 실어도 「+」가 깨지지 않는다. UTC 가 아닌 모양만 ms 로 바꾼다.
 */
function toIsoCursor(value: string): string {
  const utc = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00|\+00)$/.exec(value);
  if (utc) return `${utc[1]}.${(utc[2] ?? "").padEnd(3, "0")}Z`;
  return new Date(Date.parse(value)).toISOString();
}

/** 이어 읽기 조건 — `since` 이후, 같은 시각이면 `sinceId` 이상(그 줄 포함). id 는 PostgREST 식에 들어가니 모양을 본다. */
function afterCursor<Q extends { gte: (column: string, value: string) => Q; or: (filters: string) => Q }>(
  query: Q,
  since: string,
  sinceId: string | null,
): Q {
  if (!sinceId || !/^[0-9A-Za-z-]{1,64}$/.test(sinceId)) return query.gte("created_at", since);
  return query.gte("created_at", since).or(`created_at.gt.${since},and(created_at.eq.${since},id.gte.${sinceId})`);
}

export type EmojiRepairSkip = "paused" | "cooldown" | "low_credit" | "missing_env" | "token" | "organization";
export type EmojiRepairStop =
  | "low_credit"
  | "rate_limited"
  | "http_error"
  | "request_error"
  | "time_budget"
  | "request_budget"
  | "filter_ignored";

export type EmojiRepairResult = {
  attempted: boolean;
  skipped: EmojiRepairSkip | null;
  stoppedEarly: EmojiRepairStop | null;
  /** 고를 후보 대화 수(이번에 담은 것). */
  conversations: number;
  /** 다 읽은 예약 수. */
  bookings: number;
  /** Beds24 요청 수(≈ 크레딧). */
  requests: number;
  healed: number;
  creditsRemaining: number | null;
  /** 다음 실행의 `since` · `sinceId`(같은 시각 줄 가르기). null = 끝(더 볼 줄 없음). */
  nextCursor: string | null;
  nextCursorId: string | null;
};

export type EmojiHealFetchContext = {
  supabase: Client;
  fetchImpl: typeof fetch;
  token: string;
  baseUrl: string;
  now: () => Date;
  reserve: number;
  /** 앞선 요청의 크레딧(있으면 첫 요청 전에도 선을 본다). */
  credit: ChannelCreditSnapshot | null;
  /** 이 시각(ms, `now()` 기준)이 지나면 새 요청을 하지 않는다. */
  deadlineAt: number;
};

type BookingHealOutcome = {
  attempted: boolean;
  stop: EmojiRepairStop | null;
  requests: number;
  healed: number;
  credit: ChannelCreditSnapshot | null;
};

/**
 * 예약 하나 — `GET /bookings/messages?bookingId=` 를 페이지마다(최대 `EMOJI_HEAL_BOOKING_MAX_PAGES`) 읽고, 다 읽었으면 그 대화 줄을 고친다.
 * 요청 전마다 시간 · 요청 수 · 남은 크레딧을 본다. 요청 시간 제한은 남은 예산 안으로 줄인다.
 */
async function healEmojiForBooking(
  ctx: EmojiHealFetchContext,
  args: { organizationId: string; conversationId: string; providerBookingId: string; maxRequests: number },
): Promise<BookingHealOutcome> {
  const out: BookingHealOutcome = { attempted: false, stop: null, requests: 0, healed: 0, credit: ctx.credit };
  const messages: NormalizedMessage[] = [];
  for (let page = 1; page <= EMOJI_HEAL_BOOKING_MAX_PAGES; page += 1) {
    const left = ctx.deadlineAt - ctx.now().getTime();
    if (left < EMOJI_HEAL_MIN_REQUEST_MS) {
      out.stop = "time_budget";
      break;
    }
    if (out.requests >= args.maxRequests) {
      out.stop = "request_budget";
      break;
    }
    const before = knownRemainingCredit(out.credit, ctx.now().getTime());
    if (before !== null && before < ctx.reserve) {
      out.stop = "low_credit";
      break;
    }
    out.attempted = true;
    let response: Response;
    try {
      response = await ctx.fetchImpl(
        `${ctx.baseUrl}/bookings/messages?bookingId=${args.providerBookingId}&maxAge=${BOOKING_MAX_AGE_DAYS}&page=${page}`,
        {
          headers: { accept: "application/json", token: ctx.token },
          cache: "no-store",
          signal: AbortSignal.timeout(Math.min(EMOJI_HEAL_REQUEST_TIMEOUT_MS, left)),
        },
      );
    } catch {
      out.stop = "request_error";
      break;
    }
    out.requests += 1;
    const headerCredit = readBeds24Credits(response.headers);
    const pageMs = ctx.now().getTime();
    const credit: ChannelCreditSnapshot = {
      remaining: headerCredit.remaining,
      resetsAt: headerCredit.resetsIn !== null ? pageMs + headerCredit.resetsIn * 1000 : null,
      requestCost: headerCredit.requestCost,
      ...(headerCredit.limit !== undefined ? { limit: headerCredit.limit } : {}),
    };
    await recordGuestMessageCredit(ctx.supabase, [args.organizationId], credit, "guest-messages-emoji-heal", pageMs);
    out.credit = credit;
    if (response.status === 429) {
      await activateBeds24Cooldown(ctx.supabase, { reason: "rate_limit", resetInSec: headerCredit.resetsIn });
      out.stop = "rate_limited";
      break;
    }
    if (!response.ok) {
      out.stop = "http_error";
      break;
    }
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    const parsed = parseBeds24MessagesPage(json);
    const receivedAt = ctx.now().toISOString();
    let foreign = 0;
    for (const row of parsed.rows) {
      const message = normalizeBeds24Message(row, { receivedAt });
      if (!message) continue;
      if (message.providerBookingId === args.providerBookingId) messages.push(message);
      else foreign += 1;
    }
    if (foreign > 0) {
      // 필터가 무시됐다 — 계정 전체가 오는 중이라 더 읽으면 크레딧만 쓴다. 본문은 남기지 않는다.
      console.warn("[guest-messages/emoji-heal] bookingId filter ignored — stopped", {
        providerBookingId: args.providerBookingId,
        foreignRows: foreign,
      });
      out.stop = "filter_ignored";
      break;
    }
    if (!parsed.nextPageExists) break;
  }
  if (out.stop) return out;
  out.healed = await healEmojiDamagedMessages(ctx.supabase, {
    organizationId: args.organizationId,
    provider: "beds24",
    conversationId: args.conversationId,
    messages,
  });
  return out;
}

/**
 * 되살리기 모드의 한 조직 — 「?」 줄이 있는 대화를 골라 예약마다 다시 읽고 고친다. 문(멈춤 · 쿨다운 · 토큰)은 부르는 쪽이 이미 통과했다.
 */
export async function healEmojiForOrganization(
  ctx: EmojiHealFetchContext,
  args: { organizationId: string; since: string; sinceId?: string | null; maxBookings: number },
): Promise<EmojiRepairResult> {
  const result: EmojiRepairResult = {
    attempted: false,
    skipped: null,
    stoppedEarly: null,
    conversations: 0,
    bookings: 0,
    requests: 0,
    healed: 0,
    creditsRemaining: null,
    nextCursor: null,
    nextCursorId: null,
  };
  const maxRequests = args.maxBookings * EMOJI_HEAL_BOOKING_MAX_PAGES;
  // 한 줄 더 읽어 뒤에 더 있는지 본다 — 그 줄이 다음 커서.
  const scan = await afterCursor(
    ctx.supabase
      .from("guest_messages")
      .select("id, conversation_id, created_at")
      .eq("organization_id", args.organizationId)
      .eq("provider", "beds24")
      .is("outbox_id", null)
      .gte("sent_at", sentAtFloor(args.since)),
    args.since,
    args.sinceId ?? null,
  )
    .like("body", "%?%")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(EMOJI_REPAIR_SCAN_ROWS + 1);
  if (scan.error) throw new Error(`emoji heal scan failed: ${scan.error.message}`);
  const rows = (scan.data ?? []) as Array<{ id: string; conversation_id: string; created_at: string }>;
  const picked = pickRepairConversations(rows, args.maxBookings, { scanLimit: EMOJI_REPAIR_SCAN_ROWS });
  result.conversations = picked.conversationIds.length;
  result.nextCursor = picked.nextCursor ? toIsoCursor(picked.nextCursor.createdAt) : null;
  result.nextCursorId = picked.nextCursor?.id ?? null;
  if (picked.conversationIds.length === 0) return result;

  const firstSeen = new Map<string, { createdAt: string; id: string }>();
  for (const row of rows) if (!firstSeen.has(row.conversation_id)) firstSeen.set(row.conversation_id, { createdAt: row.created_at, id: row.id });

  const conversations = await ctx.supabase
    .from("guest_conversations")
    .select("id, provider_booking_id")
    .eq("organization_id", args.organizationId)
    .eq("provider", "beds24")
    .in("id", picked.conversationIds);
  if (conversations.error) throw new Error(`emoji heal conversation read failed: ${conversations.error.message}`);
  const bookingOf = new Map(
    ((conversations.data ?? []) as Array<{ id: string; provider_booking_id: string }>).map((row) => [row.id, row.provider_booking_id]),
  );

  let credit = ctx.credit;
  for (const conversationId of picked.conversationIds) {
    const providerBookingId = bookingOf.get(conversationId);
    if (!providerBookingId || !/^\d{1,15}$/.test(providerBookingId)) continue;
    const outcome = await healEmojiForBooking(
      { ...ctx, credit },
      { organizationId: args.organizationId, conversationId, providerBookingId, maxRequests: maxRequests - result.requests },
    );
    credit = outcome.credit;
    result.attempted ||= outcome.attempted;
    result.requests += outcome.requests;
    result.healed += outcome.healed;
    if (credit) result.creditsRemaining = credit.remaining;
    if (outcome.stop) {
      result.stoppedEarly = outcome.stop;
      const first = firstSeen.get(conversationId);
      result.nextCursor = first ? toIsoCursor(first.createdAt) : args.since;
      result.nextCursorId = first ? first.id : (args.sinceId ?? null);
      break;
    }
    result.bookings += 1;
  }
  return result;
}

/**
 * `settings.emojiHeal` 고치기 — 다른 키는 그대로. 읽은 뒤 누가 이 줄을 고쳤으면(`updated_at` 이 다르면) 다시 읽어 `attempts` 번까지
 * (크레딧 기록 · 웹훅 시각 기록이 같은 줄을 자주 고친다). `mutate` 가 null 이면 쓰지 않는다. 쓴 상태 또는 null.
 */
async function updateEmojiHealState<T>(
  supabase: Client,
  organizationId: string,
  mutate: (state: EmojiHealState) => { state: EmojiHealState; value: T } | null,
  attempts = 3,
): Promise<{ state: EmojiHealState; value: T } | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const current = await supabase
      .from("guest_message_channel_state")
      .select("settings, updated_at")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (current.error || !current.data) return null;
    const row = current.data as { settings: unknown; updated_at: string };
    const next = mutate(readEmojiHealState(row.settings));
    if (!next) return null;
    const base = row.settings && typeof row.settings === "object" && !Array.isArray(row.settings) ? (row.settings as Record<string, unknown>) : {};
    const written = await supabase
      .from("guest_message_channel_state")
      .update({ settings: { ...base, emojiHeal: next.state } as unknown as Json })
      .eq("organization_id", organizationId)
      .eq("updated_at", row.updated_at)
      .select("organization_id");
    if (written.error) {
      console.error("[guest-messages/emoji-heal] state write failed", written.error.message);
      return null;
    }
    if ((written.data ?? []).length > 0) return next;
  }
  console.warn("[guest-messages/emoji-heal] state kept changing — skipped", { organizationId });
  return null;
}

/** 그날 상한에 처음 닿았을 때 한 번 — 조직 id 만(본문 · 토큰 없음). 나머지는 되살리기 모드로 고친다. */
function warnDailyCap(organizationId: string) {
  console.warn("[guest-messages/emoji-heal] daily cap reached — rest of the day stays masked", { organizationId });
}

/** 웹훅으로 「?」가 든 새 줄이 들어간 예약. `insertedAt` = 그 줄을 넣은 **뒤** 시각. */
export type EmojiHealSuspect = {
  organizationId: string;
  conversationId: string;
  providerBookingId: string;
  insertedAt: string;
};

export type EmojiWebhookHealResult = {
  skipped: EmojiRepairSkip | null;
  stoppedEarly: EmojiRepairStop | null;
  bookings: number;
  requests: number;
  healed: number;
};

/**
 * 웹훅 직후 — 「?」가 든 새 줄이 들어간 예약만 한 번씩 API 로 다시 읽어 고친다(47 §4-0-3, 2026-11-27 사용자 승인 — 이벤트 기반).
 * 문: 동기화 멈춤 · 계정 쿨다운 · 남겨 둘 선 · 조직마다 하루 상한 · 같은 예약을 이미 읽음 · 시간 예산. 429 면 계정 쿨다운.
 * **절대 던지지 않는다** — 웹훅 응답 · 받기는 이미 끝났다.
 */
export async function healEmojiAfterWebhook(
  supabase: Client,
  suspects: readonly EmojiHealSuspect[],
  deps: {
    fetchImpl?: typeof fetch;
    resolveToken?: () => Promise<Beds24TokenState>;
    baseUrl?: string | null;
    now?: () => Date;
  } = {},
): Promise<EmojiWebhookHealResult> {
  const result: EmojiWebhookHealResult = { skipped: null, stoppedEarly: null, bookings: 0, requests: 0, healed: 0 };
  const unique = new Map<string, EmojiHealSuspect>();
  for (const suspect of suspects) {
    if (!/^\d{1,15}$/.test(suspect.providerBookingId)) continue;
    const key = `${suspect.organizationId}:${suspect.providerBookingId}`;
    const prev = unique.get(key);
    if (!prev || Date.parse(suspect.insertedAt) > Date.parse(prev.insertedAt)) unique.set(key, suspect);
  }
  const picked = [...unique.values()].slice(0, EMOJI_HEAL_WEBHOOK_MAX_BOOKINGS);
  if (picked.length === 0) return result;
  try {
    const now = deps.now ?? (() => new Date());
    const deadlineAt = now().getTime() + EMOJI_HEAL_WEBHOOK_BUDGET_MS;
    const baseUrl = (deps.baseUrl !== undefined ? deps.baseUrl : getOptionalBeds24ApiEnv()?.baseUrl ?? null)?.replace(/\/$/, "");
    if (!baseUrl) return { ...result, skipped: "missing_env" };
    if (isBeds24SyncPaused()) return { ...result, skipped: "paused" };
    if ((await getBeds24Cooldown(supabase)).active) return { ...result, skipped: "cooldown" };
    let credit: ChannelCreditSnapshot | null = await readBeds24AccountCredit(supabase, now().getTime());
    let token: string | null = null;

    for (const suspect of picked) {
      const state = await supabase
        .from("guest_message_channel_state")
        .select("organization_id, settings, night_pause, credit_reserve, stall_hours")
        .eq("organization_id", suspect.organizationId)
        .maybeSingle();
      const reserve = effectiveCreditReserve(
        readGuestMessageSettings((state.data as Parameters<typeof readGuestMessageSettings>[0]) ?? null).creditReserve,
      );
      const remaining = knownRemainingCredit(credit, now().getTime());
      if (remaining !== null && remaining < reserve) {
        if (result.requests === 0) return { ...result, skipped: "low_credit" };
        return { ...result, stoppedEarly: "low_credit" };
      }

      // 마감이 가까우면 몫을 잡지도 토큰을 풀지도 않는다.
      if (deadlineAt - now().getTime() < EMOJI_HEAL_MIN_REQUEST_MS) {
        result.stoppedEarly = "time_budget";
        break;
      }

      const settle = async (requests: number, opts: { haltForDay: boolean; forget: boolean }) => {
        const settled = await updateEmojiHealState(
          supabase,
          suspect.organizationId,
          (current) => {
            const next = settleEmojiHeal(current, { providerBookingId: suspect.providerBookingId, requests, nowMs: now().getTime(), ...opts });
            return { state: next, value: !opts.haltForDay && emojiHealCapReached(current, next) };
          },
          EMOJI_HEAL_SETTLE_ATTEMPTS,
        );
        if (settled?.value) warnDailyCap(suspect.organizationId);
      };

      const claim = await updateEmojiHealState(supabase, suspect.organizationId, (current) => {
        const next = claimEmojiHeal(current, { providerBookingId: suspect.providerBookingId, insertedAt: suspect.insertedAt, nowMs: now().getTime() });
        return next.claimed ? { state: next.state, value: emojiHealCapReached(current, next.state) } : null;
      });
      if (!claim) continue;
      if (claim.value) warnDailyCap(suspect.organizationId);

      if (token === null) {
        const resolved = await (deps.resolveToken ?? (() => resolveBeds24AccessToken("guest-messages-emoji-heal")))();
        if (!resolved.ok) {
          await settle(0, { haltForDay: false, forget: true });
          return { ...result, skipped: "token" };
        }
        token = resolved.token;
      }

      const outcome = await healEmojiForBooking(
        {
          supabase,
          fetchImpl:
            deps.fetchImpl ??
            createBeds24LedgerFetch({
              feature: "guest_messages",
              action: "messages.emoji_heal",
              job: "guest_messages_emoji_heal",
              organizationId: suspect.organizationId,
            }),
          token,
          baseUrl,
          now,
          reserve,
          credit,
          deadlineAt,
        },
        {
          organizationId: suspect.organizationId,
          conversationId: suspect.conversationId,
          providerBookingId: suspect.providerBookingId,
          maxRequests: EMOJI_HEAL_BOOKING_MAX_PAGES,
        },
      );
      credit = outcome.credit;
      result.requests += outcome.requests;
      result.healed += outcome.healed;
      // 끝까지 읽어 고친 것만 「읽음」으로 남긴다 — 멈췄거나 한 번도 못 불렀으면 다음 배달이 다시 읽게.
      await settle(outcome.requests, {
        haltForDay: outcome.stop === "filter_ignored",
        forget: outcome.stop !== null || outcome.requests === 0,
      });
      if (outcome.stop) {
        result.stoppedEarly = outcome.stop;
        break;
      }
      result.bookings += 1;
    }
  } catch (error) {
    console.error("[guest-messages/emoji-heal] webhook heal failed", error instanceof Error ? error.message : "unknown");
  }
  return result;
}

/**
 * 되살리기 모드 — 한 조직, `since`(ISO) 이후 「?」 줄이 있는 대화를 오래된 순서로 `maxBookings` 개.
 * 쓰기는 `emojiMaskMatches` 가 맞을 때만이라 몇 번을 다시 돌려도 같다(멱등).
 */
export async function repairEmojiDamagedMessages(
  organizationId: string,
  args: { since: string; sinceId?: string | null; maxBookings?: number },
  deps: {
    supabase?: Client;
    fetchImpl?: typeof fetch;
    resolveToken?: () => Promise<Beds24TokenState>;
    baseUrl?: string | null;
    now?: () => Date;
  } = {},
): Promise<EmojiRepairResult> {
  const supabase = deps.supabase ?? getSupabaseServiceClient();
  const now = deps.now ?? (() => new Date());
  const deadlineAt = now().getTime() + EMOJI_HEAL_TIME_BUDGET_MS;
  const maxBookings = Math.min(EMOJI_REPAIR_MAX_BOOKINGS, Math.max(1, Math.floor(args.maxBookings ?? EMOJI_REPAIR_DEFAULT_BOOKINGS)));
  const result: EmojiRepairResult = {
    attempted: false,
    skipped: null,
    stoppedEarly: null,
    conversations: 0,
    bookings: 0,
    requests: 0,
    healed: 0,
    creditsRemaining: null,
    nextCursor: args.since,
    nextCursorId: args.sinceId ?? null,
  };

  const organization = await supabase.from("organizations").select("id, status").eq("id", organizationId).maybeSingle();
  if (organization.error) throw new Error(`emoji repair organization read failed: ${organization.error.message}`);
  if (!organization.data || (organization.data as { status: string }).status !== "active") {
    return { ...result, skipped: "organization", nextCursor: null, nextCursorId: null };
  }

  const baseUrl = (deps.baseUrl !== undefined ? deps.baseUrl : getOptionalBeds24ApiEnv()?.baseUrl ?? null)?.replace(/\/$/, "");
  if (!baseUrl) return { ...result, skipped: "missing_env" };
  if (isBeds24SyncPaused()) return { ...result, skipped: "paused" };
  if ((await getBeds24Cooldown(supabase)).active) return { ...result, skipped: "cooldown" };

  const state = await supabase
    .from("guest_message_channel_state")
    .select("organization_id, settings, night_pause, credit_reserve, stall_hours")
    .eq("organization_id", organizationId)
    .maybeSingle();
  const reserve = effectiveCreditReserve(
    readGuestMessageSettings((state.data as Parameters<typeof readGuestMessageSettings>[0]) ?? null).creditReserve,
  );
  const nowMs = now().getTime();
  const account = await readBeds24AccountCredit(supabase, nowMs);
  const remainingBefore = knownRemainingCredit(account, nowMs);
  if (remainingBefore !== null && remainingBefore < reserve) {
    return { ...result, skipped: "low_credit", creditsRemaining: remainingBefore };
  }

  // 후보가 없으면 토큰도 Beds24 도 부르지 않는다 — 먼저 고르고(읽기만), 있을 때만 토큰.
  const probe = await afterCursor(
    supabase
      .from("guest_messages")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("provider", "beds24")
      .is("outbox_id", null)
      .gte("sent_at", sentAtFloor(args.since)),
    args.since,
    args.sinceId ?? null,
  )
    .like("body", "%?%")
    .limit(1);
  if (probe.error) throw new Error(`emoji repair probe failed: ${probe.error.message}`);
  if ((probe.data ?? []).length === 0) return { ...result, nextCursor: null, nextCursorId: null };

  const token = await (deps.resolveToken ?? (() => resolveBeds24AccessToken("guest-messages-emoji-repair")))();
  if (!token.ok) return { ...result, skipped: "token" };

  const run = await healEmojiForOrganization(
    {
      supabase,
      fetchImpl:
        deps.fetchImpl ??
        createBeds24LedgerFetch({ feature: "guest_messages", action: "messages.emoji_repair", job: "guest_messages_emoji_repair", organizationId }),
      token: token.token,
      baseUrl,
      now,
      reserve,
      credit: account,
      deadlineAt,
    },
    { organizationId, since: args.since, sinceId: args.sinceId ?? null, maxBookings },
  );
  return run;
}
