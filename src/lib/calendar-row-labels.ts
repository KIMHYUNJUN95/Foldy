/**
 * 「오늘 운영」 줄 아랫글 앞에 건물 이름을 붙일지 (2026-11-18). 건물을 골랐으면 안 붙인다. 1동 1실 건물(오쿠보A 등)은
 * 방 라벨이 곧 건물 이름이라 왼쪽 방 칸에 이미 나온다 — 또 붙이면 이름이 두 번 나오고 아랫글이 잘린다.
 * 비교는 정본(한국어) 이름끼리 — 화면에 그릴 때만 현지화한다.
 */
export function roomRowSubPrefix(input: { selectedProperty: string | null; propertyName: string; roomLabel: string }): boolean {
  if (input.selectedProperty) return false;
  return input.roomLabel.trim() !== input.propertyName.trim();
}

/** 막대 글자와 막대 오른쪽 끝 사이 — 왼쪽 붙음 간격 8 + 막대 안쪽 여백 8. */
const BAR_LABEL_INSET = 16;

/**
 * 모바일 캘린더 막대가 왼쪽 객실 칸 뒤로 넘어갔을 때 글자에 줄 최대 폭 (2026-11-18). 글자는 `position: sticky` 로 객실 칸 오른쪽에
 * 붙는데, 막대를 꽉 채운 글자는 sticky 가 움직일 자리가 없어 이름 앞부분이 칸 뒤로 사라졌다 — 보이는 폭만큼 줄여 앞부분부터 보이게.
 * 좌표는 날짜 트랙 기준(px). 가려지지 않았으면 `null`(제한 없음).
 */
export function barLabelMaxWidth(input: { barLeft: number; barRight: number; visibleLeft: number }): number | null {
  if (input.barLeft >= input.visibleLeft) return null;
  return Math.max(0, input.barRight - input.visibleLeft - BAR_LABEL_INSET);
}
