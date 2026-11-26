import { describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "@/lib/__tests__/fake-supabase";
import { UNVERIFIED_MARKER_KEY, withUnverifiedMarker } from "@/lib/beds24/unverified-marker";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/beds24/calendar-client", () => ({ fetchBeds24BookingById: vi.fn(), LOW_CREDIT_THRESHOLD: 10 }));
vi.mock("@/lib/beds24/webhook-organization", () => ({
  pickWebhookOrganizationId: () => "org-1",
  readMappedOrganizationIds: async () => ["org-1"],
}));

import {
  createBeds24VerifyGate,
  guardBeds24WebhookBooking,
  isStaleBeds24Delivery,
  loadStoredBookingStates,
  loadStoredCancelPayload,
  needsBeds24Verification,
  readIncomingBookingState,
  type StoredBookingState,
} from "@/lib/beds24/webhook-booking-guard";

/**
 * 예약 웹훅 순서 · 확인 (2026-11-26 보안 점검). 공유 비밀값만으로는 예전 배달 재전송 · 지어낸 취소를 막지 못한다.
 * 계약: src/lib/beds24/webhook-booking-guard.ts · docs/engineering/01-beds24-integration.md 「웹훅 순서 · 확인」.
 */

const NOW = Date.parse("2026-11-26T03:00:00Z");

const storedRow = (over: Partial<StoredBookingState> = {}): StoredBookingState => ({
  status: "confirmed",
  checkInDate: "2026-12-01",
  checkOutDate: "2026-12-03",
  externalRoomId: "501",
  modifiedTime: "2026-11-20T00:00:00Z",
  ...over,
});

const booking = (over: Record<string, unknown> = {}) => ({
  id: 9001,
  apiReference: "HM123",
  roomId: 501,
  propertyId: 77,
  arrival: "2026-12-01",
  departure: "2026-12-03",
  status: "confirmed",
  firstName: "A",
  lastName: "B",
  modifiedTime: "2026-11-21T00:00:00Z",
  ...over,
});

const supabase = {} as never;

describe("isStaleBeds24Delivery — 오래된 배달은 덮어쓰지 않는다", () => {
  it("저장된 modifiedTime 보다 오래되면 낡은 배달", () => {
    const incoming = readIncomingBookingState(booking({ modifiedTime: "2026-11-19T00:00:00Z" }));
    expect(isStaleBeds24Delivery(incoming, [storedRow()])).toBe(true);
  });
  it("같거나 새로우면 적용(같은 배달 재전송은 해롭지 않다)", () => {
    expect(isStaleBeds24Delivery(readIncomingBookingState(booking({ modifiedTime: "2026-11-20T00:00:00Z" })), [storedRow()])).toBe(false);
    expect(isStaleBeds24Delivery(readIncomingBookingState(booking()), [storedRow()])).toBe(false);
  });
  it("어느 쪽이든 시각이 없으면 판단하지 않는다", () => {
    expect(isStaleBeds24Delivery(readIncomingBookingState(booking({ modifiedTime: undefined })), [storedRow()])).toBe(false);
    expect(isStaleBeds24Delivery(readIncomingBookingState(booking()), [storedRow({ modifiedTime: null })])).toBe(false);
  });
  it("저장된 행이 여럿이면 가장 새 것과 비교", () => {
    const incoming = readIncomingBookingState(booking({ modifiedTime: "2026-11-21T00:00:00Z" }));
    expect(isStaleBeds24Delivery(incoming, [storedRow(), storedRow({ modifiedTime: "2026-11-22T00:00:00Z" })])).toBe(true);
  });
});

describe("needsBeds24Verification — 상태를 바꾸는 배달만 Beds24 에서 다시 읽는다", () => {
  it("메시지만 온 배달(상태 그대로)은 부르지 않는다", () => {
    expect(needsBeds24Verification(readIncomingBookingState(booking()), [storedRow()], NOW)).toBeNull();
  });
  it("새 예약 · 취소 · 날짜 · 방 바뀜 · 미래 시각은 확인", () => {
    const s = [storedRow()];
    expect(needsBeds24Verification(readIncomingBookingState(booking()), [], NOW)).toBe("new_booking");
    expect(needsBeds24Verification(readIncomingBookingState(booking({ status: "cancelled" })), s, NOW)).toBe("state_changed");
    expect(needsBeds24Verification(readIncomingBookingState(booking({ departure: "2026-12-04" })), s, NOW)).toBe("state_changed");
    expect(needsBeds24Verification(readIncomingBookingState(booking({ roomId: 502 })), s, NOW)).toBe("state_changed");
    expect(needsBeds24Verification(readIncomingBookingState(booking({ modifiedTime: "2099-01-01T00:00:00Z" })), s, NOW)).toBe(
      "future_modified_time",
    );
  });
});

describe("guardBeds24WebhookBooking", () => {
  it("낡은 배달은 건너뛰고 Beds24 를 부르지 않는다", async () => {
    const fetchBooking = vi.fn();
    const outcome = await guardBeds24WebhookBooking({
      payload: booking({ modifiedTime: "2026-11-19T00:00:00Z", status: "cancelled" }),
      organizationIdDefault: "org-1",
      supabase,
      nowMs: NOW,
      fetchBooking,
      loadStored: async () => [storedRow()],
    });
    expect(outcome.kind).toBe("stale");
    expect(fetchBooking).not.toHaveBeenCalled();
  });

  it("상태가 그대로면 본문을 그대로 적용, 크레딧 0", async () => {
    const fetchBooking = vi.fn();
    const outcome = await guardBeds24WebhookBooking({
      payload: booking(),
      organizationIdDefault: "org-1",
      supabase,
      nowMs: NOW,
      fetchBooking,
      loadStored: async () => [storedRow()],
    });
    expect(outcome).toMatchObject({ kind: "apply", verified: null });
    expect(fetchBooking).not.toHaveBeenCalled();
  });

  it("지어낸 취소: Beds24 에서 읽은 값(확정)을 적용한다", async () => {
    const truth = booking({ status: "confirmed", modifiedTime: "2026-11-25T00:00:00Z" });
    const fetchBooking = vi.fn(async () => ({ ok: true as const, booking: truth }));
    const outcome = await guardBeds24WebhookBooking({
      payload: booking({ status: "cancelled", modifiedTime: "2026-11-25T00:00:00Z" }),
      organizationIdDefault: "org-1",
      supabase,
      nowMs: NOW,
      fetchBooking,
      loadStored: async () => [storedRow()],
    });
    expect(fetchBooking).toHaveBeenCalledWith("9001", expect.objectContaining({ timeoutMs: expect.any(Number), allStatuses: true }));
    expect(outcome).toEqual({ kind: "apply", payload: truth, verified: "state_changed" });
  });

  it("미래 modifiedTime 은 상태가 같아도 Beds24 에서 읽은 값을 적용한다", async () => {
    const truth = booking({ modifiedTime: "2026-11-25T00:00:00Z" });
    const fetchBooking = vi.fn(async () => ({ ok: true as const, booking: truth }));
    const outcome = await guardBeds24WebhookBooking({
      payload: booking({ modifiedTime: "2099-01-01T00:00:00Z" }),
      organizationIdDefault: "org-1",
      supabase,
      nowMs: NOW,
      fetchBooking,
      loadStored: async () => [storedRow()],
    });
    expect(fetchBooking).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ kind: "apply", payload: truth, verified: "future_modified_time" });
  });

  it("Beds24 번호가 없으면 부르지 않고 쓰지 않는다", async () => {
    const fetchBooking = vi.fn();
    const outcome = await guardBeds24WebhookBooking({
      payload: booking({ id: undefined, bookId: undefined }),
      organizationIdDefault: "org-1",
      supabase,
      nowMs: NOW,
      fetchBooking,
      loadStored: async () => [],
    });
    expect(outcome).toMatchObject({ kind: "verify_failed", mode: "verify_not_found" });
    expect(fetchBooking).not.toHaveBeenCalled();
  });

  it("Beds24 에 없는 예약 + 저장된 행 없음 → 쓰지 않는다(기록만)", async () => {
    const loadCancelPayload = vi.fn();
    const outcome = await guardBeds24WebhookBooking({
      payload: booking(),
      organizationIdDefault: "org-1",
      supabase,
      nowMs: NOW,
      fetchBooking: async () => ({ ok: false, error: "not_found" }),
      loadStored: async () => [],
      loadCancelPayload,
    });
    expect(outcome).toMatchObject({ kind: "verify_failed", mode: "verify_not_found", reason: "new_booking" });
    expect(loadCancelPayload).not.toHaveBeenCalled();
  });

  it("Beds24 에 없는 예약 + 저장된 행 있음 → 저장된 값에 취소만 얹어 일반 취소 경로로", async () => {
    const cancelPayload = { ...booking(), status: "cancelled" };
    const loadCancelPayload = vi.fn(async () => cancelPayload);
    const outcome = await guardBeds24WebhookBooking({
      payload: booking({ departure: "2026-12-09", firstName: "Forged" }),
      organizationIdDefault: "org-1",
      supabase,
      nowMs: NOW,
      fetchBooking: async () => ({ ok: false, error: "not_found" }),
      loadStored: async () => [storedRow()],
      loadCancelPayload,
    });
    expect(loadCancelPayload).toHaveBeenCalledWith(supabase, "org-1", "HM123", "9001");
    expect(outcome).toEqual({
      kind: "apply",
      payload: cancelPayload,
      verified: "state_changed",
      fallback: "verify_not_found_cancel",
    });
  });

  it("Beds24 를 못 부르면(429 · 시한 · 토큰 없음) 본문을 적용하고 표시한다", async () => {
    const payload = booking({ status: "cancelled" });
    for (const fetchBooking of [
      async () => {
        throw new Error("beds24 http 429");
      },
      async () => ({ skipped: "beds24:missing-env" }),
      async () => ({ ok: false as const, error: "http_500" }),
      async () => ({ ok: false as const, error: "unexpected_response" }),
    ]) {
      const outcome = await guardBeds24WebhookBooking({
        payload,
        organizationIdDefault: "org-1",
        supabase,
        nowMs: NOW,
        fetchBooking: fetchBooking as never,
        loadStored: async () => [storedRow()],
      });
      expect(outcome).toEqual({ kind: "apply", payload, verified: null, fallback: "verify_unavailable" });
    }
  });

  it("낡은 배달 판정이 먼저 — 확인 차단 중이어도 낡은 것은 적용하지 않는다", async () => {
    const gate = createBeds24VerifyGate(async () => 0);
    const outcome = await guardBeds24WebhookBooking({
      payload: booking({ modifiedTime: "2026-11-19T00:00:00Z", status: "cancelled" }),
      organizationIdDefault: "org-1",
      supabase,
      nowMs: NOW,
      fetchBooking: vi.fn(),
      loadStored: async () => [storedRow()],
      gate,
    });
    expect(outcome.kind).toBe("stale");
  });
});

