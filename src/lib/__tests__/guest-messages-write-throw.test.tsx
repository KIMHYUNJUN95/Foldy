import { act, useEffect } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 손님 메시지 쓰기가 던질 때(네트워크 오류 등) — 실패 결과로 바꿔 `onDone` 을 부른다(47 §5-10 「줄 접힘」).
 * 안 그러면 PC 는 접어 둔 줄이 그대로, 태블릿 칸은 `tellList(null)` 이 안 가서 바깥 줄이 접힌 채, 오류 토스트도 없다.
 * 실제 `useThread` 를 react-dom + act 로 돌린다(jsdom 없음 — search-tabs 시험과 같은 방식).
 */

const writes = vi.hoisted(() => ({ throwNext: true }));

vi.mock("@/actions/guest-messages", () => ({
  getGuestConversation: () => new Promise(() => {}),
}));
vi.mock("@/components/guest-messages/guest-writes", () => {
  const go = () => (writes.throwNext ? Promise.reject(new Error("network")) : Promise.resolve({ ok: true as const }));
  return { guestWrites: { setDone: go, snooze: go, unsnooze: go } };
});
vi.mock("@/lib/haptics", () => ({ haptic: () => {} }));

const noop = () => {};
const fakeDocument = { nodeType: 9, activeElement: null, addEventListener: noop, removeEventListener: noop, body: {} };
vi.stubGlobal("document", fakeDocument);
vi.stubGlobal("window", {
  document: fakeDocument,
  location: { href: "http://local/admin/messages", pathname: "/admin/messages", origin: "http://local" },
  HTMLIFrameElement: class {},
  addEventListener: noop,
  removeEventListener: noop,
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Controller = ReturnType<typeof import("@/components/guest-messages/use-thread").useThread>;
let createRoot: typeof import("react-dom/client").createRoot;
let useThread: typeof import("@/components/guest-messages/use-thread").useThread;

beforeAll(async () => {
  ({ createRoot } = await import("react-dom/client"));
  ({ useThread } = await import("@/components/guest-messages/use-thread"));
});

const initial = { conversation: { id: "c1", state: "awaiting" } } as unknown as import("@/lib/guest-messages/inbox-model").InboxThread;

const seen: { current: Controller | null } = { current: null };
function Probe() {
  const controller = useThread("c1", initial);
  useEffect(() => {
    seen.current = controller;
  });
  return null;
}

async function mount() {
  const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", ownerDocument: fakeDocument, addEventListener: noop, removeEventListener: noop };
  const root = createRoot(container as unknown as Element);
  await act(async () => root.render(<Probe />));
  return root;
}

beforeEach(() => {
  writes.throwNext = true;
  seen.current = null;
});

describe("쓰기가 던지면 실패 결과로 onDone", () => {
  it.each([
    ["처리 끝", (c: Controller, done: (r: unknown) => void) => c.setDone(true, done)],
    ["나중에", (c: Controller, done: (r: unknown) => void) => c.snooze({ kind: "preset", preset: "1h" } as never, done)],
    ["나중에 풀기", (c: Controller, done: (r: unknown) => void) => c.unsnooze(done)],
  ])("%s — onDone({ ok:false, errorKey:'failed' }) · pending 풀림 · 낙관 상태 되돌아감", async (_label, press) => {
    const root = await mount();
    const results: unknown[] = [];
    await act(async () => {
      press(seen.current!, (r) => results.push(r));
    });
    expect(results).toEqual([{ ok: false, errorKey: "failed" }]);
    expect(seen.current!.pending).toBe(false);
    expect(seen.current!.state).toBe("awaiting");
    await act(async () => root.unmount());
  });
});

describe("settleWrite — 실행 취소 등 run 밖의 쓰기도 같은 길", () => {
  it("던지면 failed, 아니면 그대로", async () => {
    const { settleWrite } = await import("@/lib/guest-messages/settle-write");
    await expect(settleWrite(() => Promise.reject(new Error("x")))).resolves.toEqual({ ok: false, errorKey: "failed" });
    await expect(settleWrite(() => Promise.resolve({ ok: true as const }))).resolves.toEqual({ ok: true });
  });
});
