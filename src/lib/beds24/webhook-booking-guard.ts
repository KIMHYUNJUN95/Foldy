import type { SupabaseClient } from "@supabase/supabase-js";
import { readBeds24ExternalRoomId, readBeds24String, type Beds24JsonRecord } from "@/lib/beds24/booking-payload";
import { fetchBeds24BookingById, LOW_CREDIT_THRESHOLD } from "@/lib/beds24/calendar-client";
import {
  readWebhookSourceReservationId,
  readWebhookStayDates,
  resolveWebhookOrganizationId,
} from "@/lib/beds24/process-webhook-booking";
import { filterRowsOfSameBeds24Booking, readBeds24OwnBookingId, toOriginalReservationId } from "@/lib/beds24/reservation-id";
import { resolveReservationStatusFromBeds24Record } from "@/lib/beds24/reservation-status";
import { isUnverifiedMarker, UNVERIFIED_MARKER_KEY, UNVERIFIED_RECHECK_AT_KEY } from "@/lib/beds24/unverified-marker";
import type { Database } from "@/types/database";

/**
 * 예약 웹훅을 적용하기 전에 거르는 두 가지 (2026-11-26 보안 점검).
 *
 * 웹훅 인증은 공유 비밀값 하나뿐이다(서명 · 시각 · nonce 없음). 그 값은 Beds24 설정 화면과 (`?secret=` 이면) 주소 로그에
 * 남으므로, 아는 사람이 예전 배달을 다시 보내거나 취소 · 날짜 바꾸기를 지어낼 수 있다. 그래서
 *
 * 1. **순서** — 들어온 예약의 Beds24 `modifiedTime` 이 저장된 것보다 오래됐으면 덮어쓰지 않는다(`skipped_stale`).
 * 2. **확인** — 상태를 바꾸는 배달(새 예약 · 취소 · 상태 · 날짜 · 방 바뀜, 또는 미래 시각)은 Beds24 에서 그 예약
 *    한 건을 다시 읽어(`GET /bookings?id=`, 1 크레딧) **읽은 값**을 적용한다. 본문은 믿지 않는다.
 *    메시지만 온 배달처럼 상태가 그대로면 Beds24 를 부르지 않는다(크레딧 0).
 *    - Beds24 를 못 부르면(429 · 시한 · 토큰 · 크레딧 바닥 · 같은 배달에서 이미 429) **본문을 예전처럼 적용**하되
 *      자동 안내는 계획하지 않는다(`fallback: "verify_unavailable"`) — 새 예약 · 취소가 다음 정합 작업까지 늦지 않게(사용자 결정 2026-11-26).
 *    - Beds24 가 「없는 예약」이라 하면 저장된 행이 있을 때만 그 행의 원래 값으로 일반 취소 경로를 탄다
 *      (`fallback: "verify_not_found_cancel"`, 자동 안내 없음). 저장된 행이 없거나 Beds24 번호가 없으면 쓰지 않는다(`verify_not_found`).
 *
 * 주기 조회는 없다 — 배달이 올 때만, 그 예약 하나만.
 */

/** Beds24 시계와 우리 시계 차이 여유. 이보다 먼 미래의 `modifiedTime` 은 지어낸 값으로 보고 확인한다. */
export const MODIFIED_TIME_FUTURE_SKEW_MS = 10 * 60_000;

/** 확인 읽기 하나의 시한. 라우트의 처리 예산(`BOOKING_LOOP_BUDGET_MS`)이 마지막 한 건의 이 시간까지 품는다. */
export const VERIFY_FETCH_TIMEOUT_MS = 5_000;

type ReservationStatus = Database["public"]["Enums"]["reservation_status"];

export type StoredBookingState = {
  status: ReservationStatus;
  checkInDate: string | null;
  checkOutDate: string | null;
  externalRoomId: string | null;
  modifiedTime: string | null;
  /** 저장 행의 「확인 못 함」 표시(`unverified-marker.ts`). 들어온 배달에는 없다. */
  unverifiedAt?: string | null;
};

