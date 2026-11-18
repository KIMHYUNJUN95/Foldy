import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beds24Fetch,
  BEDS24_ACCOUNT_CREDIT_WAIT_MS,
  BEDS24_CREDIT_WRITE_TIMEOUT_MS,
  buildBeds24CreditUsageRow,
  resolveBeds24CreditContext,
  updateBeds24CreditScope,
  userCreditActor,
  withBeds24CreditScope,
} from "@/lib/beds24/credit-ledger";
import type { Beds24CreditCallContext } from "@/lib/beds24/credit-usage-types";

const service = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: () => {
    if (!service.client) throw new Error("no env in tests");
    return service.client;
  },
}));
// request = 지금 「요청」 이름(요청 안 — 그 요청의 after 목록에 모은다), null 이면 요청 밖(던진다).
const afterState = vi.hoisted(() => ({
  request: null as string | null,
  byRequest: {} as Record<string, Array<() => unknown>>,
}));
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    if (!afterState.request) throw new Error("outside request scope");
    (afterState.byRequest[afterState.request] ??= []).push(fn);
  },
}));

function resetAfter() {
  afterState.request = null;
  afterState.byRequest = {};
}

const NOW = Date.parse("2026-11-18T03:00:00.000Z");
const ctx: Beds24CreditCallContext = {
  organizationId: "org-1",
  feature: "rates_write",
  actor: { kind: "user", userId: "u-1", name: "김" },
  action: "calendar.post",
  itemCount: 6,
};

function creditHeaders() {
  return new Headers({
    "x-request-cost": "3",
    "x-five-min-limit-remaining": "142",
    "x-five-min-limit-resets-in": "120",
  });
}

function withAbort<T>(promise: Promise<T>) {
  return Object.assign(promise, { abortSignal: () => promise });
}

function fakeClient(
  opts: { insertError?: string; insertErrorCode?: string; insertThrows?: boolean } = {},
) {
  const inserts: unknown[] = [];
  const upserts: unknown[] = [];
  const rpcs: unknown[] = [];
  const client = {
    rpc: (name: string, args: unknown) => {
      rpcs.push({ name, args });
      return withAbort(Promise.resolve({ error: null }));
    },
    from: (table: string) => ({
      insert: (row: unknown) => {
        if (opts.insertThrows) throw new Error("boom");
        inserts.push({ table, row });
        const failFk = opts.insertErrorCode === "23503" && (row as { actor_user_id: unknown }).actor_user_id !== null;
        if (failFk) return withAbort(Promise.resolve({ error: { message: "fk", code: "23503" } }));
        return withAbort(Promise.resolve({ error: opts.insertError ? { message: opts.insertError } : null }));
      },
      upsert: (row: unknown) => {
        upserts.push({ table, row });
        return Promise.resolve({ error: null });
      },
    }),
  };
  return { client: client as never, inserts, upserts, rpcs };
}

describe("buildBeds24CreditUsageRow", () => {
  it("헤더 → 비용 · 남은 값 · 리셋 시각", () => {
    const row = buildBeds24CreditUsageRow(ctx, { status: 200, headers: creditHeaders() }, NOW);
    expect(row).toMatchObject({
      organization_id: "org-1",
      credential_key: "main",
      feature: "rates_write",
      action: "calendar.post",
      item_count: 6,
      actor_kind: "user",
      actor_user_id: "u-1",
      actor_name: "김",
      actor_job: null,
      cost: 3,
      remaining: 142,
      resets_at: new Date(NOW + 120_000).toISOString(),
      http_status: 200,
    });
  });

  it("헤더가 없으면 비용 · 남은 값 · 리셋은 null, 상태 코드는 남긴다", () => {
    const row = buildBeds24CreditUsageRow(ctx, { status: 500, headers: new Headers() }, NOW);
    expect(row.cost).toBeNull();
    expect(row.remaining).toBeNull();
    expect(row.resets_at).toBeNull();
    expect(row.http_status).toBe(500);
  });

  it("네트워크 오류(응답 없음)는 상태 코드도 null", () => {
    const row = buildBeds24CreditUsageRow({ ...ctx, actor: { kind: "auto", job: "rates_sync" } }, null, NOW);
    expect(row.http_status).toBeNull();
    expect(row.actor_kind).toBe("auto");
    expect(row.actor_job).toBe("rates_sync");
    expect(row.actor_user_id).toBeNull();
  });

  it("다른 토큰 키는 그대로 남긴다", () => {
    const row = buildBeds24CreditUsageRow({ ...ctx, credentialKey: "messages" }, null, NOW);
    expect(row.credential_key).toBe("messages");
  });
});

