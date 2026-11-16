import { describe, expect, it } from "vitest";
import { getDictionary } from "@/lib/i18n";
import { getAdminTasksDictionary } from "@/lib/admin-tasks-i18n";
import { formatMonthDayTokyo, formatUpdateStampTokyo } from "@/lib/tasks-date-label";
import { doneTodayEntries, todayProgress } from "@/lib/tasks-today-progress";

type T = { id: string; status: string; completedAt: string | null; recurrenceRule: string | null };
const mk = (id: string, over: Partial<T> = {}): T => ({ id, status: "open", completedAt: null, recurrenceRule: null, ...over });
const opts = { isMine: () => true, isRecurring: (t: T) => !!t.recurrenceRule };

describe("진행 고리 — 오늘 완료는 분자 · 분모 모두", () => {
  it("일회성 완료 1 + 남은 3 → 1/4", () => {
    const tasks = [mk("a", { status: "completed", completedAt: "2026-11-16T04:00:00Z" })];
    const done = doneTodayEntries(tasks, [], "2026-11-16", opts).length;
    expect(todayProgress(3, done)).toEqual({ done: 1, total: 4 });
  });
  it("반복은 오늘 로그로 세고 한 작업은 한 번만", () => {
    const tasks = [mk("r", { recurrenceRule: "daily" })];
    const logs = [{ taskId: "r", day: "2026-11-16" }, { taskId: "r", day: "2026-11-16" }];
    expect(doneTodayEntries(tasks, logs, "2026-11-16", opts)).toHaveLength(1);
  });
  it("어제 완료 · 남의 작업은 제외", () => {
    const tasks = [mk("a", { status: "completed", completedAt: "2026-11-15T04:00:00Z" })];
    expect(doneTodayEntries(tasks, [], "2026-11-16", opts)).toHaveLength(0);
    expect(doneTodayEntries(tasks, [], "2026-11-15", { ...opts, isMine: () => false })).toHaveLength(0);
  });
  it("완료 시각은 도쿄 기준(UTC 15:30 = 도쿄 다음 날 00:30)", () => {
    const tasks = [mk("a", { status: "completed", completedAt: "2026-11-15T15:30:00Z" })];
    expect(doneTodayEntries(tasks, [], "2026-11-16", opts)).toHaveLength(1);
  });
  it("같은 작업이 로그 2건이어도 한 번 — 「완료」 묶음 줄 수와 고리 분자가 같은 목록에서 나온다", () => {
    const tasks = [mk("a", { status: "completed", completedAt: "2026-11-16T04:00:00Z" }), mk("r", { recurrenceRule: "daily" })];
    const logs = [{ taskId: "a", day: "2026-11-16" }, { taskId: "a", day: "2026-11-16" }, { taskId: "r", day: "2026-11-16" }];
    const ids = new Set(doneTodayEntries(tasks, logs, "2026-11-16", opts).map((e) => e.t.id));
    expect([...ids].sort()).toEqual(["a", "r"]);
  });
  it("남은 0 이어도 완료 2 면 2/2", () => {
    expect(todayProgress(0, 2)).toEqual({ done: 2, total: 2 });
  });
});

describe("월 일 라벨(도쿄)", () => {
  const iso = "2026-11-21T00:00:00+09:00";
  it("ko / ja / en", () => {
    expect(formatMonthDayTokyo(iso, "ko")).toBe("11월 21일");
    expect(formatMonthDayTokyo(iso, "ja")).toBe("11月21日");
    expect(formatMonthDayTokyo(iso, "en")).toBe("Nov 21");
  });
  it("UTC 로는 전날이어도 도쿄 날짜로", () => {
    expect(formatMonthDayTokyo("2026-11-20T16:00:00Z", "ko")).toBe("11월 21일");
  });
});

describe("업데이트 시각", () => {
  it("오늘은 HH:MM, 다른 날은 M/D HH:MM", () => {
    expect(formatUpdateStampTokyo("2026-11-16T04:38:00Z", "2026-11-16")).toBe("13:38");
    expect(formatUpdateStampTokyo("2026-11-15T04:38:00Z", "2026-11-16")).toBe("11/15 13:38");
  });
});

describe("문구 통일", () => {
  it("영어 호실 접미사는 비어 있어 '201' 로 읽힌다", () => {
    expect(`201${getDictionary("en").tasks.contextPickerRoomSuffix}`).toBe("201");
    expect(getDictionary("ko").tasks.contextPickerRoomSuffix).toBe("호");
  });
  it("공유 · 업데이트는 모바일과 PC 가 같은 말", () => {
    for (const l of ["ko", "ja", "en"] as const) {
      const d = getDictionary(l).tasks;
      const a = getAdminTasksDictionary(l);
      expect(a.dpShareCta).toBe(d.mobileWhite.share);
      expect(a.dpLog).toBe(d.updateLog);
    }
  });
  it("프로젝트 요약에서 사진 안내가 빠졌다 · splitEmpty 마침표 없음", () => {
    for (const l of ["ko", "ja", "en"] as const) {
      expect(getDictionary(l).tasks.mobileWhite.projectMeta).not.toMatch(/20/);
      expect(getDictionary(l).common.splitEmpty).not.toMatch(/[.。]$/);
    }
  });
});
