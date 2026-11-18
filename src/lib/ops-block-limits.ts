import { groupSelectionIntoRanges } from "@/lib/ops-calendar-selection";

/**
 * 판매 캘린더 차단 · 해제가 **한 번에** 받는 구간 수(방 하나의 이어진 날짜 = 1구간).
 * 실수로 격자 전체를 고르고 누르는 것을 서버에서도 막는다. 서버 액션 파일("use server")은 값을 export 할 수 없어
 * 서버와 화면(PC 패널 · 모바일 시트)이 같이 쓰도록 여기 한 곳에 둔다(2026-11-18).
 */
export const MAX_BLOCK_RANGES = 60;

/** 구간 수가 상한을 넘었는가 — 서버 판정과 화면의 「누르기 전 안내」가 같은 함수를 쓴다. */
export function exceedsBlockRangeLimit(rangeCount: number): boolean {
  return rangeCount > MAX_BLOCK_RANGES;
}

/** 칸 목록의 구간 수 — 서버가 받은 칸 · 화면이 고른 칸 모두 같은 규칙(`groupSelectionIntoRanges`)으로 센다. */
export function countBlockRanges(cells: readonly { roomKey: string; date: string }[]): number {
  return groupSelectionIntoRanges(cells.map((cell) => ({ date: cell.date, roomKey: cell.roomKey }))).length;
}

/** 상한을 넘은 구간 수 — 안내 문구의 `{over}`. 넘지 않으면 0. */
export function overBlockRangeLimit(rangeCount: number): number {
  return Math.max(0, rangeCount - MAX_BLOCK_RANGES);
}

/** 안내 문구의 `{ranges}` `{max}` `{over}` 를 채운다 — 함수 값 카피를 쓰지 않으려고 문자열 + replace 로 한다. */
export function fillBlockLimitText(text: string, rangeCount: number): string {
  return text
    .replaceAll("{ranges}", String(rangeCount))
    .replaceAll("{max}", String(MAX_BLOCK_RANGES))
    .replaceAll("{over}", String(overBlockRangeLimit(rangeCount)));
}
