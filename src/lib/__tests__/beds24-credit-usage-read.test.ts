import { describe, expect, it, vi } from "vitest";
import { readBeds24Credits } from "@/lib/beds24/credits";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: () => {
    throw new Error("no env in tests");
  },
}));

import {
  BEDS24_CREDIT_WINDOW_MAX_ROWS,
  getBeds24CreditCalls,
  getBeds24CreditDetail,
  getBeds24CreditSummary,
} from "@/lib/beds24/credit-usage-read";

/**
 * 창 집계 RPC 는 PostgREST 1,000줄 상한에 걸린다 — 오래된 창부터 정렬돼 있어 잘리면
 * 가장 최근 창(지금 창)부터 사라진다. 끝까지 페이지로 읽는지, 상한이면 오류로 드러나는지.
 */

const NOW = 1_800_000_000_000;
const PAGE = 1000;

type Row = Record<string, unknown>;

function windowRow(i: number, over: Row = {}): Row {
  return {
    credential_key: "main",
    window_resets_at: new Date(NOW - 7 * 86_400_000 + i * 1000).toISOString(),
    window_min_remaining: 199,
    window_paused_at: null,
    actor_kind: "auto",
    actor_user_id: null,
    actor_name: null,
    actor_job: `job-${i}`,
    feature: "other",
    calls: 1,
    cost: 1,
    rate_limited: 0,
    first_at: new Date(NOW - 1000).toISOString(),
    last_at: new Date(NOW - 1000).toISOString(),
    ...over,
  };
}

function fakeClient(rows: Row[], page?: (from: number, to: number) => Row[]) {
  const ranges: Array<[number, number]> = [];
  const orders: Array<Array<[string, unknown]>> = [];
  const rpc = () => {
    const calls: Array<[string, unknown]> = [];
    orders.push(calls);
    const builder = {
      order(column: string, options: unknown) {
        calls.push([column, options]);
        return builder;
      },
      range(from: number, to: number) {
        ranges.push([from, to]);
        const data = page ? page(from, to) : rows.slice(from, Math.min(to + 1, from + PAGE));
        return Promise.resolve({ data, error: null });
      },
    };
    return builder;
  };
  const table = () => {
    const chain: Record<string, unknown> = {};
    for (const key of ["select", "eq", "or", "gte", "order", "limit"]) chain[key] = () => chain;
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
    return chain;
  };
  return { client: { rpc, from: table } as never, ranges, orders };
}

