import { describe, expect, it, vi } from "vitest";

// task-reminders 가 알림 생성 모듈(server-only)을 끌어오지만, 여기서는 순수 판정만 쓴다.
vi.mock("@/lib/notifications/create", () => ({ notifyTaskParticipants: vi.fn() }));

import { decideRecurringReminder } from "../notifications/task-reminders";
import {
  isOccurrenceCompleted,
  isRecurringOccurrenceDate,
  nextRecurringOccurrence,
  OCCURRENCE_STATE_WINDOW_DAYS,
  occurrencesToAbsorb,
  outstandingOverdueOccurrences,
  pickCompletionOccurrence,
  recurringOccurrencesInRange,
} from "../tasks-recurrence";
import { ymdShift } from "../tokyo-date";

describe("월 · 연 반복은 앵커에서 바로 계산한다 (2026-10-28)", () => {
  it("1/31 매월 → 2/28 다음은 3/31 이다 (3/28 로 굳지 않음)", () => {
    expect(recurringOccurrencesInRange("monthly", "2026-01-31", "2026-01-01", "2026-05-31")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ]);
    expect(isRecurringOccurrenceDate("monthly", "2026-01-31", "2026-03-31")).toBe(true);
    expect(isRecurringOccurrenceDate("monthly", "2026-01-31", "2026-03-28")).toBe(false);
  });

  it("범위 시작이 앵커보다 한참 뒤여도 정확하다", () => {
    expect(recurringOccurrencesInRange("monthly", "2020-01-31", "2026-02-01", "2026-03-31")).toEqual([
      "2026-02-28",
      "2026-03-31",
    ]);
  });

  it("2/29 매년 → 평년은 2/28, 윤년은 다시 2/29", () => {
    expect(recurringOccurrencesInRange("yearly", "2024-02-29", "2024-01-01", "2028-12-31")).toEqual([
      "2024-02-29",
      "2025-02-28",
      "2026-02-28",
      "2027-02-28",
      "2028-02-29",
    ]);
  });

  it("아주 오래된 매일 반복도 회차를 놓치지 않는다", () => {
    expect(recurringOccurrencesInRange("daily", "2015-01-01", "2026-10-28", "2026-10-29")).toEqual([
      "2026-10-28",
      "2026-10-29",
    ]);
    expect(recurringOccurrencesInRange("weekly", "2015-01-01", "2026-10-28", "2026-11-04")).toEqual([
      "2026-10-29", // 2015-01-01 은 목요일
    ]);
  });
});

describe("요일 묶음 규칙은 맞지 않는 앵커를 내지 않는다 (2026-10-28)", () => {
  // 2026-10-24 는 토요일
  it("토요일 앵커의 평일 반복 — 첫 회차는 월요일", () => {
    expect(recurringOccurrencesInRange("weekdays", "2026-10-24", "2026-10-24", "2026-10-27")).toEqual([
      "2026-10-26",
      "2026-10-27",
    ]);
    expect(isRecurringOccurrenceDate("weekdays", "2026-10-24", "2026-10-24")).toBe(false);
    expect(nextRecurringOccurrence("weekdays", "2026-10-24", "2026-10-24")).toBe("2026-10-26");
  });

  it("맞지 않는 앵커는 밀린 회차로도 세지 않는다", () => {
    expect(outstandingOverdueOccurrences("custom:1,3,5", "2026-10-24", "2026-10-26", new Set())).toEqual(
      [],
    );
    expect(outstandingOverdueOccurrences("weekends", "2026-10-23", "2026-10-26", new Set())).toEqual([
      "2026-10-24",
      "2026-10-25",
    ]);
  });
});

describe("밀린 회차 계산은 상태 창으로 자른다", () => {
  it("창보다 오래된 회차는 «밀림» 이 아니다", () => {
    const today = "2026-10-28";
    const open = outstandingOverdueOccurrences("daily", "2020-01-01", today, new Set());
    expect(open[0]).toBe(ymdShift(today, -OCCURRENCE_STATE_WINDOW_DAYS));
    expect(open.length).toBe(OCCURRENCE_STATE_WINDOW_DAYS);
  });
});

