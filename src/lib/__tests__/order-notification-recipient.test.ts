import { beforeEach, describe, expect, it, vi } from "vitest";

// 발주 알림은 서버 키로 만든다(202611200003). 예전 INSERT 정책이 보던 「받는 사람이 같은 조직의 active 멤버」 조건을
// `src/actions/orders.ts` 가 직접 본다 — 아니면(또는 조회 실패 · 예외면) 알림만 건너뛰고 처리는 성공한다.

type Row = Record<string, unknown>;
const ORG = "org-1";
const ADMIN = "admin-1";
const REPORTER = "reporter-1";

let orders: Row[] = [];
let memberships: Row[] = [];
let membershipsMode: "ok" | "error" | "throw" = "ok";

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: ((row: Row) => boolean)[] = [];
  private single = false;
  private patch: Row | null = null;
  constructor(private readonly table: string) {}
  select() {
    return this;
  }
  update(patch: Row) {
    this.patch = patch;
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  limit() {
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  private run() {
    if (this.table === "memberships") {
      if (membershipsMode === "throw") throw new Error("network");
      if (membershipsMode === "error") return { data: null, error: { message: "read failed" } };
    }
    const source = this.table === "order_requests" ? orders : this.table === "memberships" ? memberships : [];
    const rows = source.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.patch) {
      for (const row of rows) Object.assign(row, this.patch);
      return { data: rows.map((row) => ({ id: row.id })), error: null };
    }
    return { data: this.single ? (rows[0] ?? null) : rows, error: null };
  }
  then<A = { data: unknown; error: unknown }, B = never>(
    ok?: ((value: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null,
    fail?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    try {
      return Promise.resolve(this.run()).then(ok, fail);
    } catch (error) {
      return Promise.reject(error).then(ok, fail);
    }
  }
}

const userClient = { from: (table: string) => new FakeQuery(table), kind: "user" };
const serviceClient = { from: (table: string) => new FakeQuery(table), kind: "service" };

const processed = vi.fn(async () => ({ created: true, id: "n1" }));
const deliveryUpdated = vi.fn(async () => ({ created: true, id: "n2" }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  getCurrentAppSession: async () => ({ organization: { id: ORG }, user: { id: ADMIN, role: "office_admin" } }),
  hasOrganizationContext: () => true,
}));
vi.mock("@/lib/order-permissions", () => ({ canProcessOrders: async () => true }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: async () => userClient }));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => serviceClient }));
vi.mock("@/lib/notifications/create", () => ({
  createOrderDeliveryUpdatedNotification: deliveryUpdated,
  createOrderProcessedNotification: processed,
}));

const { updateOrderDeliveryDate, updateOrderRequestStatus } = await import("@/actions/orders");

function order(status: string): Row {
  return {
    building_name: "B",
    delivery_date: null,
    delivery_end_date: null,
    delivery_start_date: null,
    id: "o1",
    organization_id: ORG,
    reported_by_user_id: REPORTER,
    room_label: "101",
    status,
    title: "타월",
  };
}

const processOrder = () => updateOrderRequestStatus({ deliveryDate: "2026-11-25", orderId: "o1", targetStatus: "ordered" });
const editDelivery = () => updateOrderDeliveryDate({ deliveryDate: "2026-11-26", orderId: "o1" });

beforeEach(() => {
  processed.mockClear();
  deliveryUpdated.mockClear();
  membershipsMode = "ok";
  memberships = [{ organization_id: ORG, status: "active", user_id: REPORTER }];
});

describe("발주 알림 — 받는 사람 확인", () => {
  it("받는 사람이 같은 조직 active 멤버면 서버 키로 알림을 만든다", async () => {
    orders = [order("approved")];
    expect(await processOrder()).toEqual({ ok: true, status: "ordered" });
    expect(processed).toHaveBeenCalledTimes(1);
    expect((processed.mock.calls[0] as unknown as [{ supabase: unknown }])[0].supabase).toBe(serviceClient);

    expect(await editDelivery()).toEqual({ ok: true, status: "ordered" });
    expect(deliveryUpdated).toHaveBeenCalledTimes(1);
    expect((deliveryUpdated.mock.calls[0] as unknown as [{ supabase: unknown }])[0].supabase).toBe(serviceClient);
  });

  it.each([
    ["멤버 아님", () => (memberships = [])],
    ["다른 조직 멤버", () => (memberships = [{ organization_id: "org-2", status: "active", user_id: REPORTER }])],
    ["active 아님", () => (memberships = [{ organization_id: ORG, status: "inactive", user_id: REPORTER }])],
    ["조회 오류", () => (membershipsMode = "error")],
    ["조회 예외", () => (membershipsMode = "throw")],
  ])("%s — 알림만 건너뛰고 처리는 성공한다", async (_label, arrange) => {
    arrange();
    orders = [order("approved")];
    expect(await processOrder()).toEqual({ ok: true, status: "ordered" });
    expect(processed).not.toHaveBeenCalled();

    expect(await editDelivery()).toEqual({ ok: true, status: "ordered" });
    expect(deliveryUpdated).not.toHaveBeenCalled();
  });
});
