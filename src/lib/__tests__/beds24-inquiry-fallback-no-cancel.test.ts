import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase } from "@/lib/__tests__/fake-supabase";

/**
 * 4차 감사 버그: `status=inquiry` 를 400 으로 거절해 문의를 빼고 다시 읽었는데 행이 없으면, 그것은 「없음」이 아니라 「모름」이다.
 * 예전에는 `not_found` → 저장값으로 취소라서 살아 있는 문의 예약이 취소됐다. 웹훅 확인 · 매일 다시 읽기 둘 다 실제
 * `fetchBeds24BookingById` 로(Beds24 HTTP 만 가짜) 돌려 본다. 계약: docs/engineering/01-beds24-integration.md.
 */
const state = vi.hoisted(() => ({ urls: [] as string[], queue: [] as Response[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getOptionalBeds24ApiEnv: () => ({ baseUrl: "https://beds24.test/api/v2/" }) }));
vi.mock("@/lib/beds24/access-token", () => ({ resolveBeds24AccessToken: async () => ({ ok: true, token: "t" }) }));
vi.mock("@/lib/beds24/credit-ledger", () => ({
  beds24Fetch: async (url: string) => {
    state.urls.push(url);
    return state.queue.shift();
  },
}));
vi.mock("@/lib/beds24/account-credit", () => ({ readBeds24AccountCredit: async () => null }));
vi.mock("@/lib/beds24/webhook-organization", () => ({
  pickWebhookOrganizationId: () => "org-1",
  readMappedOrganizationIds: async () => ["org-1"],
}));

import { UNVERIFIED_MARKER_KEY, UNVERIFIED_RECHECK_AT_KEY } from "@/lib/beds24/unverified-marker";
import { recheckUnverifiedBeds24Reservations } from "@/lib/beds24/unverified-recheck";
import { createBeds24VerifyGate, guardBeds24WebhookBooking } from "@/lib/beds24/webhook-booking-guard";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const inquiryRejectedThenEmpty = () => [json({ error: "invalid status" }, 400), json({ success: true, data: [] })];

beforeEach(() => {
  state.urls = [];
  state.queue = [];
});

describe("400 → 문의 빼고 다시 읽기 → 빈 응답 — 취소하지 않는다", () => {
  it("웹훅 확인: 저장값 취소가 아니라 「확인 못 함」(본문 적용 + 표시)", async () => {
    state.queue = inquiryRejectedThenEmpty();
    const loadCancelPayload = vi.fn(async () => ({ id: 9001, status: "cancelled" }));
    const payload = { id: 9001, roomId: 501, arrival: "2026-12-01", departure: "2026-12-04", status: "request" };
    const outcome = await guardBeds24WebhookBooking({
      payload,
      organizationIdDefault: "org-1",
      supabase: {} as never,
      nowMs: Date.parse("2026-11-26T03:00:00Z"),
      loadStored: async () => [
        { status: "confirmed", checkInDate: "2026-12-01", checkOutDate: "2026-12-03", externalRoomId: "501", modifiedTime: null },
      ],
      loadCancelPayload,
      gate: createBeds24VerifyGate(async () => null),
    });
    expect(state.urls).toHaveLength(2);
    expect(loadCancelPayload).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ kind: "apply", payload, fallback: "verify_unavailable" });
  });

  it("매일 다시 읽기: 처리기를 부르지 않고 표시를 남긴다(다시 읽은 시각만 적음)", async () => {
    state.queue = inquiryRejectedThenEmpty();
    const fake = createFakeSupabase({
      properties: [{ organization_id: "org-1", external_provider: "beds24", external_property_id: "77" }],
      reservations: [
        {
          id: "res-1",
          organization_id: "org-1",
          source_reservation_id: "9001::room::501",
          status: "confirmed",
          raw_payload: { id: 9001, status: "inquiry", [UNVERIFIED_MARKER_KEY]: "2026-11-25T00:00:00.000Z" },
        },
      ],
    });
    const processBooking = vi.fn();
    const loadCancelPayload = vi.fn();
    const result = await recheckUnverifiedBeds24Reservations(fake.client as never, {
      processBooking: processBooking as never,
      loadCancelPayload: loadCancelPayload as never,
      gate: createBeds24VerifyGate(async () => null),
      nowIso: () => "2026-11-26T05:00:00.000Z",
    });
    expect(state.urls).toHaveLength(2);
    expect(result).toMatchObject({ unavailable: 1, cancelled: 0, cleared: 0 });
    expect(processBooking).not.toHaveBeenCalled();
    expect(loadCancelPayload).not.toHaveBeenCalled();
    expect(fake.tables.reservations[0]).toMatchObject({ status: "confirmed" });
    expect(fake.tables.reservations[0].raw_payload).toMatchObject({
      status: "inquiry",
      [UNVERIFIED_MARKER_KEY]: "2026-11-25T00:00:00.000Z",
      [UNVERIFIED_RECHECK_AT_KEY]: "2026-11-26T05:00:00.000Z",
    });
  });
});
