import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 조용한 갱신의 시간 제한(2026-11-18) — Next 액션 줄에서 잃어버린 요청(끝나지 않는 약속)에 폴링 잠금이 영영 묶이지 않는다.
 * 원인 추적: `src/lib/live-request.ts` 머리말.
 */

const never = <T,>() => new Promise<T>(() => {});

vi.mock("@/actions/beds24-credit", () => ({
  loadBeds24CreditCalls: vi.fn(() => never()),
  loadBeds24CreditDetail: vi.fn(() => never()),
  loadBeds24CreditSummary: vi.fn(() => never()),
}));

afterEach(() => {
  vi.useRealTimers();
});

describe("settleWithin", () => {
  it("제한 안에 끝나면 그 값", async () => {
    const { settleWithin } = await import("@/lib/live-request");
    await expect(settleWithin(Promise.resolve(7), 1000)).resolves.toBe(7);
  });

  it("원래 실패는 그대로 실패", async () => {
    const { settleWithin } = await import("@/lib/live-request");
    await expect(settleWithin(Promise.reject(new Error("x")), 1000)).rejects.toThrow("x");
  });

  it("끝나지 않으면 제한 시간 뒤 실패한다", async () => {
    vi.useFakeTimers();
    const { settleWithin, LiveRequestTimeout } = await import("@/lib/live-request");
    const run = settleWithin(never<number>(), 20_000);
    const seen = run.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(19_999);
    let settled = false;
    void run.then(
      () => (settled = true),
      () => (settled = true),
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await seen).toBeInstanceOf(LiveRequestTimeout);
  });
});

describe("크레딧 읽기 — 액션이 끝나지 않아도 실패로 돌아와 잠금이 풀린다", () => {
  it("fetchCreditDetail · fetchCreditSummary 는 제한 시간 뒤 { ok: false }", async () => {
    vi.useFakeTimers();
    const { LIVE_REQUEST_TIMEOUT_MS } = await import("@/lib/live-request");
    const { fetchCreditDetail, fetchCreditSummary } = await import("@/components/shared/beds24-credit-live");
    const detail = fetchCreditDetail("today");
    const summary = fetchCreditSummary();
    await vi.advanceTimersByTimeAsync(LIVE_REQUEST_TIMEOUT_MS);
    await expect(detail).resolves.toEqual({ ok: false });
    await expect(summary).resolves.toEqual({ ok: false });
  });
});

describe("최근 호출 읽기 — 액션이 끝나지 않으면 제한 시간 뒤 실패(null)", () => {
  it("fetchCalls 는 20초 뒤 null — 「더 보기」 · 첫 장 잠금이 풀린다", async () => {
    vi.useFakeTimers();
    const { LIVE_REQUEST_TIMEOUT_MS } = await import("@/lib/live-request");
    const { fetchCalls } = await import("@/components/shared/beds24-credit-calls");
    let result: unknown = "pending";
    void fetchCalls("today", { actor: null, feature: null }, null).then((value) => (result = value));
    await vi.advanceTimersByTimeAsync(LIVE_REQUEST_TIMEOUT_MS - 1);
    expect(result).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBeNull();
  });
});
