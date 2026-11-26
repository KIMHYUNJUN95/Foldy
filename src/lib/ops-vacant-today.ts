/**
 * 오늘 빈방만 — 판매 캘린더. **순수하다.**
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 이식 상태 「오늘 빈방만」
 * 원본: STAY ARI Manager `roomsVacantTodaySet` (`BuildingCalendar.jsx`)
 *
 * 「오늘 밤」을 차지한 **확정 숙박**이 없는 방. 저쪽과 같이 —
 * - 받는 것은 `stays`(`splitOpsBars` — 방을 차지하는 확정 숙박, 「예약 표시」 필터와 무관, 2026-11-26)다. 취소 · 문의 ·
 *   예약 요청은 이미 빠져 있다. 보이는 막대로 세면 확정을 껐을 때 모든 방이 빈방이 됐다.
 * - **차단(블록)은 안 센다** — 차단된 방도 「빈방」으로 남는다. 저쪽이 그렇게 했고, 판매 조정
 *   화면이라 막아 둔 방도 보여야 풀지 말지 판단한다.
 * - 오늘 체크아웃하는 예약은 오늘 밤을 차지하지 않는다(`checkIn ≤ 오늘 < checkOut`).
 */
export function opsVacantRoomKeys(args: {
  roomKeys: readonly string[];
  stays: ReadonlyArray<{ roomKey: string; checkIn: string; checkOut: string }>;
  /** 도쿄 운영일 `YYYY-MM-DD`. */
  today: string;
}): Set<string> {
  const booked = new Set<string>();
  for (const stay of args.stays) {
    if (stay.checkIn <= args.today && args.today < stay.checkOut) booked.add(stay.roomKey);
  }
  return new Set(args.roomKeys.filter((key) => !booked.has(key)));
}
