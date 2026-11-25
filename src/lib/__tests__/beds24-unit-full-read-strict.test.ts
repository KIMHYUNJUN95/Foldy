import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/admin-session", () => ({
  getAdminSessionForApi: vi.fn(async () => ({
    ok: true,
    session: { organization: { id: "org-1" }, user: { id: "user-1", name: "Tester" } },
  })),
}));
vi.mock("@/lib/ops-admin", () => ({ canAccessOpsAdmin: () => true, canWriteOpsCalendar: () => true }));
vi.mock("@/app/api/ops/calendar/reads", () => ({ readRoomNames: vi.fn() }));
vi.mock("@/lib/beds24/live-signal", () => ({ signalBeds24Change: vi.fn(async () => undefined) }));

let serviceClient: never;
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => serviceClient }));

const { loadUnitFullReadAt, loadUnitFullReadAtOrNull } = await import("@/lib/beds24/property-rates-state");
const { enqueueBeds24PriceJob } = await import("@/lib/beds24/price-job-queue");
const { readOpsRoomUnavailableNights } = await import("@/lib/ops-calendar");
const { submitPriceChange } = await import("@/actions/ops-calendar");

/**
 * 유령 유닛 기준 시각(`loadUnitFullReadAt`)을 못 읽었을 때 — 화면은 빈 맵으로 넘어가지만, 쓰기는 멈춘다 (2026-11-25).
 *
 * 빈 맵이면 `isGhostUnit` 이 꺼져 Beds24 가 이미 지운 유닛이 쓰기 대상으로 남는다 — 최소숙박 · 가격이 없는 방으로 간다.
 * 계약: docs/product/33-calendar-write-features.md 「유령 유닛」
 */

type Result = { data: unknown; error: { code?: string; message: string } | null };

/** 표 · 고른 열마다 결과를 정하는 최소 가짜. 체인 어디서 await 해도 같은 결과. */
function fakeClient(resolve: (table: string, columns: string) => Result) {
  const inserts: string[] = [];
  const client = {
    from(table: string) {
      let columns = "";
      const chain: Record<string, unknown> = {};
      for (const method of ["eq", "in", "order", "gt", "gte", "lt", "lte", "is", "neq", "not", "range", "maybeSingle", "single"]) {
        chain[method] = () => chain;
      }
      chain.select = (value?: string) => {
        columns = value ?? "";
        return chain;
      };
      chain.insert = () => {
        inserts.push(table);
        return chain;
      };
      chain.then = (onFulfilled: (value: Result) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(resolve(table, columns)).then(onFulfilled, onRejected);
      return chain;
    },
    rpc() {
      inserts.push("rpc");
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { client: client as never, inserts };
}

const ORG = "org-1";
const FAIL = { data: null, error: { code: "57014", message: "timeout" } };

function lookupClient(statesFail: boolean, options: { ratesFail?: boolean; noRates?: boolean } = {}) {
  return fakeClient((table, columns) => {
    if (table === "beds24_price_jobs") return { data: { id: "job-1" }, error: null };
    if (table === "rooms" && columns.startsWith("id, properties")) {
      return { data: [{ id: "room-a", properties: { external_property_id: 100 } }], error: null };
    }
    if (table === "beds24_property_rates_state") {
      return statesFail ? FAIL : { data: [{ external_property_id: 100, last_full_read_at: "2026-11-25T00:00:00Z" }], error: null };
    }
    if (table === "rooms") {
      return {
        data: [
          {
            external_price_source_room_id: null,
            external_room_id: "5001",
            id: "room-a",
            preferred_min_stay_room_id: null,
            property_id: "prop-1",
          },
        ],
        error: null,
      };
    }
    if (table === "room_daily_rates") {
      if (options.ratesFail) return FAIL;
      if (options.noRates) return { data: [], error: null };
      return { data: [{ min_stay: 2, room_id: "room-a", stay_date: "2026-12-01", synced_at: "2026-11-25T01:00:00Z" }], error: null };
    }
    return { data: null, error: null };
  });
}

describe("loadUnitFullReadAtOrNull — 쓰기용", () => {
  it("상태 표를 못 읽으면 null — 「기준 없음」을 「유령 없음」으로 바꾸지 않는다", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await loadUnitFullReadAtOrNull(lookupClient(true).client, ORG)).toBeNull();
    errorSpy.mockRestore();
  });

  it("읽히면 유닛별 시각을 돌려준다", async () => {
    const map = await loadUnitFullReadAtOrNull(lookupClient(false).client, ORG);
    expect(map?.get("room-a")).toBe("2026-11-25T00:00:00Z");
  });
});

describe("loadUnitFullReadAt — 화면용(예전 동작 유지)", () => {
  it("못 읽으면 빈 맵", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const map = await loadUnitFullReadAt(lookupClient(true).client, ORG);
    expect(map.size).toBe(0);
    errorSpy.mockRestore();
  });
});

