/**
 * 글자 복사 — 한 곳에 모은 규칙(2026-11-11). `navigator.clipboard` 가 없거나(보안 컨텍스트 아님) 거절하면
 * 숨은 textarea + `execCommand("copy")` 로 한 번 더 시도한다. 둘 다 실패하면 false — 부르는 쪽이 실패 문구 · error 햅틱.
 */
type ClipboardLike = { writeText: (text: string) => Promise<void> };
type DocLike = {
  createElement: (tag: "textarea") => {
    value: string;
    style: Record<string, string>;
    select: () => void;
    setSelectionRange: (start: number, end: number) => void;
    setAttribute: (name: string, value: string) => void;
  };
  activeElement?: { focus?: () => void } | null;
  body: { appendChild: (node: never) => unknown; removeChild: (node: never) => unknown };
  execCommand: (command: string) => boolean;
};

export async function copyTextToClipboard(
  text: string,
  env?: { clipboard?: ClipboardLike; doc?: DocLike },
): Promise<boolean> {
  const clipboard = env && "clipboard" in env ? env.clipboard : typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  const doc = env?.doc ?? (typeof document !== "undefined" ? (document as unknown as DocLike) : undefined);
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      /* 거절됨 — 아래 대체 경로 */
    }
  }
  if (!doc) return false;
  try {
    const previous = doc.activeElement ?? null;
    const area = doc.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", ""); // 키보드가 올라오지 않게
    area.style.position = "fixed";
    area.style.opacity = "0";
    doc.body.appendChild(area as never);
    try {
      area.select();
      area.setSelectionRange(0, text.length); // iOS 웹뷰는 select() 만으로 잡히지 않는다
      return doc.execCommand("copy");
    } finally {
      doc.body.removeChild(area as never);
      previous?.focus?.(); // 눌렀던 버튼으로 초점을 돌려준다
    }
  } catch {
    return false;
  }
}
