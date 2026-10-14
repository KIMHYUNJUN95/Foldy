"use client";

// 외부 리뷰 목록의 기간 칩 → 공용 범위 캘린더 시트.
//
// 시트 자체는 `requests/date-range-calendar.tsx` 를 그대로 쓴다 (1단계에서 프리셋 줄과 선택 기간
// 요약을 선택적 prop 으로 추가해 둔 그 컴포넌트다). 캘린더를 새로 만들지 않는다 — CLAUDE.md §4a.
//
// 목록 자체는 서버 컴포넌트라 상태가 없다. 여기서만 시트 열림 여부를 들고, 적용하면 쿼리스트링을
// 바꿔 서버가 다시 그린다.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DateRangeCalendar, type DateRangeValue } from "@/components/requests/date-range-calendar";
import type { Locale } from "@/lib/i18n";
import { ChevronDown } from "lucide-react";
import { CIc, CxIcon } from "./cx-icons";

export type RangeChipLabels = {
  chip: string;
  title: string;
  apply: string;
  clear: string;
  close: string;
  previousMonth: string;
  nextMonth: string;
  selectStart: string;
  selectEnd: string;
  summary: string;
  presets: { days: number; label: string }[];
};

export function ReviewRangeChip({
  from,
  to,
  locale,
  labels,
  /** 적용 시 유지할 나머지 쿼리(뷰·플랫폼·문제만). 페이지는 항상 1로 되돌린다. */
  baseParams,
  variant = "chip",
}: {
  from: string | null;
  to: string | null;
  locale: Locale;
  labels: RangeChipLabels;
  baseParams: Record<string, string>;
  /** "line" = 화이트 리디자인 머리의 기간 줄(글자 + ▾). */
  variant?: "chip" | "line";
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  function push(range: DateRangeValue | null) {
    const params = new URLSearchParams(baseParams);
    if (range?.startDate) params.set("from", range.startDate);
    if (range?.endDate) params.set("to", range.endDate);
    // 기간을 바꾸면 결과 수가 달라지므로 페이지는 1로. 3페이지에 있다가 빈 화면을 보게 된다.
    params.delete("page");
    setOpen(false);
    router.push(`/mobile/complaints?${params.toString()}`);
  }

  return (
    <>
      {variant === "line" ? (
        <button type="button" className="fbw-rangeline" aria-haspopup="dialog" onClick={() => setOpen(true)}>
          {labels.chip}
          <ChevronDown aria-hidden="true" />
        </button>
      ) : (
        <button type="button" className="cx-rangechip" onClick={() => setOpen(true)}>
          <CIc>{CxIcon.cal}</CIc>
          {labels.chip}
        </button>
      )}
      <DateRangeCalendar
        open={open}
        locale={locale}
        value={{ startDate: from ?? undefined, endDate: to ?? undefined }}
        presets={labels.presets}
        summaryLabel={labels.summary}
        labels={{
          apply: labels.apply,
          clear: labels.clear,
          close: labels.close,
          previousMonth: labels.previousMonth,
          nextMonth: labels.nextMonth,
          selectStart: labels.selectStart,
          selectEnd: labels.selectEnd,
          title: labels.title,
        }}
        onApply={(range) => push(range)}
        onClear={() => push(null)}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
