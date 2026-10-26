import { readBeds24OwnBookingId } from "@/lib/beds24/reservation-id";
import {
  readBeds24BookingId,
  resolveReservationStatusFromBeds24Record,
} from "@/lib/beds24/reservation-status";

export type Beds24JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): Beds24JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Beds24JsonRecord;
}

function readString(record: Beds24JsonRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function hasStayDateFields(record: Beds24JsonRecord): boolean {
  return (
    !!readString(record, ["firstNight", "first_night", "checkIn", "check_in", "arrival", "startDate"]) &&
    !!readString(record, ["lastNight", "last_night", "checkOut", "check_out", "departure", "endDate"])
  );
}

/** backfill `/bookings` 응답에 쓰는 엄격한 형태. */
function looksLikeBookingRecord(record: Beds24JsonRecord): boolean {
  return !!readBeds24BookingId(record) && hasStayDateFields(record);
}

function hasWebhookCancelSignals(record: Beds24JsonRecord): boolean {
  if (readString(record, ["cancelTime", "cancel_time", "cancelledAt", "cancelled_at"])) {
    return true;
  }
  if (readString(record, ["subStatus", "sub_status", "substatus"])) {
    return true;
  }
  if (
    readString(record, [
      "statusText",
      "status_text",
      "statusName",
      "status_name",
      "bookingStatusText",
      "booking_status_text",
      "bookingStatus",
      "booking_status",
      "status",
    ])
  ) {
    return resolveReservationStatusFromBeds24Record(record) === "cancelled";
  }
  return false;
}

/**
 * 느슨한 웹훅 형태: 숙박 날짜가 없는 간략한 취소 페이로드도 받는다.
 */
export function looksLikeWebhookBookingRecord(record: Beds24JsonRecord): boolean {
  if (!readBeds24BookingId(record)) return false;
  if (looksLikeBookingRecord(record)) return true;
  if (hasWebhookCancelSignals(record)) return true;
  return false;
}

// 병적이거나 순환처럼 보이는 페이로드가 무한히 돌지 않도록 재귀 깊이를 제한한다.
// 실제 Beds24 페이로드는 예약을 기껏해야 두어 단계까지만 중첩한다.
const MAX_EXTRACT_DEPTH = 8;

function extractWithMatcher(
  value: unknown,
  matchesRecord: (record: Beds24JsonRecord) => boolean,
  depth = 0,
): Beds24JsonRecord[] {
  if (depth > MAX_EXTRACT_DEPTH) return [];

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractWithMatcher(item, matchesRecord, depth + 1));
  }

  const record = asRecord(value);
  if (!record) return [];

  const results: Beds24JsonRecord[] = matchesRecord(record) ? [record] : [];
  // 고정 키 목록이 아니라 중첩된 모든 객체/배열 값으로 재귀한다. 그래서
  // 어떤 봉투 키 아래에 예약이 감싸여 있어도(Beds24 웹훅은 계정/설정에 따라
  // "booking", "data", "bookings" 등으로 보낸 적이 있다) 여전히
  // 찾는다. 매칭은 예약 id + 숙박 날짜(또는 취소 신호)를 요구하므로
  // 과도한 재귀로 오탐이 생기지 않으며, 중복은 아래에서 제거한다.
  for (const key of Object.keys(record)) {
    const child = record[key];
    if (child !== null && typeof child === "object") {
      results.push(...extractWithMatcher(child, matchesRecord, depth + 1));
    }
  }
  return results;
}

/**
 * 서로 다른 봉투 단계에서 나온 중복 예약 레코드(같은 예약 id)를 버린다.
 *
 * 같은 예약인지는 **Beds24 자기 번호**로 본다 (2026-10-01). `readBeds24BookingId` 는 채널 번호
 * (`apiReference`)를 먼저 읽어서, 한 응답에 함께 온 그룹(다객실) 예약의 방들이 하나만 남았다.
 */
function dedupeBookingRecords(records: Beds24JsonRecord[]): Beds24JsonRecord[] {
  const seen = new Set<string>();
  const out: Beds24JsonRecord[] = [];
  for (const record of records) {
    const id = readBeds24OwnBookingId(record) ?? readBeds24BookingId(record);
    const key = id ?? JSON.stringify(record);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }
  return out;
}

/**
 * backfill `/bookings` API 응답용 엄격한 추출기.
 */
export function extractBeds24BookingCandidates(value: unknown): Beds24JsonRecord[] {
  return dedupeBookingRecords(extractWithMatcher(value, looksLikeBookingRecord));
}

/**
 * Beds24 웹훅용 느슨한 추출기(간략한 취소 페이로드 포함).
 */
export function extractBeds24WebhookBookingCandidates(value: unknown): Beds24JsonRecord[] {
  return dedupeBookingRecords(extractWithMatcher(value, looksLikeWebhookBookingRecord));
}

export function readBeds24String(record: Beds24JsonRecord, keys: string[]): string | null {
  return readString(record, keys);
}

export function toBeds24IsoDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function beds24LastNightToCheckout(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
  return d.toISOString().slice(0, 10);
}

export function isLikelyNumericRoomLabel(value: string) {
  return /^\d+$/.test(value.trim());
}

export function readBeds24ExternalRoomId(record: Beds24JsonRecord): string | null {
  return (
    readString(record, ["roomId", "room_id"]) ??
    readString(record, ["unitId", "unit_id"])
  );
}
