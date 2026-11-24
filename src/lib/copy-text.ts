/**
 * 글 복사 — 공용(예약 캘린더 모바일 · 손님 메시지 출입 번호).
 * 클립보드 API 가 없거나 거절하면(권한 · http · 오래된 웹뷰) 숨은 글 칸 + `execCommand("copy")` 로 한 번 더.
 * 그것도 안 되면 던진다 — 오류 글에 복사하려던 값을 넣지 않는다(출입 번호 등).
 */
export async function copyText(value: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // 아래 대체 복사로.
    }
  }
  if (typeof document === "undefined") throw new Error("clipboard_unavailable");
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  // 숨은 글 칸을 고르면 포커스가 옮겨 간다 — 끝나면 누른 단추 등 원래 요소로 돌려준다.
  const previous = document.activeElement;
  let ok = false;
  try {
    textarea.select();
    textarea.setSelectionRange(0, value.length); // iOS 는 select() 만으로 고르지 않는다.
    ok = document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
    if (typeof HTMLElement !== "undefined" && previous instanceof HTMLElement && previous.isConnected) {
      previous.focus({ preventScroll: true });
    }
  }
  if (!ok) throw new Error("clipboard_unavailable");
}
