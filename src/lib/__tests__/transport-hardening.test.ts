// 교통비 점검 수정(2026-11-11) — 자동 연결 저장(H2) · 앞으로 올 달 막기 · 합계 오류를 0엔으로 숨기지 않기(M12) ·
// 제출은 고칠 수 있는 상태일 때만 · 자기 정산서 처리 금지.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "./fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/tokyo-date", () => ({ tokyoToday: () => "2026-11-11" }));

const ORG = "org-1";
const USER = "user-1";
vi.mock("@/lib/session", () => ({
  getCurrentAppSession: async () => ({ organization: { id: ORG }, user: { id: USER } }),
  hasOrganizationContext: () => true,
}));

let fake: ReturnType<typeof createFakeSupabase>;
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => fake.client }));

beforeEach(() => {
  fake = createFakeSupabase({
    attendance_sessions: [
      { id: "att-1", organization_id: ORG, user_id: USER, operating_date: "2026-11-05", status: "approved" },
      { id: "att-other", organization_id: ORG, user_id: "user-2", operating_date: "2026-11-05", status: "approved" },
    ],
    cleaning_sessions: [{ id: "cl-1", organization_id: ORG, staff_user_id: USER, cleaning_date: "2026-11-06" }],
    properties: [{ id: "prop-1", organization_id: ORG }],
    transport_reimbursement_reports: [],
    transport_reimbursement_items: [],
    transport_reimbursement_item_images: [],
  });
});

const base = { targetMonth: "2026-11", amountYen: 400, entryMode: "linked" as const };

describe("createTransportItemAction — 자동 연결(H2)", () => {
  it("근태 기록 연결은 출처를 work_context 에 적는다(DB 검사 트리거가 요구하는 칸)", async () => {
    const { createTransportItemAction } = await import("@/app/mobile/attendance/transport/actions");
    const res = await createTransportItemAction({ ...base, usageDate: "2026-11-05", attendanceSessionId: "att-1" });
    expect(res.ok).toBe(true);
    const item = fake.tables.transport_reimbursement_items[0];
    expect(item.work_context).toMatchObject({ linkedSourceType: "attendance", linkedSourceId: "att-1" });
    expect(item.attendance_session_id).toBe("att-1");
  });

  it("청소 기록 연결은 청소 세션 id 로 출처를 적고 근태 칸은 비운다", async () => {
    const { createTransportItemAction } = await import("@/app/mobile/attendance/transport/actions");
    const res = await createTransportItemAction({
      ...base,
      usageDate: "2026-11-06",
      cleaningSessionId: "cl-1",
      propertyId: "prop-1",
    });
    expect(res.ok).toBe(true);
    const item = fake.tables.transport_reimbursement_items[0];
    expect(item.work_context).toMatchObject({ linkedSourceType: "cleaning", linkedSourceId: "cl-1" });
    expect(item.attendance_session_id).toBeNull();
  });

  it("건물만 있고 기록이 없으면 자동 연결로 저장하지 않는다", async () => {
    const { createTransportItemAction } = await import("@/app/mobile/attendance/transport/actions");
    expect(await createTransportItemAction({ ...base, usageDate: "2026-11-06", propertyId: "prop-1" })).toEqual({
      ok: false,
      error: "link_target_required",
    });
  });

  it("다른 날 · 남의 기록은 거절한다", async () => {
    const { createTransportItemAction } = await import("@/app/mobile/attendance/transport/actions");
    expect(
      await createTransportItemAction({ ...base, usageDate: "2026-11-07", attendanceSessionId: "att-1" }),
    ).toEqual({ ok: false, error: "invalid_link" });
    expect(
      await createTransportItemAction({ ...base, usageDate: "2026-11-05", attendanceSessionId: "att-other" }),
    ).toEqual({ ok: false, error: "invalid_link" });
    expect(await createTransportItemAction({ ...base, usageDate: "2026-11-07", cleaningSessionId: "cl-1" })).toEqual({
      ok: false,
      error: "invalid_link",
    });
    expect(fake.tables.transport_reimbursement_items).toHaveLength(0);
  });

  it("직접 입력은 근태 id 가 와도 잇지 않는다", async () => {
    const { createTransportItemAction } = await import("@/app/mobile/attendance/transport/actions");
    const res = await createTransportItemAction({
      ...base,
      entryMode: "manual",
      usageDate: "2026-11-05",
      attendanceSessionId: "att-1",
    });
    expect(res.ok).toBe(true);
    const item = fake.tables.transport_reimbursement_items[0];
    expect(item.attendance_session_id).toBeNull();
    expect(item.work_context).not.toHaveProperty("linkedSourceType");
  });
});

