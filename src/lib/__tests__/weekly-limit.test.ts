import { describe, expect, it } from "vitest";
import { breakSecondsBySession } from "@/lib/attendance-pay-calculation";
import {
  computeWeeklyLimit,
  dailyWorkedSeconds,
  evaluateWeeklyLimit,
  formatWeeklyMinutes,
  weeklyChipDetail,
  weeklyLimitChipOf,
  weeklyLimitStatusOf,
  type WeeklyLimitSession,
} from "@/lib/staff-documents/weekly-limit";

const copy = { weeklyHours: "{h}시간 {m}분", weeklyHoursWhole: "{h}시간", weeklyRange: "{from}~{to}" };

let seq = 0;
/** 도쿄 시각 "YYYY-MM-DDTHH:mm" 두 개로 닫힌 근무 하나. */
function shift(day: string, from: string, to: string, extra: Partial<WeeklyLimitSession> = {}): WeeklyLimitSession {
  seq += 1;
  return {
    id: `s${seq}`,
    operating_date: day,
    status: "completed",
    clock_in_at: `${day}T${from}:00+09:00`,
    clock_out_at: `${extra.operating_date ?? day}T${to}:00+09:00`,
    ...extra,
  };
}

const far = { today: "2026-12-31", nowMs: Date.parse("2026-12-31T12:00:00+09:00") };

describe("weeklyLimitStatusOf", () => {
  it("28시간 정확히는 괜찮고, 1분이라도 넘으면 초과", () => {
    expect(weeklyLimitStatusOf(28 * 60)).toBe("near");
    expect(weeklyLimitStatusOf(28 * 60 + 1)).toBe("over");
    expect(weeklyLimitStatusOf(24 * 60)).toBe("near");
    expect(weeklyLimitStatusOf(24 * 60 - 1)).toBe("ok");
  });
});

describe("dailyWorkedSeconds", () => {
  it("도쿄 날짜로 센다 — UTC 로는 전날인 오전 근무도 그날", () => {
    // 도쿄 10/14 06:00~08:00 = UTC 10/13 21:00~23:00
    const daily = dailyWorkedSeconds([shift("2026-10-14", "06:00", "08:00")], [], far);
    expect(daily.get("2026-10-14")).toBe(2 * 3600);
    expect(daily.get("2026-10-13")).toBeUndefined();
  });

  it("자정을 넘는 근무는 도쿄 0시에서 나눈다", () => {
    const s: WeeklyLimitSession = {
      id: "night",
      operating_date: "2026-10-14",
      status: "completed",
      clock_in_at: "2026-10-14T22:00:00+09:00",
      clock_out_at: "2026-10-15T01:30:00+09:00",
    };
    const daily = dailyWorkedSeconds([s], [], far);
    expect(daily.get("2026-10-14")).toBe(2 * 3600);
    expect(daily.get("2026-10-15")).toBe(1.5 * 3600);
  });

  it("휴게를 빼고, 근무 밖 휴게는 빼지 않는다 — 급여 규칙과 같은 합계", () => {
    const s = shift("2026-10-14", "09:00", "18:00");
    const breaks = [
      { session_id: s.id, started_at: "2026-10-14T12:00:00+09:00", ended_at: "2026-10-14T13:00:00+09:00" },
      // 출근 전에 시작한 휴게 — 근무 안 부분(09:00~09:15)만 뺀다
      { session_id: s.id, started_at: "2026-10-14T08:30:00+09:00", ended_at: "2026-10-14T09:15:00+09:00" },
      // 닫힌 근무의 열린 휴게 — 퇴근 시각에 끝난 것으로(17:30~18:00)
      { session_id: s.id, started_at: "2026-10-14T17:30:00+09:00", ended_at: null },
    ];
    const daily = dailyWorkedSeconds([s], breaks, far);
    const gross = 9 * 3600;
    const breakSec = breakSecondsBySession(breaks, [s]).get(s.id) ?? 0;
    expect(breakSec).toBe(3600 + 900 + 1800);
    expect(daily.get("2026-10-14")).toBe(gross - breakSec);
  });

  it("무효 · 퇴근 안 찍고 넘어간 근무는 세지 않는다", () => {
    const daily = dailyWorkedSeconds(
      [
        shift("2026-10-14", "09:00", "18:00", { status: "invalid" }),
        shift("2026-10-15", "09:00", "18:00", { invalidated_at: "2026-10-16T00:00:00Z" }),
        { id: "ab", operating_date: "2026-10-16", status: "abandoned", clock_in_at: "2026-10-16T09:00:00+09:00", clock_out_at: null },
        // 지난 운영일인데 아직 open — 퇴근을 잊은 것
        { id: "stale", operating_date: "2026-10-17", status: "open", clock_in_at: "2026-10-17T09:00:00+09:00", clock_out_at: null },
      ],
      [],
      { today: "2026-10-18", nowMs: Date.parse("2026-10-18T12:00:00+09:00") },
    );
    expect(daily.size).toBe(0);
  });

  it("오늘 열린 근무는 지금까지, 열린 휴게는 지금까지 쉬는 중", () => {
    const open: WeeklyLimitSession = {
      id: "open",
      operating_date: "2026-10-18",
      status: "open",
      clock_in_at: "2026-10-18T09:00:00+09:00",
      clock_out_at: null,
    };
    const breaks = [{ session_id: "open", started_at: "2026-10-18T11:00:00+09:00", ended_at: null }];
    const daily = dailyWorkedSeconds([open], breaks, {
      today: "2026-10-18",
      nowMs: Date.parse("2026-10-18T12:00:00+09:00"),
    });
    expect(daily.get("2026-10-18")).toBe(2 * 3600);
  });
});

