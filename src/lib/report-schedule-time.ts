// 업무일지 예약 보내기(2026-10-20) — 모바일 시트(`report-sheet.tsx`)와 PC 업무일지 창(`admin-tasks-console.tsx`)이 같이 쓰는 시각 계산.
// 시각은 **오늘(도쿄)** 하루 안에서 **1분 단위**로 고른다(2026-10-20 2차 — 시안 HBVDqUS4 · R1dhvKv7). 빠른 선택은 지금 바로 · 30분 뒤 ·
// 1시간 뒤 · 18:00 · 19:00 · 20:00, 그 아래 「오늘 [시]:[분]」 칸은 늘 보인다. 지난 시각은 막는다(서버도 1분 뒤부터만 받는다).
import { tokyoToday } from "@/lib/tokyo-date";

export const QUICK_TIMES = ["18:00", "19:00", "20:00"] as const;
/** 빠른 선택의 「n분 뒤」. */
export const QUICK_OFFSETS = [30, 60] as const;
/** 지금부터 이 분 뒤부터 고를 수 있다. */
export const LEAD_MIN = 2;
/** 오늘의 마지막 분(23:59). */
export const DAY_LAST_MIN = 24 * 60 - 1;

export function tokyoNowMinutes(): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** 0~1439 분 → 「HH:MM」. */
export const fromMinutes = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** 예약 시각(ISO) → 도쿄 「HH:MM」. */
export function tokyoHHMM(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

/** 오늘(도쿄) 「HH:MM」 → 서버에 넘길 ISO. */
export const tokyoTodayIso = (hhmm: string) => `${tokyoToday()}T${hhmm}:00+09:00`;

/** 지금 기준으로 고를 수 있는 가장 이른 분. 오늘 남은 시각이 없으면 null. */
export function earliestMinute(nowMin: number): number | null {
  const first = nowMin + LEAD_MIN;
  return first > DAY_LAST_MIN ? null : first;
}

/** 이 시각을 지금 고를 수 있나. */
export const slotOpen = (hhmm: string, nowMin: number) => toMinutes(hhmm) >= nowMin + LEAD_MIN && toMinutes(hhmm) <= DAY_LAST_MIN;

/** 「n분 뒤」 빠른 선택의 시각. 오늘을 넘으면 null. */
export function offsetTime(nowMin: number, offset: number): string | null {
  const at = nowMin + offset;
  return at > DAY_LAST_MIN ? null : fromMinutes(at);
}

/**
 * 시 · 분 칸 한 칸 올리기 / 내리기. 분은 59 → 00 이면 시도 넘어가고, 시는 23 ↔ 00 으로 돈다(오늘 안).
 * 칸이 비어 있으면(지금 바로) 가장 이른 시각을 5분 단위로 올린 값에서 시작한다.
 */
export function stepTime(value: string | null, part: "hour" | "minute", delta: number, nowMin: number): string {
  if (!value) {
    const base = earliestMinute(nowMin) ?? DAY_LAST_MIN;
    return fromMinutes(Math.min(DAY_LAST_MIN, Math.ceil(base / 5) * 5));
  }
  const min = toMinutes(value);
  if (part === "hour") {
    const hour = (Math.floor(min / 60) + delta + 24 * 10) % 24;
    return fromMinutes(hour * 60 + (min % 60));
  }
  return fromMinutes((min + delta + 1440 * 10) % 1440);
}

/** 두 자리까지 친 숫자 → 유효한 시(0~23) · 분(0~59)이면 숫자, 아니면 null. */
export function parsePart(raw: string, part: "hour" | "minute"): number | null {
  if (!/^\d{1,2}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= (part === "hour" ? 23 : 59) ? n : null;
}

/** 첫 자리만으로 칸이 끝났나 — 시는 3~9, 분은 6~9 로 시작하면 두 번째 자리가 올 수 없다. */
export const partDone = (raw: string, part: "hour" | "minute") =>
  raw.length >= 2 || (raw.length === 1 && Number(raw) > (part === "hour" ? 2 : 5));

/**
 * 남은 시간 문구 — 「1시간 12분」 · 「1시간」 · 「12분」. 템플릿은 문구 사전에서 받는다(`{h}` · `{m}`).
 * 함수 값을 dictionary.tasks 에 넣지 못하므로(CLAUDE.md) 자리표시 문자열 + replace.
 */
export function durationLabel(minutes: number, t: { hm: string; h: string; m: string }): string {
  const total = Math.max(1, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0 && m > 0) return t.hm.replace("{h}", String(h)).replace("{m}", String(m));
  if (h > 0) return t.h.replace("{h}", String(h));
  return t.m.replace("{m}", String(m));
}
