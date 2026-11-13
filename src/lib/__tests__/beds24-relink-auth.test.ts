import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 리뷰 객실 재연결(일회성 수동 라우트) 인증 — 2026-11-13 보안 점검.
 * 정기 호출자가 없어 웹훅 비밀값을 끊었다. 받는 값은 `CRON_SECRET`(Bearer) 하나.
 */
const state = vi.hoisted(() => ({ relinkCalls: 0 }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => ({}) }));
vi.mock("@/lib/beds24/review-room-relink", () => ({
  relinkReviewRooms: async () => {
    state.relinkCalls += 1;
    return {};
  },
}));

import { POST } from "@/app/api/beds24/reviews-sync/relink/route";

const CRON = "test-cron-secret";
const WEBHOOK = "test-webhook-secret";
const ORG = "00000000-0000-4000-8000-000000000900";
const request = (headers: Record<string, string>) =>
  new NextRequest(`http://localhost/api/beds24/reviews-sync/relink?organizationId=${ORG}&skipLookup=1`, {
    method: "POST",
    headers,
  });

const saved = { cron: process.env.CRON_SECRET, webhook: process.env.BEDS24_WEBHOOK_SECRET };
beforeEach(() => {
  process.env.CRON_SECRET = CRON;
  process.env.BEDS24_WEBHOOK_SECRET = WEBHOOK;
  state.relinkCalls = 0;
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

describe("리뷰 재연결 — 인증", () => {
  it("웹훅 비밀값(헤더 · Bearer) → 403", async () => {
    expect((await POST(request({ "x-beds24-webhook-secret": WEBHOOK }))).status).toBe(403);
    expect((await POST(request({ authorization: `Bearer ${WEBHOOK}` }))).status).toBe(403);
    expect(state.relinkCalls).toBe(0);
  });
  it("CRON_SECRET 미설정이면 웹훅 비밀값이 있어도 404", async () => {
    delete process.env.CRON_SECRET;
    expect((await POST(request({ "x-beds24-webhook-secret": WEBHOOK }))).status).toBe(404);
  });
  it("Bearer CRON_SECRET → 통과", async () => {
    expect((await POST(request({ authorization: `Bearer ${CRON}` }))).status).toBe(200);
    expect(state.relinkCalls).toBe(1);
  });
});