describe("createBeds24VerifyGate — 한 배달 안의 차단기", () => {
  const rateLimited = Object.assign(new Error("429"), { isRateLimit: true });

  it("429 한 번이면 같은 배달의 다음 예약은 부르지 않고 본문 적용", async () => {
    const gate = createBeds24VerifyGate(async () => 150);
    const fetchBooking = vi.fn(async () => {
      throw rateLimited;
    });
    const run = (id: number) =>
      guardBeds24WebhookBooking({
        payload: booking({ id, status: "cancelled" }),
        organizationIdDefault: "org-1",
        supabase,
        nowMs: NOW,
        fetchBooking: fetchBooking as never,
        loadStored: async () => [storedRow()],
        gate,
      });
    expect(await run(9001)).toMatchObject({ kind: "apply", fallback: "verify_unavailable" });
    expect(await run(9002)).toMatchObject({ kind: "apply", fallback: "verify_unavailable" });
    expect(fetchBooking).toHaveBeenCalledTimes(1);
  });

  it("429 가 아닌 실패는 차단하지 않는다", async () => {
    const gate = createBeds24VerifyGate(async () => 150);
    const fetchBooking = vi.fn(async () => {
      throw new Error("timeout");
    });
    for (const id of [9001, 9002]) {
      await guardBeds24WebhookBooking({
        payload: booking({ id, status: "cancelled" }),
        organizationIdDefault: "org-1",
        supabase,
        nowMs: NOW,
        fetchBooking: fetchBooking as never,
        loadStored: async () => [storedRow()],
        gate,
      });
    }
    expect(fetchBooking).toHaveBeenCalledTimes(2);
  });

  it("계정 크레딧이 바닥(LOW_CREDIT_THRESHOLD 미만)이면 처음부터 부르지 않는다 · 한 번만 읽는다", async () => {
    const readRemaining = vi.fn(async () => 3);
    const gate = createBeds24VerifyGate(readRemaining);
    expect(await gate.allow()).toBe(false);
    expect(await gate.allow()).toBe(false);
    expect(readRemaining).toHaveBeenCalledTimes(1);
  });

  it("크레딧 기록이 없거나 읽기 실패면 막지 않는다", async () => {
    expect(await createBeds24VerifyGate(async () => null).allow()).toBe(true);
    expect(
      await createBeds24VerifyGate(async () => {
        throw new Error("db");
      }).allow(),
    ).toBe(true);
  });
});

