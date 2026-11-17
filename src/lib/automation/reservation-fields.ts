/**
 * 자동화 메시지가 읽는 예약 원본(`reservations.raw_payload` — Beds24 V2) 필드. **순수하다.**
 *
 * 저쪽(STAY ARI Manager)은 저장할 때 `normalize()`(functions/index.js :1356)로 필드를 만들어 두고 리포트가 그것을
 * 읽었다. 우리 표는 원본을 그대로 들고 있으므로, 같은 규칙으로 **읽을 때** 만든다 —
 *
 * | 여기 | 저쪽 |
 * | --- | --- |
 * | `bookDateOf` | `determineDate` (:1229) — bookingTime → bookTime → entryTime → 가장 이른 invoiceDate, 도쿄 날짜 |
 * | `cancelInstantOf` | `cancelTime \|\| (취소면 modifiedTime \|\| modified)` (:1451) |
 * | `exactReferer` | `referer` 원문 — 일일 리포트는 `"Airbnb"` / `"Booking.com"` 과 **정확히 같은** 것만 셌다 |
 * | 금액 | `legacyReservationAmount`(ops-sales-summary — 같은 `normalize` 규칙) |
 */

import { resolveReservationNumber } from "@/lib/reservation-display-id";
import { getReservationGuests } from "@/lib/reservation-guests";
import { tokyoDateOf } from "@/lib/tokyo-date";

export type RawPayload = Record<string, unknown>;

export function asRaw(value: unknown): RawPayload {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RawPayload) : {};
}

