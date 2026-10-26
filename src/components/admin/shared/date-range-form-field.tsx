"use client";

import { useState } from "react";
import { AdminDateRangePicker, type AdminDateRangePickerLabels } from "./admin-date-range-picker";

type DateRangeFormFieldProps = {
  /** 범위 시작을 담는 폼 필드 이름 ("YYYY-MM-DD"). */
  startName: string;
  /** 범위 끝을 담는 폼 필드 이름 ("YYYY-MM-DD"). */
  endName: string;
  defaultFrom?: string;
  defaultTo?: string;
  localeTag: string;
  ariaLabel: string;
  labels: AdminDateRangePickerLabels;
};

/**
 * 공용 `AdminDateRangePicker` 의 폼용 래퍼 — `DateFormField` 의 범위 버전.
 * 브랜드 달력 팝오버와 숨은 input 두 개를 그려서, 서버 렌더 `<form method="get">` 필터 바가
 * 네이티브 `<input type="date">` 두 개 대신 이것을 넣어도 클라이언트 페이지가 되지 않는다.
 * 서버는 제출된 값을 여전히 파싱/검증한다
 * (src/lib/request-filters.ts 의 `parseRequestDateRange`).
 */
export function DateRangeFormField({
  startName,
  endName,
  defaultFrom = "",
  defaultTo = "",
  localeTag,
  ariaLabel,
  labels,
}: DateRangeFormFieldProps) {
  const [range, setRange] = useState({ from: defaultFrom, to: defaultTo });

  return (
    <>
      <input type="hidden" name={startName} value={range.from} />
      <input type="hidden" name={endName} value={range.to} />
      <AdminDateRangePicker
        from={range.from}
        to={range.to}
        onChange={(from, to) => setRange({ from, to })}
        localeTag={localeTag}
        ariaLabel={ariaLabel}
        labels={labels}
      />
    </>
  );
}
