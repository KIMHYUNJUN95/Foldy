"use client";

import { useState } from "react";
import { AdmDropdown, type AdmOption } from "./adm-dropdown";

type DdFormSelectProps = {
  /** 폼 필드 이름 — 숨은 input 이 선택한 값을 네이티브 <form> 제출에 실어 보낸다. */
  name: string;
  options: AdmOption[];
  defaultValue?: string;
  placeholder?: string;
  ariaLabel?: string;
  size?: "sm" | "md";
  wide?: boolean;
};

/**
 * 공용 `AdmDropdown`(.dd)을 감싼 폼용 래퍼. 드롭다운과 숨은
 * input 을 렌더해서 서버 액션 <form> 안에서 네이티브 <select> 를 대신한다. 서버 액션이 그래도
 * 제출된 값을 검증하므로, 숨은 필드(브라우저가 `required` 검증을 하지 않음)여도 괜찮다.
 */
export function DdFormSelect({
  name,
  options,
  defaultValue = "",
  placeholder,
  ariaLabel,
  size,
  wide,
}: DdFormSelectProps) {
  const [value, setValue] = useState(defaultValue);

  return (
    <>
      <input type="hidden" name={name} value={value} />
      <AdmDropdown
        options={options}
        value={value}
        onChange={setValue}
        placeholder={placeholder}
        ariaLabel={ariaLabel}
        size={size}
        wide={wide}
      />
    </>
  );
}
