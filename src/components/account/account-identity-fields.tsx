"use client";

import { useState } from "react";
import {
  IdentityNamesFields,
  type IdentityCopy,
} from "@/components/identity/identity-names-fields";
import {
  normalizeIdentityNames,
  validateIdentityNames,
  type IdentityNames,
} from "@/lib/identity-names";

/**
 * 내 정보 — 국적 + 이름 세 가지. 서버 폼(`updateAccountProfile`)에 숨은 input 으로 값을 실어 보낸다.
 * 서버가 같은 규칙(`validateIdentityNames`)으로 다시 검사한다. PC 콘솔 화면이라 나라는 칸 아래 검색 드롭다운(모바일 하단 시트 아님).
 */
export function AccountIdentityFields({
  copy,
  locale,
  initial,
  showErrors,
}: {
  copy: IdentityCopy;
  locale: string;
  initial: IdentityNames;
  /** 저장이 이 칸들 때문에 막혔으면 처음부터 오류를 보여 준다. */
  showErrors: boolean;
}) {
  const [value, setValue] = useState<IdentityNames>(initial);
  const errors = validateIdentityNames(normalizeIdentityNames(value));
  return (
    <IdentityNamesFields
      copy={copy}
      errors={errors}
      formNames
      locale={locale}
      nationalityPopover
      onChange={setValue}
      showErrors={showErrors}
      value={value}
    />
  );
}