export type IncomingBookingState = StoredBookingState;

export function parseBeds24ModifiedTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function readIncomingBookingState(payload: Beds24JsonRecord): IncomingBookingState {
  const { checkInDate, checkOutDate } = readWebhookStayDates(payload);
  return {
    status: resolveReservationStatusFromBeds24Record(payload),
    checkInDate,
    checkOutDate,
    externalRoomId: readBeds24ExternalRoomId(payload),
    modifiedTime: readBeds24String(payload, ["modifiedTime", "modified_time", "modified"]),
  };
}

/** 저장된 행(「확인 못 함」 표시 행 빼고) 중 가장 새 `modifiedTime` 보다 엄격히 오래됐으면 낡은 배달이다. 어느 쪽이든 시각이 없으면 판단하지 않는다. */
export function isStaleBeds24Delivery(incoming: IncomingBookingState, stored: readonly StoredBookingState[]): boolean {
  const incomingMs = parseBeds24ModifiedTime(incoming.modifiedTime);
  if (incomingMs === null) return false;
  let newestStored: number | null = null;
  for (const row of stored) {
    // 확인 못 하고 적용한 행의 시각은 지어낸 것일 수 있다 — 진짜 배달을 낡았다고 막지 않게 비교에서 뺀다.
    if (isUnverifiedMarker(row.unverifiedAt)) continue;
    const ms = parseBeds24ModifiedTime(row.modifiedTime);
    if (ms !== null && (newestStored === null || ms > newestStored)) newestStored = ms;
  }
  return newestStored !== null && incomingMs < newestStored;
}

export type VerificationReason = "new_booking" | "state_changed" | "future_modified_time";

function matchesStored(incoming: IncomingBookingState, row: StoredBookingState): boolean {
  if (incoming.status !== row.status) return false;
  // 짧은 취소 배달처럼 들어온 쪽에 값이 없으면 그 칸은 비교하지 않는다(바꾸지 않으므로).
  if (incoming.checkInDate && incoming.checkInDate !== row.checkInDate) return false;
  if (incoming.checkOutDate && incoming.checkOutDate !== row.checkOutDate) return false;
  if (incoming.externalRoomId && incoming.externalRoomId !== row.externalRoomId) return false;
  return true;
}

export function needsBeds24Verification(
  incoming: IncomingBookingState,
  stored: readonly StoredBookingState[],
  nowMs: number,
): VerificationReason | null {
  const incomingMs = parseBeds24ModifiedTime(incoming.modifiedTime);
  if (incomingMs !== null && incomingMs > nowMs + MODIFIED_TIME_FUTURE_SKEW_MS) return "future_modified_time";
  if (stored.length === 0) return "new_booking";
  return stored.some((row) => matchesStored(incoming, row)) ? null : "state_changed";
}

type StoredDbRow = {
  status: ReservationStatus;
  check_in_date: string | null;
  check_out_date: string | null;
  raw_book_id: string | null;
  raw_id: string | null;
  raw_modified: string | null;
  raw_unverified: string | null;
  raw_recheck_at: string | null;
  raw_room_id: string | null;
  raw_unit_id: string | null;
};