describe("beds24Fetch → 기록", () => {
  const call = (hint = {}) =>
    beds24Fetch("https://api.beds24.com/v2/inventory/rooms/calendar", { method: "POST" }, hint, (async () =>
      new Response("{}", { status: 200, headers: creditHeaders() })) as never);
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it("한 줄 기록 + 계정 마지막 값은 DB 함수로", async () => {
    const { client, inserts, rpcs } = fakeClient();
    service.client = client;
    try {
      await call();
      await settle();
      expect(inserts).toHaveLength(1);
      expect(rpcs).toHaveLength(1);
      expect(rpcs[0]).toMatchObject({ name: "beds24_record_account_credit" });
    } finally {
      service.client = null;
    }
  });

  it("main 이 아닌 토큰은 계정 마지막 값을 건드리지 않는다", async () => {
    const { client, inserts, upserts, rpcs } = fakeClient();
    service.client = client;
    try {
      await call({ credentialKey: "messages" });
      await settle();
      expect(inserts).toHaveLength(1);
      expect(upserts).toHaveLength(0);
      expect(rpcs).toHaveLength(0);
    } finally {
      service.client = null;
    }
  });

  it("기록이 실패해도 던지지 않고 응답을 돌려준다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      service.client = fakeClient({ insertThrows: true }).client;
      await expect(call()).resolves.toBeInstanceOf(Response);
      service.client = fakeClient({ insertError: "denied" }).client;
      await expect(call()).resolves.toBeInstanceOf(Response);
      await settle();
    } finally {
      service.client = null;
      spy.mockRestore();
    }
  });

  it("서비스 클라이언트를 못 만들면 조용히 건너뛴다", async () => {
    service.client = null;
    await expect(call()).resolves.toBeInstanceOf(Response);
  });
});

/** supabase-js 처럼 `.abortSignal()` 을 받는 가짜. hang 이면 중단 신호가 올 때까지 끝나지 않는다. */
const seenSignals: AbortSignal[] = [];

function abortable(hang: boolean, onStart: () => void) {
  let signal: AbortSignal | undefined;
  const builder = {
    abortSignal(next: AbortSignal) {
      signal = next;
      seenSignals.push(next);
      return builder;
    },
    then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) {
      onStart();
      const run = new Promise((done) => {
        if (!hang) return done({ error: null });
        signal?.addEventListener("abort", () => done({ error: { message: "aborted" } }));
      });
      return run.then(resolve, reject);
    },
  };
  return builder;
}

function hangingClient(opts: { hangInsert?: boolean; hangRpc?: boolean } = {}) {
  const inserts: unknown[] = [];
  const rpcs: unknown[] = [];
  const client = {
    rpc: (_name: string, args: unknown) => abortable(Boolean(opts.hangRpc), () => rpcs.push(args)),
    from: () => ({ insert: (row: unknown) => abortable(Boolean(opts.hangInsert), () => inserts.push(row)) }),
  };
  return { client: client as never, inserts, rpcs };
}

