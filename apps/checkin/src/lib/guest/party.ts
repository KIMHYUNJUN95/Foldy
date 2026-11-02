// 명부 자리 수 계산(DB 없음 — 테스트로 덮는다). 43 §8: 인원이 예약과 다르면 손님이 줄을 더하거나 빼고, 직원 화면에 표시.

/** 명부에 보이는 자리 수 — 저장한 사람과 손님이 말한 인원 중 큰 쪽. */
export function seatCount(saved: number, partySize: number): number {
  return Math.max(saved, partySize);
}

/**
 * 「이 사람은 안 와요」 뒤의 인원. 저장한 사람을 빼면 `savedAfter` 는 하나 줄어든 수.
 * 대표자 한 명은 남아야 하므로 1 밑으로는 못 내려간다 — 그럴 땐 null.
 */
export function partyAfterRemoval(saved: number, partySize: number, removingSaved: boolean): number | null {
  const next = seatCount(saved, partySize) - 1;
  const savedAfter = removingSaved ? saved - 1 : saved;
  if (next < 1 || next < savedAfter) return null;
  return next;
}
