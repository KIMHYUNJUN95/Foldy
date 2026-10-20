/**
 * 청소 배정 — 알바 「내 시프트」 달력 칸의 상태와 날짜 계산. 순수 모듈.
 *
 * **「배정 없음」 기준**(사용자 확인 2026-10-20) — 신청했는데 방이 없다고 바로 「배정 없음」이 아니다(그건 「신청 · 배정 전」과 같다).
 * 다음 중 하나일 때만: ① 그날 청소 방이 있었고 **미배정 방이 0** ② 관리자가 그날 일정을 **취소** ③ 그날이 **지났다**.
 * ① 에서 새 예약 · 수기 추가로 미배정 방이 다시 생기면 「신청 · 배정 전」으로 돌아간다(이 함수가 매번 다시 계산하므로 저절로).
 * docs/product/37-cleaning-shift-assignment.md 「4-1」
 */

export type ShiftDayState =
  /** 배정됨(방 N개) */
  | "assigned"
  /** 신청 · 배정 전 */
  | "waiting"
  /** 배정 없음 */
  | "none"
  /** 지난 날 일함 */
  | "worked"
  /** 신청 안 함(오늘 · 앞날) */
  | "free"
  /** 신청 안 한 지난 날 */
  | "past";

export function shiftDayState(input: {
  applied: boolean;
  cancelled: boolean;
  myRooms: number;
  /** 그날 청소 방 수(예약 기준 + 수기 추가). */
  totalRooms: number;
  /** 그날 아무도 안 들어간 방 수. */
  openRooms: number;
  isPast: boolean;
}): ShiftDayState {
  const { applied, cancelled, myRooms, totalRooms, openRooms, isPast } = input;
  if (!applied) {
    if (myRooms > 0) return isPast ? "worked" : "assigned";
    return isPast ? "past" : "free";
  }
  if (cancelled) return "none";
  if (myRooms > 0) return isPast ? "worked" : "assigned";
  if (isPast) return "none";
  if (totalRooms > 0 && openRooms === 0) return "none";
  return "waiting";
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value: unknown): value is string {
  return typeof value === "string" && DAY.test(value);
}

export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
}

/** 달력 날짜 더하기(UTC 자정으로 계산 — 날짜 키만 다룬다, 시각 없음). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function monthDays(ym: string): string[] {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`);
}

/** 0 = 일요일 … 6 = 토요일. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "09:45" · "09:45:00" → 585. 아니면 null. */
export function timeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes < 24 * 60 ? minutes : null;
}

/** 585 → "9:45". */
export function minutesToLabel(minutes: number | null): string {
  if (minutes === null) return "";
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** 역할로 정한 처음 출근 시각 — 알바 9:45 · 직원 9:00(사용자 확인 2026-10-20). 사람별로 바꿀 수 있다. */
export function defaultStartMinutes(role: string): number {
  return role === "part_time_staff" ? 9 * 60 + 45 : 9 * 60;
}
