"use client";

import { useEffect, useRef } from "react";
import "./board-white.css";

/**
 * 게시판 가운데 확인 창(글 · 댓글 삭제 · 사용자 차단 · 신고 처리 삭제) — 되돌릴 수 없는 일에만. 의도된 BottomSheet 예외.
 * 화이트 리디자인(2026-10-15): 흰 카드 · 회색 「취소」 + 빨간 확인, 살짝 커지며 나타난다.
 */
export function BoardConfirm({
  title,
  body,
  cancelLabel,
  confirmLabel,
  pending = false,
  fallbackFocus,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  cancelLabel: string;
  confirmLabel: string;
  pending?: boolean;
  /** 연 요소가 닫힐 때 이미 없어졌으면(시트 안 줄 등) 초점을 돌릴 곳 — 보통 시트를 연 「⋯」 단추. */
  fallbackFocus?: () => HTMLElement | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCancelRef = useRef(onCancel);
  const fallbackRef = useRef(fallbackFocus);
  useEffect(() => {
    onCancelRef.current = onCancel;
    fallbackRef.current = fallbackFocus;
  });

  // Esc 로 닫고, 열릴 때 「취소」 에 초점, Tab 은 창 안 버튼 사이만 돈다, 닫히면 연 자리(없어졌으면 `fallbackFocus`)로 초점을 되돌린다(unslop 2026-11-20).
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancelRef.current();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && dialogRef.current.contains(active);
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // 연 요소가 시트 안에 있었으면 시트와 함께 사라졌다 — 그때는 부르는 쪽이 준 대체 요소로.
      const target = opener?.isConnected ? opener : fallbackRef.current?.();
      target?.focus();
    };
  }, []);

  return (
    <div aria-label={title} aria-modal="true" className="bdw-cf" ref={dialogRef} role="dialog">
      <div className="bdw-cf__card">
        <p>{title}</p>
        <span>{body}</span>
        <div className="bdw-cf__btns">
          <button className="bdw-btn is-gray" onClick={onCancel} ref={cancelRef} type="button">
            {cancelLabel}
          </button>
          <button className="bdw-btn is-red" disabled={pending} onClick={onConfirm} type="button">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
