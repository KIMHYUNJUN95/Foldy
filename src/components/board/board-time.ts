import type { Locale } from "@/lib/i18n";

/**
 * 「3일 전」 같은 상대 시각 — Intl 로 언어별로 만든다(문구를 따로 두지 않는다). 서버에는 안정된 「지금」이 없어서
 * 화면은 하이드레이션 뒤에만 이 값을 그린다(피드 · 상세 공통).
 */
export function boardRelativeTime(iso: string, locale: Locale): string {
  const diffSec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 7],
    ["week", 4.34524],
    ["month", 12],
    ["year", Infinity],
  ];
  let value = diffSec;
  for (const [unit, span] of units) {
    if (Math.abs(value) < span) return rtf.format(-Math.round(value), unit);
    value = value / span;
  }
  return rtf.format(-Math.round(value), "year");
}

/** 작성자 줄 아래 회색 한 줄 — 「역할 · 상대 시각」. 둘 중 비어 있는 것은 뺀다. */
export function boardMetaLine(role: string, time: string): string {
  return [role, time].filter(Boolean).join(" · ");
}
