/**
 * private broadcast 토픽 나눠 쓰기 (2026-11-16, 손님 메시지 실시간) — `useLiveChannel` 이 쓴다.
 *
 * supabase-js 는 **같은 토픽이면 같은 채널 객체**를 돌려준다(`client.channel(topic)` 이 이미 있는 것을 찾음). private 토픽은
 * RLS 가 토픽 이름 그대로 비교하니 이름 뒤에 구분자를 붙일 수도 없다. 그래서 한 화면에 같은 토픽을 듣는 곳이 둘이면
 * (PC 손님 메시지 = 목록 + 열린 대화) 한쪽이 채널을 닫을 때 다른 쪽까지 끊긴다. 이 허브가 토픽마다 채널 하나를 열고
 * 듣는 곳을 세어, 마지막이 떠날 때만 닫는다. 닫히는 중에 다시 들어오면 닫힘이 끝난 뒤 새로 연다(닫히는 채널을 재사용하지 않게).
 *
 * 이미 붙어 있는 토픽에 늦게 들어온 곳에는 마지막 상태를 한 번 다시 알려 준다(`SUBSCRIBED` 면 그쪽의 「다시 붙음 → 따라잡기」가 돈다).
 *
 * 소켓은 모른다 — 여닫기는 `transport` 가 한다(시험에서는 가짜). 순수하다.
 */
export type PrivateTopicListener = {
  onMessage: (payload: unknown) => void;
  onStatus?: (status: string) => void;
};

export type PrivateTopicTransport<C> = {
  open: (topic: string, onMessage: (payload: unknown) => void, onStatus: (status: string) => void) => C;
  close: (channel: C) => Promise<unknown>;
};

type Entry<C> = { channel: C | null; listeners: Set<PrivateTopicListener>; lastStatus: string | null };

export function createPrivateTopicHub<C>(transport: PrivateTopicTransport<C>) {
  const entries = new Map<string, Entry<C>>();
  const closing = new Map<string, Promise<unknown>>();

  function join(topic: string, listener: PrivateTopicListener): () => void {
    let entry = entries.get(topic);
    if (!entry) {
      const created: Entry<C> = { channel: null, listeners: new Set(), lastStatus: null };
      entries.set(topic, created);
      const start = () => {
        // 닫힘을 기다리는 사이 모두 떠났거나 새 묶음으로 바뀌었으면 열지 않는다.
        if (entries.get(topic) !== created || created.listeners.size === 0) return;
        created.channel = transport.open(
          topic,
          (payload) => created.listeners.forEach((l) => l.onMessage(payload)),
          (status) => {
            created.lastStatus = status;
            created.listeners.forEach((l) => l.onStatus?.(status));
          },
        );
      };
      created.listeners.add(listener);
      const pending = closing.get(topic);
      if (pending) void pending.then(start, start);
      else start();
      entry = created;
    } else {
      entry.listeners.add(listener);
      // 이미 붙어 있는 채널에 늦게 들어왔다 — 지금 상태를 한 번 알려 준다(처음 붙음 · 다시 붙음 판정이 그대로 돌게).
      if (entry.lastStatus) listener.onStatus?.(entry.lastStatus);
    }

    const joined = entry;
    return () => {
      if (!joined.listeners.delete(listener) || joined.listeners.size > 0) return;
      if (entries.get(topic) === joined) entries.delete(topic);
      if (!joined.channel) return;
      const done: Promise<unknown> = transport
        .close(joined.channel)
        .catch(() => undefined)
        .then(() => {
          if (closing.get(topic) === done) closing.delete(topic);
        });
      closing.set(topic, done);
    };
  }

  return { join, size: () => entries.size };
}
