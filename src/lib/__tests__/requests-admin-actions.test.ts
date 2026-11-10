import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "./fake-supabase";

/**
 * 어드민 요청 콘솔(수리 · 분실물 · 주문) 서버 액션 — 2026-11-10 점검.
 * 권한 게이트가 모바일과 같은 키인지 · 읽은 상태가 바뀌면 「stale」 로 끊는지 · 날짜 · 수량 검사.
 * 실제 DB 는 부르지 않는다(가짜 Supabase).
 */

const ORG = "org-1";
const USER = "11111111-1111-4111-8111-111111111111";
const ITEM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let capabilities: string[] = [];
let fake = createFakeSupabase({});
/** update 가 실행되기 직전에 한 번 부른다 — 「읽은 뒤 다른 사람이 바꿈」 흉내. */
let beforeUpdate: (() => void) | null = null;

function client() {
  return {
    ...fake.client,
    from(table: string) {
      const builder = fake.client.from(table) as unknown as Record<string, (...args: unknown[]) => unknown>;
      const originalUpdate = builder.update;
      builder.update = (value: unknown) => {
        const hook = beforeUpdate;
        beforeUpdate = null;
        hook?.();
        return originalUpdate(value);
      };
      return builder;
    },
  };
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: async () => client() }));
vi.mock("@/lib/admin-session", () => ({
  requireAdminSession: async () => ({
    capabilities,
    organization: { id: ORG },
    user: { id: USER, preferredLanguage: "ko", role: "field_manager" },
  }),
}));
vi.mock("@/lib/order-permissions", () => ({
  canProcessOrders: async () => capabilities.includes("order_processor"),
}));

const lost = await import("@/app/admin/lost-found/actions");
const maintenance = await import("@/app/admin/maintenance/actions");
const orders = await import("@/app/admin/orders/actions");
const { tokyoToday, ymdShift } = await import("@/lib/tokyo-date");

/** 가짜 표는 읽은 행을 참조로 돌려주므로, 「다른 사람이 바꿈」은 새 객체로 갈아 끼워 흉내 낸다. */
function replaceRow(table: string, patch: Record<string, unknown>) {
  fake.tables[table][0] = { ...fake.tables[table][0], ...patch };
}

function lostRow(overrides: Record<string, unknown> = {}) {
  return {
    handled_at: null,
    handled_by: null,
    handling_memo: null,
    hold_until: "2020-01-01",
    id: ITEM,
    organization_id: ORG,
    reported_by_user_id: USER,
    status: "stored",
    ...overrides,
  };
}

beforeEach(() => {
  capabilities = [];
  beforeUpdate = null;
});

