import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const afterQueue: Array<() => Promise<void>> = [];
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => afterQueue.push(fn) }));

type Call = { table: string; op: "select" | "update"; payload?: unknown; eq: Array<[string, unknown]> };
let calls: Call[] = [];
let selectResult: { data: unknown; error: unknown } = { data: null, error: null };

function fakeClient() {
  return {
    from(table: string) {
      const call: Call = { eq: [], op: "select", table };
      calls.push(call);
      const chain = {
        eq(column: string, value: unknown) {
          call.eq.push([column, value]);
          return chain;
        },
        maybeSingle: async () => selectResult,
        select() {
          call.op = "select";
          return chain;
        },
        then(ok: (value: unknown) => unknown) {
          return Promise.resolve({ data: null, error: null }).then(ok);
        },
        update(payload: unknown) {
          call.op = "update";
          call.payload = payload;
          return chain;
        },
      };
      return chain;
    },
  };
}
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => fakeClient() }));

const { resolveOpsCalendarStatusFilter } = await import("@/lib/ops-calendar-status-filter-preference");

beforeEach(() => {
  calls = [];
  afterQueue.length = 0;
  selectResult = { data: null, error: null };
});

describe("resolveOpsCalendarStatusFilter — 사람마다 기억", () => {
  it("주소 값이 먼저고, 본인 행에만 저장한다", async () => {
    const result = await resolveOpsCalendarStatusFilter("user-1", { show: "inquiry,confirmed" });
    expect(result).toEqual(["confirmed", "inquiry"]);
    expect(calls).toHaveLength(0);
    for (const job of afterQueue) await job();
    expect(calls).toEqual([
      { eq: [["id", "user-1"]], op: "update", payload: { ops_calendar_status_filter: ["confirmed", "inquiry"] }, table: "profiles" },
    ]);
  });

  it("주소가 없으면 저장값으로 연다", async () => {
    selectResult = { data: { ops_calendar_status_filter: ["confirmed", "request"] }, error: null };
    expect(await resolveOpsCalendarStatusFilter("user-1", {})).toEqual(["confirmed", "request"]);
    expect(calls[0]?.eq).toEqual([["id", "user-1"]]);
    expect(afterQueue).toHaveLength(0);
  });

  it("칸이 없는 DB(읽기 오류)면 기본 = 확정만", async () => {
    selectResult = { data: null, error: { code: "42703", message: "column does not exist" } };
    expect(await resolveOpsCalendarStatusFilter("user-1", {})).toEqual(["confirmed"]);
  });

  it("예전 cancelled=1 링크는 확정 + 취소, 저장값을 읽지 않는다", async () => {
    expect(await resolveOpsCalendarStatusFilter("user-1", { cancelled: "1" })).toEqual(["confirmed", "cancelled"]);
    expect(calls).toHaveLength(0);
  });

  it("show=none 은 아무것도 안 보기로 저장한다", async () => {
    expect(await resolveOpsCalendarStatusFilter("user-1", { show: "none" })).toEqual([]);
    for (const job of afterQueue) await job();
    expect(calls[0]?.payload).toEqual({ ops_calendar_status_filter: [] });
  });
});
