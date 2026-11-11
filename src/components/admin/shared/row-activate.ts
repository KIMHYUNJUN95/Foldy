import type { KeyboardEvent } from "react";

/**
 * 콘솔 표 · 목록의 「줄 누르면 열기」를 키보드로도(2026-11-11). `<tr onClick>` 만 있으면 Tab 으로 닿지 않고 Enter 도 안 먹는다.
 * 줄에 `{...rowActivateProps(open)}` 를 붙인다 — Tab 으로 닿고(tabIndex 0) Enter · Space 로 연다. 줄 안의 단추 · 체크에서
 * 누른 키는 그 요소 몫이라 줄을 열지 않는다. 초점 테두리는 `admin-console.css` 의 `[data-row-activate]:focus-visible`.
 */
export function rowActivateProps(onActivate: () => void) {
  return {
    tabIndex: 0,
    "data-row-activate": "",
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      if (event.target !== event.currentTarget) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onActivate();
    },
  } as const;
}
