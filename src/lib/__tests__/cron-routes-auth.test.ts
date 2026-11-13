import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 정기 실행 라우트 인증 — 2026-11-13 보안 점검.
 * `BEDS24_WEBHOOK_SECRET` 은 Beds24 웹훅 설정 화면에 보이는 값이라 크론 · 작업 라우트를 열지 않는다.
 * 받는 값은 `CRON_SECRET`(`Authorization: Bearer`) 하나. 인증을 지나면 서비스 클라이언트를 만들므로
 * 그 호출 수(`reached`)로 「통과했다」를 본다(만든 순간 멈추게 해 실제 작업은 돌지 않는다).
 */
const state = vi.hoisted(() => ({ reached: 0 }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/beds24/sync-control", () => ({ isBeds24SyncPaused: () => false }));
vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: () => {
    state.reached += 1;
    throw new Error("stop-after-auth");
  },
}));

import * as reconcile from "@/app/api/beds24/reconcile/route";
import * as reviewsSync from "@/app/api/beds24/reviews-sync/route";
import * as reviewsHealth from "@/app/api/beds24/reviews-sync/health/route";
import * as ratesSync from "@/app/api/beds24/rates-sync/route";
import * as priceWorker from "@/app/api/beds24/price-jobs/worker/route";
import * as recruitSync from "@/app/api/recruit/sync/route";

const CRON = "test-cron-secret";
const WEBHOOK = "test-webhook-secret";

type Handler = (request: NextRequest) => Promise<Response>;
const routes: Array<{ name: string; path: string; post: Handler }> = [
  { name: "reconcile", path: "/api/beds24/reconcile", post: reconcile.POST },
  { name: "reviews-sync", path: "/api/beds24/reviews-sync", post: reviewsSync.POST },
  { name: "reviews-sync/health", path: "/api/beds24/reviews-sync/health", post: reviewsHealth.POST },
  { name: "rates-sync", path: "/api/beds24/rates-sync", post: ratesSync.POST },
  { name: "price-jobs/worker", path: "/api/beds24/price-jobs/worker", post: priceWorker.POST },
  { name: "recruit/sync full", path: "/api/recruit/sync?mode=full", post: recruitSync.POST },
];

function request(path: string, headers: Record<string, string> = {}, extraQuery = "") {
  const sep = path.includes("?") ? "&" : "?";
  return new NextRequest(`http://localhost${path}${extraQuery ? sep + extraQuery : ""}`, { method: "POST", headers });
}

/** 인증을 지나면 서비스 클라이언트에서 멈춘다 — 응답(500) 이든 throw 든 status 만 본다. */
async function call(post: Handler, req: NextRequest): Promise<number | "threw"> {
  try {
    return (await post(req)).status;
  } catch {
    return "threw";
  }
}

const saved = { cron: process.env.CRON_SECRET, webhook: process.env.BEDS24_WEBHOOK_SECRET };
beforeEach(() => {
  process.env.CRON_SECRET = CRON;
  process.env.BEDS24_WEBHOOK_SECRET = WEBHOOK;
  state.reached = 0;
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

describe.each(routes)("$name — 웹훅 비밀값으로는 열리지 않는다", ({ path, post }) => {
  it("x-beds24-webhook-secret 헤더 → 403", async () => {
    expect(await call(post, request(path, { "x-beds24-webhook-secret": WEBHOOK }))).toBe(403);
    expect(state.reached).toBe(0);
  });
  it("Bearer 웹훅 비밀값 → 403", async () => {
    expect(await call(post, request(path, { authorization: `Bearer ${WEBHOOK}` }))).toBe(403);
    expect(state.reached).toBe(0);
  });
  it("?secret= 웹훅 비밀값 → 403", async () => {
    expect(await call(post, request(path, {}, `secret=${WEBHOOK}`))).toBe(403);
    expect(state.reached).toBe(0);
  });
  it("?secret= 에 CRON_SECRET 을 실어도 거절(쿼리는 안 받음)", async () => {
    expect(await call(post, request(path, {}, `secret=${CRON}`))).toBe(403);
    expect(state.reached).toBe(0);
  });
  it("Bearer CRON_SECRET → 통과", async () => {
    const status = await call(post, request(path, { authorization: `Bearer ${CRON}` }));
    expect(status).not.toBe(403);
    expect(status).not.toBe(404);
    expect(state.reached).toBeGreaterThan(0);
  });
});

describe.each(routes.filter((r) => r.name !== "recruit/sync full"))(
  "$name — CRON_SECRET 이 없으면 웹훅 비밀값이 있어도 404",
  ({ path, post }) => {
    it("404", async () => {
      delete process.env.CRON_SECRET;
      expect(await call(post, request(path, { "x-beds24-webhook-secret": WEBHOOK }))).toBe(404);
      expect(state.reached).toBe(0);
    });
  },
);
