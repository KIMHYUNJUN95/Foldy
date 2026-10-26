// 급여 엑셀의 근태 칸 — 欠勤日数 · 残業時間 · 週末出勤 · 勤務表チェック用(본인 기록 ↔ 급여 입력) 계산.
// DB 를 읽지 않는 순수 계산이다. 기준(2026-10-26 사용자 확정, 문서 39 「근태 칸 · 勤務表チェック用」):
// - 欠勤日数: 청소 배정(= 확정 시프트)이 있었는데 무효가 아닌 출근 기록이 하나도 없는 날. 오늘(도쿄) 이전 날만.
// - 残業時間: 날마다 급여 인정 분 중 8시간(480분)을 넘는 분의 합 — 시간 표시만(할증 없음).
// - 週末出勤日数 · 時間: 토 · 일요일에 급여 인정 분이 있는 날 수와 그 분 합(공휴일은 넣지 않는다).
// - 本人記入時間 · 日数: 본인이 찍은 원래 시각(정정 · 수정 전) − 휴게. 관리자가 손으로 만든 세션은 빼고,
//   무효가 된 세션도 본인이 찍은 기록이라 넣는다. 給与入力時間과 차이가 나면 備考에 이유를 일본어로 적는다.

import { paidSecondsForSession } from "@/lib/attendance-pay-calculation";

/** 근태 칸 — 출력 엑셀의 입력 시트 AE~AH · 勤務表チェック用. 분 단위. */
export type PayrollKintai = {
  absentDays: number;
  overtimeMinutes: number;
  weekendDays: number;
  weekendMinutes: number;
  /** 본인이 찍은 원래 시각으로 잰 분(휴게 제외). */
  recordedMinutes: number;
  /** 본인 기록이 있는 날 수(분이 0 보다 큰 날). */
  recordedDays: number;
  /** 차이 이유(일본어) — 없으면 빈 문자열. */
  notes: string;
};

export const EMPTY_PAYROLL_KINTAI: PayrollKintai = {
  absentDays: 0,
  overtimeMinutes: 0,
  weekendDays: 0,
  weekendMinutes: 0,
  recordedMinutes: 0,
  recordedDays: 0,
  notes: "",
};

const OVERTIME_THRESHOLD_MINUTES = 8 * 60;

export type KintaiSession = {
  id: string;
  operating_date: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  status: string;
  manual_created: boolean;
};

export type KintaiAudit = {
  session_id: string;
  action_type: string;
  before_json: unknown;
  created_at: string;
};

/** 도쿄 날짜 키(YYYY-MM-DD)의 요일 — 0 일요일 … 6 토요일. 날짜 키 자체가 도쿄 날짜라 UTC 로 읽어도 같다. */
function weekdayOf(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay();
}

/** 날마다 급여 인정 분 → 잔업 · 주말. */
export function overtimeAndWeekend(days: readonly { date: string; paidMinutes: number }[]): {
  overtimeMinutes: number;
  weekendDays: number;
  weekendMinutes: number;
} {
  let overtimeMinutes = 0;
  let weekendDays = 0;
  let weekendMinutes = 0;
  for (const d of days) {
    if (d.paidMinutes <= 0) continue;
    overtimeMinutes += Math.max(0, d.paidMinutes - OVERTIME_THRESHOLD_MINUTES);
    const wd = weekdayOf(d.date);
    if (wd === 0 || wd === 6) {
      weekendDays += 1;
      weekendMinutes += d.paidMinutes;
    }
  }
  return { overtimeMinutes, weekendDays, weekendMinutes };
}

/** 배정이 있었는데 무효 아닌 출근 기록이 없는 날 수 — `today` 이전 날만. */
export function absentDays(
  assignedDates: Iterable<string>,
  sessions: readonly Pick<KintaiSession, "operating_date" | "status">[],
  today: string,
): number {
  const attended = new Set<string>();
  for (const s of sessions) if (s.status !== "invalid") attended.add(s.operating_date);
  let count = 0;
  for (const date of new Set(assignedDates)) {
    if (date < today && !attended.has(date)) count += 1;
  }
  return count;
}

