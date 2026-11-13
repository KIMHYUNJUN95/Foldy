import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Beds24 틱 인증 — 2026-11-13 보안 점검.
 * 웹훅 비밀값은 Beds24 웹훅 설정 화면에 보이므로 틱을 열지 않는다.
 * 받는 값: `CRON_SECRET`(Bearer) · pg_cron Vault 토큰(`beds24_tick_token_ok`).
 */
const state = vi.hoisted(() => ({ tokenOk: false, rpcCalls: [] as string[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: () => ({
    rpc: async (_fn: string, args: { p_token: string }) => {
      state.rpcCalls.push(args.p_token);
      return { data: state.tokenOk, error: null };
    },
  }),
}));
vi.mock("@/lib/beds24/sync-control", () => ({ isBeds24SyncPaused: () => false }));
// 인증을 지나면 곧바로 「busy」로 끝나게 해 작업 경로를 타지 않는다.
vi.mock("@/lib/beds24/sync-locks", () => ({
  acquireBeds24Lock: async () => ({ acquired: false, lockId: null, reason: "busy" }),
  releaseBeds24Lock: async () => undefined,
  getBeds24Cooldown: async () => null,
}));
vi.mock("@/lib/beds24/price-job-queue", () => ({ hasPendingPriceJobs: async () => false }));
vi.mock("@/lib/beds24/price-job-worker", () => ({ runNextPriceJob: async () => null }));
vi.mock("@/lib/beds24/price-webhook", () => ({
  priceWebhookRunLockName: () => "x",
  refreshBeds24Property: async () => ({}),
}));

import { POST } from "@/app/api/beds24/tick/route";

const CRON = "test-cron-secret";
const WEBHOOK = "test-webhook-secret";
const VAULT = "v".repeat(64);

const request = (headers: Record<string, string>) =>
  new NextRequest("http://localhost/api/beds24/tick", { method: "POST", headers });

const saved = { cron: process.env.CRON_SECRET, webhook: process.env.BEDS24_WEBHOOK_SECRET };
beforeEach(() => {
  process.env.CRON_SECRET = CRON;
  process.env.BEDS24_WEBHOOK_SECRET = WEBHOOK;
  state.tokenOk = false;
  state.rpcCalls = [];
});
afterEach(() => {
  for (const [key, value] of [
    ["CRON_SECRET", saved.cron],
    ["BEDS24_WEBHOOK_SECRET", saved.webhook],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Beds24 틱 — 웹훅 비밀값으로는 열리지 않는다", () => {
  it("Bearer 웹훅 비밀값 → 403", async () => {
    expect((await POST(request({ authorization: `Bearer ${WEBHOOK}` }))).status).toBe(403);
  });
  it("x-beds24-webhook-secret 헤더 → 403", async () => {
    expect((await POST(request({ "x-beds24-webhook-secret": WEBHOOK }))).status).toBe(403);
  });
  it("값 없음 · 틀린 값 → 403", async () => {
    expect((await POST(request({}))).status).toBe(403);
    expect((await POST(request({ authorization: "Bearer wrong" }))).status).toBe(403);
  });
});

describe("Beds24 틱 — CRON_SECRET · Vault 토큰은 통과", () => {
  it("Bearer CRON_SECRET → 통과(DB 에 묻지 않는다)", async () => {
    expect((await POST(request({ authorization: `Bearer ${CRON}` }))).status).toBe(200);
    expect(state.rpcCalls).toHaveLength(0);
  });
  it("Bearer Vault 토큰(pg_cron) → 통과", async () => {
    state.tokenOk = true;
    expect((await POST(request({ authorization: `Bearer ${VAULT}` }))).status).toBe(200);
    expect(state.rpcCalls).toEqual([VAULT]);
  });
});