describe("분실물 어드민 — 권한 게이트는 모바일과 같은 lost_found.handle", () => {
  it("청소 강제완료 키만 있으면 막는다", async () => {
    capabilities = ["cleaning.force_complete"];
    fake = createFakeSupabase({ lost_items: [lostRow()] });
    const result = await lost.disposeLostItem({ itemId: ITEM, memo: "" });
    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("lost_found.handle 이 있으면 처리한다", async () => {
    capabilities = ["lost_found.handle"];
    fake = createFakeSupabase({ lost_items: [lostRow()] });
    const result = await lost.disposeLostItem({ itemId: ITEM, memo: "" });
    expect(result).toEqual({ ok: true });
  });
});

describe("분실물 상태 정정", () => {
  beforeEach(() => {
    capabilities = ["lost_found.handle"];
  });

  it("보관 중으로 되돌리면 보관 기한을 새로 준다(밤 배치가 바로 다시 넘기지 않게)", async () => {
    fake = createFakeSupabase({ lost_items: [lostRow({ status: "disposal_scheduled", hold_until: "2020-01-01" })] });
    const result = await lost.correctLostItemStatus({ itemId: ITEM, memo: "", status: "stored" });
    expect(result).toEqual({ ok: true });
    expect(fake.tables.lost_items[0].hold_until).toBe(ymdShift(tokyoToday(), 14));
  });

  it("접수로 되돌려도 보관 기한을 새로 준다", async () => {
    fake = createFakeSupabase({ lost_items: [lostRow({ status: "disposal_scheduled" })] });
    await lost.correctLostItemStatus({ itemId: ITEM, memo: "", status: "registered" });
    expect(fake.tables.lost_items[0].hold_until).toBe(ymdShift(tokyoToday(), 14));
  });

  it("지금과 같은 상태로의 정정은 거절한다", async () => {
    fake = createFakeSupabase({ lost_items: [lostRow({ status: "stored" })] });
    const result = await lost.correctLostItemStatus({ itemId: ITEM, memo: "", status: "stored" });
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("읽은 뒤 상태가 바뀌었으면 stale", async () => {
    fake = createFakeSupabase({ lost_items: [lostRow({ status: "disposal_scheduled" })] });
    beforeUpdate = () => {
      replaceRow("lost_items", { status: "disposed" });
    };
    const result = await lost.correctLostItemStatus({ itemId: ITEM, memo: "", status: "stored" });
    expect(result).toEqual({ ok: false, reason: "stale" });
  });
});

describe("분실물 복원 — 읽은 상태 조건", () => {
  it("읽은 뒤 다른 사람이 이미 복원했으면 덮어쓰지 않고 stale", async () => {
    capabilities = ["lost_found.handle"];
    fake = createFakeSupabase({ lost_items: [lostRow({ status: "disposed" })] });
    beforeUpdate = () => {
      replaceRow("lost_items", { handling_memo: "other", status: "stored" });
    };
    const result = await lost.restoreLostItem({ itemId: ITEM, reason: "x" });
    expect(result).toEqual({ ok: false, reason: "stale" });
    expect(fake.tables.lost_items[0].handling_memo).toBe("other");
  });
});

describe("분실물 보관 연장 — 날짜 검사", () => {
  it("없는 날짜(2월 31일)는 거절한다", async () => {
    capabilities = ["lost_found.handle"];
    fake = createFakeSupabase({ lost_items: [lostRow()] });
    const result = await lost.extendLostItemStorage({ dueDate: "2099-02-31", itemId: ITEM, reason: "" });
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("수리 어드민 강제 완료 · 무효 — 모바일과 같은 maintenance_status_change", () => {
  const report = () => ({ id: ITEM, organization_id: ORG, resolution_memo: null, status: "open" });

  it("청소 강제완료 키만 있으면 막는다", async () => {
    capabilities = ["cleaning.force_complete"];
    fake = createFakeSupabase({ maintenance_reports: [report()] });
    const result = await maintenance.applyMaintenanceException({ kind: "force", memo: "", reportId: ITEM });
    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("maintenance_status_change 가 있으면 처리한다", async () => {
    capabilities = ["maintenance_status_change"];
    fake = createFakeSupabase({ maintenance_reports: [report()] });
    const result = await maintenance.applyMaintenanceException({ kind: "void", memo: "", reportId: ITEM });
    expect(result).toEqual({ ok: true });
    expect(fake.tables.maintenance_reports[0].status).toBe("cancelled");
  });
});

describe("주문 어드민", () => {
  const order = (overrides: Record<string, unknown> = {}) => ({
    admin_memo: null,
    delivery_date: "2026-11-20",
    delivery_end_date: null,
    delivery_start_date: null,
    id: ITEM,
    items: [{ id: "i1", link: "", memo: "", name: "타월", quantity: "2" }],
    organization_id: ORG,
    status: "ordered",
    title: "비품",
    ...overrides,
  });

  beforeEach(() => {
    capabilities = ["order_processor"];
  });

  it("종결로 정정하면 배송일을 비운다(거절과 같은 규칙)", async () => {
    fake = createFakeSupabase({ order_requests: [order({ delivery_start_date: "2026-11-20", delivery_end_date: "2026-11-22" })] });
    const result = await orders.correctOrderStatus({ memo: "", orderId: ITEM, status: "closed" });
    expect(result).toEqual({ ok: true });
    const row = fake.tables.order_requests[0];
    expect([row.delivery_date, row.delivery_start_date, row.delivery_end_date]).toEqual([null, null, null]);
  });

  const READ_AT = "2026-11-10T01:00:00.000Z";
  const editInput = (qty: string) => ({
    expectedUpdatedAt: READ_AT,
    items: [{ link: "", memo: "", name: "타월", qty }],
    orderId: ITEM,
    reason: "",
    title: "비품",
    urgency: "normal" as const,
  });
  const editable = (overrides: Record<string, unknown> = {}) => order({ status: "requested", updated_at: READ_AT, ...overrides });

  it.each(["0", "-1", "abc", "1e3", "10000", ""])("수량 「%s」 은 이유(invalid_item)와 함께 거절한다", async (qty) => {
    fake = createFakeSupabase({ order_requests: [editable()] });
    expect(await orders.editOrder(editInput(qty))).toEqual({ ok: false, reason: "invalid_item" });
  });

  it("예전에 저장된 소수 수량(1.5)은 메모만 고쳐도 그대로 저장된다", async () => {
    fake = createFakeSupabase({
      order_requests: [editable({ items: [{ id: "i1", imageUrls: ["p"], link: "", memo: "", name: "세제", quantity: "1.5" }] })],
    });
    const result = await orders.editOrder({ ...editInput("1.5"), items: [{ link: "", memo: "큰 통", name: "세제", qty: "1.5" }] });
    expect(result).toEqual({ ok: true });
    expect((fake.tables.order_requests[0] as { items: unknown[] }).items).toEqual([
      { id: "i1", imageUrls: ["p"], link: "", memo: "큰 통", name: "세제", quantity: "1.5" },
    ]);
  });

  it("고칠 수 있는 상태면 수정한다(수량은 정리해서 저장)", async () => {
    fake = createFakeSupabase({ order_requests: [editable()] });
    expect(await orders.editOrder(editInput("03"))).toEqual({ ok: true });
    expect((fake.tables.order_requests[0] as { items: { id: string; quantity: string }[] }).items).toEqual([
      expect.objectContaining({ id: "i1", quantity: "3" }),
    ]);
  });

  it("종결된 주문은 내용 수정을 거절한다", async () => {
    fake = createFakeSupabase({ order_requests: [editable({ status: "closed" })] });
    expect(await orders.editOrder(editInput("3"))).toEqual({ ok: false, reason: "invalid" });
  });

  it("창을 연 뒤 누가 이 주문을 바꿨으면(updated_at 다름) stale", async () => {
    fake = createFakeSupabase({ order_requests: [editable({ updated_at: "2026-11-10T01:05:00.000Z" })] });
    expect(await orders.editOrder(editInput("3"))).toEqual({ ok: false, reason: "stale" });
  });

  it("읽은 뒤 저장 직전에 바뀌어도 stale(조건부 update)", async () => {
    fake = createFakeSupabase({ order_requests: [editable()] });
    beforeUpdate = () => {
      replaceRow("order_requests", { updated_at: "2026-11-10T01:05:00.000Z" });
    };
    expect(await orders.editOrder(editInput("3"))).toEqual({ ok: false, reason: "stale" });
  });

  it("보낸 품목이 40개를 넘으면 too_many_items", async () => {
    fake = createFakeSupabase({ order_requests: [editable()] });
    const items = Array.from({ length: 41 }, (_, n) => ({ link: "", memo: "", name: `품목${n}`, qty: "1" }));
    expect(await orders.editOrder({ ...editInput("1"), items })).toEqual({ ok: false, reason: "too_many_items" });
    expect(await orders.editOrder({ ...editInput("1"), items: items.slice(0, 40) })).toEqual({ ok: true });
  });
});

describe("콘솔 실패 토스트 문구", async () => {
  const { adminActionErrorMessage } = await import("@/components/admin/shared/admin-action-error");
  const copy = { actionFailed: "F", actionForbidden: "P", actionStale: "S" };
  it.each([
    ["forbidden", "P"],
    ["unauthorized", "P"],
    ["stale", "S"],
    ["not_found", "S"],
    ["invalid_transition", "S"],
    ["failed", "F"],
    ["invalid", "F"],
    [undefined, "F"],
  ])("%s → %s", (reason, expected) => {
    expect(adminActionErrorMessage(reason, copy)).toBe(expected);
  });
});
