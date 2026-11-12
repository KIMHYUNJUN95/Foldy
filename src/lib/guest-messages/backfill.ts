/**
 * 손님 메시지 — 과거 메시지 가져오기(한 번만, 이어 받기). docs/product/47-guest-messaging.md §4-0-2
 *
 * 2026-11-12 사용자 결정: Beds24 가 주는 과거 메시지를 전부(`maxAge=999`일) 가져온다.
 *
 * - `GET /bookings/messages?maxAge=999&page=N` — 거르지 않는다(읽음 · 안 읽음 · 모든 채널). 한 번 실행에 최대 `maxPages` 페이지 · 시간 예산 안에서.
 * - **조직 하나 기준**으로 계정 전체를 훑는다. 예약 → 조직은 매핑 · 기존 대화로만 정한다(**기본 조직 값은 쓰지 않는다** — 몇 년치를
 *   엉뚱한 조직에 넣지 않게). 다른 조직 · 조직 못 정함 · 엇갈림은 넣지 않고 세기만(+ 예약 번호만 로그).
 * - 실행 소유: claim 이 `run_id` 를 붙여 준다. 모든 상태 쓰기는 `status = 'running' and run_id = 내 번호` 조건이고 페이지마다 lease 를 늘린다.
 *   쓰기가 0행이면 다른 실행이 잡은 것 — 바로 멈춘다(`lost_lease`).
 * - 커서: 페이지를 다 넣은 뒤에만 앞으로. 이어 받을 때는 **앞 페이지(next_page − 1)부터 다시** 읽는다(페이지 경계 밀림 대비, 중복은 안 들어감 —
 *   그 페이지는 새로 들어간 수만 센다). 예약 넣기가 실패한 페이지는 커서 · 숫자를 그대로 두고 멈추고, 같은 페이지가 3번 실패하면
 *   실패한 예약 번호를 `failed_booking_ids` 에 남기고 넘어간다.
 * - 크레딧: 가져오기 전용 선(`backfillStopLine` — 발송 선보다 훨씬 높다)을 **페이지마다 부르기 전에** 본다: 남은 크레딧 − 마지막 비용 × 2 가 선 아래면 멈춘다.
 *   남은 크레딧을 모르면 첫 페이지만 읽는다. 429 면 계정 쿨다운 + 리셋 시각을 `resume_after` 에 남긴다.
 * - 과거 메시지는 「답장 기다림 · 늦음」을 만들지 않는다: `ingestConversationMessages({ history: true })`.
 *
 * 재기 모드(`mode: "measure"`): `maxAge=7` 첫 페이지 하나만 읽고 넣지 않는다. 건수 · 비용 · 남은 크레딧 · 정렬 방향을 `last_measure` 에 남긴다(V3). 5분에 한 번.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { readBeds24AccountCredit } from "@/lib/beds24/account-credit";
import { resolveBeds24AccessToken, type Beds24TokenState } from "@/lib/beds24/access-token";
import { LOW_CREDIT_THRESHOLD } from "@/lib/beds24/calendar-client";
import { readBeds24Credits } from "@/lib/beds24/credits";
import { isBeds24SyncPaused } from "@/lib/beds24/sync-control";
import { activateBeds24Cooldown, getBeds24Cooldown } from "@/lib/beds24/sync-locks";
import { readMappedOrganizationIds } from "@/lib/beds24/webhook-organization";
import { getOptionalBeds24ApiEnv } from "@/lib/env";
import { recordGuestMessageCredit } from "@/lib/guest-messages/adapter-server";
import { normalizeBeds24Message } from "@/lib/guest-messages/beds24-normalize";
import { effectiveCreditReserve, knownRemainingCredit } from "@/lib/guest-messages/credit";
import { decideReconcileOrganization } from "@/lib/guest-messages/org-resolve";
import { parseBeds24MessagesPage } from "@/lib/guest-messages/reconcile";
import { groupMessagesByBooking, ingestConversationMessages, resolveConversationSeed } from "@/lib/guest-messages/store";
import { readGuestMessageSettings, type NormalizedMessage } from "@/lib/guest-messages/types";
import { warnAssumedUtcTimes } from "@/lib/guest-messages/webhook-ingest";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const BACKFILL_MAX_AGE_DAYS = 999;
export const BACKFILL_MEASURE_MAX_AGE_DAYS = 7;
/** 한 번 실행에 읽는 페이지 수 기본값. */
export const BACKFILL_PAGES_PER_RUN = 10;
/** 라우트가 받는 `pages` 상한. */
export const BACKFILL_MAX_PAGES_PER_CALL = 20;
/** 한 번 실행의 시간 예산 — 함수 최대 시간(300초)보다 짧게. 넘으면 다음 페이지를 읽지 않고 멈춘다(paused). */
export const BACKFILL_TIME_BUDGET_MS = 240_000;
/** lease 길이 — 페이지마다 늘린다. 함수가 끊기면 이 시간 뒤 다른 실행이 잡을 수 있다. */
export const BACKFILL_LEASE_SECONDS = 120;
/** 같은 페이지가 이만큼 실패하면 실패 예약 번호를 남기고 넘어간다. */
export const BACKFILL_POISON_ATTEMPTS = 3;
export const BACKFILL_FAILED_IDS_MAX = 500;
/** 계정 5분 한도(지금 200 — 47 Q8). 가져오기 선 계산용. */
export const BACKFILL_ASSUMED_FIVE_MIN_LIMIT = 200;
/** 가져오기 선 = max(남겨 둘 선 + 40, 5분 한도의 50%). 발송 · 직원 답장 몫을 넉넉히 남긴다. */
export const BACKFILL_RESERVE_MARGIN = 40;
export const BACKFILL_LIMIT_SHARE = 0.5;
/** 다음 페이지 비용 = 마지막 비용 × 이 값(모르면 1 × 이 값). */
export const BACKFILL_COST_SAFETY = 2;
export const BACKFILL_MEASURE_INTERVAL_MS = 5 * 60_000;

