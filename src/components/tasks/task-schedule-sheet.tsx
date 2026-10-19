"use client";

// Unified schedule picker (mobile) — one clean sheet for 날짜 · 시간 · 반복, benchmarked on
// Todoist's date popover. Quick relative options (오늘/내일/다음 주/다음 주말/날짜 없음) with computed
// date labels + an inline month calendar + expandable Time / Repeat rows.
// Single-date model (A안, 2026-07-24): the picker sets ONE date; the form maps it to `due_at`.
// See docs/product/18-todo-task-workflow.md → "Dates And Time".
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Armchair,
  Ban,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Repeat,
  Sun,
  Sunrise,
  X,
} from "lucide-react";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { TimeWheels } from "@/components/tasks/date-time-fields";
import type { Dictionary } from "@/lib/i18n";
import {
  CUSTOM_RECURRENCE_PREFIX,
  formatCustomWeekdays,
  formatWeekday,
  parseCustomWeekdays,
  WEEKDAY_ORDER,
} from "@/lib/tasks-recurrence";
import { cn } from "@/lib/utils";
import { tokyoToday, ymdShift } from "@/lib/tokyo-date";

type Copy = Dictionary["tasks"];

export type ScheduleValue = { date: string; time: string; repeat: string; duration: number };

// Time-block duration options (minutes). 0 = 기간 없음.
const DURATIONS = [15, 30, 60, 120] as const;

const pad2 = (n: number) => String(n).padStart(2, "0");
const YMD = /^\d{4}-\d{2}-\d{2}$/;

// 날짜 유틸은 순수 모듈 `@/lib/tokyo-date` 가 정본이다(서버·클라이언트 공용).
const addDays = ymdShift;
function dowOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
// Next Monday strictly after today (Monday → +7).
function nextMonday(ymd: string): string {
  const dow = dowOf(ymd);
  const delta = ((1 - dow + 7) % 7) || 7;
  return addDays(ymd, delta);
}

