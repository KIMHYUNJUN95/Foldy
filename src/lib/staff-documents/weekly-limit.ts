import { isStaleOpenSession } from "@/lib/attendance";
import type { BreakInterval } from "@/lib/attendance-pay-calculation";
import { tokyoDateOf, tokyoDayEndExclusive, ymdShift } from "@/lib/tokyo-date";

/**
 * 「주 28시간」 — 자격외활동(資格外活動許可, 보통 유학 · 가족체재)의 근무 한도 판정. 순수 모듈(docs/product/41 §R4).
 *
 * 법무성 기준은 「1주에 28시간 이내」이고, 1주는 **어느 요일부터 세어도** 연속 7일이다. 그래서 달력 주(월~일)가 아니라
 * 도쿄 날짜로 d-6 ~ d 의 7일 창을 하루씩 옮겨 가며 가장 많은 창을 찾는다.
 *
 * - 근무 시간 = 출근 ~ 퇴근 − 휴게. 휴게 규칙은 급여(`breakSecondsBySession`)와 같다 — 근무 안으로 자르고,
 *   닫힌 근무의 열린 휴게는 퇴근 시각에 끝난 것으로 본다. 날짜로 나눠야 해서 합계가 아니라 구간으로 뺀다.
 * - 자정을 넘는 근무는 도쿄 날짜 경계에서 나눈다.
 * - 아직 열린 근무(오늘 운영일)는 지금까지 센다. 열린 휴게는 지금까지 쉬는 중으로 본다.
 * - 세지 않는 것: 무효 근무, 퇴근을 안 찍고 넘어간 근무(`abandoned` · 지난 운영일의 `open`) — 끝 시각을 모른다.
 * - 학교 장기 방학(1일 8시간 · 주 40시간)은 모델에 없다 — 관리자가 판단한다.
 */

/** 법정 한도 — 7일 동안 이 분을 **넘으면** 초과. */
export const WEEKLY_LIMIT_MINUTES = 28 * 60;
/** 이 분 이상이면 근접(미리 알림). */
export const WEEKLY_NEAR_MINUTES = 24 * 60;
/** 창 길이(일). */
export const WEEKLY_WINDOW_DAYS = 7;

export type WeeklyLimitStatus = "over" | "near" | "ok";

export type WeeklyLimitSession = {
  id: string;
  operating_date: string;
  status: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  invalidated_at?: string | null;
};

export type WeeklyLimitWindow = { start: string; end: string; minutes: number };

export type WeeklyLimitResult = {
  status: WeeklyLimitStatus;
  /** 끝날이 [from, to] 안인 창 중 가장 많은 것(같으면 늦은 것). */
  worst: WeeklyLimitWindow;
  /** `to` 에서 끝나는 창 — 「최근 7일」. */
  current: WeeklyLimitWindow;
};

export function weeklyLimitStatusOf(minutes: number): WeeklyLimitStatus {
  if (minutes > WEEKLY_LIMIT_MINUTES) return "over";
  if (minutes >= WEEKLY_NEAR_MINUTES) return "near";
  return "ok";
}

type Span = [number, number];

/** [a, b) 에서 겹치는 구간들을 뺀다(빼는 구간은 정렬 · 합쳐진 상태). */
function subtract(span: Span, cuts: Span[]): Span[] {
  const out: Span[] = [];
  let cursor = span[0];
  for (const [s, e] of cuts) {
    if (e <= cursor) continue;
    if (s >= span[1]) break;
    if (s > cursor) out.push([cursor, Math.min(s, span[1])]);
    cursor = Math.max(cursor, e);
    if (cursor >= span[1]) break;
  }
  if (cursor < span[1]) out.push([cursor, span[1]]);
  return out;
}

function mergeSpans(spans: Span[]): Span[] {
  const sorted = spans.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  return merged;
}

/**
 * 도쿄 날짜별 근무 초(휴게 뺀 것). `today` 는 도쿄 오늘(열린 근무가 오늘 것인지 가린다), `nowMs` 는 열린 근무 · 휴게의 끝.
 */