export type BackfillStatus = "idle" | "running" | "paused" | "done" | "failed";
/** 실행 전에 멈춘 이유. busy = 다른 실행이 도는 중 · done = 이미 끝남(다시 하려면 restart) · too_soon = 재기는 5분에 한 번. */
export type BackfillSkip = "busy" | "done" | "too_soon" | "missing_env" | "paused" | "cooldown" | "low_credit" | "token";
/** 도중에 멈춘 이유. max_pages · time_budget = 이번 몫을 다 씀 · credit_unknown = 남은 크레딧을 몰라 첫 페이지만 읽음 · lost_lease = 다른 실행이 잡음. */
export type BackfillStop =
  | "max_pages"
  | "time_budget"
  | "credit_unknown"
  | "low_credit"
  | "rate_limited"
  | "http_error"
  | "request_error"
  | "failed_bookings"
  | "lost_lease";

export type BackfillMeasure = {
  at: string;
  rows: number;
  requestCost: number | null;
  remaining: number | null;
  resetsIn: number | null;
  nextPageExists: boolean;
  /** 페이지 안 메시지 시각 순서(`asc` 오래된 것 먼저 · `desc` 새 것 먼저 · `mixed` · `unknown` 2건 미만). */
  order: "asc" | "desc" | "mixed" | "unknown";
};

export type BackfillResult = {
  mode: "run" | "measure";
  organizationId: string;
  status: BackfillStatus | null;
  skipped: BackfillSkip | null;
  stoppedEarly: BackfillStop | null;
  pages: number;
  fetched: number;
  imported: number;
  duplicates: number;
  unrouted: number;
  failedBookings: number;
  nextPage: number | null;
  creditsRemaining: number | null;
  resumeAfter: string | null;
  measure: BackfillMeasure | null;
};

type Client = SupabaseClient<Database>;
type StateRow = Database["public"]["Tables"]["guest_message_backfill_state"]["Row"];

export type BackfillDeps = {
  supabase?: Client;
  fetchImpl?: typeof fetch;
  resolveToken?: () => Promise<Beds24TokenState>;
  baseUrl?: string | null;
  now?: () => Date;
  maxPages?: number;
};

/** 실패로 볼 결과인가(라우트 207). busy · done · 몫 소진 · 크레딧 멈춤은 정상. */
export function isBackfillFailure(result: BackfillResult): boolean {
  return (
    result.skipped === "token" ||
    result.skipped === "missing_env" ||
    result.stoppedEarly === "http_error" ||
    result.stoppedEarly === "request_error" ||
    result.stoppedEarly === "failed_bookings"
  );
}

