import { describe, expect, it } from "vitest";
import {
  absentDays,
  computePayrollKintai,
  originalTimes,
  overtimeAndWeekend,
  recordedWork,
  type KintaiAudit,
  type KintaiSession,
} from "@/lib/payroll-kintai";

/** 급여 엑셀 근태 칸(문서 39 「근태 칸 · 勤務表チェック用」). 날짜 · 시각은 가짜. 도쿄 = UTC+9. */

const sess = (over: Partial<KintaiSession> & { id: string }): KintaiSession => ({
  operating_date: "2026-10-14",
  clock_in_at: "2026-10-14T00:00:00Z", // 09:00 도쿄
  clock_out_at: "2026-10-14T09:00:00Z", // 18:00 도쿄
  status: "completed",
  manual_created: false,
  ...over,
});

const audit = (session_id: string, action_type: string, before_json: unknown, created_at: string): KintaiAudit => ({
  session_id,
  action_type,
  before_json,
  created_at,
});

describe("overtimeAndWeekend", () => {
  it("하루 8시간 넘는 분만 잔업, 토 · 일만 주말(공휴일 아님)", () => {
    const r = overtimeAndWeekend([
      { date: "2026-10-09", paidMinutes: 600 }, // 금 · 2시간 잔업
      { date: "2026-10-10", paidMinutes: 480 }, // 토 · 잔업 없음
      { date: "2026-10-11", paidMinutes: 510 }, // 일 · 30분 잔업
      { date: "2026-10-12", paidMinutes: 300 }, // 월(스포츠의 날 공휴일) — 주말 아님
      { date: "2026-10-17", paidMinutes: 0 }, // 토지만 인정 0 — 세지 않음
    ]);
    expect(r).toEqual({ overtimeMinutes: 150, weekendDays: 2, weekendMinutes: 990 });
  });
});

describe("absentDays", () => {
  it("배정 있는데 무효 아닌 출근이 없는 날, 오늘 이전만 · 같은 날 배정 여러 줄은 하루", () => {
    const n = absentDays(
      ["2026-10-01", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-20", "2026-10-26"],
      [
        { operating_date: "2026-10-02", status: "completed" },
        { operating_date: "2026-10-03", status: "invalid" },
      ],
      "2026-10-26",
    );
    // 10/1(기록 없음) · 10/3(무효만) · 10/20 = 3, 10/26 은 오늘이라 안 셈
    expect(n).toBe(3);
  });
});

describe("originalTimes", () => {
  it("그 칸을 처음 바꾼 감사 기록의 before 값 — 순서가 섞여 있어도", () => {
    const s = sess({ id: "s1", clock_out_at: "2026-10-14T08:00:00Z" });
    const t = originalTimes(s, [
      audit("s1", "manual_update", { clock_out_at: "2026-10-14T08:30:00Z" }, "2026-10-16T00:00:00Z"),
      audit("s1", "correction_apply", { clock_in_at: "2026-10-14T00:00:00Z", clock_out_at: "2026-10-14T10:15:00Z" }, "2026-10-15T00:00:00Z"),
    ]);
    expect(t).toEqual({ clockIn: "2026-10-14T00:00:00Z", clockOut: "2026-10-14T10:15:00Z" });
  });

  it("감사 기록이 없거나 그 칸을 안 건드렸으면 지금 값", () => {
    const s = sess({ id: "s1" });
    expect(originalTimes(s, [audit("s1", "invalidate", { status: "completed" }, "2026-10-15T00:00:00Z")])).toEqual({
      clockIn: s.clock_in_at,
      clockOut: s.clock_out_at,
    });
  });
});

describe("recordedWork", () => {
  it("원래 시각 − 휴게, 손으로 만든 세션은 빼고, 이유는 날짜와 함께", () => {
    const sessions = [
      // 정정 전 퇴근 19:15 → 지금 18:00. 본인 기록은 10:15 − 휴게 1시간 = 9:15
      sess({ id: "a", operating_date: "2026-10-14" }),
      // 손으로 추가 — 본인 기록에서 빠짐
      sess({ id: "b", operating_date: "2026-10-21", clock_in_at: "2026-10-21T00:00:00Z", clock_out_at: "2026-10-21T05:00:00Z", manual_created: true }),
      // 퇴근 없이 넘어감
      sess({ id: "c", operating_date: "2026-10-22", clock_in_at: "2026-10-22T00:00:00Z", clock_out_at: null, status: "abandoned" }),
      // 무효 — 본인이 찍은 기록이라 넣는다(4시간)
      sess({ id: "d", operating_date: "2026-10-23", clock_in_at: "2026-10-23T00:00:00Z", clock_out_at: "2026-10-23T04:00:00Z", status: "invalid" }),
    ];
    const audits = new Map<string, KintaiAudit[]>([
      ["a", [audit("a", "correction_apply", { clock_in_at: "2026-10-14T00:00:00Z", clock_out_at: "2026-10-14T10:15:00Z" }, "2026-10-15T00:00:00Z")]],
    ]);
    const r = recordedWork(sessions, new Map([["a", 3600]]), audits);
    expect(r.recordedMinutes).toBe(9 * 60 + 15 + 4 * 60);
    expect(r.recordedDays).toBe(2);
    expect(r.notes).toBe("打刻修正 1件（10/14） / 手動追加 1件（10/21） / 無効 1件（10/23） / 退勤なし 1件（10/22）");
  });

  it("고친 것 없으면 이유는 빈칸", () => {
    expect(recordedWork([sess({ id: "a" })], new Map(), new Map()).notes).toBe("");
  });
});

describe("computePayrollKintai", () => {
  it("한 사람의 칸 전부", () => {
    const k = computePayrollKintai({
      days: [{ date: "2026-10-14", paidMinutes: 540 }],
      sessions: [sess({ id: "a" })],
      breakSecondsBySession: new Map(),
      auditsBySession: new Map(),
      assignedDates: ["2026-10-14", "2026-10-15"],
      today: "2026-11-01",
    });
    expect(k).toEqual({
      absentDays: 1,
      overtimeMinutes: 60,
      weekendDays: 0,
      weekendMinutes: 0,
      recordedMinutes: 540,
      recordedDays: 1,
      notes: "",
    });
  });
});