describe("크레딧 창 집계 — 1,000줄 넘어도 끝까지 읽는다", () => {
  it("2,500줄이면 세 장을 읽고 마지막(가장 최근) 줄까지 센다", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => windowRow(i));
    rows.push(windowRow(2500, { window_resets_at: new Date(NOW + 60_000).toISOString(), cost: 7, calls: 7, window_min_remaining: 150, actor_job: "latest" }));
    const { client, ranges } = fakeClient(rows);
    const summary = await getBeds24CreditSummary("org-1", { supabase: client, nowMs: NOW });
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(summary.windowUsed).toBe(50);
    expect(summary.actors.find((actor) => actor.kind === "auto")?.credits).toBe(7);
  });

  it("오늘 합계 — 잘리던 줄까지 다 더한다", async () => {
    const rows = Array.from({ length: 1500 }, (_, i) =>
      windowRow(i, { window_resets_at: null, first_at: new Date(NOW - 60_000).toISOString(), last_at: new Date(NOW - 60_000).toISOString() }),
    );
    const { client } = fakeClient(rows);
    const detail = await getBeds24CreditDetail("org-1", "today", { supabase: client, nowMs: NOW });
    expect(detail.total).toBe(1500);
  });

  it("페이지마다 함수 안 정렬과 같은 순서(group by 키 전부)를 건다", async () => {
    const { client, orders } = fakeClient([windowRow(0)]);
    await getBeds24CreditSummary("org-1", { supabase: client, nowMs: NOW });
    expect(orders).toEqual([
      [
        ["window_resets_at", { ascending: true, nullsFirst: false }],
        ["actor_kind", { ascending: true }],
        ["actor_user_id", { ascending: true, nullsFirst: false }],
        ["actor_job", { ascending: true, nullsFirst: false }],
        ["feature", { ascending: true }],
      ],
    ]);
  });

  it("두 장에 겹쳐 온 같은 키 줄은 한 번만 — 뒤 장 값을 쓴다", async () => {
    const loose = (i: number, over: Row = {}) =>
      windowRow(i, { window_resets_at: null, first_at: new Date(NOW - 60_000).toISOString(), last_at: new Date(NOW - 60_000).toISOString(), ...over });
    const first = Array.from({ length: PAGE }, (_, i) => loose(i));
    const second = [loose(PAGE - 1, { cost: 3, calls: 3 }), ...Array.from({ length: 500 }, (_, i) => loose(PAGE + i))];
    const { client } = fakeClient([], (from) => (from === 0 ? first : from === PAGE ? second : []));
    const detail = await getBeds24CreditDetail("org-1", "today", { supabase: client, nowMs: NOW });
    expect(detail.total).toBe(PAGE - 1 + 3 + 500);
  });

  it("범위 끝은 읽기 시각 그대로(+60초 없음) — 모든 장이 같은 범위", async () => {
    const seen: unknown[] = [];
    const rows = Array.from({ length: PAGE + 1 }, (_, i) => windowRow(i));
    const { client } = fakeClient(rows);
    const rpc = (client as unknown as { rpc: (name: string, args: unknown) => unknown }).rpc;
    const spy = { ...(client as object), rpc: (name: string, args: unknown) => (seen.push(args), rpc(name, args)) };
    await getBeds24CreditSummary("org-1", { supabase: spy as never, nowMs: NOW });
    expect(seen).toHaveLength(2);
    for (const args of seen) expect(args).toMatchObject({ p_to: new Date(NOW).toISOString() });
  });

  it("읽는 도중 새 줄이 들어와 지금 창 키가 커져도 창 하나로 합친다", async () => {
    // 1장: 지금 창 키 = NOW+60s, 2장(새로 집계): 늦게 들어온 줄로 같은 창 키가 NOW+61s 가 됐다.
    const oldKey = new Date(NOW + 60_000).toISOString();
    const newKey = new Date(NOW + 61_000).toISOString();
    const filler = Array.from({ length: PAGE - 1 }, (_, i) => windowRow(i));
    const first = [...filler, windowRow(9001, { window_resets_at: oldKey, actor_job: "a", cost: 4, calls: 4, window_min_remaining: 190 })];
    const second = [
      windowRow(9001, { window_resets_at: newKey, actor_job: "a", cost: 5, calls: 5, window_min_remaining: 180 }),
      windowRow(9002, { window_resets_at: newKey, actor_job: "b", cost: 2, calls: 2, window_min_remaining: 180 }),
    ];
    const { client } = fakeClient([], (from) => (from === 0 ? first : from === PAGE ? second : []));
    const detail = await getBeds24CreditDetail("org-1", "1h", { supabase: client, nowMs: NOW });
    // 창 하나: 쓴 양 = 200 − 180 = 20, 우리 몫 = a 5(뒤 장) + b 2, 밖 = 13. 갈라지면 창 둘(10 + 20)로 부푼다.
    expect(detail.total).toBe(20);
    expect(detail.actors.find((actor) => actor.kind === "auto")?.credits).toBe(7);
    expect(detail.actors.find((actor) => actor.kind === "outside")?.credits).toBe(13);
  });

  it("정확히 상한 줄이면 오류 없이 끝난다", async () => {
    const rows = Array.from({ length: BEDS24_CREDIT_WINDOW_MAX_ROWS }, (_, i) => windowRow(i));
    const { client, ranges } = fakeClient(rows);
    await expect(getBeds24CreditSummary("org-1", { supabase: client, nowMs: NOW })).resolves.toBeTruthy();
    expect(ranges.at(-1)).toEqual([BEDS24_CREDIT_WINDOW_MAX_ROWS, BEDS24_CREDIT_WINDOW_MAX_ROWS]);
  }, 30_000); // 5만 줄 — 전체 실행이 바쁠 때 기본 5초를 넘긴 적이 있다

  it("상한에 닿으면 조용히 자르지 않고 오류", async () => {
    const rows = Array.from({ length: BEDS24_CREDIT_WINDOW_MAX_ROWS + 1 }, (_, i) => windowRow(i));
    const { client } = fakeClient(rows);
    await expect(getBeds24CreditSummary("org-1", { supabase: client, nowMs: NOW })).rejects.toThrow(/beds24_credit_usage_windows/);
  }, 30_000);
});

describe("readBeds24Credits — 빈 헤더는 값이 없다", () => {
  it.each(["", "   "])("%j 는 null (0 아님)", (value) => {
    const info = readBeds24Credits(
      new Headers({ "x-request-cost": value, "x-five-min-limit-remaining": value, "x-five-min-limit-resets-in": value }),
    );
    expect(info).toEqual({ requestCost: null, remaining: null, resetsIn: null });
  });

  it("새 이름이 비었으면 옛 이름 값을 읽는다", () => {
    expect(readBeds24Credits(new Headers({ "x-five-min-limit-remaining": "", "X-FiveMinCreditLimit-Remaining": "12" })).remaining).toBe(12);
  });

  it("진짜 0 은 0", () => {
    expect(readBeds24Credits(new Headers({ "x-five-min-limit-remaining": "0" })).remaining).toBe(0);
  });
});