export function TaskSchedulePicker({
  copy,
  locale,
  initialDate,
  initialTime,
  initialRepeat,
  initialDuration,
  hadCustom,
  variant = "full",
  title,
  confirmLabel,
  onApply,
  onCancel,
}: {
  copy: Copy;
  locale: string;
  initialDate: string;
  initialTime: string;
  initialRepeat: string;
  initialDuration: number;
  hadCustom: boolean;
  /**
   * "full" (default) — date + time + repeat, commit-on-close (Todoist-style; any dismiss keeps it).
   * "date" — date only (no time/repeat, no 날짜 없음), commit-on-confirm: only the 완료 button applies;
   *          a scrim tap / drag / Esc cancels. Used for the overdue bulk reschedule.
   */
  variant?: "full" | "date";
  /** Header title override shown when no date is selected (defaults to 일정). */
  title?: string;
  /** Confirm-button label override (defaults to 완료). */
  confirmLabel?: string;
  onApply: (value: ScheduleValue) => void;
  /** date variant only — called when the sheet is dismissed without confirming. */
  onCancel?: () => void;
}) {
  const isDate = variant === "date";
  const today = tokyoToday();
  const [date, setDate] = useState(YMD.test(initialDate) ? initialDate : "");
  const [time, setTime] = useState(initialTime);
  const [repeat, setRepeat] = useState(initialRepeat);
  const [duration, setDuration] = useState(initialDuration > 0 ? initialDuration : 0);
  const [timeOpen, setTimeOpen] = useState(false);
  const [durationOpen, setDurationOpen] = useState(false);
  const [repeatOpen, setRepeatOpen] = useState(false);

  const base = YMD.test(date) ? date : today;
  const [cur, setCur] = useState({ y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) });

  // Commit-on-close: capture the latest draft and hand it to the parent when the sheet closes.
  const draftRef = useRef<ScheduleValue>({ date, time, repeat, duration });
  useEffect(() => {
    // Duration only makes sense with a time-of-day; drop it otherwise so it never leaks out.
    // A half-finished custom rule (`custom:` with no weekdays) commits as 반복 없음 — this sheet is
    // commit-on-close, so a drag-down while the picker is open must not persist an unschedulable
    // rule. The server fails it closed to null anyway; normalizing here keeps UI and stored value
    // in agreement instead of silently disagreeing.
    const committedRepeat =
      repeat.startsWith(CUSTOM_RECURRENCE_PREFIX) && !parseCustomWeekdays(repeat) ? "" : repeat;
    draftRef.current = { date, time, repeat: committedRepeat, duration: time ? duration : 0 };
  }, [date, time, repeat, duration]);
  // "full": commit on any close. "date": commit only when 완료 was tapped (confirmedRef); else cancel.
  const confirmedRef = useRef(false);
  const handleClose = useCallback(() => {
    if (!isDate || confirmedRef.current) onApply(draftRef.current);
    else onCancel?.();
  }, [isDate, onApply, onCancel]);

  const fmtWeekday = (ymd: string) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(
      new Date(`${ymd}T00:00:00Z`),
    );
  const fmtMonthDay = (ymd: string) =>
    new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", timeZone: "UTC" }).format(
      new Date(`${ymd}T00:00:00Z`),
    );
  const fmtFull = (ymd: string) =>
    new Intl.DateTimeFormat(locale, {
      month: "long",
      day: "numeric",
      weekday: "short",
      timeZone: "UTC",
    }).format(new Date(`${ymd}T00:00:00Z`));

  const tomorrow = addDays(today, 1);
  const nextWeek = nextMonday(today);
  const nextWeekend = addDays(nextWeek, 5);

  const quick: { key: string; label: string; hint: string; icon: React.ReactNode; ymd: string | null }[] = [
    { key: "today", label: copy.quickToday, hint: fmtWeekday(today), icon: <Sun className="size-[18px]" aria-hidden="true" />, ymd: today },
    { key: "tomorrow", label: copy.quickTomorrow, hint: fmtWeekday(tomorrow), icon: <Sunrise className="size-[18px]" aria-hidden="true" />, ymd: tomorrow },
    { key: "nextWeek", label: copy.scheduleNextWeek, hint: `${fmtWeekday(nextWeek)} ${fmtMonthDay(nextWeek)}`, icon: <ChevronRight className="size-[18px]" aria-hidden="true" />, ymd: nextWeek },
    { key: "nextWeekend", label: copy.scheduleNextWeekend, hint: `${fmtWeekday(nextWeekend)} ${fmtMonthDay(nextWeekend)}`, icon: <Armchair className="size-[18px]" aria-hidden="true" />, ymd: nextWeekend },
    { key: "none", label: copy.scheduleNoDate, hint: "", icon: <Ban className="size-[18px]" aria-hidden="true" />, ymd: null },
  ];

  function pick(ymd: string | null) {
    if (ymd === null) {
      setDate("");
      setTime("");
      setRepeat("");
      setDuration(0);
      setTimeOpen(false);
      setDurationOpen(false);
      setRepeatOpen(false);
      return;
    }
    setDate(ymd);
    setCur({ y: Number(ymd.slice(0, 4)), m: Number(ymd.slice(5, 7)) });
  }

  // ── inline month calendar ──────────────────────────────────────────────────
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
  const shiftMonth = (d: number) =>
    setCur(({ y, m }) => {
      const idx = y * 12 + (m - 1) + d;
      return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
    });

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < first; i++) cells.push(<span key={`pad-${i}`} />);
  for (let d = 1; d <= daysIn; d++) {
    const iso = `${cur.y}-${pad2(cur.m)}-${pad2(d)}`;
    const isSel = iso === date;
    const isT = iso === today;
    const w = (first + d - 1) % 7;
    cells.push(
      <button
        className={cn(
          "flex aspect-square items-center justify-center rounded-[11px] text-[13.5px] font-bold transition-colors",
          isSel
            ? "bg-primary text-primary-foreground shadow-[0_6px_14px_-8px_hsl(var(--primary-hsl)/0.7)]"
            : isT
              ? "bg-primary/[0.08] text-primary ring-1 ring-inset ring-primary/25"
              : cn("text-foreground hover:bg-slate-50", w === 0 && "text-rose-500", w === 6 && "text-blue-600"),
        )}
        key={iso}
        onClick={() => setDate(iso)}
        type="button"
      >
        {d}
      </button>,
    );
  }

  const fill = (t: string, map: Record<string, string | number>) =>
    t.replace(/\{(\w+)\}/g, (_, k: string) => String(map[k] ?? ""));

  const timeLabel = (() => {
    if (!/^\d{1,2}:\d{2}$/.test(time)) return "";
    const [h, m] = time.split(":").map(Number);
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h >= 12 ? copy.pmLabel : copy.amLabel} ${h12}:${pad2(m)}`;
  })();

  // Duration (time-block length) — options + display label.
  const durationOptLabel = (d: number) =>
    d === 15
      ? copy.duration15
      : d === 30
        ? copy.duration30
        : d === 60
          ? copy.duration60
          : d === 120
            ? copy.duration120
            : `${d}${copy.durationMinUnit}`;
  const durationText = duration > 0 ? durationOptLabel(duration) : copy.durationNone;

  // Repeat — contextual options keyed off the selected date (Todoist-style).
  const wdLong = YMD.test(date)
    ? new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(
        new Date(`${date}T00:00:00Z`),
      )
    : "";
  const dayNum = YMD.test(date) ? Number(date.slice(8, 10)) : 0;
  const mdLabel = YMD.test(date) ? fmtMonthDay(date) : "";
  const repeatOptions: { rule: string; label: string }[] = [
    { rule: "", label: copy.repeatNone },
    { rule: "daily", label: copy.repeatDaily },
    { rule: "weekly", label: fill(copy.repeatWeeklyOn, { w: wdLong }) },
    { rule: "weekdays", label: copy.repeatEveryWeekday },
    { rule: "weekends", label: copy.repeatWeekends },
    { rule: "monthly", label: fill(copy.repeatMonthlyOn, { d: dayNum }) },
    { rule: "yearly", label: fill(copy.repeatYearlyOn, { md: mdLabel }) },
  ];
  // 사용자 지정 요일 반복 — `customDays` is the mode flag AND the value: an array (possibly empty)
  // while the row is on, null otherwise. `custom:` with an empty body parses to null, so the
  // "custom mode, nothing picked yet" state needs the explicit prefix check.
  const inCustomMode = repeat.startsWith(CUSTOM_RECURRENCE_PREFIX);
  const customDays = inCustomMode ? (parseCustomWeekdays(repeat) ?? []) : null;
  const repeatIncomplete = inCustomMode && customDays!.length === 0;
  const toggleCustomDay = (wd: number) => {
    const next = customDays!.includes(wd)
      ? customDays!.filter((d) => d !== wd)
      : [...customDays!, wd].sort((a, b) => a - b);
    setRepeat(`${CUSTOM_RECURRENCE_PREFIX}${next.join(",")}`);
  };

  const currentRepeatLabel = !repeat
    ? ""
    : inCustomMode
      ? customDays!.length
        ? fill(copy.repeatWeeklyOn, { w: formatCustomWeekdays(repeat, locale) })
        : copy.repeatCustom
      : (repeatOptions.find((o) => o.rule === repeat)?.label ??
        (repeat === "custom" ? copy.repeatCustom : ""));

  const hasDate = YMD.test(date);
  const rowBtn =
    "flex w-full items-center gap-3 rounded-2xl border border-border bg-surface px-3.5 py-3 text-left transition-colors";

  return (
    <BottomSheet
      ariaLabel={copy.scheduleTitle}
      className="flex max-h-[88dvh] flex-col"
      header={
        <div className="mb-2 flex items-baseline gap-2">
          <p className="text-[17px] font-black tracking-[-0.02em] text-foreground">
            {hasDate ? fmtFull(date) : (title ?? copy.scheduleTitle)}
          </p>
          {hasDate ? (
            <span className="text-[12px] font-bold text-muted-foreground">{copy.scheduleTitle}</span>
          ) : null}
        </div>
      }
      onClose={handleClose}
    >
      {({ close }) => (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto pb-1">
            {/* Quick relative options (date variant hides 날짜 없음 — you must move to a date) */}
            <div className="flex flex-col">
              {quick
                .filter((o) => !isDate || o.ymd !== null)
                .map((o) => {
                const on = o.ymd === null ? !hasDate : o.ymd === date;
                return (
                  <button
                    className="flex items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-slate-50"
                    key={o.key}
                    onClick={() => pick(o.ymd)}
                    type="button"
                  >
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-full",
                        o.key === "today"
                          ? "bg-emerald-50 text-emerald-600"
                          : o.key === "tomorrow"
                            ? "bg-amber-50 text-amber-600"
                            : o.key === "none"
                              ? "bg-slate-100 text-slate-400"
                              : "bg-primary/10 text-primary",
                      )}
                    >
                      {o.icon}
                    </span>
                    <span className="flex-1 text-[14.5px] font-bold text-foreground">{o.label}</span>
                    {o.hint ? (
                      <span className="text-[12.5px] font-semibold text-muted-foreground">{o.hint}</span>
                    ) : null}
                    {/* Fixed-width check slot so the hint (요일/날짜) never shifts left when selected. */}
                    <span className="flex w-4 shrink-0 items-center justify-center">
                      {on ? (
                        <Check className="size-4 text-primary" strokeWidth={3} aria-hidden="true" />
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Inline month calendar */}
            <div className="mt-2 border-t-[0.5px] border-[var(--separator)] pt-3">
              <div className="mb-2 flex items-center justify-between">
                <button
                  aria-label={copy.calPrevMonth}
                  className="flex size-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-foreground"
                  onClick={() => shiftMonth(-1)}
                  type="button"
                >
                  <ChevronLeft className="size-[17px]" aria-hidden="true" />
                </button>
                <span className="text-[14px] font-black tracking-[-0.01em] text-foreground">{monthLabel}</span>
                <button
                  aria-label={copy.calNextMonth}
                  className="flex size-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-foreground"
                  onClick={() => shiftMonth(1)}
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
            </div>

            {/* Time + Repeat — full variant only (date variant is date-only for bulk reschedule). */}
            {!isDate ? (
              <>
            {/* Time */}
            <div className="mt-3 border-t-[0.5px] border-[var(--separator)] pt-3">
              <button
                aria-expanded={timeOpen}
                className={cn(rowBtn, !hasDate && "opacity-50")}
                disabled={!hasDate}
                onClick={() => setTimeOpen((v) => !v)}
                type="button"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Clock className="size-[18px]" aria-hidden="true" />
                </span>
                <span className="flex-1 text-[14.5px] font-bold text-foreground">{copy.scheduleAddTime}</span>
                {timeLabel ? (
                  <span className="text-[13px] font-bold text-primary">{timeLabel}</span>
                ) : null}
                {timeLabel ? (
                  <span
                    aria-label={copy.clearDate}
                    className="flex size-6 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTime("");
                      setTimeOpen(false);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </span>
                ) : (
                  <ChevronDown
                    className={cn("size-4 text-slate-400 transition-transform", timeOpen && "rotate-180")}
                    aria-hidden="true"
                  />
                )}
              </button>
              {timeOpen && hasDate ? (
                <>
                  <div className="mt-2 grid grid-cols-5 gap-1.5">
                    {["09:00", "12:00", "15:00", "18:00", "21:00"].map((tv) => (
                      <button
                        className={cn(
                          "flex items-center justify-center rounded-full border py-1.5 text-[12.5px] font-bold transition-colors",
                          time === tv
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-surface text-slate-600",
                        )}
                        key={tv}
                        onClick={() => setTime(tv)}
                        type="button"
                      >
                        {tv}
                      </button>
                    ))}
                  </div>
                  <TimeWheels copy={copy} onChange={setTime} value={time} />

                  {/* Duration — Todoist-style time-block length (single day). */}
                  <div className="mt-3 flex items-center justify-between rounded-2xl border border-border bg-surface px-3.5 py-2.5">
                    <span className="text-[13.5px] font-bold text-foreground">{copy.durationLabel}</span>
                    <button
                      aria-expanded={durationOpen}
                      className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-[12.5px] font-bold text-slate-600"
                      onClick={() => setDurationOpen((v) => !v)}
                      type="button"
                    >
                      {durationText}
                      <ChevronDown
                        className={cn("size-3.5 transition-transform", durationOpen && "rotate-180")}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                  {durationOpen ? (
                    <div className="mt-2 space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-[12.5px] font-bold transition-colors",
                            duration === 0
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-surface text-slate-600",
                          )}
                          onClick={() => setDuration(0)}
                          type="button"
                        >
                          {copy.durationNone}
                        </button>
                        {DURATIONS.map((d) => (
                          <button
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-[12.5px] font-bold transition-colors",
                              duration === d
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-surface text-slate-600",
                            )}
                            key={d}
                            onClick={() => setDuration(d)}
                            type="button"
                          >
                            {durationOptLabel(d)}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-bold text-muted-foreground">{copy.durationCustom}</span>
                        <input
                          className="h-9 w-24 rounded-xl border border-border bg-surface px-3 text-center text-[13px] font-bold text-foreground outline-none focus:border-primary"
                          inputMode="numeric"
                          max={1440}
                          min={1}
                          onChange={(e) => {
                            const v = Number(e.target.value.replace(/\D/g, ""));
                            setDuration(v >= 1 && v <= 1440 ? v : 0);
                          }}
                          placeholder="—"
                          type="number"
                          value={duration > 0 ? String(duration) : ""}
                        />
                        <span className="text-[12px] font-semibold text-muted-foreground">{copy.durationMinUnit}</span>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>

            {/* Repeat */}
            <div className="mt-3 border-t-[0.5px] border-[var(--separator)] pt-3">
              <button
                aria-expanded={repeatOpen}
                className={cn(rowBtn, !hasDate && "opacity-50")}
                disabled={!hasDate}
                onClick={() => setRepeatOpen((v) => !v)}
                type="button"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Repeat className="size-[18px]" aria-hidden="true" />
                </span>
                <span className="flex-1 text-[14.5px] font-bold text-foreground">{copy.scheduleAddRepeat}</span>
                {currentRepeatLabel ? (
                  <span className="text-[13px] font-bold text-primary">{currentRepeatLabel}</span>
                ) : null}
                <ChevronDown
                  className={cn("size-4 text-slate-400 transition-transform", repeatOpen && "rotate-180")}
                  aria-hidden="true"
                />
              </button>
              {repeatOpen && hasDate ? (
                <div className="mt-2 flex flex-col">
                  {repeatOptions.map((o) => (
                    <button
                      className="flex items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-slate-50"
                      key={o.rule || "none"}
                      onClick={() => setRepeat(o.rule)}
                      type="button"
                    >
                      <span className="flex-1 text-[14px] font-bold text-foreground">{o.label}</span>
                      {repeat === o.rule ? (
                        <Check className="size-4 text-primary" strokeWidth={3} aria-hidden="true" />
                      ) : null}
                    </button>
                  ))}
                  {hadCustom ? (
                    <button
                      className="flex items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-slate-50"
                      onClick={() => setRepeat("custom")}
                      type="button"
                    >
                      <span className="flex-1 text-[14px] font-bold text-foreground">{copy.repeatCustom}</span>
                      {repeat === "custom" ? (
                        <Check className="size-4 text-primary" strokeWidth={3} aria-hidden="true" />
                      ) : null}
                    </button>
                  ) : null}
                  {/* 사용자 지정 요일 — 켜면 일~토 칩이 펼쳐진다. 하나도 안 고르면 저장 버튼이 잠긴다. */}
                  <button
                    aria-expanded={inCustomMode}
                    className="flex items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-slate-50"
                    onClick={() => setRepeat(inCustomMode ? "" : CUSTOM_RECURRENCE_PREFIX)}
                    type="button"
                  >
                    <span className="flex-1 text-[14px] font-bold text-foreground">
                      {copy.repeatPickDays}
                    </span>
                    {inCustomMode ? (
                      <Check className="size-4 text-primary" strokeWidth={3} aria-hidden="true" />
                    ) : null}
                  </button>
                  {customDays ? (
                    <div className="px-2 pb-1 pt-1">
                      <div className="grid grid-cols-7 gap-1.5">
                        {WEEKDAY_ORDER.map((wd) => {
                          const on = customDays.includes(wd);
                          return (
                            <button
                              aria-pressed={on}
                              className={cn(
                                "h-10 rounded-xl border text-[13px] font-extrabold transition-colors",
                                on
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border bg-surface text-muted-foreground active:bg-slate-100",
                              )}
                              key={wd}
                              onClick={() => toggleCustomDay(wd)}
                              type="button"
                            >
                              {formatWeekday(wd, locale)}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-[12px] font-semibold text-muted-foreground">
                        {customDays.length
                          ? fill(copy.repeatWeeklyOn, { w: formatCustomWeekdays(repeat, locale) })
                          : copy.repeatPickDaysHint}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
              </>
            ) : null}
          </div>

          <button
            className={cn(
              "mt-3 h-[52px] w-full shrink-0 rounded-2xl text-[15px] font-extrabold transition-colors",
              (isDate && !hasDate) || repeatIncomplete
                ? "bg-slate-100 text-slate-400"
                : "bg-primary text-primary-foreground",
            )}
            disabled={(isDate && !hasDate) || repeatIncomplete}
            onClick={() => {
              confirmedRef.current = true;
              close();
            }}
            type="button"
          >
            {confirmLabel ?? copy.scheduleDone}
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