function text(raw: RawPayload, key: string): string | null {
  const value = raw[key];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** 날짜만 있으면 그대로, 시각이 있으면 도쿄 날짜로(저쪽 `toJapanDate`). */
function toTokyoDate(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return tokyoDateOf(value);
}

/** 예약 접수일(도쿄). 입실일은 쓰지 않는다 — 저쪽 주석 「뻥튀기 영구 방지」. */
export function bookDateOf(raw: RawPayload): string | null {
  for (const key of ["bookingTime", "bookTime", "entryTime"]) {
    const value = text(raw, key);
    if (value && value.length >= 10) return toTokyoDate(value);
  }
  if (Array.isArray(raw.invoiceItems)) {
    const dates = raw.invoiceItems
      .map((item) => (item && typeof item === "object" ? (item as RawPayload).invoiceDate : null))
      .filter((value): value is string => typeof value === "string" && value.length >= 10)
      .sort();
    if (dates.length > 0) return toTokyoDate(dates[0]);
  }
  return null;
}

/** 취소 시각(원문 ISO). 원본에 cancelTime 이 없으면 마지막 수정 시각을 쓴다 — 취소된 예약일 때만. */
/** 예약이 들어온 순간(ISO) — Beds24 `bookingTime`(없으면 `bookTime` · `entryTime`). 날짜만 있으면 null. */
export function bookingInstantOf(raw: RawPayload): string | null {
  for (const key of ["bookingTime", "bookTime", "entryTime"]) {
    const value = text(raw, key);
    if (value && value.length > 10 && Number.isFinite(Date.parse(value))) return value;
  }
  return null;
}

export function cancelInstantOf(raw: RawPayload, cancelled: boolean): string | null {
  const cancelTime = text(raw, "cancelTime");
  if (cancelTime) return cancelTime;
  if (!cancelled) return null;
  return text(raw, "modifiedTime") ?? text(raw, "modified");
}

export function exactReferer(raw: RawPayload): string {
  return text(raw, "referer") ?? "";
}

/**
 * 알림에 적는 예약 번호 — **채널 예약번호**(Airbnb `HM…` · Booking 번호) → Beds24 번호 순. 어느 것도 없으면 `null`(2026-11-17).
 *
 * 내부 UUID(`reservations.id`)는 사람이 못 찾는 번호라 **절대 돌려주지 않는다** — 전에는 원본에 번호가 없으면 UUID 를 그대로 적었다.
 */
export function reservationNumberOf(raw: RawPayload, channelReservationId?: string | null): string | null {
  return resolveReservationNumber({ channelReservationId, rawPayload: raw });
}

/** 채널 이름 — 원본의 referer · channel · source 순, 없으면 번호 모양으로(`HM…` = Airbnb · 숫자 10자리 = Booking.com), 그래도 없으면 `-`. */
export function channelNameOf(raw: RawPayload, reservationNumber: string | null): string {
  const named = text(raw, "referer") ?? text(raw, "channel") ?? text(raw, "source") ?? text(raw, "apiSource");
  if (named) return named;
  if (reservationNumber && /^HM[A-Z0-9]{6,}$/.test(reservationNumber)) return "Airbnb";
  if (reservationNumber && /^\d{10}$/.test(reservationNumber)) return "Booking.com";
  return "-";
}

/** 성인 · 어린이 — 저쪽 알림 형식(`성인 2명, 아동 1명 (총 3명)`). */
export function guestCountsOf(raw: RawPayload): { adults: number; children: number; total: number } {
  const guests = getReservationGuests(raw);
  const adults = guests.adults ?? 0;
  const children = guests.children ?? 0;
  return { adults, children, total: guests.total ?? adults + children };
}

/** JSON 경로로 받아 올 키 — 원본을 통째로 받지 않는다(ops-calendar 와 같은 이유). */
export const AUTOMATION_PAYLOAD_KEYS = [
  "status",
  "referer",
  "referrer",
  "channel",
  "source",
  "apiSource",
  "subSource",
  "bookingTime",
  "bookTime",
  "entryTime",
  "cancelTime",
  "modifiedTime",
  "modified",
  "price",
  "amount",
  "invoiceItems",
  "numAdult",
  "numChild",
  "numInfant",
  "bookId",
  "id",
  "apiReference",
  "rateDescription",
] as const;

export const AUTOMATION_RESERVATION_SELECT = [
  "id, property_name, room_label, guest_name, status, check_in_date, check_out_date, updated_at, last_known_amount, original_reservation_id",
  ...AUTOMATION_PAYLOAD_KEYS.map((key) => `rp_${key}:raw_payload->${key}`),
].join(", ");

export type AutomationReservation = {
  id: string;
  propertyName: string;
  roomLabel: string;
  guestName: string;
  status: string;
  checkIn: string;
  checkOut: string;
  updatedAt: string;
  /** DB 가 기억한 마지막 금액(`reservations.last_known_amount` — 취소로 price 가 0 이 돼도 남는다). */
  lastKnownAmount: number | null;
  /** `reservations.original_reservation_id` — 채널 예약번호(Airbnb HM… · Booking 번호). 옛 줄 · 시험 값은 없을 수 있다. */
  channelReservationId?: string | null;
  raw: RawPayload;
};

export function toAutomationReservation(row: Record<string, unknown>): AutomationReservation {
  const raw: RawPayload = {};
  for (const key of AUTOMATION_PAYLOAD_KEYS) {
    const value = row[`rp_${key}`];
    if (value !== null && value !== undefined) raw[key] = value;
  }
  return {
    checkIn: String(row.check_in_date ?? ""),
    checkOut: String(row.check_out_date ?? ""),
    guestName: String(row.guest_name ?? ""),
    id: String(row.id ?? ""),
    propertyName: String(row.property_name ?? ""),
    raw,
    roomLabel: String(row.room_label ?? ""),
    status: String(row.status ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    channelReservationId: typeof row.original_reservation_id === "string" ? row.original_reservation_id : null,
    lastKnownAmount: Number(row.last_known_amount) > 0 ? Number(row.last_known_amount) : null,
  };
}

/**
 * 취소 전 **원래 금액** — Beds24 는 취소되면 `price` 를 0 으로 비우지만 요금 내역(`rateDescription`)은 남긴다(2026-10-07 확인).
 *
 * - Airbnb: `Base Price N JPY` + `Cleaning fee N JPY` — 2026-06 이후 확정 예약 1,296건 전부 `price` 와 같다.
 * - Booking.com: 날짜 줄(`2026-11-05 (…) JPY 114996`)의 합 — 1,174건 중 1,166건 ±10엔(반올림). 예약 뒤 연장된 경우는 처음
 *   날짜만 남아 적게 나온다(0.7%).
 * - 순서: 0 이 아닌 지금 금액 → DB 가 기억한 마지막 금액(`last_known_amount`, 트리거) → 요금 내역 → 없으면 `null`(확인 불가).
 *   Airbnb 는 취소되면 요금 내역까지 0 으로 바꿔 오는 경우가 있어(최근 30일 28%) 트리거가 필요하다.
 */
export function originalAmountOf(raw: RawPayload, currentAmount: number, lastKnownAmount: number | null = null): number | null {
  if (currentAmount > 0) return currentAmount;
  // DB 가 취소 직전에 기억한 금액이 가장 정확하다(2026-10-07 트리거 — 그 전에 취소된 예약에는 없다).
  if (lastKnownAmount !== null && lastKnownAmount > 0) return Math.round(lastKnownAmount);
  const description = typeof raw.rateDescription === "string" ? raw.rateDescription : "";
  if (!description) return null;
  if (/Base Price\s+[\d.]+\s*JPY/i.test(description)) {
    const base = Number(/Base Price\s+([\d.]+)\s*JPY/i.exec(description)?.[1] ?? 0);
    const cleaning = Number(/Cleaning fee\s+([\d.]+)\s*JPY/i.exec(description)?.[1] ?? 0);
    const total = base + cleaning;
    return total > 0 ? Math.round(total) : null;
  }
  let total = 0;
  for (const line of description.split(/\r?\n/)) {
    const match = /^\d{4}-\d{2}-\d{2}\b.*?JPY\s+([\d.]+)/.exec(line.trim());
    if (match) total += Number(match[1]);
  }
  return total > 0 ? Math.round(total) : null;
}