describe("evaluateWeeklyLimit — 어느 날부터 세어도 7일", () => {
  // 수요일(10/14)부터 7일 동안 5시간씩 6일 = 30시간. 월~일 달력 주로 자르면 어느 주도 28시간을 안 넘는다.
  const sessions = [
    shift("2026-10-14", "09:00", "14:00"),
    shift("2026-10-15", "09:00", "14:00"),
    shift("2026-10-16", "09:00", "14:00"),
    shift("2026-10-17", "09:00", "14:00"),
    shift("2026-10-18", "09:00", "14:00"),
    shift("2026-10-19", "09:00", "14:00"),
    shift("2026-10-20", "09:00", "11:00"),
  ];

  it("주 중간에서 시작하는 7일 창을 찾는다", () => {
    const result = computeWeeklyLimit(sessions, [], { from: "2026-10-01", to: "2026-10-31", ...far });
    expect(result.status).toBe("over");
    expect(result.worst).toEqual({ start: "2026-10-14", end: "2026-10-20", minutes: 32 * 60 });
    // 달력 주(월 10/12 ~ 일 10/18)로 세면 25시간 — 그 기준이면 놓친다
    const daily = dailyWorkedSeconds(sessions, [], far);
    const calendarWeek = evaluateWeeklyLimit(daily, { from: "2026-10-18", to: "2026-10-18" });
    expect(calendarWeek.current.minutes).toBe(25 * 60);
  });

  it("current 는 to 에서 끝나는 창, worst 는 범위 안 최댓값", () => {
    const result = computeWeeklyLimit(sessions, [], { from: "2026-10-20", to: "2026-10-25", ...far });
    expect(result.current).toEqual({ start: "2026-10-19", end: "2026-10-25", minutes: 7 * 60 });
    expect(result.worst.end).toBe("2026-10-20");
  });

  it("범위 밖 근무는 창 판정에 들어가지 않는다", () => {
    const result = computeWeeklyLimit(sessions, [], { from: "2026-11-10", to: "2026-11-12", ...far });
    expect(result.status).toBe("ok");
    expect(result.worst.minutes).toBe(0);
  });

  it("24시간 이상이면 근접", () => {
    const result = computeWeeklyLimit(sessions.slice(0, 5), [], { from: "2026-10-18", to: "2026-10-18", ...far });
    expect(result.status).toBe("near");
    expect(weeklyLimitChipOf(result)).toEqual({ status: "near", start: "2026-10-12", end: "2026-10-18", minutes: 25 * 60 });
  });
});

describe("표시", () => {
  it("시간 · 분, 날짜 범위", () => {
    expect(formatWeeklyMinutes(29 * 60 + 30, copy)).toBe("29시간 30분");
    expect(formatWeeklyMinutes(26 * 60, copy)).toBe("26시간");
    expect(weeklyChipDetail({ status: "over", start: "2026-10-14", end: "2026-10-20", minutes: 28 * 60 + 1 }, copy)).toBe(
      "10/14~10/20 · 28시간 1분",
    );
  });
});
