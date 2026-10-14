"use client";

// 요청 등록 폼 공용 조각 — 화이트 리디자인(2026-10-14, 시안 LFNew-Phone · MaintNew-Phone · OrderNew-Phone).
// 이름표(notched) 고르기 칸 · 3칸 고르기 타일 · 읽기 전용 칸 · 확인 시트. 모양은 order-form.css 의 .ofw-* 를 쓴다.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import "@/components/requests/order-form.css";

export type PickOption = { value: string; label: string };

/** 이름표 칸 모양의 고르기(건물 · 객실). 바깥을 누르면 닫힌다. */
export function PickField({
  label,
  value,
  placeholder,
  options,
  onChange,
  disabled,
  emptyText,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: PickOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div className={cn("ofw-nf ofw-dd", open && "is-open")} ref={ref}>
      <span className="ofw-nf__l" id={`${id}-l`}>
        {label}
      </span>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={`${id}-l`}
        className={cn("ofw-nf__in ofw-dd__btn", !current && "is-ph")}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        <span>{current?.label ?? placeholder}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open ? (
        <ul className="ofw-dd__menu" role="listbox" aria-labelledby={`${id}-l`}>
          {options.length === 0 && emptyText ? <li className="ofw-dd__empty">{emptyText}</li> : null}
          {options.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === value}>
              <button
                className={o.value === value ? "on" : ""}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                type="button"
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** 한 번에 보이는 고르기 타일(분류 · 카테고리 · 긴급도). dangerValue 를 고르면 빨간 글자. */
export function ChoiceTiles({
  label,
  options,
  value,
  onChange,
  cols = 3,
  dangerValue,
}: {
  label: string;
  options: PickOption[];
  value: string;
  onChange: (value: string) => void;
  cols?: 3 | 4;
  dangerValue?: string;
}) {
  const id = useId();
  return (
    <div className="ofw-tiles-wrap">
      <span className="ofw-k" id={id}>
        {label}
      </span>
      <div className={cn("ofw-tiles", cols === 4 && "is-4")} role="radiogroup" aria-labelledby={id}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              aria-checked={on}
              className={cn(on && "on", on && dangerValue === o.value && "is-danger")}
              key={o.value}
              onClick={() => {
                haptic("light");
                onChange(o.value);
              }}
              role="radio"
              type="button"
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ReadonlyField({ label, value, tail }: { label: string; value: string; tail: string }) {
  return (
    <div className="ofw-nf">
      <span className="ofw-nf__l">{label}</span>
      <div className="ofw-nf__in ofw-ro">
        <span>{value}</span>
        <em>{tail}</em>
      </div>
    </div>
  );
}

export type SheetRow = { k: string; v: string; danger?: boolean };

/** 보내기 전 확인 시트 — 제목 · 한 줄 · 정보 줄 · [취소][확인]. 닫기는 「취소」 · 끌어내리기 · 바깥 누르기. */
export function ConfirmFormSheet({
  title,
  sub,
  rows,
  cancelLabel,
  confirmLabel,
  pending,
  onCancel,
  onConfirm,
  children,
}: {
  title: string;
  sub: string;
  rows: SheetRow[];
  cancelLabel: string;
  confirmLabel: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <BottomSheet ariaLabel={title} onClose={() => (pending ? undefined : onCancel())}>
      {({ close }) => (
        <div className="ofw-sheet">
          <div className="ofw-sheet__h">
            <h3>{title}</h3>
            <span>{sub}</span>
          </div>
          <dl className="ofw-sheet__dl">
            {rows.map((r) => (
              <div key={r.k}>
                <dt>{r.k}</dt>
                <dd className={r.danger ? "is-danger" : ""}>{r.v}</dd>
              </div>
            ))}
          </dl>
          {children}
          <div className="ofw-sheet__btns">
            <button className="ofw-btn is-gray" disabled={pending} onClick={close} type="button">
              {cancelLabel}
            </button>
            <button className="ofw-btn is-pri" disabled={pending} onClick={onConfirm} type="button">
              {pending ? <span className="ofw-spin" aria-hidden="true" /> : null}
              {confirmLabel}
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
