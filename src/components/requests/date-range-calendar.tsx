"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/shell/bottom-sheet";

export type DateRangeValue = {
  endDate?: string;
  startDate?: string;
};

export type DateRangeCalendarLabels = {
  apply: string;
  clear: string;
  close: string;
  previousMonth: string;
  nextMonth: string;
  selectEnd: string;
  selectStart: string;
  title: string;
};

/**
 * 빠른 기간 프리셋. 컴플레인 「외부 리뷰 / 문제 객실」처럼 최근 N일을 반복해서 고르는 화면용이며,
 * 넘기지 않으면 줄 자체가 렌더되지 않는다(기존 요청 필터 사용처는 그대로).
 */
export type DateRangePreset = { days: number; label: string };

type DateRangeCalendarProps = {
  labels: DateRangeCalendarLabels;
  locale: Locale;
  onApply: (range: DateRangeValue) => void;
  onClear: () => void;
  onClose: () => void;
  open: boolean;
  value: DateRangeValue;
  /** 있으면 월 이동 위에 프리셋 줄을 그린다. */
  presets?: DateRangePreset[];
  /** 있으면 적용 버튼 위에 «선택 기간 · 시작 – 종료» 요약 줄을 그린다. */
  summaryLabel?: string;
};

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isoToDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

// 2021-08-01 은 일요일 — 현지화된 짧은 요일 이름을 구하는 데 쓴다.
function getWeekdayNames(locale: Locale): string[] {
  const formatter = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    timeZone: "UTC",
  });
  return Array.from({ length: 7 }, (_, index) =>
    formatter.format(new Date(Date.UTC(2021, 7, 1 + index))),
  );
}

export function DateRangeCalendar({ open, ...rest }: DateRangeCalendarProps) {
  if (!open) return null;
  // 팝업이 열릴 때마다 패널을 다시 마운트해, 상태 동기화 effect 없이
  // 초안 상태가 최신 `value` 로 다시 채워지게 한다.
  return <CalendarPanel {...rest} />;
}