/** 멈춘 이유 → 남길 상태. 다시 돌리면 이어지는 것은 paused, 사람이 봐야 하는 것은 failed. */
export function backfillStatusAfter(reason: BackfillSkip | BackfillStop | null, nextPageExists: boolean): BackfillStatus {
  if (reason === null) return nextPageExists ? "paused" : "done";
  if (reason === "missing_env" || reason === "token" || reason === "http_error" || reason === "request_error" || reason === "failed_bookings") {
    return "failed";
  }
  return "paused";
}

/** 가져오기 선. 남겨 둘 선(≥ 10)보다 늘 높아서 계정 저크레딧 쿨다운(10)까지 내려가지 않는다. */
export function backfillStopLine(reserve: number): number {
  return Math.max(
    reserve + BACKFILL_RESERVE_MARGIN,
    Math.ceil(BACKFILL_ASSUMED_FIVE_MIN_LIMIT * BACKFILL_LIMIT_SHARE),
    LOW_CREDIT_THRESHOLD + BACKFILL_RESERVE_MARGIN,
  );
}

/** 다음 페이지를 읽어도 되는가. remaining 을 모르면 첫 페이지만. */
export function canReadNextPage(args: {
  remaining: number | null;
  lastRequestCost: number | null;
  stopLine: number;
  pagesReadThisRun: number;
}): "ok" | "low_credit" | "credit_unknown" {
  if (args.remaining === null) return args.pagesReadThisRun === 0 ? "ok" : "credit_unknown";
  const cost = Math.max(1, args.lastRequestCost ?? 1) * BACKFILL_COST_SAFETY;
  return args.remaining - cost < args.stopLine ? "low_credit" : "ok";
}

/** 메시지 시각 순서(재기 모드 기록용). */
export function observedOrder(sentAts: readonly string[]): BackfillMeasure["order"] {
  const times = sentAts.map((value) => Date.parse(value)).filter((value) => Number.isFinite(value));
  if (times.length < 2) return "unknown";
  let up = false;
  let down = false;
  for (let i = 1; i < times.length; i += 1) {
    if (times[i] > times[i - 1]) up = true;
    if (times[i] < times[i - 1]) down = true;
  }
  if (up && down) return "mixed";
  if (down) return "desc";
  return "asc";
}

async function readReserve(supabase: Client, organizationId: string): Promise<number> {
  const state = await supabase
    .from("guest_message_channel_state")
    .select("organization_id, settings, night_pause, credit_reserve, stall_hours")
    .eq("organization_id", organizationId)
    .maybeSingle();
  const row = (state.data ?? null) as Parameters<typeof readGuestMessageSettings>[0];
  return effectiveCreditReserve(readGuestMessageSettings(row).creditReserve);
}

function emptyResult(mode: BackfillResult["mode"], organizationId: string): BackfillResult {
  return {
    mode,
    organizationId,
    status: null,
    skipped: null,
    stoppedEarly: null,
    pages: 0,
    fetched: 0,
    imported: 0,
    duplicates: 0,
    unrouted: 0,
    failedBookings: 0,
    nextPage: null,
    creditsRemaining: null,
    resumeAfter: null,
    measure: null,
  };
}

/** 진행 줄 읽기(화면 · 서버 액션용). 없으면 null. */
export async function readGuestMessageBackfillState(supabase: Client, organizationId: string): Promise<StateRow | null> {
  const result = await supabase
    .from("guest_message_backfill_state")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (result.error) throw new Error(`backfill state read failed: ${result.error.message}`);
  return (result.data ?? null) as StateRow | null;
}

/** 내 실행일 때만 쓴다. false = 0행(다른 실행이 잡음) 또는 쓰기 실패. */
async function writeOwnedState(
  supabase: Client,
  organizationId: string,
  runId: string,
  patch: Partial<StateRow>,
): Promise<boolean> {
  const result = await supabase
    .from("guest_message_backfill_state")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("status", "running")
    .eq("run_id", runId)
    .select("organization_id");
  if (result.error) {
    console.error("[guest-messages/backfill] state write failed", result.error.message);
    return false;
  }
  return (result.data ?? []).length > 0;
}

