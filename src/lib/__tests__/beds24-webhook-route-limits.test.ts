import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Beds24 예약 웹훅 라우트의 상한 · 전달 범위 (2026-11-26 보안 점검).
 * - 실패 배치 원문도 거절 배달과 같은 20,000자 상한.
 * - 한 배달의 예약 수 상한(`BEDS24_WEBHOOK_MAX_BOOKINGS`) — 넘는 것은 처리하지 않고 실패로 남긴다(정합 작업이 복구).
 * - `BEDS24_PRICE_WEBHOOK_FORWARD_URL` 은 가격 배달만 넘긴다 — 예약 본문(손님 전화 · 메일 · 주소)은 절대 아니다.
 * - 낡은 배달은 처리기에 가지 않는다.
 * - 확인 못 함(`verify_unavailable`) · 없는 예약 취소는 적용하되 자동 안내 계획에서 뺀다.
 * - 처리 시간 예산(`BOOKING_LOOP_BUDGET_MS`)을 넘기면 남은 예약은 `over_delivery_cap`.
 */
const state = vi.hoisted(() => ({
  bookings: [] as Array<Record<string, unknown>>,
  processed: [] as Array<Record<string, unknown>>,
  unverifiedAts: [] as Array<string | null | undefined>,
  forwarded: 0,
  events: [] as Array<{ rawBody?: unknown; results: Array<{ mode: string }> }>,
  guard: (payload: Record<string, unknown>) => ({ kind: "apply", payload, verified: null }) as Record<string, unknown>,
  processResult: { ok: false, mode: "upsert_failed", sourceReservationId: "x" } as Record<string, unknown>,
  planned: [] as Array<Array<{ sourceReservationId?: unknown }>>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (task: () => unknown) => void Promise.resolve().then(task) };
});
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => ({}) }));
vi.mock("@/lib/beds24/sync-control", () => ({ isBeds24SyncPaused: () => false }));
vi.mock("@/lib/beds24/webhook-forward", () => ({
  parseForwardTargets: () => ["https://other.example/hook"],
  forwardBeds24Delivery: async () => {
    state.forwarded += 1;
    return [];
  },
}));
vi.mock("@/lib/beds24/webhook-events", () => ({
  recordBeds24WebhookEvent: async (args: { rawBody?: unknown; results: Array<{ mode: string }> }) => {
    state.events.push(args);
  },
  recordBeds24WebhookRejection: async () => undefined,
}));
vi.mock("@/lib/beds24/price-webhook", () => ({
  extractPriceWebhookSignal: (body: unknown) => {
    const record = body as Record<string, unknown> | null;
    return record && typeof record === "object" && record.roomId ? { action: null, externalPropertyId: null, externalRoomId: String(record.roomId) } : null;
  },
  processBeds24PriceWebhook: async (args: { body: Record<string, unknown> }) =>
    args.body?.roomId ? { handled: true, skipped: true, reason: "debounced", externalPropertyId: "1" } : { handled: false, reason: "not_a_price_delivery" },
}));
vi.mock("@/lib/beds24/booking-payload", () => ({ extractBeds24WebhookBookingCandidates: () => state.bookings }));
vi.mock("@/lib/beds24/webhook-booking-guard", () => ({
  createBeds24VerifyGate: () => ({ allow: async () => true, tripRateLimit: () => undefined }),
  guardBeds24WebhookBooking: async (args: { payload: Record<string, unknown> }) => state.guard(args.payload),
}));
vi.mock("@/lib/beds24/account-credit", () => ({ readBeds24AccountCredit: async () => null }));
vi.mock("@/lib/beds24/process-webhook-booking", () => ({
  processBeds24WebhookBooking: async (args: { payload: Record<string, unknown>; unverifiedAt?: string | null }) => {
    state.processed.push(args.payload);
    state.unverifiedAts.push(args.unverifiedAt);
    return { ...state.processResult, sourceReservationId: String(args.payload.id ?? "") };
  },
}));
vi.mock("@/lib/guest-messages/auto-scheduler", () => ({
  planAutoMessagesAfterWebhook: async (_supabase: unknown, results: Array<{ sourceReservationId?: unknown }>) => {
    state.planned.push(results);
  },
}));
vi.mock("@/lib/guest-messages/media-copy-server", () => ({ copyPendingGuestMessageMedia: async () => undefined }));
vi.mock("@/lib/guest-messages/webhook-ingest", () => ({
  ingestBeds24WebhookMessages: async () => ({ mediaMessageIds: {}, emojiSuspects: [] }),
  prepareCapturedMessagesPayload: () => null,
  shouldCaptureWebhookMessages: () => false,
}));

import { BEDS24_WEBHOOK_MAX_BOOKINGS, BOOKING_LOOP_BUDGET_MS, GET, POST } from "@/app/api/beds24/webhook/route";

const SECRET = "test-webhook-secret";

