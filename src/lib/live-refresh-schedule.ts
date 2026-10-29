/**
 * 실시간 갱신 스케줄 — 언제 화면을 다시 읽을지만 정한다(브라우저 · 소켓과 무관한 순수 로직, 2026-10-29).
 *
 * `src/components/shared/live-refresh.tsx` 가 쓴다. 규칙은 Beds24 실시간(`beds24-live-refresh.tsx`)과 같다.
 * - 신호가 몰려 와도 `debounceMs` 안이면 **한 번**만 다시 읽는다.
 * - 숨은 탭에 온 신호는 미뤘다가 다시 보일 때 한 번.
 * - 신호는 저장되지 않아서 끊긴 동안 온 것은 사라진다 — `catchUpHiddenMs` 넘게 가려졌다 보이거나,
 *   소켓이 다시 붙거나 네트워크가 돌아오면(`onReconnect`) 신호 없이도 한 번 다시 읽는다.
 */
export const LIVE_REFRESH_DEBOUNCE_MS = 600;
export const LIVE_REFRESH_CATCH_UP_HIDDEN_MS = 60_000;

export type LiveRefreshScheduler = {
  /** 변경 신호가 왔다. `visible` = 지금 탭이 보이는지. */
  onSignal(visible: boolean): void;
  onVisible(): void;
  onHidden(): void;
  /** 소켓이 끊겼다 다시 붙었거나 네트워크가 돌아왔다. */
  onReconnect(): void;
  dispose(): void;
};

export function createLiveRefreshScheduler({
  refresh,
  debounceMs = LIVE_REFRESH_DEBOUNCE_MS,
  catchUpHiddenMs = LIVE_REFRESH_CATCH_UP_HIDDEN_MS,
  now = Date.now,
}: {
  refresh: () => void;
  debounceMs?: number;
  catchUpHiddenMs?: number;
  now?: () => number;
}): LiveRefreshScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  let hiddenAt: number | null = null;
  let disposed = false;

  const schedule = () => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      pending = false;
      refresh();
    }, debounceMs);
  };

  return {
    onSignal(visible) {
      if (!visible) {
        pending = true;
        return;
      }
      schedule();
    },
    onVisible() {
      const longHidden = hiddenAt !== null && now() - hiddenAt > catchUpHiddenMs;
      hiddenAt = null;
      if (pending || longHidden) schedule();
    },
    onHidden() {
      hiddenAt = now();
    },
    onReconnect() {
      schedule();
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
