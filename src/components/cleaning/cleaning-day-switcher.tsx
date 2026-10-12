"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DatePickerSheet } from "@/components/shell/date-picker-sheet";

/**
 * 모바일 청소 화면의 운영일 이동 — `‹ 8월 4일 (월) ›` + 라벨 탭으로 달력 열기.
 *
 * 화살표만으로는 먼 날짜로 갈 수 없어, 라벨을 누르면 **공용 `DatePickerSheet`** 가 열린다
 * (CLAUDE.md §3 — 모든 슬라이드업 시트는 공용 BottomSheet 규격). 콘솔은 `.calpop` 규격의
 * `AdminDatePicker` 를 쓰지만 그 규칙은 §4a 대로 **콘솔 한정**이고, 두 규격을 섞지 않는다.
 *
 * 미래 날짜를 막지 않는다 — 청소 대상은 예약에서 파생되므로 내일·다음 주도 계산되고, 그것이 인력
 * 배치의 근거가 된다.
 */
export function CleaningDaySwitcher({
  date,
  today,
  locale,
  basePath,
  labels,
}: {
  date: string;
  today: string;
  locale: string;
  basePath: string;
  labels: {
    prev: string;
    next: string;
    select: string;
    today: string;
    prevMonth: string;
    nextMonth: string;
    goToday: string;
  };
}) {
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);

  const go = (next: string) => router.push(`${basePath}?date=${next}`);

  const shift = (delta: number) => {
    const [y, m, d] = date.split("-").map(Number);
    // Tokyo 운영일 문자열을 UTC 로 다뤄 자정·서머타임 영향을 받지 않게 한다(저장소 관례).
    const at = new Date(Date.UTC(y, m - 1, d + delta));
    go(at.toISOString().slice(0, 10));
  };

  const label = new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Tokyo",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${date}T00:00:00+09:00`));

  const isToday = date === today;

  return (
    <div className="flex items-center gap-1.5">
      <button
        aria-label={labels.prev}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#f4f4f7] text-muted-foreground transition-colors active:bg-[#ececf0]"
        onClick={() => shift(-1)}
        type="button"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </button>

      <div className="relative min-w-0 flex-1">
        <button
          aria-label={labels.select}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-[#f4f4f7] px-3 text-[13px] font-extrabold tracking-[-0.01em] text-foreground transition-colors active:bg-[#ececf0]"
          onClick={() => setPickerOpen(true)}
          type="button"
        >
          <span className="truncate">{label}</span>
          {isToday ? (
            <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-bold text-primary">
              {labels.today}
            </span>
          ) : null}
        </button>
      </div>

      <button
        aria-label={labels.next}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#f4f4f7] text-muted-foreground transition-colors active:bg-[#ececf0]"
        onClick={() => shift(1)}
        type="button"
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </button>

      {pickerOpen ? (
        <DatePickerSheet
          labels={{
            title: labels.select,
            prevMonth: labels.prevMonth,
            nextMonth: labels.nextMonth,
            today: labels.goToday,
          }}
          locale={locale}
          onClose={() => setPickerOpen(false)}
          onSelect={(next) => {
            setPickerOpen(false);
            go(next);
          }}
          today={today}
          value={date}
        />
      ) : null}
    </div>
  );
}
