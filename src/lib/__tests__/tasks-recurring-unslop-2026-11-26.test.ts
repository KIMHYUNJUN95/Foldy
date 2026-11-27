import { describe, expect, it } from "vitest";
import { getDictionary } from "@/lib/i18n";
import { getAdminTasksDictionary } from "@/lib/admin-tasks-i18n";
import { CATCH_UP_THRESHOLD, detailScheduleDate, needsCatchUp, splitCalendarDay, statusPillView } from "@/lib/tasks-console-view";

const base = { shownStatus: "open", recurring: false, occDone: false, completingNow: false } as const;

describe("상태 알약 — 글자는 지금 상태, 누르면 대기 ↔ 진행 중", () => {
  it("대기 → 글자 「대기」, 누르면 진행 중", () => {
    expect(statusPillView(base)).toMatchObject({ labelKey: "stOpen", pressed: false, disabled: false, next: "in_progress" });
  });
  it("진행 중 → 눌린 상태, 누르면 대기", () => {
    const v = statusPillView({ ...base, shownStatus: "in_progress" });
    expect(v).toMatchObject({ labelKey: "stInProgress", pressed: true, isDone: false, next: "open" });
  });
  it("완료된 일회성 → 「완료」 · 눌리지 않은 상태 · 누르면 진행 중으로 다시 연다(예전 3칸과 같음)", () => {
    const v = statusPillView({ ...base, shownStatus: "completed" });
    expect(v).toMatchObject({ labelKey: "stCompleted", isDone: true, pressed: false, disabled: false, next: "in_progress" });
  });
  it("완료된 반복 회차는 막는다 — 되돌리기는 제목 고리로", () => {
    const v = statusPillView({ ...base, shownStatus: "completed", recurring: true, occDone: true });
    expect(v.disabled).toBe(true);
    expect(v.labelKey).toBe("stCompleted");
  });
  it("완료 움직임 중에는 막는다", () => {
    expect(statusPillView({ ...base, completingNow: true }).disabled).toBe(true);
  });
  it("완료된 일회성을 누른 뒤(draft = 진행 중)는 서버 응답 전에도 바로 「진행 중」", () => {
    const v = statusPillView({ ...base, shownStatus: "in_progress" });
    expect(v).toMatchObject({ labelKey: "stInProgress", isDone: false, pressed: true });
  });
  it("반복의 완료 여부는 회차 기록만 본다", () => {
    expect(statusPillView({ ...base, recurring: true, shownStatus: "in_progress" }).isDone).toBe(false);
    expect(statusPillView({ ...base, recurring: true, occDone: true, shownStatus: "completed" }).isDone).toBe(true);
  });
  it("반복이라도 회차가 안 끝났으면 누를 수 있다", () => {
    expect(statusPillView({ ...base, recurring: true }).disabled).toBe(false);
  });
});

describe("상세 일정 날짜", () => {
  it("반복 + 회차 → 회차 날짜", () => {
    expect(detailScheduleDate(true, "2026-11-26", "2026-11-06")).toBe("2026-11-26");
  });
  it("반복인데 회차 없이 열면(관리함 · 프로젝트) 오늘이 아니라 시리즈 날짜", () => {
    expect(detailScheduleDate(true, null, "2026-11-06")).toBe("2026-11-06");
    expect(detailScheduleDate(true, null, null)).toBeNull();
  });
  it("일회성은 그 작업 날짜", () => {
    expect(detailScheduleDate(false, null, "2026-11-20")).toBe("2026-11-20");
  });
});

describe("밀린 회차 정리 — 7회 넘을 때만", () => {
  it("문턱", () => {
    expect(CATCH_UP_THRESHOLD).toBe(7);
    expect(needsCatchUp(undefined)).toBe(false);
    expect(needsCatchUp(7)).toBe(false);
    expect(needsCatchUp(8)).toBe(true);
  });
});

describe("캘린더 칸 — 반복은 한 줄, 나머지 2개 + 「+N건」", () => {
  const rec = (id: string) => ({ id, r: true });
  const one = (id: string) => ({ id, r: false });
  const isRec = (t: { r: boolean }) => t.r;
  it("반복 3 + 일회성 4 → 반복 3 · 2개 · +2", () => {
    const c = splitCalendarDay([rec("a"), one("b"), rec("c"), one("d"), one("e"), rec("f"), one("g")], isRec);
    expect(c.repeating).toBe(3);
    expect(c.shown.map((t) => t.id)).toEqual(["b", "d"]);
    expect(c.more).toBe(2);
  });
  it("반복만 → 일회성 줄 없음 · 더 보기 없음", () => {
    expect(splitCalendarDay([rec("a"), rec("b")], isRec)).toEqual({ repeating: 2, shown: [], more: 0 });
  });
  it("빈 날", () => {
    expect(splitCalendarDay([], isRec)).toEqual({ repeating: 0, shown: [], more: 0 });
  });
});

describe("새 문구 — ko · ja · en 모두, ko 는 한자 없음", () => {
  const keys = ["odCatchUp", "dpRepeatSince", "skDaysSummary", "calRepeatN", "odDaysBehind"] as const;
  const han = /\p{Script=Han}/u;
  it.each(["ko", "ja", "en"] as const)("%s", (locale) => {
    const d = getAdminTasksDictionary(locale);
    for (const k of keys) expect(d[k], k).toBeTruthy();
    expect(d.dpRepeatSince).toContain("{date}");
    expect(d.skDaysSummary).toContain("{past}");
    expect(d.skDaysSummary).toContain("{next}");
    expect(d.calRepeatN).toContain("{n}");
    if (locale === "ko") for (const k of keys) expect(han.test(d[k]), k).toBe(false);
  });
  it("밀림 문구는 회차 기준 — 콘솔 사전과 모바일 사전이 같다", () => {
    const want = { ko: "{n}회 밀림", ja: "{n}回 未完了", en: "{n} missed" } as const;
    for (const locale of ["ko", "ja", "en"] as const) {
      expect(getAdminTasksDictionary(locale).odDaysBehind).toBe(want[locale]);
      expect(getDictionary(locale).tasks.odDaysBehind).toBe(want[locale]);
    }
  });
});
