"use client";

// 관리자 콘솔 공용 사유 모달 프리미티브.
import { useEffect, useRef, useState } from "react";

export type AdminReasonModalProps = {
  title: string;
  description: string;
  placeholder: string;
  confirmLabel: string;
  cancelLabel: string;
  pending?: boolean;
  errorText?: string | null;
  danger?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
};

/** 가운데 정렬 사유 입력 대화상자 — 관리자 콘솔 액션의 `window.prompt` 를 대체한다.
 * 선택/필수 텍스트 사유가 필요한 경우 (승인 / 무효 / 반려). */
export function AdminReasonModal({
  title,
  description,
  placeholder,
  confirmLabel,
  cancelLabel,
  pending,
  errorText,
  danger,
  onConfirm,
  onCancel,
}: AdminReasonModalProps) {
  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    taRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(15, 23, 32, 0.45)",
        padding: 20,
      }}
      onClick={onCancel}
    >
      <div
        className="admodal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 400,
          background: "var(--card)",
          borderRadius: 16,
          border: "1px solid var(--line)",
          boxShadow: "var(--sh-pop)",
          padding: 20,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 900, color: "var(--ink)", marginBottom: 6 }}>
          {title}
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--adm-muted)", marginBottom: 12 }}>
          {description}
        </div>
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          rows={3}
          style={{
            width: "100%",
            resize: "none",
            padding: "9px 11px",
            border: "1px solid var(--line)",
            borderRadius: 10,
            background: "var(--adm-surface)",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--ink)",
            fontFamily: "inherit",
          }}
        />
        {errorText ? (
          <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 700, color: "var(--danger)" }}>
            {errorText}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            style={{ flex: 1 }}
            onClick={onCancel}
            disabled={pending}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn btn--sm ${danger ? "btn--danger-ghost" : "btn--ok"}`}
            style={{ flex: 1.4 }}
            onClick={() => onConfirm(value)}
            disabled={pending}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
