"use client";

// 공용 관리자 콘솔 시간 선택 프리미티브.
import { useEffect, useMemo, useRef, useState } from "react";
import { Clock } from "lucide-react";

type AdminTimePickerProps = {
  /** "HH:mm" (24시간) 또는 미설정이면 "". */
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  placeholder?: string;
};

function parse(value: string): { h: number; m: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return { h, m };
}
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

export function AdminTimePicker({ value, onChange, ariaLabel, placeholder = "--:--" }: AdminTimePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hourColRef = useRef<HTMLDivElement | null>(null);
  const minColRef = useRef<HTMLDivElement | null>(null);

  const parsed = useMemo(() => parse(value), [value]);
  const selH = parsed?.h ?? null;
  const selM = parsed?.m ?? null;

  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 열릴 때 선택된 시/분을 애니메이션 없이 (가운데로) 스크롤해 보여준다.
  useEffect(() => {
    if (!open) return;
    const scrollToSel = (col: HTMLDivElement | null) => {
      if (!col) return;
      const active = col.querySelector<HTMLElement>("[data-sel='true']");
      if (active) col.scrollTop = active.offsetTop - col.clientHeight / 2 + active.clientHeight / 2;
    };
    scrollToSel(hourColRef.current);
    scrollToSel(minColRef.current);
  }, [open]);

  function pick(h: number | null, m: number | null) {
    const nh = h ?? selH ?? 0;
    const nm = m ?? selM ?? 0;
    onChange(`${pad(nh)}:${pad(nm)}`);
  }

  return (
    <div className="atp" ref={rootRef}>
      <button
        type="button"
        className="atp__trigger"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={parsed ? "atp__val" : "atp__val atp__val--empty"}>
          {parsed ? `${pad(parsed.h)}:${pad(parsed.m)}` : placeholder}
        </span>
        <Clock className="atp__ic" aria-hidden="true" />
      </button>

      {open ? (
        <div className="atp__pop" role="dialog" aria-label={ariaLabel}>
          <div className="atp__cols">
            <div className="atp__col" ref={hourColRef}>
              {HOURS.map((h) => (
                <button
                  key={h}
                  type="button"
                  data-sel={h === selH}
                  className={`atp__opt${h === selH ? " sel" : ""}`}
                  onClick={() => pick(h, null)}
                >
                  {pad(h)}
                </button>
              ))}
            </div>
            <div className="atp__sep">:</div>
            <div className="atp__col" ref={minColRef}>
              {MINUTES.map((m) => (
                <button
                  key={m}
                  type="button"
                  data-sel={m === selM}
                  className={`atp__opt${m === selM ? " sel" : ""}`}
                  onClick={() => pick(null, m)}
                >
                  {pad(m)}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
