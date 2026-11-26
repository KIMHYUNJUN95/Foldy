import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { readBeds24AccountCredit } from "@/lib/beds24/account-credit";
import type { Beds24JsonRecord } from "@/lib/beds24/booking-payload";
import { fetchBeds24BookingById } from "@/lib/beds24/calendar-client";
import { processBeds24WebhookBooking } from "@/lib/beds24/process-webhook-booking";
import { readBeds24OwnBookingId } from "@/lib/beds24/reservation-id";
import { UNVERIFIED_MARKER_KEY, UNVERIFIED_RECHECK_AT_KEY, isUnverifiedMarker } from "@/lib/beds24/unverified-marker";
import {
  VERIFY_FETCH_TIMEOUT_MS,
  createBeds24VerifyGate,
  isRateLimitError,
  loadStoredCancelPayload,
  type Beds24VerifyGate,
} from "@/lib/beds24/webhook-booking-guard";

/**
 * 「확인 못 함」 표시 예약 다시 읽기 — 매일 정합(`/api/beds24/reconcile`) 끝에 (2026-11-26 3차 감사).
 *
 * 증분 정합은 `modifiedFrom` 커서로 읽어서, Beds24 에서 실제로 바뀌지 않은 예약(지어낸 배달 등)은 다시 읽지 않는다 —
 * 그러면 표시 · 지어낸 값이 영영 남는다. 그래서 표시가 오래된 순으로 최대 `UNVERIFIED_RECHECK_LIMIT` 개를 번호로 읽는다
 * (모든 상태, 1 크레딧씩). 있으면 일반 처리기로 적용(표시가 지워짐) · 엄격한 없음이면 저장된 값으로 취소 ·
 * 못 읽으면 다음 날. 웹훅 확인과 같은 차단기(429 한 번 · 크레딧 바닥이면 그만 읽음).
 * 읽고도 표시가 남은 행에는 `_foldy_recheck_at` 을 적고, 순서는 `coalesce(recheck_at, unverified_at)` 오래된 순 — 돌아가며 읽는다.
 */
export const UNVERIFIED_RECHECK_LIMIT = 20;
/** 정합 라우트(60초) 안에서 이 일에 쓰는 시간 — 넘으면 남은 것은 다음 날. */
export const UNVERIFIED_RECHECK_BUDGET_MS = 15_000;
/** 정합 라우트가 시작부터 이 시각까지만 다시 읽기에 쓴다(상한 60초에서 응답 · 기록 여유). */
export const UNVERIFIED_RECHECK_ROUTE_DEADLINE_MS = 45_000;
/** 남은 시간이 이보다 적으면 아예 건너뛴다(`skipped_time`). */
export const UNVERIFIED_RECHECK_MIN_BUDGET_MS = 8_000;

/** 정합 라우트에서 지난 시간 → 다시 읽기 예산. `null` 이면 건너뛴다. */
export function unverifiedRecheckBudgetMs(elapsedMs: number): number | null {
  const budget = Math.min(UNVERIFIED_RECHECK_BUDGET_MS, UNVERIFIED_RECHECK_ROUTE_DEADLINE_MS - elapsedMs);
  return budget < UNVERIFIED_RECHECK_MIN_BUDGET_MS ? null : budget;
}

export type UnverifiedRecheckResult = {
  candidates: number;
  cleared: number;
  cancelled: number;
  unavailable: number;
  /** Beds24 에서 읽어 적용했는데도 표시가 남은 행(다른 키의 옛 행) — 사람이 확인. */
  leftoverMarked: number;
  stoppedReason: "breaker" | "budget" | "missing_env" | "skipped_time" | null;
};

type MarkedBooking = { organizationId: string; bookingId: string; sourceReservationId: string };
type MarkedRow = { id: string; organization_id: string; source_reservation_id: string; raw_payload: unknown };

type Deps = {
  fetchBooking?: typeof fetchBeds24BookingById;
  processBooking?: typeof processBeds24WebhookBooking;
  loadCancelPayload?: typeof loadStoredCancelPayload;
  gate?: Beds24VerifyGate;
  nowMs?: () => number;
  /** 정합 라우트가 남은 시간으로 정한다(`unverifiedRecheckBudgetMs`). */
  budgetMs?: number;
  nowIso?: () => string;
};

function stringKey(rawPayload: unknown, key: string): string | null {
  if (!rawPayload || typeof rawPayload !== "object") return null;
  const value = (rawPayload as Record<string, unknown>)[key];
  return isUnverifiedMarker(value) ? String(value) : null;
}