describe("완료 정산 — 가장 최근 미해결 회차 (2026-10-28)", () => {
  // 월·수·금, 앵커 2026-10-19(월). 오늘 10-27(화), 금 10-23 · 월 10-26 이 열려 있다.
  const rule = "custom:1,3,5";
  const anchor = "2026-10-19";
  const resolved = new Set(["2026-10-19", "2026-10-21"]);

  it("회차가 아닌 화요일에 체크하면 월요일로 정산한다", () => {
    expect(pickCompletionOccurrence(rule, anchor, "2026-10-27", resolved)).toBe("2026-10-26");
  });

  it("그 다음 흡수가 금요일을 치워 밀림이 남지 않는다", () => {
    const absorbed = occurrencesToAbsorb(rule, anchor, "2026-10-26", "2026-10-27", resolved);
    expect(absorbed).toEqual(["2026-10-23"]);
    const after = new Set([...resolved, "2026-10-26", ...absorbed]);
    expect(outstandingOverdueOccurrences(rule, anchor, "2026-10-27", after)).toEqual([]);
  });

  it("요청 날짜가 회차면 그대로", () => {
    expect(pickCompletionOccurrence(rule, anchor, "2026-10-26", resolved)).toBe("2026-10-26");
  });
});

describe("흡수는 오늘(도쿄) 이후를 건드리지 않는다 (2026-10-28)", () => {
  it("내일 회차를 미리 완료해도 열린 오늘 회차는 남는다", () => {
    const today = "2026-10-28";
    const absorbed = occurrencesToAbsorb("daily", "2026-10-25", "2026-10-29", today, new Set([
      "2026-10-25",
      "2026-10-26",
    ]));
    expect(absorbed).toEqual(["2026-10-27"]);
    expect(absorbed).not.toContain(today);
  });

  it("과거 회차를 직접 완료하면 그보다 뒤는 건드리지 않는다", () => {
    expect(occurrencesToAbsorb("daily", "2026-10-20", "2026-10-23", "2026-10-28", new Set())).toEqual([
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
    ]);
  });
});

describe("이중 완료 가드", () => {
  it("완료 상태만 true", () => {
    const states = new Map([
      ["2026-10-27", "completed" as const],
      ["2026-10-26", "moved" as const],
    ]);
    expect(isOccurrenceCompleted(states, "2026-10-27")).toBe(true);
    expect(isOccurrenceCompleted(states, "2026-10-26")).toBe(false);
    expect(isOccurrenceCompleted(states, "2026-10-28")).toBe(false);
  });
});

describe("반복 업무 알림 판정 (2026-10-28)", () => {
  const base = { taskId: "t1", rule: "daily", anchor: "2026-10-20", today: "2026-10-28" };

  it("만든 다음 날 「기한 초과」를 보내지 않는다 — 오늘 회차가 열려 있으면 마감 임박", () => {
    expect(
      decideRecurringReminder({ ...base, anchor: "2026-10-27", resolvedDates: new Set(["2026-10-27"]) }),
    ).toEqual({ type: "task_due_soon", dedupeBase: "task_due_soon:t1:2026-10-28" });
  });

  it("오늘 회차가 없고 밀린 회차가 있으면 가장 최근 밀린 날짜로 키를 만든다", () => {
    // 매주 월요일(10-19 앵커), 오늘 10-28(수), 10-26 열림
    expect(
      decideRecurringReminder({ ...base, rule: "weekly", anchor: "2026-10-19", resolvedDates: new Set(["2026-10-19"]) }),
    ).toEqual({ type: "task_overdue", dedupeBase: "task_overdue:t1:2026-10-26" });
  });

  it("오늘 회차도 끝났고 밀린 것도 없으면 보내지 않는다", () => {
    const done = new Set(["2026-10-27", "2026-10-28"]);
    expect(decideRecurringReminder({ ...base, anchor: "2026-10-27", resolvedDates: done })).toBeNull();
  });
});