export async function loadStoredBookingStates(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  sourceReservationId: string,
  beds24BookingId: string | null,
): Promise<StoredBookingState[]> {
  const originalId = toOriginalReservationId(sourceReservationId).trim();
  if (!originalId) return [];
  const { data, error } = await supabase
    .from("reservations")
    .select(
      `status, check_in_date, check_out_date, raw_book_id:raw_payload->>bookId, raw_id:raw_payload->>id, raw_modified:raw_payload->>modifiedTime, raw_room_id:raw_payload->>roomId, raw_unit_id:raw_payload->>unitId, raw_unverified:raw_payload->>${UNVERIFIED_MARKER_KEY}, raw_recheck_at:raw_payload->>${UNVERIFIED_RECHECK_AT_KEY}`,
    )
    .eq("organization_id", organizationId)
    .eq("original_reservation_id", originalId);
  if (error) throw new Error(`stored booking lookup failed: ${error.message}`);
  const rows = ((data ?? []) as unknown as StoredDbRow[]).map((row) => ({
    bookingId: row.raw_book_id?.trim() || row.raw_id?.trim() || null,
    state: {
      status: row.status,
      checkInDate: row.check_in_date,
      checkOutDate: row.check_out_date,
      externalRoomId: row.raw_room_id?.trim() || row.raw_unit_id?.trim() || null,
      modifiedTime: row.raw_modified,
      // 이어 붙일 때는 마지막으로 다시 읽은 시각을 표시 값으로 — 매일 다시 읽기 순서(`unverified-recheck.ts`)가 앞으로 돌아가지 않게.
      unverifiedAt: isUnverifiedMarker(row.raw_unverified) && isUnverifiedMarker(row.raw_recheck_at) ? row.raw_recheck_at : row.raw_unverified,
    },
  }));
  return filterRowsOfSameBeds24Booking(rows, beds24BookingId).map((row) => row.state);
}

/**
 * 한 배달 안의 확인 읽기 차단기. 429 를 한 번 받으면 그 배달의 나머지는 부르지 않는다. 처음 확인이 필요할 때 한 번,
 * 마지막 계정 크레딧 기록(`account_credit`, 새 표 없음)이 `LOW_CREDIT_THRESHOLD` 미만이면 처음부터 부르지 않는다.
 */
export type Beds24VerifyGate = { allow: () => Promise<boolean>; tripRateLimit: () => void };

export function createBeds24VerifyGate(readRemaining: () => Promise<number | null>): Beds24VerifyGate {
  let blocked = false;
  let creditChecked = false;
  return {
    async allow() {
      if (blocked) return false;
      if (!creditChecked) {
        creditChecked = true;
        const remaining = await readRemaining().catch(() => null);
        if (remaining !== null && remaining < LOW_CREDIT_THRESHOLD) blocked = true;
      }
      return !blocked;
    },
    tripRateLimit() {
      blocked = true;
    },
  };
}

const EXPLICIT_STATUS_KEYS = [
  "statusText",
  "status_text",
  "statusName",
  "status_name",
  "bookingStatusText",
  "booking_status_text",
  "bookingStatus",
  "booking_status",
];

/** 저장된 행의 원래 예약 값에 취소만 얹는다 — 본문(믿지 않는 값)은 쓰지 않는다. */
export async function loadStoredCancelPayload(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  sourceReservationId: string,
  beds24BookingId: string,
): Promise<Beds24JsonRecord | null> {
  const originalId = toOriginalReservationId(sourceReservationId).trim();
  if (!originalId) return null;
  const { data, error } = await supabase
    .from("reservations")
    .select("raw_payload")
    .eq("organization_id", organizationId)
    .eq("original_reservation_id", originalId);
  if (error) throw new Error(`stored booking lookup failed: ${error.message}`);
  for (const row of (data ?? []) as Array<{ raw_payload: unknown }>) {
    const raw = row.raw_payload;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    if (readBeds24OwnBookingId(raw) !== beds24BookingId) continue;
    const payload: Beds24JsonRecord = { ...(raw as Beds24JsonRecord) };
    for (const key of EXPLICIT_STATUS_KEYS) delete payload[key];
    // Beds24 가 「없다」고 확인한 취소라 「확인 못 함」 표시를 지운다 — 남은 자동 안내 줄을 계획이 닫게.
    delete payload[UNVERIFIED_MARKER_KEY];
    payload.status = "cancelled";
    return payload;
  }
  return null;
}

export type FetchBeds24Booking = typeof fetchBeds24BookingById;

