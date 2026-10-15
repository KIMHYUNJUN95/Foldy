"use client";
import { haptic } from "@/lib/haptics";

/** 「맨 위 고정」 스위치 줄 — 화이트 리디자인(2026-10-15). 고정 권한이 있는 사람에게만 그린다(부모가 판단). */
export function BoardPinToggle({
  checked,
  onChange,
  title,
  subtitle,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  subtitle: string;
}) {
  return (
    <label className="bdw-sw-row">
      <span className="bdw-sw-row__b">
        <b>{title}</b>
        <span>{subtitle}</span>
      </span>
      <button
        aria-checked={checked}
        aria-label={title}
        className="bdw-sw"
        onClick={() => {
          haptic("light");
          onChange(!checked);
        }}
        role="switch"
        type="button"
      >
        <i aria-hidden="true" />
      </button>
    </label>
  );
}