describe("받는 달 — 화면 · 서버 같은 규칙(3년 전 ~ 다음 달, 문서 24)", () => {
  it("transportMonthAllowed", async () => {
    const { transportMonthAllowed } = await import("../transport-month");
    expect(transportMonthAllowed("2026-12", "2026-11")).toBe(true);
    expect(transportMonthAllowed("2027-01", "2026-11")).toBe(false);
    expect(transportMonthAllowed("2023-11", "2026-11")).toBe(true);
    expect(transportMonthAllowed("2023-10", "2026-11")).toBe(false);
    expect(transportMonthAllowed("2026-13", "2026-11")).toBe(false);
  });
  it("도쿄 기준 다다음 달 정산서는 만들지 않고, 다음 달은 받는다", async () => {
    const { createTransportItemAction, submitTransportReportAction } = await import(
      "@/app/mobile/attendance/transport/actions"
    );
    expect(
      await createTransportItemAction({ ...base, entryMode: "manual", targetMonth: "2027-01", usageDate: "2027-01-01" }),
    ).toEqual({ ok: false, error: "invalid_month" });
    expect(await submitTransportReportAction("2027-01")).toEqual({ ok: false, error: "invalid_month" });
    expect(fake.tables.transport_reimbursement_reports).toHaveLength(0);
    const next = await createTransportItemAction({
      ...base,
      entryMode: "manual",
      targetMonth: "2026-12",
      usageDate: "2026-12-01",
    });
    expect(next.ok).toBe(true);
  });
});

describe("합계 · 제출", () => {
  it("syncReportTotalAmount 는 읽기 오류를 0엔으로 저장하지 않고 던진다", async () => {
    const { syncReportTotalAmount } = await import("../transport-reimbursement");
    const broken = {
      from: () => {
        const api: Record<string, unknown> = {};
        api.select = () => api;
        api.eq = () => api;
        api.update = () => {
          throw new Error("must not write");
        };
        api.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ data: null, error: { message: "boom" } }));
        return api;
      },
    };
    await expect(syncReportTotalAmount(broken as never, "rep-1")).rejects.toThrow(/boom/);
  });

  it("제출 직전에 합계를 항목에서 다시 맞추고, 그 사이 처리된 정산서는 넘기지 않는다", async () => {
    const { submitTransportReportAction } = await import("@/app/mobile/attendance/transport/actions");
    fake.tables.transport_reimbursement_reports = [
      { id: "rep-1", organization_id: ORG, user_id: USER, target_month: "2026-11-01", status: "draft", total_amount_cached: 0 },
    ];
    fake.tables.transport_reimbursement_items = [
      { id: "i1", organization_id: ORG, report_id: "rep-1", user_id: USER, amount_yen: 300 },
      { id: "i2", organization_id: ORG, report_id: "rep-1", user_id: USER, amount_yen: 500 },
    ];
    fake.tables.transport_reimbursement_item_images = [
      { id: "g1", organization_id: ORG, item_id: "i1" },
      { id: "g2", organization_id: ORG, item_id: "i2" },
    ];
    expect(await submitTransportReportAction("2026-11")).toEqual({ ok: true });
    const report = fake.tables.transport_reimbursement_reports[0];
    expect(report.total_amount_cached).toBe(800);
    expect(report.status).toBe("submitted");
  });
});

describe("관리자 교통비 처리 오류 문구", () => {
  it("self_review 는 일반 실패가 아니라 자기 정산서 안내로 보인다", async () => {
    const { transportReviewErrorText } = await import("../transport-review-copy");
    const c = { trFinalizedLocked: "F", trSelfReviewBlocked: "S", actionFailed: "X" };
    expect(transportReviewErrorText("self_review", c)).toBe("S");
    expect(transportReviewErrorText("finalized", c)).toBe("F");
    expect(transportReviewErrorText("error", c)).toBe("X");
  });
});