export type WebhookBookingGuardOutcome =
  | {
      kind: "apply";
      payload: Beds24JsonRecord;
      verified: VerificationReason | null;
      /** 확인하지 못했거나(본문 적용) 없는 예약 취소 — 둘 다 자동 안내를 계획하지 않는다. */
      fallback?: "verify_unavailable" | "verify_not_found_cancel";
      /** 확인 없이 본문으로 덮을 때 이어 붙일 저장 행의 「확인 못 함」 표시 — Beds24 값으로 쓸 때만 지워진다. */
      carryUnverifiedAt?: string;
    }
  | { kind: "stale"; incomingModifiedTime: string | null; status: ReservationStatus }
  | { kind: "verify_failed"; mode: "verify_not_found"; reason: VerificationReason };

export function isRateLimitError(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { isRateLimit?: unknown }).isRateLimit === true;
}

export async function guardBeds24WebhookBooking(params: {
  payload: Beds24JsonRecord;
  organizationIdDefault: string | null;
  supabase: SupabaseClient<Database>;
  nowMs?: number;
  fetchBooking?: FetchBeds24Booking;
  loadStored?: typeof loadStoredBookingStates;
  loadCancelPayload?: typeof loadStoredCancelPayload;
  gate?: Beds24VerifyGate;
}): Promise<WebhookBookingGuardOutcome> {
  const { payload, supabase } = params;
  const nowMs = params.nowMs ?? Date.now();
  const fetchBooking = params.fetchBooking ?? fetchBeds24BookingById;
  const loadStored = params.loadStored ?? loadStoredBookingStates;
  const loadCancelPayload = params.loadCancelPayload ?? loadStoredCancelPayload;

  const organizationId = await resolveWebhookOrganizationId({
    payload,
    organizationIdDefault: params.organizationIdDefault,
    supabase,
  });
  const sourceReservationId = readWebhookSourceReservationId(payload);
  // 조직 · 번호가 없으면 처리기가 쓰지 않고 `missing_required_fields` 로 끝낸다.
  if (!organizationId || !sourceReservationId) return { kind: "apply", payload, verified: null };

  const beds24BookingId = readBeds24OwnBookingId(payload);
  const stored = await loadStored(supabase, organizationId, sourceReservationId, beds24BookingId);
  const incoming = readIncomingBookingState(payload);

  if (isStaleBeds24Delivery(incoming, stored)) {
    return { kind: "stale", incomingModifiedTime: incoming.modifiedTime, status: incoming.status };
  }

  const reason = needsBeds24Verification(incoming, stored, nowMs);
  if (!reason) {
    const carried = stored.find((row) => isUnverifiedMarker(row.unverifiedAt))?.unverifiedAt;
    return carried ? { kind: "apply", payload, verified: null, carryUnverifiedAt: carried } : { kind: "apply", payload, verified: null };
  }
  // Beds24 번호가 없으면 읽을 수도, 같은 예약 행을 가려낼 수도 없다 — 쓰지 않는다.
  if (!beds24BookingId) return { kind: "verify_failed", mode: "verify_not_found", reason };

  const unavailable = { kind: "apply" as const, payload, verified: null, fallback: "verify_unavailable" as const };
  if (params.gate && !(await params.gate.allow())) return unavailable;

  let fetched: Awaited<ReturnType<FetchBeds24Booking>>;
  try {
    fetched = await fetchBooking(beds24BookingId, { timeoutMs: VERIFY_FETCH_TIMEOUT_MS, allStatuses: true });
  } catch (error) {
    if (isRateLimitError(error)) params.gate?.tripRateLimit();
    return unavailable;
  }
  if ("skipped" in fetched) return unavailable;
  if (fetched.ok) return { kind: "apply", payload: fetched.booking, verified: reason };
  if (fetched.error !== "not_found") return unavailable;

  if (stored.length === 0) return { kind: "verify_failed", mode: "verify_not_found", reason };
  const cancelPayload = await loadCancelPayload(supabase, organizationId, sourceReservationId, beds24BookingId);
  if (!cancelPayload) return { kind: "verify_failed", mode: "verify_not_found", reason };
  return { kind: "apply", payload: cancelPayload, verified: reason, fallback: "verify_not_found_cancel" };
}