const ok = () => new Response("{}", { status: 200, headers: creditHeaders() });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("beds24Fetch", () => {
  it("응답을 그대로 돌려준다", async () => {
    const response = new Response("{}", { status: 429, headers: creditHeaders() });
    const fetchImpl = vi.fn(async () => response);
    const got = await beds24Fetch("https://api.beds24.com/v2/inventory/rooms/calendar", { method: "POST" }, {}, fetchImpl as never);
    expect(got).toBe(response);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("네트워크 오류는 그대로 던진다", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("network");
    });
    await expect(beds24Fetch("https://api.beds24.com/v2/bookings", {}, {}, fetchImpl as never)).rejects.toThrow("network");
  });

  it("사용 줄 insert 는 기다리지 않는다 — 끝나지 않는 insert 여도 응답은 바로", async () => {
    const db = hangingClient({ hangInsert: true });
    service.client = db.client;
    try {
      const response = ok();
      const got = await Promise.race([
        beds24Fetch("https://api.beds24.com/v2/bookings", { method: "POST" }, {}, (async () => response) as never),
        new Promise((resolve) => setTimeout(() => resolve("timeout"), 200)),
      ]);
      expect(got).toBe(response);
      await tick();
      expect(db.inserts).toContainEqual(expect.objectContaining({ action: "bookings.post" }));
    } finally {
      service.client = null;
    }
  });

  it("FK 에 막히면 사람 id 만 비우고 한 번 더 — 이름은 남는다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, inserts } = fakeClient({ insertErrorCode: "23503" });
    service.client = client;
    try {
      await withBeds24CreditScope({ actor: { kind: "user", userId: "gone", name: "박" } }, () =>
        beds24Fetch("https://api.beds24.com/v2/bookings", {}, {}, (async () => new Response("{}", { status: 500 })) as never),
      );
      await tick();
      await tick();
      expect(inserts).toHaveLength(2);
      expect((inserts[1] as { row: unknown }).row).toEqual(
        expect.objectContaining({ actor_user_id: null, actor_name: "박", actor_kind: "user" }),
      );
    } finally {
      service.client = null;
      spy.mockRestore();
    }
  });
});