function enqueue(client: never) {
  return enqueueBeds24PriceJob({
    cells: [{ roomIds: ["room-a"], roomLabel: "A", stayDate: "2026-12-01", values: { m: 3 } }],
    jobType: "min_stay",
    organizationId: ORG,
    requestedBy: null,
    requestedByName: null,
    supabase: client,
  });
}

describe("enqueueBeds24PriceJob — 기준 시각을 못 읽으면", () => {
  it("enqueue_failed 로 멈추고 큐에 아무것도 넣지 않는다", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client, inserts } = lookupClient(true);
    expect(await enqueue(client)).toEqual({ error: "enqueue_failed", ok: false });
    expect(inserts).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith("[beds24/property-rates-state] full read lookup failed", { code: "57014" });
    errorSpy.mockRestore();
  });

  it("대조군 — 같은 입력에서 읽히면 큐에 넣는다", async () => {
    const { client, inserts } = lookupClient(false);
    expect(await enqueue(client)).toMatchObject({ jobId: "job-1", ok: true, targetRooms: 1 });
    expect(inserts).toEqual(["beds24_price_jobs"]);
  });
});

describe("readOpsRoomUnavailableNights — 기준 시각을 못 읽으면", () => {
  it("full_read_lookup_failed 로 던진다 — 「팔 수 있음」으로 넘어가지 않는다", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      readOpsRoomUnavailableNights({
        from: "2026-12-01",
        organizationId: ORG,
        roomIds: ["room-a"],
        roomKey: "any",
        supabase: lookupClient(true).client,
        toExclusive: "2026-12-03",
      }),
    ).rejects.toThrow("full_read_lookup_failed");
    errorSpy.mockRestore();
  });
});

describe("submitPriceChange — 기준가 읽기 실패와 빈 칸을 구분", () => {
  const cells = [{ currentPrice: 20000, date: "2030-12-01", roomIds: ["room-a"], roomKey: "row-a", roomLabel: "A" }];
  const input = { amount: 30000, kind: "amount" } as never;

  it("기준 시각 조회가 실패하면 enqueue_failed", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    serviceClient = lookupClient(true).client;
    expect(await submitPriceChange({ cells, input })).toEqual({ error: "enqueue_failed", ok: false });
    errorSpy.mockRestore();
  });

  it("요금 읽기가 실패해도 enqueue_failed", async () => {
    serviceClient = lookupClient(false, { ratesFail: true }).client;
    expect(await submitPriceChange({ cells, input })).toEqual({ error: "enqueue_failed", ok: false });
  });

  it("읽혔는데 가격이 없는 칸이면 그대로 no_priced_cells", async () => {
    serviceClient = lookupClient(false, { noRates: true }).client;
    expect(await submitPriceChange({ cells, input })).toEqual({ error: "no_priced_cells", ok: false });
  });
});
