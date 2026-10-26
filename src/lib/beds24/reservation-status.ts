import type { Database } from "@/types/database";

type JsonRecord = Record<string, unknown>;
type ReservationStatus = Database["public"]["Enums"]["reservation_status"];

function readString(record: JsonRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function readValue(record: JsonRecord, keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && !(typeof value === "string" && value.trim().length === 0)) {
      return value;
    }
  }
  return null;
}

function normalizeBeds24StatusValue(raw: unknown): ReservationStatus {
  if (raw === null || raw === undefined) return "confirmed";

  if (typeof raw === "number") {
    if (raw === 0) return "cancelled";
    if (raw === 1 || raw === 2 || raw === 3 || raw === 5 || raw === -2) return "confirmed";
    if (raw === 4) return "confirmed"; // 검정 — Beds24 에서 여전히 캘린더를 점유함
    return "confirmed";
  }

  if (typeof raw !== "string") return "confirmed";

  const value = raw.trim().toLowerCase();
  if (value.length === 0) return "confirmed";

  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && /^-?\d+$/.test(value)) {
    if (numericValue === 0) return "cancelled";
    if (numericValue === 1 || numericValue === 2 || numericValue === 3 || numericValue === 5) return "confirmed";
    if (numericValue === 4) return "confirmed";
  }

  if (
    ["cancelled", "canceled", "cancel"].includes(value) ||
    value.includes("cancelled") ||
    value.includes("canceled")
  ) {
    return "cancelled";
  }
  if (["checked_in", "checkin", "checked-in", "in_house", "inhouse"].includes(value)) {
    return "checked_in";
  }
  if (["checked_out", "checkout", "checked-out", "departed"].includes(value)) {
    return "checked_out";
  }
  if (["no_show", "noshow", "no-show"].includes(value) || value.includes("no show")) {
    return "no_show";
  }

  if (["new", "request", "inquiry", "confirmed", "modify", "modified", "black"].includes(value)) {
    return "confirmed";
  }

  return "confirmed";
}

/** Beds24 가 「살아 있는 예약」에 쓰는 명시적 상태 값 — 이 값이 오면 `cancelTime` 보다 믿는다. */
const ACTIVE_EXPLICIT_STATUSES = new Set(["confirmed", "new", "request", "inquiry", "black", "1", "2", "3", "4", "5"]);

/**
 * Beds24 예약/웹훅 payload 필드를 Foldy 예약 상태로 매핑한다.
 * 참고: Beds24 API v2 는 활성 예약에 statusCode: 0 을 줄 수 있으므로 — statusCode 만으로 판단하지 말 것.
 *
 * **명시적 상태가 살아 있으면 그것을 따른다** (2026-10-07). Beds24 는 취소했다가 되살린 예약에도
 * `cancelTime` 을 지우지 않는다(실측 7건 — `status: "confirmed"` + `cancelTime` 있음, 예: 86444948 ·
 * 91904176). 예전엔 `cancelTime` 만 보고 취소로 적어서 판매 캘린더 · 청소 · 매출에서 그 예약이 빠졌다.
 * `cancelTime` · 취소 `subStatus` 는 **상태 값이 없을 때만**(드문 취소 웹훅) 취소 신호로 쓴다.
 * 노쇼(`subStatus`)는 상태가 살아 있어도 노쇼다.
 */
export function resolveReservationStatusFromBeds24Record(record: JsonRecord): ReservationStatus {
  const explicitRaw = readValue(record, [
    "statusText",
    "status_text",
    "statusName",
    "status_name",
    "bookingStatusText",
    "booking_status_text",
    "bookingStatus",
    "booking_status",
    "status",
  ]);
  const explicit = explicitRaw === null ? null : normalizeBeds24StatusValue(explicitRaw);
  if (explicit === "cancelled") return "cancelled";
  const explicitActive = explicitRaw !== null && ACTIVE_EXPLICIT_STATUSES.has(String(explicitRaw).trim().toLowerCase());

  const subStatusRaw = readString(record, ["subStatus", "sub_status", "substatus"]);
  if (subStatusRaw) {
    const subStatus = subStatusRaw.toLowerCase();
    if (subStatus === "5" || subStatus.includes("no show")) {
      return "no_show";
    }
    if (!explicitActive && (subStatus === "3" || subStatus === "4" || subStatus.includes("cancelled by"))) {
      return "cancelled";
    }
  }

  if (!explicitActive) {
    const cancelTime = readString(record, ["cancelTime", "cancel_time", "cancelledAt", "cancelled_at"]);
    if (cancelTime) return "cancelled";
  }

  return explicit ?? "confirmed";
}

export function readBeds24BookingId(record: JsonRecord): string | null {
  return readString(record, [
    "bookId",
    "book_id",
    "apiReference",
    "api_reference",
    "reservationId",
    "reservation_id",
    "bookingId",
    "booking_id",
    "id",
  ]);
}