function CalendarPanel({
  labels,
  locale,
  onApply,
  onClear,
  onClose,
  value,
  presets,
  summaryLabel,
}: Omit<DateRangeCalendarProps, "open">) {
  const [viewMonth, setViewMonth] = useState<Date>(() =>
    value.startDate ? startOfMonth(isoToDate(value.startDate)) : startOfMonth(new Date()),
  );
  const [draftStart, setDraftStart] = useState<string | undefined>(value.startDate);
  const [draftEnd, setDraftEnd] = useState<string | undefined>(value.endDate);

  const weekdayNames = useMemo(() => getWeekdayNames(locale), [locale]);
  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(
        viewMonth,
      ),
    [locale, viewMonth],
  );
  const dayLabelFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "full" }),
    [locale],
  );

  const cells = useMemo(() => {
    const firstWeekday = viewMonth.getDay();
    const daysInMonth = new Date(
      viewMonth.getFullYear(),
      viewMonth.getMonth() + 1,
      0,
    ).getDate();
    const result: (string | null)[] = [];
    for (let i = 0; i < firstWeekday; i += 1) result.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      result.push(
        toIsoDate(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day)),
      );
    }
    return result;
  }, [viewMonth]);

  const todayIso = toIsoDate(new Date());

  function handleDayClick(iso: string) {
    // 시작일이 없거나 이미 완성된 범위가 있으면 → 새 범위를 시작한다.
    if (!draftStart || (draftStart && draftEnd)) {
      setDraftStart(iso);
      setDraftEnd(undefined);
      return;
    }
    // 두 번째 클릭이 범위를 완성하며, 역순이면 자동으로 바꾼다.
    if (iso < draftStart) {
      setDraftEnd(draftStart);
      setDraftStart(iso);
    } else {
      setDraftEnd(iso);
    }
  }

  function handleApply() {
    if (!draftStart) {
      onClear();
      return;
    }
    onApply({ startDate: draftStart, endDate: draftEnd ?? draftStart });
  }

  function handleClear() {
    setDraftStart(undefined);
    setDraftEnd(undefined);
    onClear();
  }

  /**
   * 프리셋은 «오늘 포함 최근 N일»이다 — 90일을 고르면 오늘이 종료일이고 시작일은 89일 전이다.
   * 로컬 `Date` 산술이지만 이 컴포넌트의 나머지 셀 계산과 같은 기준이라 하루가 어긋나지 않는다.
   */
  function applyPreset(days: number) {
    const end = new Date();
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days - 1));
    setDraftStart(toIsoDate(start));
    setDraftEnd(toIsoDate(end));
    setViewMonth(startOfMonth(end));
  }

  const rangeStart = draftStart;
  const rangeEnd = draftEnd ?? draftStart;
  const hintLabel = !draftStart || draftEnd ? labels.selectStart : labels.selectEnd;

  /**
   * 이웃 칸의 띠가 맞닿는지 본다 — 맞닿지 않으면 그쪽 끝을 둥글게 막는다.
   * 하루만 고른 상태(`rangeStart === rangeEnd`)에서는 띠 자체를 그리지 않으므로 항상 false 다.
   */
  function bandTouchesRight(index: number): boolean {
    const iso = cells[index];
    if (!iso || !rangeStart || !rangeEnd || rangeStart === rangeEnd) return false;
    return iso === rangeStart || (iso > rangeStart && iso < rangeEnd);
  }
  function bandTouchesLeft(index: number): boolean {
    const iso = cells[index];
    if (!iso || !rangeStart || !rangeEnd || rangeStart === rangeEnd) return false;
    return iso === rangeEnd || (iso > rangeStart && iso < rangeEnd);
  }

  const summaryText =
    draftStart && rangeEnd ? `${draftStart.replace(/-/g, ".")} – ${rangeEnd.replace(/-/g, ".")}` : "—";

  return (
    <BottomSheet
      ariaLabel={labels.title}
      header={
        <div className="min-w-0">
          <h3 className="text-base font-black tracking-tight text-foreground">
            {labels.title}
          </h3>
          <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
            {hintLabel}
          </p>
        </div>
      }
      onClose={onClose}
    >
      {() => (
        <>
          {presets?.length ? (
            <div className="mt-4 flex gap-1.5">
              {presets.map((preset) => {
                // 현재 초안이 정확히 그 프리셋 구간이면 선택 상태로 칠한다.
                const end = new Date();
                const start = new Date(
                  end.getFullYear(),
                  end.getMonth(),
                  end.getDate() - (preset.days - 1),
                );
                const on = draftStart === toIsoDate(start) && (draftEnd ?? draftStart) === toIsoDate(end);
                return (
                  <button
                    className={cn(
                      "h-9 flex-1 rounded-xl border text-xs font-extrabold transition-colors",
                      on
                        ? "border-[#315F91] bg-[#315F91] text-white"
                        : "border-border bg-background/70 text-foreground hover:bg-muted/60",
                    )}
                    key={preset.days}
                    onClick={() => applyPreset(preset.days)}
                    type="button"
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="mt-4 flex items-center justify-between">
            <button
              aria-label={labels.previousMonth}
              className="flex size-9 items-center justify-center rounded-full border border-border bg-background/70 text-foreground transition-colors hover:bg-muted/60"
              onClick={() => setViewMonth((prev) => addMonths(prev, -1))}
              type="button"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </button>
            <span className="text-sm font-black text-foreground">{monthLabel}</span>
            <button
              aria-label={labels.nextMonth}
              className="flex size-9 items-center justify-center rounded-full border border-border bg-background/70 text-foreground transition-colors hover:bg-muted/60"
              onClick={() => setViewMonth((prev) => addMonths(prev, 1))}
              type="button"
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1">
            {weekdayNames.map((name, index) => (
              <div
                className={cn(
                  "py-1.5 text-center text-[11px] font-bold uppercase tracking-wide text-muted-foreground",
                  index === 0 && "text-rose-500/80",
                  index === 6 && "text-[#315F91]",
                )}
                key={name}
              >
                {name}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-y-1 pb-2">
            {cells.map((iso, index) => {
            if (!iso) return <div key={`empty-${index}`} />;
            const isStart = iso === rangeStart;
            const isEnd = iso === rangeEnd;
            const inRange =
              rangeStart && rangeEnd && iso > rangeStart && iso < rangeEnd;
            const isEdge = isStart || isEnd;
            const dayNumber = Number(iso.slice(8, 10));
            // 띠가 «끊기는» 자리는 둥글게 막는다. 주 경계에서 잘리거나(토→일), 달 첫날이 주중이라
            // 앞이 빈칸이거나, 기간이 다음 달로 이어져 격자 끝에서 끊길 때 각진 모서리가 남는다.
            const capLeft = !(index % 7) || !bandTouchesRight(index - 1);
            const capRight = index % 7 === 6 || !bandTouchesLeft(index + 1);

            return (
              <div className="relative flex items-center justify-center" key={iso}>
                {inRange ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute inset-y-1 inset-x-0 bg-[#EAF1F8]",
                      capLeft && "rounded-l-full",
                      capRight && "rounded-r-full",
                    )}
                  />
                ) : null}
                {isEdge && rangeStart !== rangeEnd ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute inset-y-1 w-1/2 bg-[#EAF1F8]",
                      // 반쪽 띠의 안쪽 끝은 선택 동그라미에 가려지지만, 바깥쪽 끝은 주 경계에서
                      // 그대로 드러난다.
                      isStart ? "right-0" : "left-0",
                      isStart && capRight && "rounded-r-full",
                      isEnd && capLeft && "rounded-l-full",
                    )}
                  />
                ) : null}
                <button
                  aria-label={dayLabelFormatter.format(isoToDate(iso))}
                  aria-pressed={isEdge}
                  className={cn(
                    "relative flex size-10 items-center justify-center rounded-full text-sm font-bold transition-colors",
                    isEdge
                      ? "bg-[#315F91] text-white shadow-sm"
                      : inRange
                        ? "text-[#1F3A5F]"
                        : "text-foreground hover:bg-muted/70",
                    !isEdge && iso === todayIso && "ring-1 ring-[#C9D8E8]",
                  )}
                  onClick={() => handleDayClick(iso)}
                  type="button"
                >
                  {dayNumber}
                </button>
                </div>
              );
            })}
          </div>

          {summaryLabel ? (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-border bg-background/70 px-3 py-2.5">
              <span className="text-[11.5px] font-bold text-muted-foreground">{summaryLabel}</span>
              <span className="font-mono text-[13px] font-bold tabular-nums text-foreground">
                {summaryText}
              </span>
            </div>
          ) : null}

          <div className="mt-2 flex items-center gap-2 border-t-[0.5px] border-[var(--separator)] pt-4">
            <button
              className="h-11 flex-1 rounded-xl border border-border bg-background/70 text-sm font-bold text-foreground transition-colors hover:bg-muted/60"
              onClick={handleClear}
              type="button"
            >
              {labels.clear}
            </button>
            <button
              className="h-11 flex-1 rounded-xl bg-[#315F91] text-sm font-black text-white transition-colors hover:bg-[#274D76] disabled:opacity-50"
              disabled={!draftStart}
              onClick={handleApply}
              type="button"
            >
              {labels.apply}
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
