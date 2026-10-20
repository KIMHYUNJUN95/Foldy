// 업무일지 예약 보내기(2026-10-20) — 모바일 시트(`report-sheet.tsx`)와 PC 업무일지 창(`admin-tasks-console.tsx`)이 같이 쓰는 시각 계산.
// 시각은 **오늘(도쿄)** 하루 안에서 **1분 단위**로 고른다. 3차(2026-10-20, 시안 JnZtYSQ8 A · 7SR7V8Ja P1): 모바일은 시각만 담은
// 시트의 시 · 분 휠(위에 빠른 선택), PC 는 칸 하나 + 15분 간격 목록(아무렇게나 친 글자를 알아듣는다). 지난 시각은 막는다(서버도 1분 뒤부터만 받는다).
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

/** 지금부터 고를 수 있는 시각 목록 — 가장 이른 시각을 `step` 분 단위로 올린 것부터 23:45 까지(PC 목록). */
export function slotTimes(nowMin: number, step = 15): string[] {
  const first = earliestMinute(nowMin);
  if (first === null) return [];
  const out: string[] = [];
  for (let m = Math.ceil(first / step) * step; m <= DAY_LAST_MIN; m += step) out.push(fromMinutes(m));
  return out;
}

const FULL_WIDTH = /[０-９：]/g;

/**
 * 친 글자 → 오늘의 분(0~1439). 못 알아들으면 null. 지난 시각도 그대로 돌려준다(막는 건 부르는 쪽).
 * - 「1837」 「937」 「18」 「18:37」 「18.37」
 * - 「6시37분」 「6시 반」 「6時37分」 「午後6時」 「오후 6시」 「6pm」 「6:30 pm」
 * - 「30분 뒤」 「+30」 「1시간 뒤」 「30分後」 「in 30 min」 = 지금부터
 * 오전 · 오후 표시가 없고 1~11시가 이미 지났으면 오후로 본다(16시에 「6시37분」 = 18:37).
 */
export function parseTimeText(raw: string, nowMin: number): number | null {
  const text = raw
    .replace(FULL_WIDTH, (c) => (c === "：" ? ":" : String.fromCharCode(c.charCodeAt(0) - 0xfee0)))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!text) return null;

  const rel = /^(?:\+|in )?\s*(\d{1,3})\s*(분|分|m|min|mins|minutes?|시간|時間|h|hr|hrs|hours?)?\s*(뒤|후|後|later)?$/.exec(text);
  if (rel && (text.startsWith("+") || text.startsWith("in ") || rel[3])) {
    const n = Number(rel[1]);
    const hours = rel[2] !== undefined && /^(시간|時間|h|hr|hrs|hour|hours)$/.test(rel[2]);
    const at = nowMin + n * (hours ? 60 : 1);
    return at <= DAY_LAST_MIN ? at : null;
  }

  const pm = /(오후|午後|pm|p\.m\.)/.test(text);
  const am = /(오전|午前|am|a\.m\.)/.test(text);
  const body = text.replace(/(오후|午後|오전|午前|p\.m\.|a\.m\.|pm|am)/g, "").trim();

  let h: number | null = null;
  let m = 0;
  const colon = /^(\d{1,2})\s*[:.]\s*(\d{1,2})$/.exec(body);
  const word = /^(\d{1,2})\s*(?:시|時)\s*(?:(\d{1,2})\s*(?:분|分)?|(반|半))?$/.exec(body);
  const digits = /^\d{1,4}$/.test(body) ? body : null;
  if (colon) {
    h = Number(colon[1]);
    m = Number(colon[2]);
  } else if (word) {
    h = Number(word[1]);
    m = word[3] ? 30 : word[2] ? Number(word[2]) : 0;
  } else if (digits) {
    if (digits.length <= 2) h = Number(digits);
    else {
      h = Number(digits.slice(0, digits.length - 2));
      m = Number(digits.slice(-2));
    }
  }
  if (h === null || m > 59) return null;
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  if (h > 23) return null;
  const at = h * 60 + m;
  const first = nowMin + LEAD_MIN;
  if (!pm && !am && h >= 1 && h <= 11 && at < first && at + 720 <= DAY_LAST_MIN) return at + 720;
  return at;
}

/** 휠 · 목록에서 이 분(0~1439)이 이미 지났나(가장 이른 시각보다 앞). */
export const minuteGone = (minutes: number, nowMin: number) => minutes < nowMin + LEAD_MIN;

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
