import { toOriginalReservationId } from "@/lib/beds24/reservation-id";
import { readBeds24BookingId } from "@/lib/beds24/reservation-status";

/**
 * 화면에 보이는 예약 번호 — 모바일 · PC 예약 캘린더 공용 (2026-11-12).
 *
 * 예전엔 모바일은 `apiReference` 를 먼저, PC 는 `bookId` 를 먼저 읽어 같은 예약 번호가 두 화면에서 달랐다. 이제 둘 다 Beds24
 * 예약 번호(`readBeds24BookingId` 순서) → 없으면 저장된 `source_reservation_id` 의 원래 번호(객실 꼬리표를 뗀 값).
 */
export function getReservationDisplayId(row: { raw_payload: unknown; source_reservation_id: string }): string {
  return resolveReservationNumber({ rawPayload: row.raw_payload, sourceReservationId: row.source_reservation_id }) ?? toOriginalReservationId(row.source_reservation_id);
}

/**
 * 예약 번호를 고르는 **단 하나의 규칙**(2026-11-17) — 채널 예약번호(`reservations.original_reservation_id` · Airbnb `HM…` ·
 * Booking 번호) → Beds24 예약 번호(`readBeds24BookingId` 순서) → 저장된 `source_reservation_id` 의 원래 번호. 어느 것도 없으면 `null`.
 * 내부 UUID(`reservations.id`)는 절대 돌려주지 않는다. 채널 번호를 넘기지 않는 화면(캘린더)은 예전과 똑같이 동작한다.
 */
export function resolveReservationNumber(input: {
  rawPayload?: unknown;
  channelReservationId?: string | null;
  sourceReservationId?: string | null;
}): string | null {
  const channel = typeof input.channelReservationId === "string" ? toOriginalReservationId(input.channelReservationId.trim()) : "";
  if (channel) return channel;
  const payload = input.rawPayload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const fromPayload = readBeds24BookingId(payload as Record<string, string | number | boolean | null>);
    if (fromPayload) return fromPayload;
  }
  const source = typeof input.sourceReservationId === "string" ? toOriginalReservationId(input.sourceReservationId.trim()) : "";
  return source || null;
}