describe("loadStoredCancelPayload — 저장된 원래 값에 취소만", () => {
  function fakeSupabase(rows: Array<{ raw_payload: unknown }>) {
    const filters: Array<[string, unknown]> = [];
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return query;
      },
      then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null }),
    };
    return { client: { from: () => query } as never, filters };
  }

  it("조직 · 같은 Beds24 예약 행만 쓰고, 명시 상태 키를 지워 취소로 만든다", async () => {
    const { client, filters } = fakeSupabase([
      { raw_payload: { id: 8000, apiReference: "HM123", status: "confirmed" } },
      { raw_payload: { id: 9001, apiReference: "HM123", statusText: "Confirmed", _foldy_unverified_at: "2026-11-26T01:00:00.000Z", status: "confirmed", arrival: "2026-12-01" } },
    ]);
    const payload = await loadStoredCancelPayload(client, "org-1", "HM123", "9001");
    expect(filters).toEqual([
      ["organization_id", "org-1"],
      ["original_reservation_id", "HM123"],
    ]);
    expect(payload).toEqual({ id: 9001, apiReference: "HM123", status: "cancelled", arrival: "2026-12-01" });
  });

  it("같은 예약 행이 없으면 null", async () => {
    const { client } = fakeSupabase([{ raw_payload: { id: 8000 } }, { raw_payload: null }]);
    expect(await loadStoredCancelPayload(client, "org-1", "HM123", "9001")).toBeNull();
  });
});

