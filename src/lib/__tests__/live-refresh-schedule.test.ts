import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveRefreshScheduler } from "@/lib/live-refresh-schedule";

/**
 * 실시간 갱신 스케줄 (2026-10-29) — 신호가 몰려도 한 번, 숨은 탭은 미뤘다가, 오래 가려졌거나 다시 붙으면 따라잡기.
 * 화면 쪽은 `src/components/shared/live-refresh.tsx`.
 */
describe("createLiveRefreshScheduler", () => {
  let now = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    now = 0;
  });
  afterEach(() => vi.useRealTimers());

  function make() {
    const refresh = vi.fn();
    const s = createLiveRefreshScheduler({ refresh, now: () => now });
    return { refresh, s };
  }

  it("debouncesBurst — 보이는 상태의 신호 5번은 600ms 뒤 한 번", () => {
    const { refresh, s } = make();
    for (let i = 0; i < 5; i += 1) s.onSignal(true);
    vi.advanceTimersByTime(599);
    expect(refresh).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("defersWhileHidden — 숨은 탭은 미뤘다가 보일 때 한 번", () => {
    const { refresh, s } = make();
    s.onHidden();
    s.onSignal(false);
    vi.advanceTimersByTime(5_000);
    expect(refresh).toHaveBeenCalledTimes(0);
    s.onVisible();
    vi.advanceTimersByTime(600);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("catchUpAfterLongHidden — 60초 넘게 가려졌으면 신호 없이도 한 번", () => {
    const { refresh, s } = make();
    s.onHidden();
    now = 61_000;
    s.onVisible();
    vi.advanceTimersByTime(600);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("noCatchUpAfterShortHidden — 잠깐 가려진 탭은 다시 읽지 않는다", () => {
    const { refresh, s } = make();
    s.onHidden();
    now = 10_000;
    s.onVisible();
    vi.advanceTimersByTime(5_000);
    expect(refresh).toHaveBeenCalledTimes(0);
  });

  it("reconnectRefreshes — 다시 붙으면 한 번", () => {
    const { refresh, s } = make();
    s.onReconnect();
    vi.advanceTimersByTime(600);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("dispose 뒤엔 남은 타이머가 돌지 않는다", () => {
    const { refresh, s } = make();
    s.onSignal(true);
    s.dispose();
    vi.advanceTimersByTime(5_000);
    expect(refresh).toHaveBeenCalledTimes(0);
  });
});
