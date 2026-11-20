/**
 * 손님 메시지 — 서버가 준 값(목록 · 대화)이 「내 쓰기 전」 값인지 판정하는 한 곳(2026-11-20, 47 §5-9).
 *
 * 쓰기가 `revalidatePath` 를 부르지 않으니 브라우저 라우터 캐시(뒤로 · 앞으로 · 다시 들어오기)와 PC 의 첫 대화(`?c=`)는
 * 쓰기 전 서버 값을 그대로 다시 준다. 그래서 두 가지에 번호를 매긴다:
 * - **받을 때** `observe(서버 값)` — 화면이 그 값을 props 로 받은 즉시(효과에서) 한 번. 이미 번호가 있으면 그대로.
 * - 쓰기가 성공할 때 `markWrite(대화 id)`.
 * 판정 `isStale` 은 **번호를 건드리지 않는 순수 함수**라 렌더 중에도 부를 수 있다: 「받은 뒤에 쓰기가 있었나」.
 * - 번호 없는 값(아직 받지 않음 = 새 서버 렌더) → 새것(요청 0).
 * - 받은 뒤 쓰기 → 옛것. 다시 읽어도 그 값은 계속 옛것이라 **보여 줄 때마다** 옛것이다(한 번 꺼내 지우지 않음) — 다시 읽기가 실패해도 다음에 또.
 * 목록은 어느 대화든, 대화는 그 대화에 쓴 것만 본다. 문서(창) 하나에 하나 — React 를 모른다.
 * 한계: 쓰기 전에 받아 두고(예: 미리 받기) 쓰기 뒤에 처음 그린 값은 받은 때를 모르니 새것으로 본다(드묾).
 */
export type FreshnessScope = { kind: "list" } | { kind: "thread"; conversationId: string };

export function createWriteFreshness() {
  let clock = 0;
  let lastAnyWrite = 0;
  const lastWrite = new Map<string, number>();
  const received = new WeakMap<object, number>();
  const isStale = (server: object, scope: FreshnessScope): boolean => {
    const at = received.get(server);
    if (at === undefined) return false;
    const written = scope.kind === "list" ? lastAnyWrite : (lastWrite.get(scope.conversationId) ?? 0);
    return written > at;
  };
  return {
    /** 이 창에서 그 대화에 쓰기가 성공했다. */
    markWrite(conversationId: string) {
      const at = ++clock;
      lastAnyWrite = at;
      lastWrite.set(conversationId, at);
    },
    /** 화면이 서버 값을 받았다 — 처음일 때만 번호를 준다. */
    observe(server: object) {
      if (!received.has(server)) received.set(server, ++clock);
    },
    /** 받은 뒤 쓰기가 있었나. 순수하다(번호를 주지도 지우지도 않음). */
    isStale,
    /** 대화 화면 — 보여 주려는 값이 서버가 준 `initial` 이고(그 대화를 읽어 둔 값이 없음) 받은 뒤 이 대화에 썼나. 순수하다. */
    shownInitialIsStale(initial: { conversation: { id: string } } | null, conversationId: string | null, hasLoaded: boolean): boolean {
      if (!initial || !conversationId || hasLoaded || initial.conversation.id !== conversationId) return false;
      return isStale(initial, { kind: "thread", conversationId });
    },
  };
}

export const guestWriteFreshness = createWriteFreshness();
