import { fillCopy } from "@/lib/payroll-settings-i18n";
import type { PayrollPrepCopy } from "@/lib/payroll-prep-i18n";

/** 천 단위 쉼표 — 언어와 상관없이 같은 숫자 모양(명세서 숫자는 어느 언어든 같다). */
export const num = (n: number) => Math.round(n).toLocaleString("en-US");

export const yenMark = (n: number) => `¥${num(n)}`;

/** 분 → `H:MM` (문구 키 `minutesShort`). */
export function fmtTime(copy: Pick<PayrollPrepCopy, "minutesShort">, minutes: number): string {
  return fillCopy(copy.minutesShort, { h: Math.floor(minutes / 60), m: String(minutes % 60).padStart(2, "0") });
}

/** 동그라미 안 글자 — 이름 첫 글자. */
export const initialOf = (name: string) => Array.from(name.trim())[0] ?? "?";

export const signedNum = (n: number) => `${n < 0 ? "−" : "+"}${num(Math.abs(n))}`;