type PreflightOk = {
  ok: true;
  baseUrl: string;
  token: string;
  stopLine: number;
  remaining: number | null;
  lastRequestCost: number | null;
};
type PreflightFail = { ok: false; reason: BackfillSkip; creditsRemaining: number | null; resumeAfter: string | null };

/** 부르기 전 확인 — 설정 → 멈춤 → 쿨다운 → 크레딧(가져오기 선) → 토큰. */
async function preflight(
  supabase: Client,
  organizationId: string,
  deps: BackfillDeps,
  now: () => Date,
): Promise<PreflightOk | PreflightFail> {
  const baseUrl = (deps.baseUrl !== undefined ? deps.baseUrl : getOptionalBeds24ApiEnv()?.baseUrl ?? null)?.replace(/\/$/, "");
  if (!baseUrl) return { ok: false, reason: "missing_env", creditsRemaining: null, resumeAfter: null };
  if (isBeds24SyncPaused()) return { ok: false, reason: "paused", creditsRemaining: null, resumeAfter: null };
  const cooldown = await getBeds24Cooldown(supabase);
  if (cooldown.active) return { ok: false, reason: "cooldown", creditsRemaining: null, resumeAfter: cooldown.until };
  const stopLine = backfillStopLine(await readReserve(supabase, organizationId));
  const nowMs = now().getTime();
  const account = await readBeds24AccountCredit(supabase, nowMs);
  const remaining = knownRemainingCredit(account, nowMs);
  const lastRequestCost = account?.requestCost ?? null;
  if (canReadNextPage({ remaining, lastRequestCost, stopLine, pagesReadThisRun: 0 }) === "low_credit") {
    return {
      ok: false,
      reason: "low_credit",
      creditsRemaining: remaining,
      resumeAfter: account?.resetsAt ? new Date(account.resetsAt).toISOString() : null,
    };
  }
  const token = await (deps.resolveToken ?? (() => resolveBeds24AccessToken("guest-messages-backfill")))();
  if (!token.ok) return { ok: false, reason: "token", creditsRemaining: remaining, resumeAfter: null };
  return { ok: true, baseUrl, token: token.token, stopLine, remaining, lastRequestCost };
}

type PageCredit = { remaining: number | null; resetsAt: number | null; requestCost: number | null };
type PageFetch =
  | { ok: true; rows: unknown[]; nextPageExists: boolean; credit: PageCredit; resetsIn: number | null; pageMs: number }
  | { ok: false; stop: "rate_limited" | "http_error" | "request_error"; remaining: number | null; resetsAt: number | null };

async function fetchPage(
  supabase: Client,
  organizationId: string,
  url: string,
  token: string,
  fetchImpl: typeof fetch,
  now: () => Date,
): Promise<PageFetch> {
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { accept: "application/json", token }, cache: "no-store" });
  } catch {
    return { ok: false, stop: "request_error", remaining: null, resetsAt: null };
  }
  const header = readBeds24Credits(response.headers);
  const pageMs = now().getTime();
  const credit = {
    remaining: header.remaining,
    resetsAt: header.resetsIn !== null ? pageMs + header.resetsIn * 1000 : null,
    requestCost: header.requestCost,
    ...(header.limit !== undefined ? { limit: header.limit } : {}),
  };
  await recordGuestMessageCredit(supabase, [organizationId], credit, "guest-messages-backfill", pageMs);
  if (response.status === 429) {
    await activateBeds24Cooldown(supabase, { reason: "rate_limit", resetInSec: header.resetsIn });
    return { ok: false, stop: "rate_limited", remaining: credit.remaining, resetsAt: credit.resetsAt };
  }
  if (!response.ok) return { ok: false, stop: "http_error", remaining: credit.remaining, resetsAt: credit.resetsAt };
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  const parsed = parseBeds24MessagesPage(json);
  return { ok: true, rows: parsed.rows, nextPageExists: parsed.nextPageExists, credit, resetsIn: header.resetsIn, pageMs };
}

type PageIngest = { imported: number; duplicates: number; unrouted: number; failedBookingIds: string[] };

