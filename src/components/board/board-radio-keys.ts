/**
 * 라디오 묶음의 화살표 키 — 아래 · 오른쪽은 다음, 위 · 왼쪽은 이전(끝에서 돌아감), Home · End.
 * 아무것도 고르지 않았으면(-1) 다음은 처음, 이전은 끝. 다른 키는 null(신고 사유 시트, 2026-11-20).
 */
export function nextRadioIndex(current: number, key: string, length: number): number | null {
  if (length <= 0) return null;
  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      return current < 0 ? 0 : (current + 1) % length;
    case "ArrowUp":
    case "ArrowLeft":
      return current < 0 ? length - 1 : (current - 1 + length) % length;
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return null;
  }
}