/** 다시 읽기 순서 — `coalesce(recheck_at, unverified_at)`. */
function orderKeyOf(rawPayload: unknown): string | null {
  if (!stringKey(rawPayload, UNVERIFIED_MARKER_KEY)) return null;
  return stringKey(rawPayload, UNVERIFIED_RECHECK_AT_KEY) ?? stringKey(rawPayload, UNVERIFIED_MARKER_KEY);
}

async function loadMarkedBookings(
  supabase: SupabaseClient<Database>,
  organizationId: string | undefined,
): Promise<MarkedBooking[]> {
  const client = supabase as unknown as SupabaseClient;
  let orgIds: string[] | null = null;
  if (!organizationId) {
    // 정합처럼 Beds24 건물이 연결된 조직만(토큰은 그 Beds24 계정 하나).
    const properties = await client
      .from("properties")
      .select("organization_id")
      .eq("external_provider", "beds24")
      .not("external_property_id", "is", null);
    if (properties.error) throw new Error(`unverified recheck property query failed: ${properties.error.message}`);
    orgIds = [...new Set(((properties.data ?? []) as Array<{ organization_id: string }>).map((row) => row.organization_id))];
    if (orgIds.length === 0) return [];
  }
  // PostgREST 는 coalesce 로 정렬하지 못한다 — 「아직 다시 읽지 않은 행(표시 시각 순)」과 「다시 읽은 행(다시 읽은 시각 순)」을
  // 따로 앞에서부터 읽어 합친다(두 묶음의 앞 N 을 합쳐 정렬하면 전체의 앞 N 과 같다). 묶음 예약은 행이 여럿이라 넉넉히 읽는다.
  const partitions: MarkedRow[] = [];
  for (const recheckedBefore of [false, true]) {
    const base = client
      .from("reservations")
      .select("id, organization_id, source_reservation_id, raw_payload")
      .not(`raw_payload->>${UNVERIFIED_MARKER_KEY}`, "is", null);
    const scoped = organizationId ? base.eq("organization_id", organizationId) : base.in("organization_id", orgIds!);
    const recheckPath: string = `raw_payload->>${UNVERIFIED_RECHECK_AT_KEY}`;
    const markerPath: string = `raw_payload->>${UNVERIFIED_MARKER_KEY}`;
    const { data, error } = recheckedBefore
      ? await scoped.not(recheckPath, "is", null).order(recheckPath, { ascending: true }).limit(UNVERIFIED_RECHECK_LIMIT * 5)
      : await scoped.filter(recheckPath, "is", null).order(markerPath, { ascending: true }).limit(UNVERIFIED_RECHECK_LIMIT * 5);
    if (error) throw new Error(`unverified recheck query failed: ${error.message}`);
    partitions.push(...((data ?? []) as MarkedRow[]));
  }
  const rows = partitions
    .map((row) => ({ row, orderKey: orderKeyOf(row.raw_payload), bookingId: readBeds24OwnBookingId(row.raw_payload) }))
    .filter((item): item is { row: MarkedRow; orderKey: string; bookingId: string } => !!item.orderKey && !!item.bookingId)
    .sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0));
  const seen = new Set<string>();
  const out: MarkedBooking[] = [];
  for (const { row, bookingId } of rows) {
    const key = `${row.organization_id}:${bookingId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ organizationId: row.organization_id, bookingId, sourceReservationId: row.source_reservation_id });
    if (out.length >= UNVERIFIED_RECHECK_LIMIT) break;
  }
  return out;
}

/**
 * 다시 읽은 뒤에도 그 예약 번호의 행에 표시가 남았는지 보고(못 읽음 · 방 바뀜 등으로 다른 키의 옛 행), 남은 행에
 * `_foldy_recheck_at` 을 적는다 — 다음 날 순서가 뒤로 가서 다른 예약이 굶지 않게. 표시는 풀지 않는다(그 행의 값은 지어낸 것일
 * 수 있다 — 자동 안내를 계속 막는 쪽). 적기 직전에 다시 읽고 `updated_at` 이 같을 때만 쓴다 — 그사이 웹훅이 Beds24 값으로
 * 바꾼 행을 옛 값으로 되돌리지 않게.
 */
async function stampLeftoverMarkers(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  bookingId: string,
  recheckAt: string,
): Promise<number> {
  const client = supabase as unknown as SupabaseClient;
  const rows = new Map<string, { raw_payload: unknown; updated_at: string }>();
  for (const path of ["raw_payload->>id", "raw_payload->>bookId"]) {
    const { data, error } = await client
      .from("reservations")
      .select("id, raw_payload, updated_at")
      .eq("organization_id", organizationId)
      .eq(path, bookingId)
      .not(`raw_payload->>${UNVERIFIED_MARKER_KEY}`, "is", null);
    if (error) continue;
    for (const row of (data ?? []) as Array<{ id: string; raw_payload: unknown; updated_at: string }>) rows.set(row.id, row);
  }
  for (const [id, row] of rows) {
    if (!row.raw_payload || typeof row.raw_payload !== "object" || Array.isArray(row.raw_payload)) continue;
    const { error } = await client
      .from("reservations")
      .update({ raw_payload: { ...(row.raw_payload as Record<string, unknown>), [UNVERIFIED_RECHECK_AT_KEY]: recheckAt } })
      .eq("id", id)
      .eq("organization_id", organizationId)
      .eq("updated_at", row.updated_at);
    if (error) console.warn("[beds24/unverified-recheck] recheck stamp failed", { bookingId, message: error.message });
  }
  return rows.size;
}

export async function recheckUnverifiedBeds24Reservations(
  supabase: SupabaseClient<Database>,
  options: { organizationId?: string } & Deps = {},
): Promise<UnverifiedRecheckResult> {
  const fetchBooking = options.fetchBooking ?? fetchBeds24BookingById;
  const processBooking = options.processBooking ?? processBeds24WebhookBooking;
  const loadCancelPayload = options.loadCancelPayload ?? loadStoredCancelPayload;
  const now = options.nowMs ?? (() => performance.now());
  const nowIso = options.nowIso ?? (() => new Date().toISOString());
  const budgetMs = options.budgetMs ?? UNVERIFIED_RECHECK_BUDGET_MS;
  const gate =
    options.gate ?? createBeds24VerifyGate(async () => (await readBeds24AccountCredit(supabase))?.remaining ?? null);
  const result: UnverifiedRecheckResult = {
    candidates: 0,
    cleared: 0,
    cancelled: 0,
    unavailable: 0,
    leftoverMarked: 0,
    stoppedReason: null,
  };

  if (budgetMs < UNVERIFIED_RECHECK_MIN_BUDGET_MS) return { ...result, stoppedReason: "skipped_time" };

  const recheckOne = async (item: MarkedBooking): Promise<"cleared" | "cancelled" | "unavailable" | "missing_env"> => {
    let fetched: Awaited<ReturnType<typeof fetchBeds24BookingById>>;
    try {
      fetched = await fetchBooking(item.bookingId, { timeoutMs: VERIFY_FETCH_TIMEOUT_MS, allStatuses: true });
    } catch (error) {
      if (isRateLimitError(error)) gate.tripRateLimit();
      return "unavailable";
    }
    if ("skipped" in fetched) return "missing_env";
    if (fetched.ok) {
      const applied = await processBooking({ payload: fetched.booking, organizationIdDefault: item.organizationId, supabase });
      return applied.ok ? "cleared" : "unavailable";
    }
    // `not_found` 는 엄격한 없음뿐(문의를 빼고 다시 읽은 결과는 `unexpected_response` — calendar-client.ts).
    if (fetched.error !== "not_found") return "unavailable";
    const cancelPayload: Beds24JsonRecord | null = await loadCancelPayload(
      supabase,
      item.organizationId,
      item.sourceReservationId,
      item.bookingId,
    );
    if (!cancelPayload) return "unavailable";
    const cancelled = await processBooking({ payload: cancelPayload, organizationIdDefault: item.organizationId, supabase });
    return cancelled.ok ? "cancelled" : "unavailable";
  };

  const marked = await loadMarkedBookings(supabase, options.organizationId);
  result.candidates = marked.length;
  const startedAt = now();

  for (const item of marked) {
    // 한 번 읽기가 시한(5초)까지 걸려도 예산 안에서 끝나게 — 정합 라우트가 60초를 넘지 않는다.
    if (now() - startedAt + VERIFY_FETCH_TIMEOUT_MS > budgetMs) {
      result.stoppedReason = "budget";
      break;
    }
    if (!(await gate.allow())) {
      result.stoppedReason = "breaker";
      break;
    }
    const outcome = await recheckOne(item);
    if (outcome === "missing_env") {
      result.stoppedReason = "missing_env";
      break;
    }
    result[outcome] += 1;
    // 읽고도 표시가 남은 행(못 읽음 · 다른 키의 옛 행)은 다시 읽은 시각을 적어 다음 날 뒤로 돌린다.
    const leftover = await stampLeftoverMarkers(supabase, item.organizationId, item.bookingId, nowIso());
    if (leftover > 0 && outcome !== "unavailable") {
      result.leftoverMarked += leftover;
      console.warn("[beds24/unverified-recheck] marker left on other rows", { bookingId: item.bookingId, rows: leftover });
    }
  }

  if (result.candidates > 0) console.info("[beds24/unverified-recheck] done", result);
  return result;
}