/** 한 페이지 메시지를 예약별로 조직을 정해 넣는다(history: true). 기본 조직 값(BEDS24_DEFAULT_ORGANIZATION_ID)은 쓰지 않는다. */
async function ingestPage(
  supabase: Client,
  organizationId: string,
  messages: readonly NormalizedMessage[],
  now: () => Date,
): Promise<PageIngest> {
  const out: PageIngest = { imported: 0, duplicates: 0, unrouted: 0, failedBookingIds: [] };
  for (const [providerBookingId, group] of groupMessagesByBooking(messages)) {
    const first = group[0];
    try {
      const mapped = await readMappedOrganizationIds(supabase, {
        externalPropertyId: first.externalPropertyId,
        externalRoomId: first.externalRoomId,
      });
      const existing = await supabase
        .from("guest_conversations")
        .select("organization_id")
        .eq("provider", "beds24")
        .eq("provider_booking_id", providerBookingId);
      if (existing.error) throw new Error(`conversation owner lookup failed: ${existing.error.message}`);
      const decision = decideReconcileOrganization({
        mapped,
        existing: ((existing.data ?? []) as Array<{ organization_id: string }>).map((row) => row.organization_id),
        fallback: null,
      });
      if (decision.mismatch || !decision.organizationId) {
        out.unrouted += group.length;
        console.warn("[guest-messages/backfill] booking skipped — organization", {
          providerBookingId,
          reason: decision.mismatch ? "mismatch" : "unknown",
        });
        continue;
      }
      if (decision.organizationId !== organizationId) {
        out.unrouted += group.length;
        continue;
      }
      const seed = await resolveConversationSeed(supabase, {
        organizationId,
        providerBookingId,
        booking: null,
        externalPropertyId: first.externalPropertyId,
        externalRoomId: first.externalRoomId,
      });
      const ingest = await ingestConversationMessages(supabase, {
        organizationId,
        provider: "beds24",
        providerBookingId,
        seed,
        messages: group,
        now: now(),
        history: true,
      });
      out.imported += ingest.inserted;
      out.duplicates += ingest.duplicates + ingest.merged;
    } catch (error) {
      out.failedBookingIds.push(providerBookingId);
      console.error("[guest-messages/backfill] booking ingest failed", {
        providerBookingId,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return out;
}

/**
 * 과거 메시지 가져오기 한 번 실행. `restart` 면 1페이지부터 다시(끝난 것도). `mode: "measure"` 는 재기만.
 * claim 실패만 던진다 — 나머지는 결과의 skipped / stoppedEarly 로 알린다.
 */
export async function backfillGuestMessageHistory(
  organizationId: string,
  options: { mode?: "run" | "measure"; restart?: boolean } = {},
  deps: BackfillDeps = {},
): Promise<BackfillResult> {
  const mode = options.mode ?? "run";
  const supabase = deps.supabase ?? getSupabaseServiceClient();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => new Date());
  const startedMs = now().getTime();
  const result = emptyResult(mode, organizationId);

  if (mode === "measure") return measure(supabase, organizationId, result, deps, fetchImpl, now);

  const claimed = await supabase.rpc("guest_message_backfill_claim", {
    p_organization_id: organizationId,
    p_restart: options.restart === true,
    p_lease_seconds: BACKFILL_LEASE_SECONDS,
    p_now: now().toISOString(),
  });
  if (claimed.error) throw new Error(`backfill claim failed: ${claimed.error.message}`);
  const state = (Array.isArray(claimed.data) ? claimed.data[0] : null) as StateRow | null | undefined;
  if (!state || !state.run_id) {
    const current = await readGuestMessageBackfillState(supabase, organizationId);
    result.skipped = current?.status === "done" ? "done" : "busy";
    result.status = (current?.status as BackfillStatus | undefined) ?? null;
    result.nextPage = current?.next_page ?? null;
    return result;
  }
  const runId = state.run_id;
  const leaseUntil = () => new Date(now().getTime() + BACKFILL_LEASE_SECONDS * 1000).toISOString();

  const counters = {
    pages_done: state.pages_done,
    fetched_count: state.fetched_count,
    imported_count: state.imported_count,
    skipped_count: state.skipped_count,
    unrouted_count: state.unrouted_count,
    failed_bookings: state.failed_bookings,
  };
  let failedIds = [...(state.failed_booking_ids ?? [])];
  let pageAttempts = state.page_attempts ?? 0;
  const storedNextPage = Math.max(1, state.next_page);
  // 이어 받을 때는 앞 페이지부터(경계 밀림 대비). 처음이면 1페이지.
  const overlapPage = storedNextPage > 1 ? storedNextPage - 1 : null;
  let page = overlapPage ?? storedNextPage;
  let nextPage = storedNextPage;
  const maxAge = state.max_age_days || BACKFILL_MAX_AGE_DAYS;

  const release = async (reason: BackfillSkip | BackfillStop | null, nextPageExists: boolean) => {
    const status = backfillStatusAfter(reason, nextPageExists);
    const nowIso = now().toISOString();
    const owned = await writeOwnedState(supabase, organizationId, runId, {
      ...counters,
      status,
      next_page: nextPage,
      page_attempts: pageAttempts,
      failed_booking_ids: failedIds,
      last_run_at: nowIso,
      last_error: reason === "max_pages" || reason === "time_budget" ? null : reason,
      resume_after: result.resumeAfter,
      lease_until: null,
      ...(status === "done" ? { finished_at: nowIso } : {}),
    });
    if (!owned) {
      result.stoppedEarly = "lost_lease";
      result.status = null;
    } else {
      result.status = status;
    }
    result.nextPage = nextPage;
    return result;
  };

  const ready = await preflight(supabase, organizationId, deps, now);
  if (!ready.ok) {
    result.skipped = ready.reason;
    result.creditsRemaining = ready.creditsRemaining;
    result.resumeAfter = ready.resumeAfter;
    return release(ready.reason, true);
  }

  const maxPages = Math.min(BACKFILL_MAX_PAGES_PER_CALL, Math.max(1, deps.maxPages ?? BACKFILL_PAGES_PER_RUN));
  let remaining = ready.remaining;
  let lastRequestCost = ready.lastRequestCost;
  let lastResetsAt: number | null = null;
  let nextPageExists = true;
  for (let read = 0; read < maxPages; read += 1) {
    if (read > 0 && now().getTime() - startedMs > BACKFILL_TIME_BUDGET_MS) {
      result.stoppedEarly = "time_budget";
      return release("time_budget", true);
    }
    const gate = canReadNextPage({ remaining, lastRequestCost, stopLine: ready.stopLine, pagesReadThisRun: read });
    if (gate !== "ok") {
      result.stoppedEarly = gate;
      if (gate === "low_credit" && lastResetsAt !== null) result.resumeAfter = new Date(lastResetsAt).toISOString();
      return release(gate, true);
    }
    const fetched = await fetchPage(
      supabase,
      organizationId,
      `${ready.baseUrl}/bookings/messages?maxAge=${maxAge}&page=${page}`,
      ready.token,
      fetchImpl,
      now,
    );
    if (!fetched.ok) {
      result.stoppedEarly = fetched.stop;
      result.creditsRemaining = fetched.remaining;
      if (fetched.stop === "rate_limited" && fetched.resetsAt !== null) result.resumeAfter = new Date(fetched.resetsAt).toISOString();
      return release(fetched.stop, true);
    }
    result.creditsRemaining = fetched.credit.remaining;
    remaining = knownRemainingCredit(fetched.credit, fetched.pageMs);
    lastRequestCost = fetched.credit.requestCost ?? lastRequestCost;
    lastResetsAt = fetched.credit.resetsAt ?? lastResetsAt;

    const receivedAt = now().toISOString();
    const messages: NormalizedMessage[] = [];
    for (const row of fetched.rows) {
      const message = normalizeBeds24Message(row, { receivedAt });
      if (message) messages.push(message);
    }
    warnAssumedUtcTimes(messages, "backfill");
    const ingested = await ingestPage(supabase, organizationId, messages, now);
    const isOverlap = page === overlapPage;
    const failed = ingested.failedBookingIds.length;
    result.pages += 1;
    result.fetched += messages.length;
    result.imported += ingested.imported;
    result.duplicates += ingested.duplicates;
    result.unrouted += ingested.unrouted;
    result.failedBookings += failed;

    if (failed > 0 && !isOverlap) {
      pageAttempts += 1;
      if (pageAttempts < BACKFILL_POISON_ATTEMPTS) {
        // 커서 · 숫자를 옮기지 않는다 — 다음 실행이 같은 페이지를 다시 읽는다(넣은 것은 중복으로 건너뜀).
        result.stoppedEarly = "failed_bookings";
        return release("failed_bookings", true);
      }
      // 같은 페이지가 3번 실패 — 실패 예약 번호를 남기고 넘어간다.
      failedIds = [...new Set([...failedIds, ...ingested.failedBookingIds])].slice(0, BACKFILL_FAILED_IDS_MAX);
      counters.failed_bookings += failed;
      console.warn("[guest-messages/backfill] page skipped after repeated failures", { page, failed });
    }
    if (isOverlap) {
      // 이미 센 페이지 — 경계가 밀려 새로 들어간 것만 센다. 실패도 커서를 막지 않는다(그 페이지는 이미 지났다).
      counters.imported_count += ingested.imported;
    } else {
      pageAttempts = 0;
      counters.pages_done += 1;
      counters.fetched_count += messages.length;
      counters.imported_count += ingested.imported;
      counters.skipped_count += ingested.duplicates;
      counters.unrouted_count += ingested.unrouted;
    }

    nextPageExists = fetched.nextPageExists;
    nextPage = Math.max(nextPage, page + 1);
    if (!nextPageExists) return release(null, false);
    page += 1;
    // 페이지마다 커서 저장 + lease 늘리기 — 함수가 끊겨도 다음 실행이 여기서 이어 받는다.
    const owned = await writeOwnedState(supabase, organizationId, runId, {
      ...counters,
      next_page: nextPage,
      page_attempts: pageAttempts,
      failed_booking_ids: failedIds,
      last_run_at: now().toISOString(),
      lease_until: leaseUntil(),
    });
    if (!owned) {
      result.stoppedEarly = "lost_lease";
      result.nextPage = nextPage;
      return result;
    }
  }
  result.stoppedEarly = "max_pages";
  return release("max_pages", nextPageExists);
}

/** 재기 모드 — maxAge=7 첫 페이지만 읽고, 넣지 않는다. 커서는 건드리지 않는다. 5분에 한 번. */
async function measure(
  supabase: Client,
  organizationId: string,
  result: BackfillResult,
  deps: BackfillDeps,
  fetchImpl: typeof fetch,
  now: () => Date,
): Promise<BackfillResult> {
  const current = await readGuestMessageBackfillState(supabase, organizationId);
  const lastAt = (current?.last_measure as { at?: unknown } | null)?.at;
  if (typeof lastAt === "string" && now().getTime() - Date.parse(lastAt) < BACKFILL_MEASURE_INTERVAL_MS) {
    result.skipped = "too_soon";
    result.measure = current?.last_measure as unknown as BackfillMeasure;
    return result;
  }
  const ready = await preflight(supabase, organizationId, deps, now);
  if (!ready.ok) {
    result.skipped = ready.reason;
    result.creditsRemaining = ready.creditsRemaining;
    result.resumeAfter = ready.resumeAfter;
    return result;
  }
  const page = await fetchPage(
    supabase,
    organizationId,
    `${ready.baseUrl}/bookings/messages?maxAge=${BACKFILL_MEASURE_MAX_AGE_DAYS}&page=1`,
    ready.token,
    fetchImpl,
    now,
  );
  if (!page.ok) {
    result.stoppedEarly = page.stop;
    result.creditsRemaining = page.remaining;
    if (page.stop === "rate_limited" && page.resetsAt !== null) result.resumeAfter = new Date(page.resetsAt).toISOString();
    return result;
  }
  const receivedAt = now().toISOString();
  const sentAts: string[] = [];
  for (const row of page.rows) {
    const message = normalizeBeds24Message(row, { receivedAt });
    if (message) sentAts.push(message.sentAt);
  }
  result.pages = 1;
  result.fetched = page.rows.length;
  result.creditsRemaining = page.credit.remaining;
  result.measure = {
    at: now().toISOString(),
    rows: page.rows.length,
    requestCost: page.credit.requestCost,
    remaining: page.credit.remaining,
    resetsIn: page.resetsIn,
    nextPageExists: page.nextPageExists,
    order: observedOrder(sentAts),
  };
  const stored = await supabase
    .from("guest_message_backfill_state")
    .upsert(
      { organization_id: organizationId, last_measure: result.measure as unknown as Json },
      { onConflict: "organization_id" },
    );
  if (stored.error) console.error("[guest-messages/backfill] measure write failed", stored.error.message);
  return result;
}