describe("「확인 못 함」 표시 이어 붙이기 (2026-11-26)", () => {
  const MARK = "2026-11-26T01:00:00.000Z";

  it("확인이 필요 없는 배달(상태 그대로)은 저장 행 표시를 이어 붙인다", async () => {
    const payload = booking();
    const outcome = await guardBeds24WebhookBooking({
      payload,
      organizationIdDefault: "org-1",
      supabase,
      nowMs: NOW,
      loadStored: async () => [storedRow({ unverifiedAt: MARK })],
    });
    expect(outcome).toEqual({ kind: "apply", payload, verified: null, carryUnverifiedAt: MARK });
  });

  it("표시 없는 행이면 이어 붙일 것 없음", async () => {
    const payload = booking();
    const outcome = await guardBeds24WebhookBooking({
      payload,
      organizationIdDefault: "org-1",
      supabase,
      nowMs: NOW,
      loadStored: async () => [storedRow()],
    });
    expect(outcome).toEqual({ kind: "apply", payload, verified: null });
  });

  it("Beds24 에서 읽어 적용하면 표시를 이어 붙이지 않는다(통째로 바뀌어 지워진다)", async () => {
    const truth = booking({ status: "confirmed", firstName: "Real" });
    const outcome = await guardBeds24WebhookBooking({
      payload: booking({ status: "cancelled" }),
      organizationIdDefault: "org-1",
      supabase,
      nowMs: NOW,
      loadStored: async () => [storedRow({ unverifiedAt: MARK })],
      fetchBooking: (async () => ({ ok: true as const, booking: truth })) as never,
    });
    expect(outcome).toEqual({ kind: "apply", payload: truth, verified: "state_changed" });
  });
});

