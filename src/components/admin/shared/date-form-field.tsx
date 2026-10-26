"use client";

import { useState } from "react";
import { AdminDatePicker } from "./admin-date-picker";

type DateFormFieldProps = {
  /** 폼 필드 이름 — 숨김 input 이 "YYYY-MM-DD" 값을 네이티브 <form> 제출에 실어 보낸다. */
  name: string;
  defaultValue?: string;
  min?: string;
  max?: string;
  localeTag: string;
  ariaLabel: string;
  placeholder?: string;
  labels: { prevMonth: string; nextMonth: string; today: string };
};

/**
 * 공용 `AdminDatePicker` 를 감싼 폼 친화 래퍼. 브랜드 캘린더 피커와
 * 숨김 input 을 그려서 서버 액션 <form> 안의 네이티브 `<input type="date">` 를 대체할 수 있다.
 * 서버 액션은 제출된 값을 여전히 검증한다.
 */
export function DateFormField({
  name,
  defaultValue = "",
  min,
  max,
  localeTag,
  ariaLabel,
  placeholder,
  labels,
}: DateFormFieldProps) {
  const [value, setValue] = useState(defaultValue);

  return (
    <>
      <input type="hidden" name={name} value={value} />
      <AdminDatePicker
        value={value}
        onChange={setValue}
        min={min}
        max={max}
        localeTag={localeTag}
        ariaLabel={ariaLabel}
        placeholder={placeholder}
        labels={labels}
      />
    </>
  );
}
