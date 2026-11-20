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

/** 작성자 줄 아래 회색 한 줄 — 「역할 · 상대 시각 · 실제 시각」. 비어 있는 조각은 뺀다. */
export function boardMetaLine(...parts: string[]): string {
  return parts.filter(Boolean).join(" · ");
}

const TOKYO_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * 게시판 날짜 표기 하나 — 「2026.11.19 14:05」(도쿄). 상세 · 모바일 신고함 · PC 신고 콘솔이 같이 쓴다
 * (게시판 unslop 2026-11-20). 잘못된 값은 「—」.
 */
export function boardDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p: Record<string, string> = {};
  for (const part of TOKYO_PARTS.formatToParts(d)) p[part.type] = part.value;
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${p.year}.${p.month}.${p.day} ${hour}:${p.minute}`;
}

/**
 * 피드 요약 — 줄바꿈 · 겹친 공백을 한 칸으로 모은다. 줄 자르기(line-clamp)의 「…」 가 줄 끝 마침표 뒤에
 * 붙어 「....」 처럼 보이던 것을 막는다(줄이 끊기는 자리가 문장 끝이 되지 않게).
 */
export function boardSummaryText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
