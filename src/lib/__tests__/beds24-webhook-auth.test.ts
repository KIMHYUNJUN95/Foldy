import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Beds24 웹훅 수신 인증 — 2026-11-13 보안 점검.
 * 비밀값이 서버에 없으면 열린 채 받지 않는다(예전 fail-open: 누구나 가짜 예약을 upsert 할 수 있었다).
 * Beds24 가 쓰는 전달 방식(헤더 · Bearer · ?secret=)은 그대로 받는다.
 */
const state = vi.hoisted(() => ({ priceCalls: 0, bookingCalls: 0 }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => ({}) }));
vi.mock("@/lib/beds24/sync-control", () => ({ isBeds24SyncPaused: () => false }));
vi.mock("@/lib/beds24/webhook-forward", () => ({
  parseForwardTargets: () => [],
  forwardBeds24Delivery: async () => [],
}));
vi.mock("@/lib/beds24/webhook-events", () => ({
  recordBeds24WebhookEvent: async () => undefined,
  recordBeds24WebhookRejection: async () => undefined,
}));
vi.mock("@/lib/beds24/price-webhook", () => ({
  processBeds24PriceWebhook: async () => {
    state.priceCalls += 1;
    return { handled: false, reason: "test" };
  },
}));
vi.mock("@/lib/beds24/booking-payload", () => ({
  extractBeds24WebhookBookingCandidates: () => {
    state.bookingCalls += 1;
    return [];
  },
}));
vi.mock("@/lib/beds24/process-webhook-booking", () => ({ processBeds24WebhookBooking: async () => ({}) }));
vi.mock("@/lib/guest-messages/auto-scheduler", () => ({ planAutoMessagesAfterWebhook: async () => undefined }));
vi.mock("@/lib/guest-messages/media-copy-server", () => ({ copyPendingGuestMessageMedia: async () => undefined }));
vi.mock("@/lib/guest-messages/webhook-ingest", () => ({
  ingestBeds24WebhookMessages: async () => undefined,
  prepareCapturedMessagesPayload: () => null,
  shouldCaptureWebhookMessages: () => false,
}));

import { GET, POST } from "@/app/api/beds24/webhook/route";

const SECRET = "test-webhook-secret";
const URL_BASE = "http://localhost/api/beds24/webhook";

function get(query: string, headers: Record<string, string> = {}) {
  return new NextRequest(`${URL_BASE}?roomId=1&action=x${query}`, { method: "GET", headers });
}
function post(query = "", headers: Record<string, string> = {}) {
  return new NextRequest(`${URL_BASE}${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: "{}",
  });
}

const savedSecret = process.env.BEDS24_WEBHOOK_SECRET;
beforeEach(() => {
  state.priceCalls = 0;
  state.bookingCalls = 0;
  process.env.BEDS24_WEBHOOK_SECRET = SECRET;
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.BEDS24_WEBHOOK_SECRET;
  else process.env.BEDS24_WEBHOOK_SECRET = savedSecret;
});

describe("Beds24 웹훅 — 비밀값이 서버에 없으면 닫힌다", () => {
  it("POST: 비밀값 미설정이면 503, 본문을 처리하지 않는다", async () => {
    delete process.env.BEDS24_WEBHOOK_SECRET;
    const response = await POST(post("?secret=anything"));
    expect(response.status).toBe(503);
    expect(state.bookingCalls).toBe(0);
  });
  it("GET: 비밀값 미설정이면 503, 가격 배달을 처리하지 않는다", async () => {
    process.env.BEDS24_WEBHOOK_SECRET = "   ";
    const response = await GET(get("&secret=anything"));
    expect(response.status).toBe(503);
    expect(state.priceCalls).toBe(0);
  });
});

describe("Beds24 웹훅 — 틀린 값 · 없는 값은 403", () => {
  it("POST: 값 없음 403", async () => {
    expect((await POST(post())).status).toBe(403);
    expect(state.bookingCalls).toBe(0);
  });
  it("POST: 틀린 값 403", async () => {
    expect((await POST(post("?secret=wrong", { "x-beds24-webhook-secret": "wrong" }))).status).toBe(403);
  });
  it("GET: 틀린 값 403", async () => {
    expect((await GET(get("&secret=wrong"))).status).toBe(403);
    expect(state.priceCalls).toBe(0);
  });
});

describe("Beds24 웹훅 — 기존 전달 방식은 그대로 통과", () => {
  it("POST: ?secret= 쿼리", async () => {
    expect((await POST(post(`?secret=${SECRET}`))).status).toBe(200);
    expect(state.bookingCalls).toBe(1);
  });
  it("POST: x-beds24-webhook-secret 헤더", async () => {
    expect((await POST(post("", { "x-beds24-webhook-secret": SECRET }))).status).toBe(200);
  });
  it("POST: Authorization Bearer", async () => {
    expect((await POST(post("", { authorization: `Bearer ${SECRET}` }))).status).toBe(200);
  });
  it("GET: ?secret= 쿼리(가격 V1 배달)", async () => {
    expect((await GET(get(`&secret=${SECRET}`))).status).toBe(200);
    expect(state.priceCalls).toBe(1);
  });
});