describe("최근 호출 한 장 — 기간 · 거르기 · 커서", () => {
  function callClient(rows: Row[]) {
    const log: Array<[string, ...unknown[]]> = [];
    const chain: Record<string, unknown> = {};
    for (const key of ["select", "eq", "or", "gte", "is", "order", "limit"]) {
      chain[key] = (...args: unknown[]) => {
        log.push([key, ...args]);
        return chain;
      };
    }
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
    return { client: { from: () => chain } as never, log };
  }
  const row = (id: number): Row => ({
    id,
    called_at: new Date(NOW - id * 1000).toISOString(),
    actor_kind: "user",
    actor_user_id: "11111111-2222-3333-4444-555555555555",
    actor_name: "Kim",
    actor_job: null,
    feature: "guest_messages",
    action: "messages.get",
    item_count: null,
    cost: 1,
    remaining: 150,
    http_status: 200,
  });

  it("51줄 물어 50줄만 · 뒤에 더 있음, (called_at, id) 새 것부터, 기간 시작부터", async () => {
    const { client, log } = callClient(Array.from({ length: 51 }, (_, i) => row(i + 1)));
    const result = await getBeds24CreditCalls("org-1", { range: "1h" }, { supabase: client, nowMs: NOW });
    expect(result.calls).toHaveLength(50);
    expect(result.hasMore).toBe(true);
    expect(result.since).toBe(NOW - 3_600_000);
    expect(result.calls[0]).toMatchObject({ id: "1", calledAt: new Date(NOW - 1000).toISOString(), actor: { userId: "11111111-2222-3333-4444-555555555555" } });
    expect(log).toContainEqual(["limit", 51]);
    expect(log.filter(([k]) => k === "order")).toEqual([
      ["order", "called_at", { ascending: false }],
      ["order", "id", { ascending: false }],
    ]);
    expect(log).toContainEqual(["gte", "called_at", new Date(NOW - 3_600_000).toISOString()]);
    expect(log).toContainEqual(["or", "and(or(organization_id.eq.org-1,organization_id.is.null))"]);
  });

  it("커서 — 같은 시각은 id 로 잇는 조건을 조직 조건과 한 묶음으로", async () => {
    const { client, log } = callClient([row(1)]);
    const result = await getBeds24CreditCalls(
      "org-1",
      { range: "7d", cursor: { calledAt: "2026-11-18T08:02:08.049123+00:00", id: "462" } },
      { supabase: client, nowMs: NOW },
    );
    expect(result.hasMore).toBe(false);
    expect(log).toContainEqual([
      "or",
      'and(or(organization_id.eq.org-1,organization_id.is.null),or(called_at.lt."2026-11-18T08:02:08.049123+00:00",and(called_at.eq."2026-11-18T08:02:08.049123+00:00",id.lt.462)))',
    ]);
  });

  it("거르기 — 사람은 사용자 id, 자동 작업은 사람 id 없는 줄, 기능은 기능", async () => {
    const user = callClient([]);
    await getBeds24CreditCalls(
      "org-1",
      { range: "today", filter: { actor: "user:11111111-2222-3333-4444-555555555555", feature: "rates_write" } },
      { supabase: user.client, nowMs: NOW },
    );
    expect(user.log).toContainEqual(["eq", "actor_user_id", "11111111-2222-3333-4444-555555555555"]);
    expect(user.log).toContainEqual(["eq", "feature", "rates_write"]);
    const auto = callClient([]);
    await getBeds24CreditCalls("org-1", { range: "today", filter: { actor: "auto", feature: null } }, { supabase: auto.client, nowMs: NOW });
    expect(auto.log).toContainEqual(["is", "actor_user_id", null]);
    expect(auto.log.some(([k, col]) => k === "eq" && col === "feature")).toBe(false);
  });

  it("모양이 틀린 커서는 필터 글자에 넣지 않고 던진다", async () => {
    const { client } = callClient([]);
    await expect(
      getBeds24CreditCalls("org-1", { range: "today", cursor: { calledAt: 'x",id.gt.0', id: "1" } }, { supabase: client, nowMs: NOW }),
    ).rejects.toThrow(/cursor/);
  });

  it("상세의 최근 호출도 같은 한 장(50개 · 뒤에 더 있음)", async () => {
    const { client } = fakeClient([windowRow(0)]);
    const detail = await getBeds24CreditDetail("org-1", "today", { supabase: client, nowMs: NOW });
    expect(detail.recentCalls).toMatchObject({ calls: [], hasMore: false });
  });
});
