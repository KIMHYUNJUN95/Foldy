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

/**
 * 실시간 변경 묶기 — 신호의 **id 만** 모아 화면이 그 항목만 다시 읽게 한다(2026-11-13, 손님 메시지 실시간).
 *
 * `createLiveRefreshScheduler` 와 규칙은 같고(디바운스 · 숨은 탭 · 끊김 따라잡기), 다른 점은 무엇이 바뀌었는지(열쇠)를 넘긴다는 것.
 * - 같은 열쇠가 여러 번 와도 한 번(`Set`). 신호가 계속 와도 `maxWaitMs` 안에는 한 번 내보낸다(끝없이 미뤄지지 않게).
 * - 열쇠가 `maxKeys` 를 넘으면(과거 가져오기 같은 홍수) 하나하나 읽지 않고 `catchUp()` 한 번 — 보이는 것만 통째로 다시 읽기.
 * - 숨은 탭에 온 열쇠는 모아 두었다가 다시 보일 때. 오래 가려졌거나 소켓이 다시 붙으면 `catchUp()`(놓친 신호를 알 수 없다).
 */
export const LIVE_CHANGE_MAX_WAIT_MS = 3_000;
export const LIVE_CHANGE_MAX_KEYS = 40;

export type LiveChangeBatcher = {
  /** 바뀐 것의 열쇠들. `visible` = 지금 탭이 보이는지. */
  add(keys: readonly string[], visible: boolean): void;
  onVisible(): void;
  onHidden(): void;
  onReconnect(): void;
  dispose(): void;
};

export function createLiveChangeBatcher({
  flush,
  catchUp,
  debounceMs = LIVE_REFRESH_DEBOUNCE_MS,
  maxWaitMs = LIVE_CHANGE_MAX_WAIT_MS,
  maxKeys = LIVE_CHANGE_MAX_KEYS,
  catchUpHiddenMs = LIVE_REFRESH_CATCH_UP_HIDDEN_MS,
  now = Date.now,
}: {
  flush: (keys: string[]) => void;
  catchUp: () => void;
  debounceMs?: number;
  maxWaitMs?: number;
  maxKeys?: number;
  catchUpHiddenMs?: number;
  now?: () => number;
}): LiveChangeBatcher {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstAt: number | null = null;
  let pending = new Set<string>();
  let overflow = false;
  let hiddenAt: number | null = null;
  let disposed = false;

  const fire = () => {
    timer = null;
    firstAt = null;
    const keys = [...pending];
    const whole = overflow;
    pending = new Set();
    overflow = false;
    if (disposed) return;
    if (whole) catchUp();
    else if (keys.length > 0) flush(keys);
  };

  const schedule = () => {
    if (disposed) return;
    const at = now();
    if (firstAt === null) firstAt = at;
    if (timer) clearTimeout(timer);
    const wait = Math.max(0, Math.min(debounceMs, firstAt + maxWaitMs - at));
    timer = setTimeout(fire, wait);
  };

  return {
    add(keys, visible) {
      if (disposed || keys.length === 0) return;
      if (!overflow) {
        for (const key of keys) pending.add(key);
        if (pending.size > maxKeys) {
          overflow = true;
          pending = new Set();
        }
      }
      if (visible) schedule();
    },
    onVisible() {
      const longHidden = hiddenAt !== null && now() - hiddenAt > catchUpHiddenMs;
      hiddenAt = null;
      if (longHidden) {
        overflow = true;
        pending = new Set();
      }
      if (overflow || pending.size > 0) schedule();
    },
    onHidden() {
      hiddenAt = now();
    },
    onReconnect() {
      overflow = true;
      pending = new Set();
      schedule();
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
