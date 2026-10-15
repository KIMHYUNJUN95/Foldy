"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import "./admin-confirm-motion.css";

/**
 * 길게 눌러 확정(2026-10-15, 시안 Motion-C-Confirm-PC) — 한 번에 몰리지 않는 결정(연차 승인)에만 쓴다.
 * 누르고 있으면 버튼 안이 왼쪽부터 차오르고(기본 0.6초) 다 차면 `onConfirm`. 중간에 떼면 스르륵 빠진다.
 * 키보드는 Enter · Space 를 누르고 있는 동안 같은 방식. 여러 명을 연달아 처리하는 버튼에는 쓰지 말 것
 * (급여 마감 · 교통비 승인은 한 번 클릭 + `AdminUndoToast`).
 */
export function AdminHoldButton({
  children,
  durationMs = 600,
  disabled = false,
  className = "",
  style,
  onConfirm,
}: {
  children: ReactNode;
  durationMs?: number;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onConfirm: () => void;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  const start = () => {
    if (disabled || timer.current) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      navigator.vibrate?.(12);
      onConfirm();
    }, durationMs);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <button
      type="button"
      className={`ahold ${holding ? "is-holding" : ""} ${className}`}
      style={{ ...style, ["--ahold-ms" as string]: `${durationMs}ms` }}
      disabled={disabled}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        start();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === "Enter" || e.key === " ") cancel();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="ahold__lab">{children}</span>
      <span className="ahold__fill" aria-hidden="true">
        <span className="ahold__lab">{children}</span>
      </span>
    </button>
  );
}
