import { describe, expect, it, vi } from "vitest";

import { createFakeSupabase } from "@/lib/__tests__/fake-supabase";

/**
 * 「확인 못 함」 표시 예약 다시 읽기(매일 정합 끝, 2026-11-26 3차 감사). Beds24 · 처리기는 가짜.
 * 계약: docs/engineering/01-beds24-integration.md 「2026-11-26 웹훅 순서 · 확인 · 상한」.
 */
vi.mock("server-only", () => ({}));
vi.mock("@/lib/beds24/account-credit", () => ({ readBeds24AccountCredit: async () => null }));

import { UNVERIFIED_MARKER_KEY, UNVERIFIED_RECHECK_AT_KEY } from "@/lib/beds24/unverified-marker";
import {
  recheckUnverifiedBeds24Reservations,
  unverifiedRecheckBudgetMs,
  UNVERIFIED_RECHECK_LIMIT,
} from "@/lib/beds24/unverified-recheck";
import { Beds24HttpError } from "@/lib/beds24/calendar-client";
import { createBeds24VerifyGate } from "@/lib/beds24/webhook-booking-guard";

const ORG = "00000000-0000-4000-8000-000000000b00";
const OTHER = "00000000-0000-4000-8000-000000000b01";
const MARK = "2026-11-26T01:00:00.000Z";

function row(id: number, over: Record<string, unknown> = {}) {
  return {
    id: `res-${id}`,
    organization_id: ORG,
    source_reservation_id: `${id}::room::201`,
    status: "confirmed",
    raw_payload: { id, status: "confirmed", firstName: "Forged", [UNVERIFIED_MARKER_KEY]: MARK },
    ...over,
  };
}

function makeDb(reservations: Array<Record<string, unknown>>) {
  return createFakeSupabase({
    properties: [{ organization_id: ORG, external_provider: "beds24", external_property_id: "77" }],
    reservations,
  });
}

/** 처리기 흉내 — 받은 값으로 그 예약 행의 raw_payload 를 통째로 바꾼다(실제 처리기처럼). */
function fakeProcessor(tables: Record<string, Array<Record<string, unknown>>>) {
  const calls: Array<Record<string, unknown>> = [];
  const processBooking = vi.fn(async (args: { payload: Record<string, unknown>; organizationIdDefault: string | null }) => {
    calls.push(args.payload);
    for (const r of tables.reservations) {
      if (r.organization_id === args.organizationIdDefault && (r.raw_payload as { id: unknown }).id === args.payload.id) {
        r.raw_payload = args.payload;
        r.status = args.payload.status === "cancelled" ? "cancelled" : "confirmed";
      }
    }
    return { ok: true, mode: "upserted", sourceReservationId: String(args.payload.id) } as never;
  });
  return { calls, processBooking };
}

const openGate = () => createBeds24VerifyGate(async () => null);