function post(body: unknown) {
  return new NextRequest("http://localhost/api/beds24/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-beds24-webhook-secret": SECRET },
    body: JSON.stringify(body),
  });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  process.env.BEDS24_WEBHOOK_SECRET = SECRET;
  state.bookings = [];
  state.processed = [];
  state.unverifiedAts = [];
  state.forwarded = 0;
  state.events = [];
  state.guard = (payload) => ({ kind: "apply", payload, verified: null });
  state.processResult = { ok: false, mode: "upsert_failed", sourceReservationId: "x" };
  state.planned = [];
  vi.restoreAllMocks();
});

const UPSERTED = { ok: true, mode: "upserted", originalReservationId: "x", mappedStatus: "confirmed" };

describe("실패 배치 원문 상한", () => {
  it("20,000자를 넘으면 표본 + 길이만 저장한다", async () => {
    state.bookings = [{ id: 1 }];
    await POST(post({ booking: { id: 1 }, filler: "x".repeat(50_000) }));
    await flush();
    const stored = state.events[0]?.rawBody as { truncated?: boolean; length?: number; sample?: string };
    expect(stored.truncated).toBe(true);
    expect(stored.length).toBeGreaterThan(50_000);
    expect(stored.sample?.length).toBe(4_000);
  });
  it("작은 실패 본문은 그대로(재처리용)", async () => {
    state.bookings = [{ id: 1 }];
    await POST(post({ booking: { id: 1 } }));
    await flush();
    expect(state.events[0]?.rawBody).toEqual({ booking: { id: 1 } });
  });
});

describe("한 배달의 예약 수 상한", () => {
  it("앞 N개만 처리하고 나머지는 over_delivery_cap 실패로 남긴다", async () => {
    state.processResult = { ok: true, mode: "upserted", sourceReservationId: "x", originalReservationId: "x", mappedStatus: "confirmed" };
    state.bookings = Array.from({ length: BEDS24_WEBHOOK_MAX_BOOKINGS + 3 }, (_, i) => ({ id: i }));
    const response = await POST(post({ bookings: state.bookings }));
    const json = (await response.json()) as { processed: number; failed: number };
    expect(state.processed).toHaveLength(BEDS24_WEBHOOK_MAX_BOOKINGS);
    expect(json.failed).toBe(3);
    await flush();
    expect(state.events[0]?.results.filter((r) => r.mode === "over_delivery_cap")).toHaveLength(3);
  });
});

describe("낡은 배달", () => {
  it("처리기에 넘기지 않고 skipped_stale 로 센다", async () => {
    state.bookings = [{ id: 1 }];
    state.guard = () => ({ kind: "stale", incomingModifiedTime: "2026-01-01T00:00:00Z", status: "cancelled" });
    const response = await POST(post({ booking: { id: 1 } }));
    const json = (await response.json()) as { stale: number; failed: number };
    expect(state.processed).toHaveLength(0);
    expect(json.stale).toBe(1);
    expect(json.failed).toBe(0);
  });
  it("확인 읽기 결과(Beds24 값)를 처리기에 넘긴다", async () => {
    state.bookings = [{ id: 1, status: "cancelled" }];
    state.guard = () => ({ kind: "apply", payload: { id: 1, status: "confirmed" }, verified: "state_changed" });
    await POST(post({ booking: { id: 1 } }));
    expect(state.processed).toEqual([{ id: 1, status: "confirmed" }]);
  });
});

