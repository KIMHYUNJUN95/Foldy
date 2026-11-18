import { resolveReservationNumber } from "@/lib/reservation-display-id";

/**
 * 외부 리뷰 줄 · 상세에 보이는 예약 번호 — 채널 번호(Airbnb `HM…` · Booking 번호)가 먼저, 없으면 `null`.
 * 목록 쿼리는 `reservations` 를 붙이지 않으므로 Beds24 번호로는 내려가지 않고, 내부 UUID(`reservationId`)는 절대 쓰지 않는다.
 */
export function reviewReservationNo(review: { sourceReservationId: string | null }): string | null {
  return resolveReservationNumber({ channelReservationId: review.sourceReservationId });
}
