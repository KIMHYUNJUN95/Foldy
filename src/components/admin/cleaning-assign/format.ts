import type { CleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import { fill } from "@/lib/cleaning-assign-i18n";

/** 청소 배정 화면 공용 표시 함수 — 날짜 키(YYYY-MM-DD)만 다루므로 UTC 로 그린다(시각 없음 · 도쿄 날짜 그대로). */

const tag = (locale: string) => (locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US");

function utc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** 「10월 21일 (수)」 · 「10月21日(水)」 · 「Wed, Oct 21」 */
export function dayLabel(date: string, locale: string): string {
  return new Intl.DateTimeFormat(tag(locale), { day: "numeric", month: "long", timeZone: "UTC", weekday: "short" }).format(utc(date));
}

/** 「10/21」 */
export function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/** 「2026년 11월」 */
export function monthTitle(ym: string, locale: string): string {
  return new Intl.DateTimeFormat(tag(locale), { month: "long", timeZone: "UTC", year: "numeric" }).format(utc(`${ym}-01`));
}

/** 「11월」 · 「11月」 · 「November」 */
export function monthName(ym: string, locale: string): string {
  return new Intl.DateTimeFormat(tag(locale), { month: "long", timeZone: "UTC" }).format(utc(`${ym}-01`));
}

export function weekdayShort(date: string, locale: string): string {
  return new Intl.DateTimeFormat(tag(locale), { timeZone: "UTC", weekday: "short" }).format(utc(date));
}

export function agoText(iso: string, now: number, copy: CleaningAssignCopy): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (minutes < 1) return copy.agoJustNow;
  if (minutes < 60) return fill(copy.agoMin, { n: minutes });
  if (minutes < 60 * 24) return fill(copy.agoHour, { n: Math.round(minutes / 60) });
  return fill(copy.agoDay, { n: Math.round(minutes / 1440) });
}

export function roleLabel(role: string, copy: CleaningAssignCopy): string {
  if (role === "part_time_staff") return copy.rolePart;
  if (role === "field_manager") return copy.roleManager;
  return copy.roleStaff;
}

export function timeLabel(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** 「09:45」 — 시간 고르기 값. */
export function timeValue(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function yen(value: number): string {
  return `¥${Math.round(value).toLocaleString("en-US")}`;
}
