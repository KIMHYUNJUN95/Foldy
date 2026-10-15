"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import "./ops-occupancy-white.css";

/**
 * 합계에 넣을 건물 — 칩 9개 대신 드롭다운 하나(2026-10-15 가동률 화이트 리디자인에서 시작).
 * 가동률 · 매출 · 비교 화면이 같이 쓴다. 모양은 `ops-occupancy-white.css` 의 `.ocw-inc*`.
 */
export function IncludePicker({
  properties,
  included,
  onSet,
  summary,
  title,
  allLabel,
}: {
  properties: string[];
  included: Set<string>;
  onSet: (update: (prev: Set<string>) => Set<string>) => void;
  summary: string;
  title: string;
  allLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (name: string) =>
    onSet((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className={`ocw-inc${open ? " open" : ""}`} ref={rootRef}>
      <button aria-expanded={open} aria-haspopup="dialog" className="ocw-inc__btn" onClick={() => setOpen((v) => !v)} title={title} type="button">
        <span className="t">{summary}</span>
        <ChevronDown aria-hidden="true" className="chev" />
      </button>
      {open && (
        <div aria-label={title} className="ocw-inc__menu" role="dialog">
          <div className="ocw-inc__hd">
            <span>{title}</span>
            {included.size < properties.length && (
              <button className="ocw-inc__all" onClick={() => onSet(() => new Set(properties))} type="button">
                {allLabel}
              </button>
            )}
          </div>
          {properties.map((name) => {
            const on = included.has(name);
            return (
              <button aria-pressed={on} className={`ocw-inc__opt${on ? " on" : ""}`} key={name} onClick={() => toggle(name)} type="button">
                <span aria-hidden="true" className="ck">
                  {on && <Check />}
                </span>
                <span className="n">{name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

