"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "@/components/mobile/ops/mobile-automation-form.css";

/**
 * 가운데 확인 창 — 「그대로 두기 / 실행」. 첫 초점은 「그대로 두기」(Enter 한 번에 Slack 으로 나가지 않게).
 * 닫기는 「그대로 두기」 · Esc · 바깥 누르기. body 로 포털(당겨서 새로고침의 transform 에 갇히지 않게).
 */
export function MobileConfirm({
  title,
  body,
  okLabel,
  keepLabel,
  busy,
  onOk,
  onKeep,
}: {
  title: string;
  body: ReactNode;
  okLabel: string;
  keepLabel: string;
  busy: boolean;
  onOk: () => void;
  onKeep: () => void;
}) {
  const keepRef = useRef<HTMLButtonElement>(null);
  const latest = useRef({ busy, onKeep });
  useEffect(() => {
    latest.current = { busy, onKeep };
  });
  useEffect(() => {
    keepRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !latest.current.busy) latest.current.onKeep();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="maf-cf"
      data-native-back-overlay=""
      onPointerDown={(event) => {
        event.stopPropagation(); // 셸의 마우스 당겨서 새로고침으로 올라가지 않게(포털도 React 트리로는 올라간다)
        if (event.target === event.currentTarget && !busy) onKeep();
      }}
    >
      <div aria-describedby="maf-cf-body" aria-labelledby="maf-cf-title" aria-modal="true" className="maf-cf__card" role="alertdialog">
        <h3 id="maf-cf-title">{title}</h3>
        <p id="maf-cf-body">{body}</p>
        <div className="maf-cf__btns">
          <button className="maf-btn is-gray" disabled={busy} onClick={onKeep} ref={keepRef} type="button">
            {keepLabel}
          </button>
          <button className="maf-btn is-primary" disabled={busy} onClick={onOk} type="button">
            {okLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
