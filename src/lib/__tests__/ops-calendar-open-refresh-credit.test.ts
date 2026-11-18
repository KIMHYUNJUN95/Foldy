import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const seen = vi.hoisted(() => ({ scope: undefined as unknown, pending: [] as Promise<unknown>[] }));

vi.mock("next/server", () => ({
  after: (fn: () => Promise<unknown>) => {
    seen.pending.push(fn());
  },
}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => ({}) }));
vi.mock("@/lib/beds24/price-job-queue", () => ({ hasPendingPriceJobs: async () => false }));
vi.mock("@/lib/beds24/price-job-kick", () => ({ kickPriceJobWorker: async () => {} }));
vi.mock("@/lib/beds24/rates-refresh", async () => {
  const ledger = await import("@/lib/beds24/credit-ledger");
  return {
    refreshOpsCalendarRates: async () => {
      seen.scope = ledger.currentBeds24CreditScope();
    },
  };
});

import { scheduleOpsCalendarOpenRefresh } from "@/lib/ops-calendar-open-refresh";

describe("판매 캘린더 열기 — 낡은 창 당기기의 「누가」", () => {
  it("연 사람으로 남는다(자동 아님) · 조직 포함", async () => {
    const data = {
      days: [{ date: "2026-11-18" }, { date: "2026-11-30" }],
      selectedProperties: ["아라키초A"],
      propertyExternalIds: { 아라키초A: "123" },
      ratesRefreshable: true,
      ratesSyncedAt: null,
    } as never;
    scheduleOpsCalendarOpenRefresh("org-1", data, { id: "u1", name: "김" });
    await Promise.all(seen.pending);
    expect(seen.scope).toMatchObject({ organizationId: "org-1", actor: { kind: "user", userId: "u1", name: "김" } });
  });
});
