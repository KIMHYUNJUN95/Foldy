import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  attendanceMonthFingerprint,
  finalizeAttendanceMonthChecked,
  insertAttendanceSessionChecked,
  updateAttendanceSessionChecked,
} from "@/lib/attendance-session-rpc";

// DB 함수(202611110001) 결과 → 앱 결과 매핑. 함수 자체의 동작은 PGlite 로 확인했다(문서 24 「근태 점검 1차」).

function fakeRpc(reply: { data: unknown; error: { message: string; code?: string } | null }) {
  const calls: { fn: string; args: unknown }[] = [];
  return {
    calls,
    client: {
      rpc(fn: string, args: unknown) {
        calls.push({ fn, args });
        return Promise.resolve(reply);
      },
    },
  };
}

describe("근무 넣기 · 바꾸기 RPC 매핑", () => {
  it("넣기 성공은 id 를 돌려준다", async () => {
    const f = fakeRpc({ data: { result: "ok", id: "s-1" }, error: null });
    await expect(insertAttendanceSessionChecked(f.client as never, { user_id: "u" })).resolves.toEqual({ result: "ok", id: "s-1" });
    expect(f.calls[0]).toEqual({ fn: "attendance_insert_session_checked", args: { p_values: { user_id: "u" }, p_approve_request: null } });
  });

  it("겹침 · 마감 · 열린 근무 충돌은 그 이름 그대로", async () => {
    for (const result of ["overlap", "finalized", "open_conflict"] as const) {
      const f = fakeRpc({ data: { result }, error: null });
      await expect(insertAttendanceSessionChecked(f.client as never, {})).resolves.toEqual({ result });
    }
  });

  it("마감 트리거 예외는 finalized 로", async () => {
    const f = fakeRpc({ data: null, error: { message: "attendance_month_finalized", code: "P0001" } });
    await expect(updateAttendanceSessionChecked(f.client as never, "o", "s", null, {})).resolves.toEqual({ result: "finalized" });
  });

  it("그 밖의 오류 · 모르는 결과는 error", async () => {
    const f = fakeRpc({ data: null, error: { message: "boom" } });
    await expect(updateAttendanceSessionChecked(f.client as never, "o", "s", null, {})).resolves.toEqual({ result: "error" });
    const g = fakeRpc({ data: { result: "weird" }, error: null });
    await expect(insertAttendanceSessionChecked(g.client as never, {})).resolves.toEqual({ result: "error" });
  });

  it("바꾸기 성공은 새 updated_at, 기대 updated_at 을 그대로 넘긴다", async () => {
    const f = fakeRpc({ data: { result: "ok", updated_at: "2026-11-11T00:00:00+00:00" }, error: null });
    await expect(
      updateAttendanceSessionChecked(f.client as never, "o", "s", "2026-11-10T00:00:00+00:00", { status: "invalid" }),
    ).resolves.toEqual({ result: "ok", updatedAt: "2026-11-11T00:00:00+00:00" });
    expect(f.calls[0].args).toEqual({
      p_organization_id: "o",
      p_session_id: "s",
      p_expected_updated_at: "2026-11-10T00:00:00+00:00",
      p_changes: { status: "invalid" },
      p_approve_request: null,
    });
  });

  it("stale · not_found 는 그 이름 그대로", async () => {
    for (const result of ["stale", "not_found", "overlap", "finalized"] as const) {
      const f = fakeRpc({ data: { result }, error: null });
      await expect(updateAttendanceSessionChecked(f.client as never, "o", "s", null, {})).resolves.toEqual({ result });
    }
  });
});

describe("정정 승인을 같이 넘기기 (리뷰 6)", () => {
  it("승인 정보를 p_approve_request 로, request_changed 는 그 이름 그대로", async () => {
    const approve = { id: "r", actor_user_id: "a", comment: null, reviewed_at: "2026-11-11T00:00:00Z" };
    const f = fakeRpc({ data: { result: "request_changed" }, error: null });
    await expect(insertAttendanceSessionChecked(f.client as never, { user_id: "u" }, approve)).resolves.toEqual({ result: "request_changed" });
    expect(f.calls[0].args).toEqual({ p_values: { user_id: "u" }, p_approve_request: approve });
    const g = fakeRpc({ data: { result: "request_changed" }, error: null });
    await expect(updateAttendanceSessionChecked(g.client as never, "o", "s", null, {}, approve)).resolves.toEqual({ result: "request_changed" });
    expect((g.calls[0].args as Record<string, unknown>).p_approve_request).toEqual(approve);
  });

  it("승인 정보가 없으면 null 로 넘긴다", async () => {
    const f = fakeRpc({ data: { result: "ok", id: "s-1" }, error: null });
    await insertAttendanceSessionChecked(f.client as never, {});
    expect((f.calls[0].args as Record<string, unknown>).p_approve_request).toBeNull();
  });
});

describe("마감 RPC 매핑", () => {
  it("지문 읽기 실패는 던진다(계산하지 않는다)", async () => {
    const f = fakeRpc({ data: null, error: { message: "boom" } });
    await expect(attendanceMonthFingerprint(f.client as never, "o", "u", "2026-10")).rejects.toThrow();
  });

  it("지문은 그 달 1일로 부른다", async () => {
    const f = fakeRpc({ data: "abc", error: null });
    await expect(attendanceMonthFingerprint(f.client as never, "o", "u", "2026-10")).resolves.toBe("abc");
    expect(f.calls[0].args).toEqual({ p_organization_id: "o", p_user_id: "u", p_target_month: "2026-10-01" });
  });

  it("ok · stale · already_finalized · error", async () => {
    const args = {
      organizationId: "o",
      userId: "u",
      ym: "2026-10",
      actorId: "a",
      fingerprint: "fp",
      totalPaidMinutes: 480,
      grossAmount: 9600,
      rateBreakdown: [],
      allowanceBreakdown: [],
    };
    const okRpc = fakeRpc({ data: { result: "ok", id: "snap-1" }, error: null });
    await expect(finalizeAttendanceMonthChecked(okRpc.client as never, args)).resolves.toEqual({ result: "ok", id: "snap-1" });
    expect(okRpc.calls[0].fn).toBe("finalize_attendance_month_checked");
    expect(okRpc.calls[0].args).toMatchObject({ p_target_month: "2026-10-01", p_expected_fingerprint: "fp", p_gross_amount: 9600 });
    for (const result of ["stale", "already_finalized"] as const) {
      const f = fakeRpc({ data: { result }, error: null });
      await expect(finalizeAttendanceMonthChecked(f.client as never, args)).resolves.toEqual({ result });
    }
    const e = fakeRpc({ data: null, error: { message: "boom" } });
    await expect(finalizeAttendanceMonthChecked(e.client as never, args)).resolves.toEqual({ result: "error" });
  });
});
