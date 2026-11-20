/**
 * 손님 메시지 검색 — 언제 서버에 물을지 정하는 부분(47 §5-10). React 와 떨어져 있어 시계를 바꿔 끼워 시험한다.
 *
 * - 입력: 글자를 칠 때마다 300ms 를 다시 센다. 그 사이 앞 검색어의 답이 오면 버린다(지금 검색어만 받는다).
 * - 한 번에 하나: 서버 액션은 중간에 끊을 수 없고, 한 화면에서 차례로 돈다. 그래서 묻고 있는 동안 새로 찾을 말이 생기면
 *   **마지막 하나만** 기다리게 두고(중간 것은 보내지 않는다), 앞 답이 오면 바로 그것을 보낸다.
 * - 실시간 신호: 신호마다 다시 찾지 않는다 — 앞 검색에서 `liveGapMs` 가 지나야 한 번(그 안에 온 신호는 끝에 한 번으로 모은다).
 *   입력 중(300ms 대기 중)에는 건너뛴다(어차피 곧 새로 찾는다).
 * - 내 손으로 바꾼 것(처리 끝 · 나중에 · 답장 보냄)은 `refresh()` — 바로 다시 찾는다.
 * - 주소: 입력이 멈춘 뒤 쓴다. 그 전에 화면을 떠나면 안 쓴 주소가 남는다 — 떠나기 직전(누름)에 `flush()`, 사라질 때(`dispose`)도
 *   남아 있으면 쓰고 끝낸다(뒤로 돌아왔을 때 마지막 글자가 빠지지 않게).
 * - 지운 뒤 같은 말을 다시 치면 지우기 전에 묻던 답은 받지 않는다(새로 묻는다).
 */

export const SEARCH_DEBOUNCE_MS = 300;
/** 실시간 신호로 다시 찾는 최소 간격. */
export const LIVE_SEARCH_GAP_MS = 5000;

type Timers = {
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  now: () => number;
};

export type SearchRunnerOptions<R> = {
  fetch: (query: string) => Promise<R>;
  /** 서버에 묻기 시작할 때. */
  onStart?: (query: string) => void;
  /** 지금 검색어의 답(실패는 null). 지난 검색어의 답은 부르지 않는다. */
  onResult: (query: string, result: R | null) => void;
  /** 입력이 멈춰 검색어가 정해졌을 때(주소 `q` 쓰기). 지울 때는 바로 null. */
  onCommit?: (query: string | null) => void;
  debounceMs?: number;
  liveGapMs?: number;
  timers?: Timers;
};

export type SearchRunner = {
  /** 입력이 바뀜 — null 이면 검색을 멈춘다. */
  type: (query: string | null) => void;
  /** 엔터 — 기다리지 않고 바로. */
  submit: (query: string | null) => void;
  /** 내 손으로 바꾼 뒤 — 같은 검색어로 바로 다시(입력 중이면 건너뜀). */
  refresh: () => void;
  /** 실시간 신호 — 간격을 두고 모아서 다시. */
  live: () => void;
  /** 입력 중이라 아직 안 쓴 주소를 지금 쓴다(검색은 그대로 300ms 뒤). 화면을 떠나기 직전에. */
  flush: () => void;
  /** 멈춘다 — 안 쓴 주소가 있으면 쓰고, 그 뒤로는 아무것도 부르지 않는다. */
  dispose: () => void;
};

const browserTimers: Timers = {
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export function createSearchRunner<R>(options: SearchRunnerOptions<R>): SearchRunner {
  const { fetch, onStart, onResult, onCommit } = options;
  const debounceMs = options.debounceMs ?? SEARCH_DEBOUNCE_MS;
  const liveGapMs = options.liveGapMs ?? LIVE_SEARCH_GAP_MS;
  const timers = options.timers ?? browserTimers;

  /** 지금 화면이 원하는 검색어(입력이 멈추기 전에도 바로 바뀐다 — 지난 답을 버리는 기준). */
  let wanted: string | null = null;
  let inflight = false;
  /** 묻는 동안 새로 찾을 말 — 마지막 하나만. */
  let pending: string | null = null;
  let typingTimer: unknown = null;
  let liveTimer: unknown = null;
  let lastStartAt = Number.NEGATIVE_INFINITY;
  let disposed = false;
  /** 입력 중이라 아직 주소에 안 쓴 검색어(없으면 null). */
  let uncommitted: string | null = null;
  /** 지울 때마다 하나 올린다 — 지우기 전에 보낸 답은 같은 검색어라도 받지 않는다. */
  let round = 0;

  const clearTyping = () => {
    if (typingTimer !== null) timers.clearTimeout(typingTimer);
    typingTimer = null;
  };
  const clearLive = () => {
    if (liveTimer !== null) timers.clearTimeout(liveTimer);
    liveTimer = null;
  };

  const commitNow = () => {
    if (uncommitted === null) return;
    const query = uncommitted;
    uncommitted = null;
    onCommit?.(query);
  };

  const start = (query: string) => {
    const startedRound = round;
    inflight = true;
    lastStartAt = timers.now();
    onStart?.(query);
    fetch(query)
      .then(
        (result) => result,
        () => null,
      )
      .then((result) => {
        inflight = false;
        if (disposed) return;
        if (query === wanted && startedRound === round) onResult(query, result);
        const next = pending;
        pending = null;
        if (next !== null && next === wanted) start(next);
      });
  };

  const request = (query: string) => {
    wanted = query;
    if (inflight) {
      pending = query;
      return;
    }
    start(query);
  };

  return {
    type(query) {
      if (disposed) return;
      clearTyping();
      wanted = query;
      if (query === null) {
        pending = null;
        uncommitted = null;
        round += 1;
        clearLive();
        onCommit?.(null);
        return;
      }
      // 앞 검색어를 기다리던 것은 보내지 않는다 — 입력이 멈추면 지금 말로 보낸다.
      pending = null;
      uncommitted = query;
      typingTimer = timers.setTimeout(() => {
        typingTimer = null;
        commitNow();
        request(query);
      }, debounceMs);
    },
    submit(query) {
      if (disposed) return;
      clearTyping();
      wanted = query;
      uncommitted = null;
      if (query === null) {
        pending = null;
        return;
      }
      onCommit?.(query);
      request(query);
    },
    refresh() {
      if (disposed || wanted === null || typingTimer !== null) return;
      clearLive();
      request(wanted);
    },
    live() {
      if (disposed || wanted === null || typingTimer !== null || liveTimer !== null) return;
      const wait = lastStartAt + liveGapMs - timers.now();
      if (wait <= 0) {
        request(wanted);
        return;
      }
      liveTimer = timers.setTimeout(() => {
        liveTimer = null;
        if (disposed || wanted === null || typingTimer !== null) return;
        request(wanted);
      }, wait);
    },
    flush() {
      if (!disposed) commitNow();
    },
    dispose() {
      if (disposed) return;
      commitNow();
      disposed = true;
      clearTyping();
      clearLive();
      pending = null;
    },
  };
}