export function dailyWorkedSeconds(
  sessions: readonly WeeklyLimitSession[],
  breaks: readonly BreakInterval[],
  { today, nowMs }: { today: string; nowMs: number },
): Map<string, number> {
  const breaksBySession = new Map<string, BreakInterval[]>();
  for (const b of breaks) {
    const list = breaksBySession.get(b.session_id);
    if (list) list.push(b);
    else breaksBySession.set(b.session_id, [b]);
  }

  const totals = new Map<string, number>();
  for (const s of sessions) {
    if (s.status === "invalid" || s.invalidated_at) continue;
    if (!s.clock_in_at) continue;
    const isRunning =
      !s.clock_out_at && (s.status === "open" || s.status === "reopened") && !isStaleOpenSession(s.operating_date, today);
    if (!s.clock_out_at && !isRunning) continue; // 끝을 모르는 근무는 세지 않는다
    const start = Date.parse(s.clock_in_at);
    const end = s.clock_out_at ? Date.parse(s.clock_out_at) : nowMs;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

    const cuts = mergeSpans(
      (breaksBySession.get(s.id) ?? []).map((b): Span => {
        const bStart = Math.max(Date.parse(b.started_at), start);
        const endIso = b.ended_at ?? s.clock_out_at;
        const bEnd = Math.min(endIso ? Date.parse(endIso) : nowMs, end);
        return [bStart, bEnd];
      }),
    );

    for (const [workStart, workEnd] of subtract([start, end], cuts)) {
      // 도쿄 날짜 경계에서 나눈다.
      let cursor = workStart;
      while (cursor < workEnd) {
        const day = tokyoDateOf(new Date(cursor).toISOString());
        if (!day) break;
        const boundary = Date.parse(tokyoDayEndExclusive(day));
        const pieceEnd = Math.min(boundary, workEnd);
        totals.set(day, (totals.get(day) ?? 0) + (pieceEnd - cursor) / 1000);
        cursor = pieceEnd;
      }
    }
  }
  return totals;
}

function windowEndingOn(end: string, daily: Map<string, number>): WeeklyLimitWindow {
  let seconds = 0;
  for (let i = 0; i < WEEKLY_WINDOW_DAYS; i += 1) seconds += daily.get(ymdShift(end, -i)) ?? 0;
  return { start: ymdShift(end, -(WEEKLY_WINDOW_DAYS - 1)), end, minutes: Math.floor(seconds / 60) };
}

/** 끝날이 `from` ~ `to`(도쿄, 포함)인 7일 창을 모두 보고 가장 많은 창으로 판정한다. */
export function evaluateWeeklyLimit(
  daily: Map<string, number>,
  { from, to }: { from: string; to: string },
): WeeklyLimitResult {
  const current = windowEndingOn(to, daily);
  let worst = current;
  for (let end = from; end < to; end = ymdShift(end, 1)) {
    const w = windowEndingOn(end, daily);
    if (w.minutes > worst.minutes) worst = w;
  }
  return { status: weeklyLimitStatusOf(worst.minutes), worst, current };
}

/** 한 사람 판정 — 날짜별 합계 + 창 판정을 한 번에. */
export function computeWeeklyLimit(
  sessions: readonly WeeklyLimitSession[],
  breaks: readonly BreakInterval[],
  range: { from: string; to: string; today: string; nowMs: number },
): WeeklyLimitResult {
  return evaluateWeeklyLimit(dailyWorkedSeconds(sessions, breaks, range), range);
}

/** 화면에 넘기는 칩(문제 있을 때만). 클라이언트로 보내도 되는 값만. */
export type WeeklyLimitChip = { status: "over" | "near"; start: string; end: string; minutes: number };

export function weeklyLimitChipOf(result: WeeklyLimitResult): WeeklyLimitChip | null {
  if (result.status === "ok") return null;
  return { status: result.status, start: result.worst.start, end: result.worst.end, minutes: result.worst.minutes };
}

type HoursCopy = { weeklyHours: string; weeklyHoursWhole: string; weeklyRange: string };

/** 「29시간 30분」 — 내림 없이 분까지(28시간 1분이 「28.0」으로 보이지 않게). */
export function formatWeeklyMinutes(minutes: number, copy: HoursCopy): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0
    ? copy.weeklyHoursWhole.replace("{h}", String(h))
    : copy.weeklyHours.replace("{h}", String(h)).replace("{m}", String(m));
}

/** 「10/14~10/20」 — 도쿄 날짜 키를 그대로 월/일로. */
export function formatWeeklyRange(start: string, end: string, copy: HoursCopy): string {
  const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
  return copy.weeklyRange.replace("{from}", md(start)).replace("{to}", md(end));
}

/** 칩의 title · 상세 문구 — 「10/14~10/20 · 29시간 30분」. */
export function weeklyChipDetail(chip: WeeklyLimitChip, copy: HoursCopy): string {
  return `${formatWeeklyRange(chip.start, chip.end, copy)} · ${formatWeeklyMinutes(chip.minutes, copy)}`;
}
