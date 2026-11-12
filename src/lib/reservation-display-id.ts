import { toOriginalReservationId } from "@/lib/beds24/reservation-id";
import { readBeds24BookingId } from "@/lib/beds24/reservation-status";

/**
 * 화면에 보이는 예약 번호 — 모바일 · PC 예약 캘린더 공용 (2026-11-12).
 *
 * 예전엔 모바일은 `apiReference` 를 먼저, PC 는 `bookId` 를 먼저 읽어 같은 예약 번호가 두 화면에서 달랐다. 이제 둘 다 Beds24
 * 예약 번호(`readBeds24BookingId` 순서) → 없으면 저장된 `source_reservation_id` 의 원래 번호(객실 꼬리표를 뗀 값).
 */
export function getReservationDisplayId(row: { raw_payload: unknown; source_reservation_id: string }): string {
  const payload = row.raw_payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const fromPayload = readBeds24BookingId(payload as Record<string, string | number | boolean | null>);
    if (fromPayload) return fromPayload;
  }
  return toOriginalReservationId(row.source_reservation_id);
}
