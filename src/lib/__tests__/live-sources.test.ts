import { describe, expect, it } from "vitest";
import {
  attendanceQueueLiveSources,
  notificationLiveSources,
  requestLiveSources,
  taskDetailLiveSources,
  taskLiveSources,
} from "@/lib/live-sources";

/** 화면별 실시간 구독 묶음 (2026-10-29) — 필터 칸이 테이블마다 다르다(org 칸이 없는 테이블은 사람 · 할 일로). */
const ORG = "00000000-0000-0000-0000-00000000000a";
const ME = "00000000-0000-0000-0000-00000000000b";
const TASK = "00000000-0000-0000-0000-00000000000c";

describe("live sources", () => {
  it("할 일 — tasks · 반복 체크는 조직, 참여자는 나", () => {
    expect(taskLiveSources(ORG, ME)).toEqual([
      { table: "tasks", filter: `organization_id=eq.${ORG}` },
      { table: "task_occurrence_state", filter: `organization_id=eq.${ORG}` },
      { table: "task_participants", filter: `user_id=eq.${ME}` },
    ]);
  });

  it("할 일 상세 — 목록 묶음 + 그 할 일의 업데이트", () => {
    expect(taskDetailLiveSources(ORG, ME, TASK)).toEqual([
      ...taskLiveSources(ORG, ME),
      { table: "task_updates", filter: `task_id=eq.${TASK}` },
    ]);
  });

  it("요청 — 주문 · 수리 · 분실물", () => {
    expect(requestLiveSources(ORG).map((s) => s.table)).toEqual(["order_requests", "maintenance_reports", "lost_items"]);
    expect(requestLiveSources(ORG).every((s) => s.filter === `organization_id=eq.${ORG}`)).toBe(true);
  });

  it("알림 — 받는 사람이 나", () => {
    expect(notificationLiveSources(ME)).toEqual([{ table: "notifications", filter: `recipient_user_id=eq.${ME}` }]);
  });

  it("근태 대기열 — 출퇴근 기록 · 정정 · 교통비 · 연차", () => {
    expect(attendanceQueueLiveSources(ORG).map((s) => s.table)).toEqual([
      "attendance_sessions",
      "attendance_correction_requests",
      "transport_reimbursement_reports",
      "annual_leave_requests",
    ]);
  });
});

// 근태 급여 · 시급 화면(2026-11-11) — 다른 사람이 마감 · 근무 수정 · 시급을 바꾸면 열어 둔 PC 화면이 따라온다.
import { attendancePayrollLiveSources, attendanceWagesLiveSources } from "@/lib/live-sources";

describe("근태 급여 · 시급 실시간 묶음", () => {
  it("급여 — 근무 · 정정 · 마감 스냅샷 · 수당 · 시급 · 고용 형태, 모두 조직으로 거른다", () => {
    const s = attendancePayrollLiveSources("org-1");
    expect(s.map((x) => x.table).sort()).toEqual([
      "attendance_correction_requests",
      "attendance_month_snapshots",
      "attendance_pay_allowances",
      "attendance_sessions",
      "employment_type_history",
      "hourly_rate_history",
    ]);
    expect(s.every((x) => x.filter === "organization_id=eq.org-1")).toBe(true);
  });

  it("시급 — 시급 · 고용 형태 · 수당", () => {
    expect(attendanceWagesLiveSources("org-1").map((x) => x.table).sort()).toEqual([
      "attendance_pay_allowances",
      "employment_type_history",
      "hourly_rate_history",
    ]);
  });
});
