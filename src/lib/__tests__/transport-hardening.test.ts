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
const DONE = { status: "completed", closed_without_cleaning: false };

/** 표 하나만 읽기 오류를 내게 한다. */
function failTable(table: string) {
  const original = fake.client.from;
  fake.client.from = ((name: string) => {
    if (name !== table) return original(name);
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "gte", "lte", "limit", "order", "maybeSingle"]) q[m] = () => q;
    q.then = (res: (v: unknown) => unknown) => Promise.resolve(res({ data: null, error: { message: "boom" } }));
    return q;
  }) as typeof fake.client.from;
}
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => fake.client }));

beforeEach(() => {
  fake = createFakeSupabase({
    attendance_sessions: [
      { id: "att-1", organization_id: ORG, user_id: USER, operating_date: "2026-11-05", status: "approved", clock_in_site_id: "site-1" },
      { id: "att-other", organization_id: ORG, user_id: "user-2", operating_date: "2026-11-05", status: "approved" },
      // 근무지가 다른 조직 것 · 근무지 없음 · 다른 조직 근태 기록
      { id: "att-foreign-site", organization_id: ORG, user_id: USER, operating_date: "2026-11-08", status: "approved", clock_in_site_id: "site-x" },
      { id: "att-no-site", organization_id: ORG, user_id: USER, operating_date: "2026-11-09", status: "approved", clock_in_site_id: null },
      { id: "att-org2", organization_id: "org-2", user_id: USER, operating_date: "2026-11-05", status: "approved", clock_in_site_id: "site-x" },
      // 무효 처리된 근태 — 후보에도 저장에도 쓰지 않는다. FK 가 빈 근무지(이름으로 출근지를 맞추는 경우).
      { id: "att-invalid", organization_id: ORG, user_id: USER, operating_date: "2026-11-14", status: "invalid", clock_in_site_id: "site-1" },
      { id: "att-nofk", organization_id: ORG, user_id: USER, operating_date: "2026-11-16", status: "approved", clock_in_site_id: "site-nofk" },
    ],
    attendance_sites: [
      { id: "site-1", organization_id: ORG, name: "아라키초A", property_id: "prop-a" },
      { id: "site-x", organization_id: "org-2", name: "남의 근무지", property_id: null },
      { id: "site-nofk", organization_id: ORG, name: "사무실", property_id: null },
    ],
    cleaning_sessions: [
      { id: "cl-1", organization_id: ORG, staff_user_id: USER, cleaning_date: "2026-11-06", room_label: "아라키초A 201", ...DONE },
      { id: "cl-unknown-room", organization_id: ORG, staff_user_id: USER, cleaning_date: "2026-11-07", room_label: "없는 방 9", ...DONE },
      { id: "cl-foreign-room", organization_id: ORG, staff_user_id: USER, cleaning_date: "2026-11-10", room_label: "가부키초 301", ...DONE },
      { id: "cl-org2", organization_id: "org-2", staff_user_id: USER, cleaning_date: "2026-11-06", room_label: "아라키초A 201", ...DONE },
      // 「청소한 기록」이 아닌 것 — 취소 · 「못 했어요」로 닫음.
      { id: "cl-cancelled", organization_id: ORG, staff_user_id: USER, cleaning_date: "2026-11-12", room_label: "아라키초A 201", status: "cancelled", closed_without_cleaning: false },
      { id: "cl-closed", organization_id: ORG, staff_user_id: USER, cleaning_date: "2026-11-13", room_label: "아라키초A 201", status: "completed", closed_without_cleaning: true },
      // 우리 조직 방인데 다른 조직 건물을 가리킨다.
      { id: "cl-cross", organization_id: ORG, staff_user_id: USER, cleaning_date: "2026-11-15", room_label: "아라키초A 999", ...DONE },
    ],
    rooms: [
      { room_label: "아라키초A 201", organization_id: ORG, property_id: "prop-a" },
      // 다른 조직에만 있는 방 — 우리 조직 청소 기록이어도 이 건물 이름을 쓰지 않는다.
      { room_label: "가부키초 301", organization_id: "org-2", property_id: "prop-other-org" },
      { room_label: "아라키초A 999", organization_id: ORG, property_id: "prop-other-org" },
    ],
    properties: [
      { id: "prop-1", organization_id: ORG },
      { id: "prop-a", organization_id: ORG, name: "Arakicho A", display_name_ko: "아라키초A" },
      { id: "prop-other-org", organization_id: "org-2", name: "Kabukicho" },
    ],
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

describe("건물 이름은 서버가 정한다 — 화면이 보낸 이름을 믿지 않는다(2026-11-25)", () => {
  const manual = { targetMonth: "2026-11", amountYen: 400, entryMode: "manual" as const, usageDate: "2026-11-05" };
  const label = () => (fake.tables.transport_reimbursement_items[0].work_context as Record<string, string>).buildingLabel;

  it("건물: 다른 언어 이름을 보내도 정규(한국어) 이름으로 저장한다", async () => {
    const { createTransportItemAction } = await import("@/app/mobile/attendance/transport/actions");
    const res = await createTransportItemAction({ ...manual, propertyId: "prop-a", destinationKey: "prop-a", buildingLabel: "荒木町A" } as never);
    expect(res.ok).toBe(true);
    expect(label()).toBe("아라키초A");
  });

  it("건물: 엉뚱한 이름을 보내도 정규 이름으로 저장한다", async () => {
    const { createTransportItemAction } = await import("@/app/mobile/attendance/transport/actions");
    await createTransportItemAction({ ...manual, propertyId: "prop-a", destinationKey: "prop-a", buildingLabel: "남의 집" } as never);
    expect(label()).toBe("아라키초A");
  });

  it("사무실 · 기타: 정규 이름(사무실 · 기타)으로 저장한다", async () => {
    const { createTransportItemAction } = await import("@/app/mobile/attendance/transport/actions");
    await createTransportItemAction({ ...manual, destinationKey: "office", buildingLabel: "Office" } as never);
    await createTransportItemAction({ ...manual, destinationKey: "other", buildingLabel: "아무거나", memo: "택시" } as never);
    const labels = fake.tables.transport_reimbursement_items.map(
      (i) => (i.work_context as Record<string, string>).buildingLabel,
    );
    expect(labels).toEqual(["사무실", "기타"]);
  });

  it("출근지가 없으면 화면이 보낸 이름을 저장하지 않는다", async () => {
    const { createTransportItemAction } = await import("@/app/mobile/attendance/transport/actions");
    expect((await createTransportItemAction({ ...manual, buildingLabel: "가짜 건물" } as never)).ok).toBe(true);
    expect(label()).toBeUndefined();
  });

  it("다른 조직 · 없는 건물은 지금처럼 거절한다", async () => {
    const { createTransportItemAction } = await import("@/app/mobile/attendance/transport/actions");
    for (const propertyId of ["prop-other-org", "prop-missing"]) {
      expect(await createTransportItemAction({ ...manual, propertyId, buildingLabel: "아라키초A" } as never)).toEqual({
        ok: false,
        error: "invalid_link",
      });
    }
    expect(fake.tables.transport_reimbursement_items).toHaveLength(0);
  });

  it("수정 액션은 건물 이름을 바꾸지 않는다(출근지는 수정에서 못 바꾼다)", async () => {
    const { createTransportItemAction, updateTransportItemAction } = await import(
      "@/app/mobile/attendance/transport/actions"
    );
    const created = await createTransportItemAction({ ...manual, propertyId: "prop-a", destinationKey: "prop-a" });
    if (!created.ok) throw new Error("create failed");
    expect(
      await updateTransportItemAction({ itemId: created.itemId, buildingLabel: "가짜 건물" } as never),
    ).toEqual({ ok: true });
    expect(label()).toBe("아라키초A");
  });
});

describe("자동 연결 항목의 건물 이름도 서버가 연결된 기록에서 정한다(2026-11-25)", () => {
  const linked = { targetMonth: "2026-11", amountYen: 400, entryMode: "linked" as const };
  const label = () => (fake.tables.transport_reimbursement_items[0].work_context as Record<string, string>).buildingLabel;
  const create = async (input: Record<string, unknown>) => {
    const { createTransportItemAction } = await import("@/app/mobile/attendance/transport/actions");
    return createTransportItemAction({ ...linked, ...input } as never);
  };

  it("근태 연결: 화면이 다른 이름을 보내도 근무지 이름(attendance_sites.name)을 저장한다", async () => {
    expect((await create({ usageDate: "2026-11-05", attendanceSessionId: "att-1", buildingLabel: "荒木町A 가짜" })).ok).toBe(true);
    expect(label()).toBe("아라키초A");
  });

  it("청소 연결: 화면이 다른 이름을 보내도 방 → 건물(display_name_ko ?? name)을 저장한다", async () => {
    expect((await create({ usageDate: "2026-11-06", cleaningSessionId: "cl-1", buildingLabel: "남의 집" })).ok).toBe(true);
    expect(label()).toBe("아라키초A");
  });

  it("근무지가 없거나 다른 조직 것이면 이름을 비운다(화면 값을 쓰지 않는다)", async () => {
    await create({ usageDate: "2026-11-08", attendanceSessionId: "att-foreign-site", buildingLabel: "가짜" });
    await create({ usageDate: "2026-11-09", attendanceSessionId: "att-no-site", buildingLabel: "가짜" });
    const labels = fake.tables.transport_reimbursement_items.map(
      (i) => (i.work_context as Record<string, string>).buildingLabel,
    );
    expect(labels).toEqual([undefined, undefined]);
  });

  it("청소 방을 못 찾거나 다른 조직 방이면 이름을 비운다", async () => {
    await create({ usageDate: "2026-11-07", cleaningSessionId: "cl-unknown-room", buildingLabel: "가짜" });
    await create({ usageDate: "2026-11-10", cleaningSessionId: "cl-foreign-room", buildingLabel: "가짜" });
    const labels = fake.tables.transport_reimbursement_items.map(
      (i) => (i.work_context as Record<string, string>).buildingLabel,
    );
    expect(labels).toEqual([undefined, undefined]);
  });

  it("다른 조직 근태 · 청소 기록은 지금처럼 invalid_link", async () => {
    expect(await create({ usageDate: "2026-11-05", attendanceSessionId: "att-org2" })).toEqual({ ok: false, error: "invalid_link" });
    expect(await create({ usageDate: "2026-11-06", cleaningSessionId: "cl-org2" })).toEqual({ ok: false, error: "invalid_link" });
    expect(fake.tables.transport_reimbursement_items).toHaveLength(0);
  });

  it("근무지 · 방 · 건물 읽기 오류는 read_failed(이름 없이 저장하지 않는다)", async () => {
    const { resolveLinkedTransportPlace } = await import("@/lib/transport-reimbursement");
    const failing = {
      from: () => {
        const q: Record<string, unknown> = {};
        for (const m of ["select", "eq", "in", "limit", "order", "maybeSingle"]) q[m] = () => q;
        q.then = (res: (v: unknown) => unknown) => Promise.resolve(res({ data: null, error: { message: "boom" } }));
        return q;
      },
    };
    expect(
      await resolveLinkedTransportPlace(failing as never, ORG, { type: "attendance", siteId: "site-1" }),
    ).toEqual({ ok: false, error: "read_failed" });
    expect(
      await resolveLinkedTransportPlace(failing as never, ORG, { type: "cleaning", roomLabel: "아라키초A 201" }),
    ).toEqual({ ok: false, error: "read_failed" });
  });
});

describe("연결 항목의 건물 정보는 서버가 연결 기록에서 한 판정으로 정한다(2026-11-25 추가)", () => {
  const linked = { targetMonth: "2026-11", amountYen: 400, entryMode: "linked" as const };
  const ctx = (i = 0) => fake.tables.transport_reimbursement_items[i].work_context as Record<string, string>;
  const actions = () => import("@/app/mobile/attendance/transport/actions");
  const create = async (input: Record<string, unknown>) =>
    (await actions()).createTransportItemAction({ ...linked, ...input } as never);
  const candidates = async () => {
    const { getLinkedTransportCandidates } = await import("@/lib/transport-reimbursement");
    return getLinkedTransportCandidates(fake.client as never, ORG, USER, "2026-11-01");
  };

  it("요약(contextSummary): 화면 값 대신 후보 목록과 글자까지 같은 글을 저장한다", async () => {
    const list = await candidates();
    const clean = list.find((c) => c.cleaningSessionId === "cl-1")!;
    const att = list.find((c) => c.attendanceSessionId === "att-1")!;
    expect(clean.contextSummary).toMatch(/^아라키초A · /);
    await create({ usageDate: "2026-11-06", cleaningSessionId: "cl-1", contextSummary: "가짜 요약" });
    await create({ usageDate: "2026-11-05", attendanceSessionId: "att-1", contextSummary: "가짜 요약" });
    expect(ctx(0).contextSummary).toBe(clean.contextSummary);
    expect(ctx(1).contextSummary).toBe(att.contextSummary);
    expect(ctx(1).contextSummary).toBe("아라키초A");
  });

  it("요약: 직접 입력은 지금처럼 화면 값", async () => {
    await create({ entryMode: "manual", usageDate: "2026-11-05", contextSummary: "201, 202" });
    expect(ctx().contextSummary).toBe("201, 202");
  });

  it("요약 고치기: 연결 항목으로 남으면 그대로, 같은 저장에서 직접 입력으로 바꾸면 받는다", async () => {
    const { updateTransportItemAction } = await actions();
    const created = await create({ usageDate: "2026-11-06", cleaningSessionId: "cl-1" });
    if (!created.ok) throw new Error("create failed");
    const before = ctx().contextSummary;
    expect(await updateTransportItemAction({ itemId: created.itemId, contextSummary: "가짜" })).toEqual({ ok: true });
    expect(ctx().contextSummary).toBe(before);
    await updateTransportItemAction({ itemId: created.itemId, contextSummary: "301", entryMode: "manual" });
    expect(ctx().contextSummary).toBe("301");
  });

  it("건물 id: 연결 기록이 건물을 가리키면 화면 값 대신 그것(금액 기억 키 destinationKey 도 같이)", async () => {
    await create({ usageDate: "2026-11-05", attendanceSessionId: "att-1", propertyId: "prop-1", destinationKey: "prop-1" });
    await create({ usageDate: "2026-11-06", cleaningSessionId: "cl-1", propertyId: "prop-1", destinationKey: "prop-1" });
    const rows = fake.tables.transport_reimbursement_items;
    expect(rows.map((r) => r.property_id)).toEqual(["prop-a", "prop-a"]);
    expect(rows.map((r) => (r.work_context as Record<string, string>).destinationKey)).toEqual(["prop-a", "prop-a"]);
    // 후보가 주던 값과 같다 — 화면이 후보를 그대로 보내던 지금까지의 저장값과 어긋나지 않는다.
    const list = await candidates();
    expect(list.find((c) => c.attendanceSessionId === "att-1")?.propertyId).toBe("prop-a");
    expect(list.find((c) => c.cleaningSessionId === "cl-1")?.propertyId).toBe("prop-a");
  });

  it("건물 id: 근무지 FK 가 비면 지금처럼 화면이 이름으로 맞춘 값(같은 조직 확인)", async () => {
    expect((await create({ usageDate: "2026-11-16", attendanceSessionId: "att-nofk", propertyId: "prop-1", destinationKey: "prop-1" })).ok).toBe(true);
    expect(fake.tables.transport_reimbursement_items[0].property_id).toBe("prop-1");
    expect(await create({ usageDate: "2026-11-16", attendanceSessionId: "att-nofk", propertyId: "prop-other-org" })).toEqual({
      ok: false,
      error: "invalid_link",
    });
  });

  it("같은 조직 방이 다른 조직 건물을 가리키면 건물 없음(이름 · id 비움, 요약은 방만)", async () => {
    expect((await create({ usageDate: "2026-11-15", cleaningSessionId: "cl-cross" })).ok).toBe(true);
    const row = fake.tables.transport_reimbursement_items[0];
    expect(row.property_id).toBeNull();
    expect(ctx().buildingLabel).toBeUndefined();
    expect(ctx().contextSummary).not.toContain("·");
    const cand = (await candidates()).find((c) => c.cleaningSessionId === "cl-cross")!;
    expect(cand.propertyId).toBeUndefined();
    expect(cand.buildingLabel).toBe("");
    expect(cand.contextSummary).toBe(ctx().contextSummary);
  });

  it("연결할 수 있는 기록: 후보에 안 나오는 기록(무효 근태 · 취소 · 못 했어요 청소)은 저장도 거절", async () => {
    const list = await candidates();
    const ids = list.map((c) => c.attendanceSessionId ?? c.cleaningSessionId);
    for (const id of ["att-invalid", "cl-cancelled", "cl-closed"]) expect(ids).not.toContain(id);
    expect(await create({ usageDate: "2026-11-14", attendanceSessionId: "att-invalid" })).toEqual({ ok: false, error: "invalid_link" });
    expect(await create({ usageDate: "2026-11-12", cleaningSessionId: "cl-cancelled" })).toEqual({ ok: false, error: "invalid_link" });
    expect(await create({ usageDate: "2026-11-13", cleaningSessionId: "cl-closed" })).toEqual({ ok: false, error: "invalid_link" });
    expect(fake.tables.transport_reimbursement_items).toHaveLength(0);
  });

  it("액션: 근무지 · 방 · 건물 읽기 오류면 read_failed 이고 저장하지 않는다", async () => {
    for (const [table, input] of [
      ["attendance_sites", { usageDate: "2026-11-05", attendanceSessionId: "att-1" }],
      ["rooms", { usageDate: "2026-11-06", cleaningSessionId: "cl-1" }],
      ["properties", { usageDate: "2026-11-06", cleaningSessionId: "cl-1" }],
    ] as const) {
      const original = fake.client.from;
      failTable(table);
      expect(await create(input)).toEqual({ ok: false, error: "read_failed" });
      fake.client.from = original;
    }
    expect(fake.tables.transport_reimbursement_items).toHaveLength(0);
  });

  it("후보 목록: 근무지 · 방 · 건물 읽기 오류를 삼키지 않는다(빈 이름 대신 던짐)", async () => {
    for (const table of ["attendance_sessions", "attendance_sites", "cleaning_sessions", "rooms", "properties"]) {
      const original = fake.client.from;
      failTable(table);
      await expect(candidates()).rejects.toThrow(/read failed/);
      fake.client.from = original;
    }
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
