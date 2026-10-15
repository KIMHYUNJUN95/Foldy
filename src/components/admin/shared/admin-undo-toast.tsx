"use client";

import { useEffect, useRef } from "react";
import "./admin-confirm-motion.css";

/**
 * 「실행 취소」 토스트(2026-10-15, 시안 Motion-C-Confirm-PC) — 여러 명을 연달아 처리하는 버튼(급여 마감 ·
 * 교통비 승인)이 확인 창 대신 쓴다. 아래 가운데 · 남은 시간 고리 · 5초 뒤 저절로 닫힘(마우스를 올리면 멈춤).
 * `stamp` 이 바뀌면(한 명 더 처리) 문구가 위로 굴러 바뀌고 시간이 처음부터 다시 간다.
 */
export function AdminUndoToast({
  stamp,
  message,
  undoLabel,
  pending = false,
  durationMs = 5000,
  onUndo,
  onExpire,
}: {
  stamp: number;
  message: string;
  undoLabel: string;
  pending?: boolean;
  durationMs?: number;
  onUndo: () => void;
  onExpire: () => void;
}) {
  const left = useRef(durationMs);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expire = useRef(onExpire);
  useEffect(() => {
    expire.current = onExpire;
  });

  const run = () => {
    startedAt.current = Date.now();
    timer.current = setTimeout(() => expire.current(), left.current);
  };
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    left.current = Math.max(0, left.current - (Date.now() - startedAt.current));
  };

  useEffect(() => {
    left.current = durationMs;
    if (pending) return;
    run();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [stamp, durationMs, pending]);

  return (
    <div className="adm-undo" role="status" onMouseEnter={stop} onMouseLeave={() => !pending && run()}>
      <svg className="adm-undo__ring" width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="7.5" stroke="rgba(255,255,255,.22)" strokeWidth="2.4" />
        <circle
          key={stamp}
          className="adm-undo__arc"
          cx="10"
          cy="10"
          r="7.5"
          stroke="#fff"
          strokeWidth="2.4"
          strokeLinecap="round"
          pathLength={1}
          transform="rotate(-90 10 10)"
          style={{ animationDuration: `${durationMs}ms` }}
        />
      </svg>
      <span className="adm-undo__msg">
        <span key={stamp} className="adm-undo__t">
          {message}
        </span>
      </span>
      <button type="button" className="adm-undo__btn" onClick={onUndo} disabled={pending}>
        {undoLabel}
      </button>
    </div>
  );
}