function hasKey(obj: unknown, key: string): obj is Record<string, unknown> {
  return typeof obj === "object" && obj !== null && Object.prototype.hasOwnProperty.call(obj, key);
}

/** 세션의 원래 시각 — 그 칸을 처음 바꾼 감사 기록의 before 값, 없으면 지금 값. `audits` 는 그 세션 것, 순서 무관. */
export function originalTimes(
  session: Pick<KintaiSession, "clock_in_at" | "clock_out_at">,
  audits: readonly KintaiAudit[],
): { clockIn: string | null; clockOut: string | null } {
  const asc = [...audits].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const first = (key: "clock_in_at" | "clock_out_at"): string | null => {
    for (const a of asc) {
      if (hasKey(a.before_json, key)) {
        const v = a.before_json[key];
        return typeof v === "string" ? v : null;
      }
    }
    return session[key];
  };
  return { clockIn: first("clock_in_at"), clockOut: first("clock_out_at") };
}

/** 「10/14、10/20」 — 같은 날은 한 번, 날짜 ↑. */
function noteDates(dates: readonly string[]): string {
  return Array.from(new Set(dates))
    .sort()
    .map((d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`)
    .join("、");
}

/** 本人記入時間 · 日数와 차이 이유. `sessions` 는 한 사람의 그 달 세션. */
export function recordedWork(
  sessions: readonly KintaiSession[],
  breakSecondsBySession: ReadonlyMap<string, number>,
  auditsBySession: ReadonlyMap<string, readonly KintaiAudit[]>,
): { recordedMinutes: number; recordedDays: number; notes: string } {
  const minutesByDate = new Map<string, number>();
  const corrected: string[] = [];
  const manualAdded: string[] = [];
  const manualEdited: string[] = [];
  const invalid: string[] = [];
  const noClockOut: string[] = [];
  for (const s of sessions) {
    const audits = auditsBySession.get(s.id) ?? [];
    const date = s.operating_date;
    if (audits.some((a) => a.action_type === "correction_apply")) corrected.push(date);
    if (audits.some((a) => a.action_type === "manual_update")) manualEdited.push(date);
    if (s.status === "invalid") invalid.push(date);
    if (s.manual_created) {
      manualAdded.push(date);
      continue;
    }
    const { clockIn, clockOut } = originalTimes(s, audits);
    if (!clockIn || !clockOut) {
      if (s.status !== "invalid") noClockOut.push(date);
      continue;
    }
    const minutes = Math.floor(paidSecondsForSession(clockIn, clockOut, breakSecondsBySession.get(s.id) ?? 0) / 60);
    minutesByDate.set(date, (minutesByDate.get(date) ?? 0) + minutes);
  }
  let recordedMinutes = 0;
  let recordedDays = 0;
  for (const m of minutesByDate.values()) {
    recordedMinutes += m;
    if (m > 0) recordedDays += 1;
  }
  const notes = (
    [
      ["打刻修正", corrected],
      ["手動追加", manualAdded],
      ["手動修正", manualEdited],
      ["無効", invalid],
      ["退勤なし", noClockOut],
    ] as const
  )
    .filter(([, dates]) => dates.length > 0)
    .map(([label, dates]) => `${label} ${dates.length}件（${noteDates(dates)}）`)
    .join(" / ");
  return { recordedMinutes, recordedDays, notes };
}

/** 한 사람의 근태 칸 전부. */
export function computePayrollKintai(input: {
  days: readonly { date: string; paidMinutes: number }[];
  sessions: readonly KintaiSession[];
  breakSecondsBySession: ReadonlyMap<string, number>;
  auditsBySession: ReadonlyMap<string, readonly KintaiAudit[]>;
  assignedDates: Iterable<string>;
  today: string;
}): PayrollKintai {
  return {
    absentDays: absentDays(input.assignedDates, input.sessions, input.today),
    ...overtimeAndWeekend(input.days),
    ...recordedWork(input.sessions, input.breakSecondsBySession, input.auditsBySession),
  };
}
