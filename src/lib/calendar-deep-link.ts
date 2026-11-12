/**
 * 모바일 예약 캘린더 딥링크(`?reservationId=`) 판정 — **순수 모듈** (2026-11-12 예약 캘린더 점검).
 *
 * 예전엔 예약이 읽은 창(이번 달 · 다음 달) 밖이거나 취소 · 노쇼거나 주소에 건물이 없으면 아무 말 없이 안 열렸고, 건물을 안 고른
 * 채 들어오면 건물을 고른 뒤에야 시트가 뜬금없이 떴다. 이제 서버가 예약을 먼저 찾아 **그 예약의 달 · 건물로 다시 보내** 열고,
 * 못 여는 경우는 이유를 알려 준다.
 */
export type CalendarDeepLinkNotice = "cancelled" | "no_property" | "not_found" | "out_of_window";

export type CalendarDeepLinkDecision =
  | { kind: "open"; month: string; property: string }
  | { kind: "notice"; reason: CalendarDeepLinkNotice };

export function decideCalendarDeepLink(input: {
  /** 찾은 예약(이 조직). 없으면 `null`. `propertyName` 은 정규 건물 이름. */
  reservation: { checkInDate: string; checkOutDate: string; propertyName: string; status: string } | null;
  /** 캘린더에서 빠지는 건물 · 객실인가(`isExcludedOperationalProperty` · `Room`). */
  excluded: boolean;
  /** 읽는 창 — 이번 달 · 다음 달(`YYYY-MM`). */
  currentMonth: string;
  nextMonth: string;
}): CalendarDeepLinkDecision {
  const { reservation, currentMonth, nextMonth } = input;
  if (!reservation) return { kind: "notice", reason: "not_found" };
  if (reservation.status === "cancelled" || reservation.status === "no_show") return { kind: "notice", reason: "cancelled" };
  if (input.excluded || !reservation.propertyName.trim()) return { kind: "notice", reason: "no_property" };
  const checkInMonth = reservation.checkInDate.slice(0, 7);
  if (checkInMonth === currentMonth || checkInMonth === nextMonth) {
    return { kind: "open", month: checkInMonth, property: reservation.propertyName };
  }
  // 지난달에 들어와 이번 달까지 묵는 예약 — 이번 달 화면에 막대가 있다.
  if (checkInMonth < currentMonth && reservation.checkOutDate > `${currentMonth}-01`) {
    return { kind: "open", month: currentMonth, property: reservation.propertyName };
  }
  return { kind: "notice", reason: "out_of_window" };
}