describe("beds24Fetch — DB 가 멈췄을 때 · 요청마다 after", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAfter();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetAfter();
    service.client = null;
  });

  it("insert · RPC 가 끝나지 않아도 (a) 결과는 상한 뒤 돌아오고 (b) 다음 호출 기록은 안 막히며 (c) after 작업은 시한 안에 끝난다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = hangingClient({ hangInsert: true, hangRpc: true });
    service.client = db.client;
    afterState.request = "req-1";
    seenSignals.length = 0;
    try {
      const first = ok();
      const firstCall = beds24Fetch("https://api.beds24.com/v2/bookings", { method: "POST" }, {}, (async () => first) as never);
      await vi.advanceTimersByTimeAsync(BEDS24_ACCOUNT_CREDIT_WAIT_MS);
      await expect(firstCall).resolves.toBe(first);

      const second = ok();
      const secondCall = beds24Fetch("https://api.beds24.com/v2/inventory/rooms/calendar", {}, {}, (async () => second) as never);
      await vi.advanceTimersByTimeAsync(0);
      // 앞 호출의 멈춘 쓰기와 상관없이 바로 시작한다(앱 안에 줄이 없다).
      expect(db.inserts).toHaveLength(2);
      expect(db.rpcs).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(BEDS24_ACCOUNT_CREDIT_WAIT_MS);
      await expect(secondCall).resolves.toBe(second);

      const tasks = (afterState.byRequest["req-1"] ?? []).map((fn) => fn());
      expect(tasks).toHaveLength(4); // 호출마다 사용 줄 + 계정 값
      let settled = false;
      void Promise.all(tasks).then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(BEDS24_CREDIT_WRITE_TIMEOUT_MS);
      expect(settled).toBe(true);
      // 시한을 넘기면 RPC · insert 에 넘긴 신호가 실제로 끊긴다.
      expect(seenSignals).toHaveLength(4);
      expect(seenSignals.every((signal) => signal.aborted)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("서로 다른 두 요청은 각자 자기 after 로 쓴다", async () => {
    const db = hangingClient();
    service.client = db.client;
    afterState.request = "worker";
    await beds24Fetch("https://api.beds24.com/v2/inventory/rooms/calendar", { method: "POST" }, {}, (async () => ok()) as never);
    afterState.request = "person";
    await beds24Fetch("https://api.beds24.com/v2/bookings", { method: "POST" }, {}, (async () => ok()) as never);
    expect(afterState.byRequest.worker).toHaveLength(2);
    expect(afterState.byRequest.person).toHaveLength(2);
  });

  it("계정 값이 빨리 쓰이면 상한까지 기다리지 않는다", async () => {
    const db = hangingClient();
    service.client = db.client;
    afterState.request = "req";
    const response = ok();
    const call = beds24Fetch("https://api.beds24.com/v2/bookings", { method: "POST" }, {}, (async () => response) as never);
    await vi.advanceTimersByTimeAsync(0);
    await expect(call).resolves.toBe(response);
    expect(db.rpcs).toHaveLength(1);
  });
});

describe("resolveBeds24CreditContext — 누가 · 어디에", () => {
  it("범위 밖은 자동 + 호출 지점 job, 기능은 URL 로 짐작", () => {
    const c = resolveBeds24CreditContext("https://api.beds24.com/v2/inventory/rooms/calendar", "POST", { job: "rates_sync" });
    expect(c.actor).toEqual({ kind: "auto", job: "rates_sync" });
    expect(c.feature).toBe("rates_write");
    expect(c.action).toBe("calendar.post");
    expect(c.credentialKey).toBe("main");
  });

  it("사람 범위 안에서는 토큰 갱신도 그 사람 몫, 기능은 범위가 이긴다", async () => {
    await withBeds24CreditScope({ actor: userCreditActor({ id: "u-9", name: "박" }), organizationId: "org-2", feature: "block_write" }, async () => {
      const c = resolveBeds24CreditContext("https://api.beds24.com/v2/inventory/rooms/calendar", "POST", { job: "booking" });
      expect(c.actor).toEqual({ kind: "user", userId: "u-9", name: "박" });
      expect(c.organizationId).toBe("org-2");
      expect(c.feature).toBe("block_write");
    });
  });

  it("자동 범위의 job 이 호출 지점 job 보다 이긴다(요금 작업 크론 · 손님 메시지 보내기)", async () => {
    await withBeds24CreditScope({ actor: { kind: "auto", job: "price_job" } }, async () => {
      const c = resolveBeds24CreditContext("https://x/inventory/rooms/calendar", "POST", { job: "calendar" });
      expect(c.actor).toEqual({ kind: "auto", job: "price_job" });
    });
    expect(resolveBeds24CreditContext("https://x/inventory/rooms/calendar", "POST", { job: "calendar" }).actor).toEqual({
      kind: "auto",
      job: "calendar",
    });
  });

  it("호출 지점 힌트가 범위보다 이긴다(기능 · 조직)", async () => {
    await withBeds24CreditScope({ feature: "rates_write", organizationId: "org-a" }, async () => {
      const c = resolveBeds24CreditContext("https://x/authentication/token", "GET", { feature: "auth", organizationId: "org-b" });
      expect(c.feature).toBe("auth");
      expect(c.organizationId).toBe("org-b");
    });
  });

  it("집은 뒤 채운 요청자가 이후 호출에 보인다", async () => {
    await withBeds24CreditScope({ actor: { kind: "auto", job: "price_job" } }, async () => {
      expect(resolveBeds24CreditContext("https://x/inventory/rooms/calendar", "POST").actor).toEqual({ kind: "auto", job: "price_job" });
      updateBeds24CreditScope({ actor: userCreditActor({ id: "u-3", name: null }), organizationId: "org-3" });
      const c = resolveBeds24CreditContext("https://x/inventory/rooms/calendar", "POST");
      expect(c.actor).toEqual({ kind: "user", userId: "u-3", name: "" });
      expect(c.organizationId).toBe("org-3");
    });
  });
});