describe("recheckUnverifiedBeds24Reservations", () => {
  it("Beds24 에 있으면 읽은 값으로 적용 — 표시가 지워진다(모든 상태로 읽음)", async () => {
    const fake = makeDb([row(9001), row(9002, { raw_payload: { id: 9002, status: "confirmed" } })]);
    const { calls, processBooking } = fakeProcessor(fake.tables);
    const fetchBooking = vi.fn(async () => ({ ok: true as const, booking: { id: 9001, status: "confirmed", firstName: "Real" } }));
    const result = await recheckUnverifiedBeds24Reservations(fake.client as never, { fetchBooking, processBooking, gate: openGate() });
    expect(result).toMatchObject({ candidates: 1, cleared: 1, cancelled: 0, unavailable: 0 });
    expect(fetchBooking).toHaveBeenCalledWith("9001", { timeoutMs: 5000, allStatuses: true });
    expect(calls).toEqual([{ id: 9001, status: "confirmed", firstName: "Real" }]);
    expect(fake.tables.reservations[0].raw_payload).not.toHaveProperty(UNVERIFIED_MARKER_KEY);
  });

  it(`한 번에 최대 ${UNVERIFIED_RECHECK_LIMIT}개 — 묶음 행은 예약 하나로 센다 · 다른 조직(Beds24 건물 없음)은 안 읽는다`, async () => {
    const rows = Array.from({ length: UNVERIFIED_RECHECK_LIMIT + 5 }, (_, i) => row(8000 + i));
    rows.push(row(8000, { id: "res-8000-b", source_reservation_id: "8000::room::202" }));
    rows.push(row(7000, { organization_id: OTHER }));
    const fake = makeDb(rows);
    const { processBooking } = fakeProcessor(fake.tables);
    const fetchBooking = vi.fn(async (id: string) => ({ ok: true as const, booking: { id: Number(id), status: "confirmed" } }));
    const result = await recheckUnverifiedBeds24Reservations(fake.client as never, { fetchBooking, processBooking, gate: openGate() });
    expect(fetchBooking).toHaveBeenCalledTimes(UNVERIFIED_RECHECK_LIMIT);
    expect(new Set(fetchBooking.mock.calls.map((call) => call[0])).size).toBe(UNVERIFIED_RECHECK_LIMIT);
    expect(fetchBooking.mock.calls.map((call) => call[0])).not.toContain("7000");
    expect(result.candidates).toBe(UNVERIFIED_RECHECK_LIMIT);
  });

  it("엄격한 없음이면 저장된 값으로 취소한다(본문 값 안 씀 · 표시 지움)", async () => {
    const fake = makeDb([row(9001)]);
    const { calls, processBooking } = fakeProcessor(fake.tables);
    const loadCancelPayload = vi.fn(async () => ({ id: 9001, status: "cancelled" }));
    const result = await recheckUnverifiedBeds24Reservations(fake.client as never, {
      fetchBooking: async () => ({ ok: false as const, error: "not_found" }),
      processBooking,
      loadCancelPayload,
      gate: openGate(),
    });
    expect(result).toMatchObject({ cancelled: 1, cleared: 0 });
    expect(loadCancelPayload).toHaveBeenCalledWith(expect.anything(), ORG, "9001::room::201", "9001");
    expect(calls).toEqual([{ id: 9001, status: "cancelled" }]);
    expect(fake.tables.reservations[0]).toMatchObject({ status: "cancelled" });
  });

  it("못 읽으면(오류 · 이상한 응답 · 취소본 없음) 아무것도 쓰지 않고 표시를 남긴다 — 다음 날", async () => {
    for (const fetchBooking of [
      async () => {
        throw new Error("timeout");
      },
      async () => ({ ok: false as const, error: "unexpected_response" }),
      async () => ({ ok: false as const, error: "not_found" }),
    ]) {
      const fake = makeDb([row(9001)]);
      const { processBooking } = fakeProcessor(fake.tables);
      const result = await recheckUnverifiedBeds24Reservations(fake.client as never, {
        fetchBooking: fetchBooking as never,
        processBooking,
        loadCancelPayload: async () => null,
        gate: openGate(),
      });
      expect(result).toMatchObject({ unavailable: 1, cleared: 0, cancelled: 0 });
      expect(processBooking).not.toHaveBeenCalled();
      expect(fake.tables.reservations[0].raw_payload).toHaveProperty(UNVERIFIED_MARKER_KEY, MARK);
    }
  });

  it("차단기 — 429 한 번이면 그 뒤로 읽지 않는다 · 크레딧 바닥이면 처음부터 안 읽는다", async () => {
    const fake = makeDb([row(9001), row(9002), row(9003)]);
    const { processBooking } = fakeProcessor(fake.tables);
    const fetchBooking = vi.fn(async () => {
      throw new Beds24HttpError(429, 60, true);
    });
    const result = await recheckUnverifiedBeds24Reservations(fake.client as never, { fetchBooking, processBooking, gate: openGate() });
    expect(fetchBooking).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ unavailable: 1, stoppedReason: "breaker" });

    const low = vi.fn();
    const lowResult = await recheckUnverifiedBeds24Reservations(fake.client as never, {
      fetchBooking: low as never,
      processBooking,
      gate: createBeds24VerifyGate(async () => 3),
    });
    expect(low).not.toHaveBeenCalled();
    expect(lowResult.stoppedReason).toBe("breaker");
  });

  it("시간 예산을 넘기면 남은 것은 다음 날", async () => {
    const fake = makeDb([row(9001), row(9002)]);
    const { processBooking } = fakeProcessor(fake.tables);
    let t = 0;
    const fetchBooking = vi.fn(async (id: string) => {
      t += 16_000;
      return { ok: true as const, booking: { id: Number(id), status: "confirmed" } };
    });
    const result = await recheckUnverifiedBeds24Reservations(fake.client as never, {
      fetchBooking,
      processBooking,
      gate: openGate(),
      nowMs: () => t,
    });
    expect(fetchBooking).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ cleared: 1, stoppedReason: "budget" });
  });

  it("organizationId 를 주면 그 조직만", async () => {
    const fake = makeDb([row(9001), row(7000, { organization_id: OTHER })]);
    const { processBooking } = fakeProcessor(fake.tables);
    const fetchBooking = vi.fn(async (id: string) => ({ ok: true as const, booking: { id: Number(id), status: "confirmed" } }));
    await recheckUnverifiedBeds24Reservations(fake.client as never, { organizationId: OTHER, fetchBooking, processBooking, gate: openGate() });
    expect(fetchBooking.mock.calls.map((call) => call[0])).toEqual(["7000"]);
  });
  it("못 읽고 남은 행에는 다시 읽은 시각을 적고, 다음에는 coalesce(recheck_at, unverified_at) 오래된 순 — 돌아가며 읽는다", async () => {
    // 21개: 가장 오래된 1개(8000)가 매번 못 읽혀도 다음 날엔 뒤로 가서 21번째(8020)가 읽힌다.
    const rows = Array.from({ length: UNVERIFIED_RECHECK_LIMIT + 1 }, (_, i) =>
      row(8000 + i, {
        raw_payload: { id: 8000 + i, status: "confirmed", [UNVERIFIED_MARKER_KEY]: `2026-11-20T00:00:${String(i).padStart(2, "0")}.000Z` },
      }),
    );
    const fake = makeDb(rows);
    const { processBooking } = fakeProcessor(fake.tables);
    const fetchBooking = vi.fn(async (id: string) =>
      id === "8000" ? ({ ok: false as const, error: "unexpected_response" }) : ({ ok: true as const, booking: { id: Number(id), status: "confirmed" } }),
    );
    const day1 = await recheckUnverifiedBeds24Reservations(fake.client as never, {
      fetchBooking,
      processBooking,
      gate: openGate(),
      nowIso: () => "2026-11-26T05:00:00.000Z",
    });
    expect(day1).toMatchObject({ unavailable: 1, cleared: UNVERIFIED_RECHECK_LIMIT - 1 });
    expect(fetchBooking.mock.calls.map((call) => call[0])).not.toContain("8020");
    expect(fake.tables.reservations[0].raw_payload).toMatchObject({
      [UNVERIFIED_MARKER_KEY]: "2026-11-20T00:00:00.000Z",
      [UNVERIFIED_RECHECK_AT_KEY]: "2026-11-26T05:00:00.000Z",
    });
    // 지워진 행에는 다시 읽은 시각을 적지 않는다(Beds24 값으로 통째로 바뀜).
    expect(fake.tables.reservations[1].raw_payload).not.toHaveProperty(UNVERIFIED_RECHECK_AT_KEY);

    fetchBooking.mockClear();
    await recheckUnverifiedBeds24Reservations(fake.client as never, { fetchBooking, processBooking, gate: openGate() });
    expect(fetchBooking.mock.calls.map((call) => call[0])).toEqual(["8020", "8000"]);
  });

  it("정합 라우트 예산 — min(15초, 45초 − 지난 시간), 8초가 안 남으면 건너뛴다", () => {
    expect(unverifiedRecheckBudgetMs(0)).toBe(15_000);
    expect(unverifiedRecheckBudgetMs(35_000)).toBe(10_000);
    expect(unverifiedRecheckBudgetMs(37_000)).toBe(8_000);
    expect(unverifiedRecheckBudgetMs(37_001)).toBeNull();
    expect(unverifiedRecheckBudgetMs(60_000)).toBeNull();
  });

  it("예산이 8초보다 적으면 DB 도 Beds24 도 읽지 않고 skipped_time", async () => {
    const fake = makeDb([row(9001)]);
    const fetchBooking = vi.fn();
    const result = await recheckUnverifiedBeds24Reservations(fake.client as never, {
      fetchBooking: fetchBooking as never,
      gate: openGate(),
      budgetMs: 7_999,
    });
    expect(fetchBooking).not.toHaveBeenCalled();
    expect(result).toEqual({ candidates: 0, cleared: 0, cancelled: 0, unavailable: 0, leftoverMarked: 0, stoppedReason: "skipped_time" });
  });

  it("한 번 읽기 시한(5초)이 예산에 안 들어가면 더 읽지 않는다", async () => {
    const fake = makeDb([row(9001), row(9002)]);
    const { processBooking } = fakeProcessor(fake.tables);
    let t = 0;
    const fetchBooking = vi.fn(async (id: string) => {
      t += 4_000;
      return { ok: true as const, booking: { id: Number(id), status: "confirmed" } };
    });
    const result = await recheckUnverifiedBeds24Reservations(fake.client as never, {
      fetchBooking,
      processBooking,
      gate: openGate(),
      nowMs: () => t,
      budgetMs: 8_000,
    });
    expect(fetchBooking).toHaveBeenCalledTimes(1);
    expect(result.stoppedReason).toBe("budget");
  });

  it("예약 번호는 readBeds24OwnBookingId 로(bookId · book_id · id 순)", async () => {
    const fake = makeDb([row(9001, { raw_payload: { book_id: 9100, id: 9001, status: "confirmed", [UNVERIFIED_MARKER_KEY]: MARK } })]);
    const { processBooking } = fakeProcessor(fake.tables);
    const fetchBooking = vi.fn<(id: string) => Promise<{ ok: false; error: string }>>(async () => ({ ok: false as const, error: "unexpected_response" }));
    await recheckUnverifiedBeds24Reservations(fake.client as never, { fetchBooking, processBooking, gate: openGate() });
    expect(fetchBooking.mock.calls.map((call) => call[0])).toEqual(["9100"]);
  });
});
