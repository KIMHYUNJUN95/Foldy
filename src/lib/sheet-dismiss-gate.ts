/**
 * 공용 BottomSheet 닫기 판정(2026-11-24). 닫기 막기(`dismissDisabled`)가 켜진 동안에는 네 가지 길(스크림 탭 · Esc ·
 * 끌어내리기 · 안쪽 close) 모두 미끄러져 나가지 않는다 — 부모가 onClose 를 무시하면 시트가 안 보인 채 화면을 덮던 것.
 *
 * - `request`: 닫기를 요청받음 → 막혔으면 `stay`(그대로), 아니면 `slideOut`.
 * - `finish`: 미끄러져 나가는 시간이 끝남 → 그 사이 막혔으면 `reopen`(다시 올라옴 · onClose 안 부름), 아니면 `close`.
 */
export type SheetDismissStep = "request" | "finish";
export type SheetDismissDecision = "stay" | "slideOut" | "reopen" | "close";

export function decideSheetDismiss(step: SheetDismissStep, dismissDisabled: boolean): SheetDismissDecision {
  if (step === "request") return dismissDisabled ? "stay" : "slideOut";
  return dismissDisabled ? "reopen" : "close";
}
