import { MAX_STAY_NIGHTS, stayNights } from "@/lib/ops-manual-booking";

/**
 * 예약 옮기기 — **순수 규칙만.** Beds24 왕복 · DB 는 호출부(`submitReservationMove`)가 한다.
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「예약 옮기기」(2026-10-19 사용자 확정, 시안 보드
 * https://claude.ai/artifact/XtdqTWRYhCfnSY4kWLJzmf).
 *
 * - **같은 예약을 고친다**(Beds24 `POST /bookings` 에 `id` + `roomId`). 지우고 새로 만들지 않는다 — 채널 예약을 지우면 채널에
 *   취소가 나가 손님 예약이 실제로 취소될 수 있고, 예약번호 · 결제 · 채널 연결이 끊긴다.
 * - 객실과 날짜를 함께 옮길 수 있다. **박수 · 금액은 그대로**(금액은 「수정」에서). **채널 예약도 날짜를 옮긴다**(2026-10-20
 *   사용자 결정 — 전엔 잠갔다). 채널 예약 내용은 그대로라 화면이 그 사실을 적는다.
 * - 예약이 있는 자리에는 놓을 수 없다 — 서버가 우리 표 + Beds24 로 다시 막는다.
 */

export type ReservationMoveError =
  | "same_place"
  | "bad_dates"
  | "past_arrival"
  | "stay_too_long"
  /** 이미 끝난 숙박 — 옮길 밤이 없다. */
  | "past_stay";

export type StayRange = { arrival: string; departure: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 날짜를 바꾸는가 — 체크인이나 체크아웃이 다르면. */
export function moveChangesDates(original: StayRange, next: StayRange): boolean {
  return original.arrival !== next.arrival || original.departure !== next.departure;
}

export function validateReservationMove(args: {
  original: StayRange;
  next: StayRange;
  /** 옮길 곳이 지금 줄과 같은가(서버가 다시 계산한 행 키 기준). */
  sameRow: boolean;
  today: string;
}): ReservationMoveError | null {
  const { original, next } = args;
  const datesChanged = moveChangesDates(original, next);
  if (args.sameRow && !datesChanged) return "same_place";
  if (!DATE.test(next.arrival) || !DATE.test(next.departure) || next.departure <= next.arrival) return "bad_dates";
  if (next.departure <= args.today) return "past_stay";
  // 체크인을 **옮길 때만** 과거를 막는다(예약 수정과 같다). 묵고 있는 손님을 다른 방으로 옮기는 것은 정상이다.
  if (next.arrival !== original.arrival && next.arrival < args.today) return "past_arrival";
  if (stayNights(next.arrival, next.departure).length > MAX_STAY_NIGHTS) return "stay_too_long";
  return null;
}

/**
 * 옮긴 자리에서 **새로 차지하는 밤**(겹침 · 가용 검사 대상). 같은 줄에서 날짜만 옮기면 원래 묵던 밤은 그 예약 자신의 밤이라
 * 「찬 밤」이 아니다. 다른 줄로 옮기면 전부 새 밤이다. 지난 밤은 검사하지 않는다(이미 묵은 밤).
 */
export function moveTargetNights(args: { original: StayRange; next: StayRange; sameRow: boolean; today: string }): string[] {
  const after = stayNights(args.next.arrival, args.next.departure).filter((night) => night >= args.today);
  if (!args.sameRow) return after;
  const before = new Set(stayNights(args.original.arrival, args.original.departure));
  return after.filter((night) => !before.has(night));
}

/** Beds24 `POST /bookings` 옮기기 페이로드 — 객실과(바뀌었으면) 날짜만. 이름 · 금액 · 메모는 보내지 않는다. */
export function buildBeds24BookingMove(
  bookingId: string,
  args: { roomId: string; original: StayRange; next: StayRange },
): Record<string, unknown> {
  const payload: Record<string, unknown> = { id: Number(bookingId), roomId: Number(args.roomId) };
  if (args.next.arrival !== args.original.arrival) payload.arrival = args.next.arrival;
  if (args.next.departure !== args.original.departure) payload.departure = args.next.departure;
  return payload;
}

/**
 * 보낸 뒤 **다시 읽은 예약**이 옮긴 대로인가 — Beds24 는 받기만 하고 안 바꾼 것도 성공으로 답할 수 있다(2026-10-08).
 * @returns 안 맞는 항목(`roomId` · `arrival` · `departure`). 비면 맞다.
 */
export function diffMoveReadback(payload: Record<string, unknown>, booking: Record<string, unknown>): string[] {
  const mismatched: string[] = [];
  if (String(booking.roomId ?? "") !== String(payload.roomId)) mismatched.push("roomId");
  for (const key of ["arrival", "departure"] as const) {
    if (payload[key] === undefined) continue;
    if (String(booking[key] ?? "").slice(0, 10) !== String(payload[key])) mismatched.push(key);
  }
  return mismatched;
}
