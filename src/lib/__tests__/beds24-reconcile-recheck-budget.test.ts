import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * 정합 라우트(`/api/beds24/reconcile`, 상한 60초)는 「확인 못 함」 다시 읽기에 `min(15초, 45초 − 지난 시간)` 만 준다.
 * 8초가 안 남으면 건너뛰고 `skipped_time`. 계약: docs/engineering/01-beds24-integration.md.
 */
const clock = vi.hoisted(() => ({ t: 0, backfillMs: 0 }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/beds24/sync-control", () => ({ isBeds24SyncPaused: () => false }));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => ({}) }));
vi.mock("@/lib/beds24/webhook-events", () => ({ recordBeds24ReconciliationEvent: async () => undefined }));
vi.mock("@/lib/beds24/room-blocks-sync", () => ({ syncBeds24RoomBlocks: async () => ({ ok: true }) }));
vi.mock("@/lib/beds24/reservations-backfill", () => ({
  backfillBeds24Reservations: async () => {
    clock.t += clock.backfillMs;
    return { partial: false, fetchedRows: 1, incremental: true };
  },
}));
const recheck = vi.hoisted(() => vi.fn(async () => ({ candidates: 0, cleared: 0, cancelled: 0, unavailable: 0, leftoverMarked: 0, stoppedReason: null })));
vi.mock("@/lib/beds24/unverified-recheck", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/beds24/unverified-recheck")>()),
  recheckUnverifiedBeds24Reservations: recheck,
}));

import { POST } from "@/app/api/beds24/reconcile/route";

function request() {
  return new NextRequest("https://foldy.test/api/beds24/reconcile", {
    method: "POST",
    headers: { authorization: "Bearer cron-test" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  recheck.mockClear();
});

describe("정합 라우트 — 다시 읽기 예산", () => {
  it.each([
    [1_000, 15_000],
    [33_000, 12_000],
  ])("정합에 %ims 쓰면 다시 읽기 예산은 %ims", async (spent, budget) => {
    vi.stubEnv("CRON_SECRET", "cron-test");
    clock.t = 0;
    clock.backfillMs = spent;
    vi.spyOn(performance, "now").mockImplementation(() => clock.t);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(recheck).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ budgetMs: budget }));
  });

  it("8초가 안 남으면 다시 읽지 않고 skipped_time", async () => {
    vi.stubEnv("CRON_SECRET", "cron-test");
    clock.t = 0;
    clock.backfillMs = 38_000;
    vi.spyOn(performance, "now").mockImplementation(() => clock.t);
    const response = await POST(request());
    const body = (await response.json()) as { unverifiedRecheck: { stoppedReason: string } };
    expect(recheck).not.toHaveBeenCalled();
    expect(body.unverifiedRecheck.stoppedReason).toBe("skipped_time");
  });
});
