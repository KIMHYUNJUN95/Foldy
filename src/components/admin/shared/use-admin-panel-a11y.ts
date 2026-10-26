"use client";

// 관리자 콘솔 공용 사이드 패널 / 가운데 모달 동작 훅.
// Esc 로 닫기, body 스크롤 잠금, 열릴 때 패널에 포커스, 닫힐 때 포커스 복원.
// `trapFocus` (옵트인, 2026-09-30 — 매출 요약 모달)는 Tab / Shift+Tab 을 패널 안에 가둔다.
// `quietRestore` (옵트인, 2026-10-01 — 운영 캘린더 툴바 패널)는 포커스를 트리거로 돌려주지만
// 포커스 링은 그리지 않는다: Esc 로 닫으면 브라우저가 키보드 사용으로 보고
// 열어 둔 툴바 토글에 링을 그려서, 닫힌 패널의 버튼이 켜져 있는 것처럼 보였다.
import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useAdminPanelA11y<T extends HTMLElement>(
  onClose: () => void,
  options: { disabled?: boolean; trapFocus?: boolean; quietRestore?: boolean } = {},
) {
  const panelRef = useRef<T | null>(null);
  const onCloseRef = useRef(onClose);
  const disabledRef = useRef(options.disabled ?? false);
  const trapFocus = options.trapFocus ?? false;
  const quietRestore = options.quietRestore ?? false;

  useEffect(() => {
    onCloseRef.current = onClose;
    disabledRef.current = options.disabled ?? false;
  }, [onClose, options.disabled]);

  useEffect(() => {
    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    requestAnimationFrame(() => {
      panelRef.current?.focus({ preventScroll: true });
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Tab" && trapFocus) {
        const panel = panelRef.current;
        if (!panel) return;
        const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
          (element) => element.offsetParent !== null || element === document.activeElement,
        );
        if (focusable.length === 0) {
          event.preventDefault();
          panel.focus({ preventScroll: true });
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        const inside = active instanceof Node && panel.contains(active);
        if (event.shiftKey && (active === first || active === panel || !inside)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || !inside)) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key !== "Escape" || disabledRef.current) return;
      event.preventDefault();
      onCloseRef.current();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      // `focusVisible` 은 여기 TS DOM lib 보다 최신이라, 지원하지 않는 브라우저는 이 키를 무시한다.
      previousActive?.focus({ preventScroll: true, ...(quietRestore ? { focusVisible: false } : {}) } as FocusOptions);
    };
  }, [trapFocus, quietRestore]);

  return panelRef;
}