describe("확인 못 함 · 없는 예약 · 가드 오류", () => {
  it("「확인 못 함」 표시 — verify_unavailable 은 새로 남기고, 확인 없이 덮을 땐 이어 붙이고, Beds24 값이면 지운다", async () => {
    state.processResult = UPSERTED;
    state.bookings = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    state.guard = (payload) =>
      payload.id === 1
        ? { kind: "apply", payload, verified: null, fallback: "verify_unavailable" }
        : payload.id === 2
          ? { kind: "apply", payload, verified: null, carryUnverifiedAt: "2026-11-26T01:00:00.000Z" }
          : payload.id === 3
            ? { kind: "apply", payload, verified: "state_changed" }
            : { kind: "apply", payload, verified: "state_changed", fallback: "verify_not_found_cancel" };
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await POST(post({ bookings: state.bookings }));
    expect(typeof state.unverifiedAts[0]).toBe("string");
    expect(Number.isNaN(Date.parse(String(state.unverifiedAts[0])))).toBe(false);
    expect(state.unverifiedAts.slice(1)).toEqual(["2026-11-26T01:00:00.000Z", null, null]);
    await flush();
    expect(state.planned[0]?.map((r) => r.sourceReservationId)).toEqual(["2", "3"]);
  });

  it("verify_unavailable: 본문을 적용하고 세되, 그 예약만 자동 안내 계획에서 뺀다", async () => {
    state.processResult = UPSERTED;
    state.bookings = [{ id: 1 }, { id: 2 }];
    state.guard = (payload) =>
      payload.id === 1
        ? { kind: "apply", payload, verified: null, fallback: "verify_unavailable" }
        : { kind: "apply", payload, verified: "state_changed" };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await POST(post({ bookings: state.bookings }));
    const json = (await response.json()) as { verifyUnavailableApplied: number; verified: number; failed: number };
    expect(state.processed).toEqual([{ id: 1 }, { id: 2 }]);
    expect(json).toMatchObject({ verifyUnavailableApplied: 1, verified: 1, failed: 0 });
    expect(warn).toHaveBeenCalledWith("[beds24/webhook] verify_unavailable_applied", { bookingId: "1" });
    await flush();
    expect(state.planned[0]?.map((r) => r.sourceReservationId)).toEqual(["2"]);
  });

  it("없는 예약 취소(verify_not_found_cancel): 저장된 값 취소본을 처리기로, 자동 안내 없음", async () => {
    state.processResult = { ...UPSERTED, mode: "cancelled", mappedStatus: "cancelled" };
    state.bookings = [{ id: 7, firstName: "Forged" }];
    state.guard = () => ({
      kind: "apply",
      payload: { id: 7, status: "cancelled" },
      verified: "state_changed",
      fallback: "verify_not_found_cancel",
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await POST(post({ bookings: state.bookings }));
    const json = (await response.json()) as { verifyUnavailableApplied: number };
    expect(state.processed).toEqual([{ id: 7, status: "cancelled" }]);
    expect(json.verifyUnavailableApplied).toBe(0);
    await flush();
    expect(state.planned[0]).toEqual([]);
  });

  it("없는 예약 + 저장된 행 없음(verify_not_found): 쓰지 않고 실패로 기록", async () => {
    state.bookings = [{ apiReference: "HM1" }];
    state.guard = () => ({ kind: "verify_failed", mode: "verify_not_found", reason: "new_booking" });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await POST(post({ bookings: state.bookings }));
    const json = (await response.json()) as { failed: number; results: Array<{ mode: string; sourceReservationId: unknown }> };
    expect(state.processed).toHaveLength(0);
    expect(json.failed).toBe(1);
    expect(json.results[0]).toMatchObject({ mode: "verify_not_found", sourceReservationId: null });
  });

  it("가드가 던지면 upsert_failed(guard_failed)로 남기고 다음 예약은 계속", async () => {
    state.processResult = UPSERTED;
    state.bookings = [{ id: 1 }, { id: 2 }];
    state.guard = (payload) => {
      if (payload.id === 1) throw new Error("db down");
      return { kind: "apply", payload, verified: null };
    };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST(post({ bookings: state.bookings }));
    const json = (await response.json()) as { results: Array<{ mode: string; error?: string }> };
    expect(json.results[0]).toMatchObject({ mode: "upsert_failed", error: "guard_failed" });
    expect(json.results[1]?.mode).toBe("upserted");
    expect(state.processed).toEqual([{ id: 2 }]);
  });
});

describe("처리 시간 예산", () => {
  it("예산을 넘기면 남은 예약은 처리하지 않고 over_delivery_cap", async () => {
    state.processResult = UPSERTED;
    state.bookings = [{ id: 1 }, { id: 2 }, { id: 3 }];
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    state.guard = (payload) => {
      if (payload.id === 2) clock = BOOKING_LOOP_BUDGET_MS + 1;
      return { kind: "apply", payload, verified: null };
    };
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await POST(post({ bookings: state.bookings }));
    const json = (await response.json()) as { results: Array<{ mode: string }> };
    expect(state.processed).toEqual([{ id: 1 }, { id: 2 }]);
    expect(json.results.map((r) => r.mode)).toEqual(["upserted", "upserted", "over_delivery_cap"]);
  });

  it("예산은 maxDuration 60초 안에 응답 뒤 일(사진 복사 20초 등)을 남긴다", () => {
    expect(BOOKING_LOOP_BUDGET_MS).toBeLessThanOrEqual(20_000);
  });
});

describe("전달 URL — 가격 배달만", () => {
  it("예약 배달(손님 정보)은 넘기지 않는다 — 본문 맨 위에 roomId 가 있어도", async () => {
    state.bookings = [{ id: 1, roomId: 501, guestPhone: "+81-90-0000-0000" }];
    await POST(post({ id: 1, roomId: 501, guestPhone: "+81-90-0000-0000" }));
    await flush();
    expect(state.forwarded).toBe(0);
  });
  it("예약도 가격도 아닌 배달은 넘기지 않는다", async () => {
    await POST(post({ hello: "world" }));
    await flush();
    expect(state.forwarded).toBe(0);
  });
  it("가격 배달은 넘긴다", async () => {
    await POST(post({ roomId: 501, action: "PRICE_CHANGE" }));
    await flush();
    expect(state.forwarded).toBe(1);
  });
  it("GET: 가격 신호가 없으면 넘기지 않고, 있으면 넘긴다", async () => {
    const get = (query: string) =>
      new NextRequest(`http://localhost/api/beds24/webhook?${query}`, { headers: { "x-beds24-webhook-secret": SECRET } });
    await GET(get("hello=world"));
    await flush();
    expect(state.forwarded).toBe(0);
    await GET(get("roomId=501&action=PRICE_CHANGE"));
    await flush();
    expect(state.forwarded).toBe(1);
  });
});
