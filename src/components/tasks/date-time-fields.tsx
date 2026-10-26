"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Dictionary } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { tokyoToday } from "@/lib/tokyo-date";

type Copy = Dictionary["tasks"];

const pad2 = (n: number) => String(n).padStart(2, "0");


// ── 인라인 월 캘린더(전체 폭 카드; 폼 패딩을 절대 넘지 않음) ──────────────
export function MiniCalendar({
  value,
  onSelect,
  onClear,
  locale,
  copy,
}: {
  value: string;
  onSelect: (ymd: string) => void;
  onClear: () => void;
  locale: string;
  copy: Copy;
}) {
  const today = tokyoToday();
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const [by, bm] = (valid ? value : today).split("-").map(Number);
  const [cur, setCur] = useState({ y: by, m: bm });

  const first = new Date(Date.UTC(cur.y, cur.m - 1, 1)).getUTCDay();
  const daysIn = new Date(Date.UTC(cur.y, cur.m, 0)).getUTCDate();
  const monthLabel = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(cur.y, cur.m - 1, 15)));
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(
      new Date(Date.UTC(2025, 0, 5 + i)),
    ),
  );
  const shift = (d: number) =>
    setCur(({ y, m }) => {
      const idx = y * 12 + (m - 1) + d;
      return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
    });

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < first; i++) cells.push(<span key={`pad-${i}`} />);
  for (let d = 1; d <= daysIn; d++) {
    const iso = `${cur.y}-${pad2(cur.m)}-${pad2(d)}`;
    const isSel = iso === value;
    const isT = iso === today;
    const w = (first + d - 1) % 7;
    cells.push(
      <button
        className={cn(
          "flex aspect-square items-center justify-center rounded-[10px] text-[13px] font-bold transition-colors",
          isSel
            ? "bg-primary text-primary-foreground shadow-[0_6px_14px_-8px_hsl(var(--primary-hsl)/0.7)]"
            : isT
              ? "bg-primary/[0.08] text-primary ring-1 ring-inset ring-primary/25"
              : cn(
                  "text-foreground hover:bg-slate-50",
                  w === 0 && "text-rose-500",
                  w === 6 && "text-blue-600",
                ),
        )}
        key={iso}
        onClick={() => onSelect(iso)}
        type="button"
      >
        {d}
      </button>,
    );
  }

  return (
    <div className="mt-2 rounded-2xl border border-border bg-surface p-3 shadow-[0_14px_44px_-28px_rgba(15,23,42,0.4)]">
      <div className="mb-2 flex items-center justify-between">
        <button
          aria-label={copy.calPrevMonth}
          className="flex size-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-foreground"
          onClick={() => shift(-1)}
          type="button"
        >
          <ChevronLeft className="size-[17px]" aria-hidden="true" />
        </button>
        <span className="text-[14px] font-black tracking-[-0.01em] text-foreground">{monthLabel}</span>
        <button
          aria-label={copy.calNextMonth}
          className="flex size-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-foreground"
          onClick={() => shift(1)}
          type="button"
        >
          <ChevronRight className="size-[17px]" aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] font-bold text-muted-foreground">
        {weekdays.map((w, i) => (
          <span className={cn(i === 0 && "text-rose-500", i === 6 && "text-blue-600")} key={i}>
            {w}
          </span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-0.5">{cells}</div>
      <div className="mt-2.5 flex items-center justify-between border-t-[0.5px] border-[var(--separator)] pt-2.5">
        <button
          className="rounded-full px-2.5 py-1 text-[12px] font-bold text-muted-foreground transition-colors hover:bg-slate-100"
          onClick={onClear}
          type="button"
        >
          {copy.clearValue}
        </button>
        <button
          className="rounded-full bg-primary/[0.07] px-3 py-1 text-[12px] font-bold text-primary transition-colors hover:bg-primary/10"
          onClick={() => onSelect(today)}
          type="button"
        >
          {copy.todayLabel}
        </button>
      </div>
    </div>
  );
}

// ── 인라인 시간 선택기: 오전/오후 + 시 + 분 휠, 직접 텍스트 입력도 지원 ───────────────────
export function TimeWheels({
  value,
  onChange,
  copy,
}: {
  value: string;
  onChange: (hhmm: string) => void;
  copy: Copy;
}) {
  const valid = /^\d{1,2}:\d{2}$/.test(value);
  const [h24, minute] = valid ? value.split(":").map(Number) : [9, 0];
  const isPm = h24 >= 12;
  const hour12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const [draft, setDraft] = useState(value);

  const emit = (pm: boolean, h12: number, mm: number) => {
    const h = pm ? (h12 % 12) + 12 : h12 % 12;
    const next = `${pad2(h)}:${pad2(mm)}`;
    setDraft(next);
    onChange(next);
  };

  const col =
    "flex max-h-[176px] flex-1 flex-col gap-1 overflow-y-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
  const item = (active: boolean) =>
    cn(
      "shrink-0 rounded-xl py-2 text-center text-[14px] font-bold transition-colors",
      active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-slate-50",
    );

  return (
    <div className="mt-2 rounded-2xl border border-border bg-surface p-3 shadow-[0_14px_44px_-28px_rgba(15,23,42,0.4)]">
      {/* 직접 입력 */}
      <input
        className="mb-2.5 h-10 w-full rounded-xl border border-border bg-background/60 px-3 text-center text-sm font-bold tracking-wide text-foreground outline-none focus:border-primary"
        inputMode="numeric"
        onChange={(e) => {
          const v = e.target.value;
          setDraft(v);
          if (/^\d{1,2}:\d{2}$/.test(v)) {
            const [hh, mm] = v.split(":").map(Number);
            if (hh <= 23 && mm <= 59) onChange(`${pad2(hh)}:${pad2(mm)}`);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault(); // 여기서 폼을 제출하지 않는다
        }}
        placeholder={copy.timeManualHint}
        value={draft}
      />
      <div className="grid grid-cols-3 gap-2">
        {/* AM / PM */}
        <div className="flex flex-col gap-1 rounded-xl bg-slate-50/70 p-1">
          {[
            { pm: false, label: copy.amLabel },
            { pm: true, label: copy.pmLabel },
          ].map((o) => (
            <button
              className={item(isPm === o.pm)}
              key={o.label}
              onClick={() => emit(o.pm, hour12, minute)}
              type="button"
            >
              {o.label}
            </button>
          ))}
        </div>
        {/* 시 1–12 */}
        <div className={cn(col, "rounded-xl bg-slate-50/70")}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
            <button
              className={item(hour12 === h)}
              key={h}
              onClick={() => emit(isPm, h, minute)}
              type="button"
            >
              {pad2(h)}
            </button>
          ))}
        </div>
        {/* 분 0–59 */}
        <div className={cn(col, "rounded-xl bg-slate-50/70")}>
          {Array.from({ length: 60 }, (_, i) => i).map((m) => (
            <button
              className={item(minute === m)}
              key={m}
              onClick={() => emit(isPm, hour12, m)}
              type="button"
            >
              {pad2(m)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