describe("낡은 배달 판정 — 「확인 못 함」 행의 시각은 비교하지 않는다", () => {
  it("표시 행의 새 시각 때문에 진짜 배달을 낡았다고 막지 않는다", () => {
    const incoming = readIncomingBookingState(booking({ modifiedTime: "2026-11-21T00:00:00Z" }));
    const forged = storedRow({ modifiedTime: "2026-11-26T03:05:00Z", unverifiedAt: "2026-11-26T03:00:00.000Z" });
    expect(isStaleBeds24Delivery(incoming, [forged])).toBe(false);
    expect(isStaleBeds24Delivery(incoming, [forged, storedRow({ modifiedTime: "2026-11-20T00:00:00Z" })])).toBe(false);
    expect(isStaleBeds24Delivery(incoming, [forged, storedRow({ modifiedTime: "2026-11-22T00:00:00Z" })])).toBe(true);
  });
});

describe("withUnverifiedMarker", () => {
  it("표시가 있으면 raw_payload 에 키를 더하고, 없으면 그대로 둔다", () => {
    const base = { id: 1, status: "confirmed" };
    expect(withUnverifiedMarker(base, "2026-11-26T01:00:00.000Z")).toEqual({ ...base, [UNVERIFIED_MARKER_KEY]: "2026-11-26T01:00:00.000Z" });
    expect(withUnverifiedMarker(base, null)).toBe(base);
    expect(withUnverifiedMarker(base, undefined)).toBe(base);
  });
});

describe("loadStoredBookingStates — 이어 붙일 표시 값", () => {
  it("다시 읽은 시각(_foldy_recheck_at)이 있으면 그것을 표시 값으로 — 매일 다시 읽기 순서가 앞으로 돌아가지 않게", async () => {
    // 가짜 DB 는 별칭 없이 행을 통째로 돌려주므로 별칭 이름으로 칸을 둔다.
    const base = { organization_id: "org-1", original_reservation_id: "9001", status: "confirmed", raw_id: "9001" };
    const fake = createFakeSupabase({
      reservations: [
        { ...base, id: "a", raw_unverified: "2026-11-20T00:00:00.000Z", raw_recheck_at: "2026-11-26T05:00:00.000Z" },
        { ...base, id: "b", raw_unverified: "2026-11-21T00:00:00.000Z", raw_recheck_at: null },
        { ...base, id: "c", raw_unverified: null, raw_recheck_at: "2026-11-26T05:00:00.000Z" },
      ],
    });
    const states = await loadStoredBookingStates(fake.client as never, "org-1", "9001", "9001");
    expect(states.map((row) => row.unverifiedAt)).toEqual(["2026-11-26T05:00:00.000Z", "2026-11-21T00:00:00.000Z", null]);
  });
});
