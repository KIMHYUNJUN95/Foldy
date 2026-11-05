// 숙박 명부 주소(2026-11-04 결정: 손님 전원의 집 주소 전체). 순수 함수 — 화면 · 웹 · 태블릿 API 가 같은 검사를 쓴다.
// 입력 문자 규칙(외국인은 영문만)은 운영 선택이지 법 해석이 아니다(43 §8-6). 길이는 「자세한 주소」를 증명하지 못하고
// 「USA」 · 「Tokyo」 한 단어만 막는다. 태블릿(Kotlin)은 `address-cases.json` 의 같은 사례표로 같은 결과를 내야 한다.

export const ADDRESS_MAX = 200;
export const ADDRESS_MIN_FOREIGN = 8;
export const ADDRESS_MIN_JAPAN = 5;

export type AddressError = "too_short" | "too_long" | "not_latin";

// 외국인 허용 글자(태블릿 Kotlin `filterForeignAddress` 와 같은 규칙, NFC 뒤): ASCII 0x20~0x7E · 「글자(\p{L})이면서 라틴 문자」
// (ª º 서수 «2º» · ß Ł ñ · 베트남어 ễ …, 전각 U+FF00~ 제외) · 결합 악센트 U+0300~036F. × ÷ 는 글자가 아니라 막힌다.
// 정규식 `v` 플래그의 [\p{L}&&\p{Script=Latin}] 와 같은 뜻 — TS 대상(ES2017)에서 안 쓰려고 글자 하나씩 두 `u` 정규식으로 센다.
const IS_LETTER = /^\p{L}$/u;
const IS_LATIN = /^\p{Script=Latin}$/u;

function allowedForeignChar(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0x0300 && code <= 0x036f) return true;
  if (code >= 0xff00 && code <= 0xffef) return false;
  return IS_LETTER.test(char) && IS_LATIN.test(char);
}

function latinOnly(value: string): boolean {
  for (const char of value) if (!allowedForeignChar(char)) return false;
  return value.length > 0;
}

/**
 * 저장하는 값. 유니코드 NFC → 폰이 자동으로 바꾸는 글자(NBSP · 곡선 따옴표 · 긴 줄표)를 ASCII 로 → 앞뒤 공백 정리 →
 * 줄바꿈은 「, 」→ 겹친 공백은 하나 → 양끝 쉼표 제거.
 */
export function normalizeAddress(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[​-‍﻿]/g, "")
    .replace(/[   -   　]/g, " ")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .trim()
    .replace(/\s*,?\s*[\r\n]+\s*/g, ", ")
    .replace(/[ \t\v\f]+/g, " ")
    .replace(/^[\s,]+|[\s,]+$/g, "");
}

/** 주소 한 줄 검사. 통과하면 null. 외국인(hasJapanAddress = false)은 영문만 · 8자 이상, 일본 거주자는 어떤 글자든 · 5자 이상. */
export function addressError(text: string, hasJapanAddress: boolean): AddressError | null {
  const value = normalizeAddress(text);
  if (value.length > ADDRESS_MAX) return "too_long";
  if (!hasJapanAddress && !latinOnly(value)) return value.length === 0 ? "too_short" : "not_latin";
  if (value.length < (hasJapanAddress ? ADDRESS_MIN_JAPAN : ADDRESS_MIN_FOREIGN)) return "too_short";
  return null;
}

/** 일본 거주 여부가 실제로 바뀌었나 — 바뀌면 옛 주소는 다른 글자 규칙으로 받은 것이라 비워 다시 묻는다. 모름(null)은 외국인으로 센다. */
export function japanFlagChanged(previous: boolean | null | undefined, next: boolean): boolean {
  return (previous === true) !== next;
}
