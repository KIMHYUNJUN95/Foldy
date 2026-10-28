"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Clock } from "lucide-react";
import { earliestMinute, fromMinutes, minuteGone, parseTimeText, slotOpen, slotTimes, toMinutes } from "@/lib/report-schedule-time";
import { cn } from "@/lib/utils";
import "./report-time-combo.css";

/**
 * 업무일지 「보낼 시각」 칸 하나 + 목록(2026-10-20 3차, 시안 7SR7V8Ja P1) — PC 업무일지 창의 작은 창. 구글 캘린더 방식.
 *
 * - 목록: 「지금 바로」 + 지금부터 15분 간격(남은 시간 같이). 고른 시각이 15분 칸이 아니면 제자리에 끼워 보인다.
 * - 치기: 「1837」 「18:37」 「6시 반」 「午後6時」 「30분 뒤」 … 아무렇게나 → 맨 위에 알아들은 시각, 아래에 같은 시간대.
 *   지난 시각을 치면 칸 테두리만 빨강, 맨 위가 「가장 이른 시각」이라 Enter 면 바로 고쳐진다.
 * - 키보드: ↑ ↓ 목록 이동, Enter = 고른 줄로 예약(`onSubmit`, 「지금 바로」 줄은 고르기만). 마우스: 줄 클릭 = 고르기(`onPick`).
 */
type Opt = { key: string; time: string | null; note: string };

export type ReportTimeComboLabels = {
  input: string;
  list: string;
  placeholder: string;
  now: string;
  earliest: string;
  past: string;
  noMatch: string;
};

export function ReportTimeCombo({
  value,
  nowMin,
  labels,
  whenIn,
  onPick,
  onSubmit,
}: {
  /** 「HH:MM」, 없으면 null(지금 바로). */
  value: string | null;
  nowMin: number;
  labels: ReportTimeComboLabels;
  /** 분 → 「1시간 12분 뒤」. */
  whenIn: (minutes: number) => string;
  onPick: (next: string | null) => void;
  onSubmit: (next: string | null) => void;
}) {
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // null = 아직 안 침(목록 전체 + 지금 값).
  const [typed, setTyped] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);

  const earliest = earliestMinute(nowMin);
  const slots = slotTimes(nowMin);
  const timeOpt = (t: string): Opt => ({ key: t, time: t, note: whenIn(toMinutes(t) - nowMin) });
  const parsed = typed?.trim() ? parseTimeText(typed, nowMin) : null;
  const past = parsed !== null && minuteGone(parsed, nowMin);

  let opts: Opt[];
  if (typed === null || !typed.trim()) {
    const times = value && slotOpen(value, nowMin) && !slots.includes(value) ? [...slots, value].sort() : slots;
    opts = [{ key: "now", time: null, note: "" }, ...times.map(timeOpt)];
  } else if (parsed !== null && past) {
    opts = earliest === null ? [] : [{ key: "earliest", time: fromMinutes(earliest), note: labels.earliest }, ...slots.slice(0, 3).map(timeOpt)];
  } else if (parsed !== null) {
    const t = fromMinutes(parsed);
    opts = [timeOpt(t), ...slots.filter((s) => s.slice(0, 2) === t.slice(0, 2) && s !== t).map(timeOpt)];
  } else {
    const digits = typed.replace(/\D/g, "");
    opts = digits ? slots.filter((s) => s.replace(":", "").startsWith(digits)).map(timeOpt) : [];
  }
  const fallback = typed === null ? Math.max(0, opts.findIndex((o) => o.time === value)) : 0;
  const at = Math.min(active ?? fallback, Math.max(0, opts.length - 1));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at, opts.length]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!opts.length) return;
      setActive(Math.min(opts.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1))));
      return;
    }
    // 조합(IME) 중 Enter 는 글자 확정이다 — 시각을 제출하지 않는다.
    if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      const opt = opts[at];
      if (!opt) return;
      if (opt.time === null) onPick(null);
      else onSubmit(opt.time);
    }
  };

  const shownText = typed ?? value ?? "";
  const hint =
    typed?.trim() && parsed !== null
      ? past
        ? labels.past
        : `→ ${fromMinutes(parsed)}`
      : typed?.trim() && !opts.length
        ? labels.noMatch
        : null;

  return (
    <div className="rtc">
      <div className={cn("rtc__in", past && "is-err")}>
        <Clock aria-hidden="true" />
        <input
          ref={inputRef}
          role="combobox"
          aria-label={labels.input}
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={opts[at] ? `${id}-o${at}` : undefined}
          aria-invalid={past || undefined}
          autoComplete="off"
          enterKeyHint="done"
          placeholder={labels.placeholder}
          value={shownText}
          onChange={(e) => {
            setTyped(e.target.value);
            setActive(null);
          }}
          onKeyDown={onKey}
        />
        {hint ? <span className={cn("rtc__hint", past && "is-bad")}>{hint}</span> : null}
      </div>
      <div ref={listRef} id={`${id}-list`} className="rtc__list" role="listbox" aria-label={labels.list}>
        {opts.map((o, i) => (
          <div
            key={o.key}
            id={`${id}-o${i}`}
            data-i={i}
            role="option"
            aria-selected={i === at}
            className={cn("rtc__opt", i === at && "is-act")}
            // 칸의 초점을 뺏지 않는다 — 고른 뒤에도 Enter · Esc 가 그대로 듣게.
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(o.time)}
          >
            <span className="num">{o.time ?? labels.now}</span>
            {o.note ? <small className="num">{o.note}</small> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
