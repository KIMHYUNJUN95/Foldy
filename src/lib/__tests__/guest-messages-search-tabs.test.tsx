import { StrictMode, act, useEffect, type ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { inboxListKey, inboxSearchSlotKey } from "@/lib/guest-messages/inbox-search";

/**
 * 손님 메시지 검색 — 상태 탭을 바꿔도 다시 묻지 않고 결과도 비지 않는다(47 §5-10).
 * 실제 React(`react-dom/client` + `act`)로 마운트한다. 이 저장소엔 jsdom · Testing Library 가 없어서, 화면 요소를 그리지 않는
 * 시험 부품만 쓰고 react-dom 이 건드리는 DOM 몇 개(이벤트 등록 · location · history)만 흉내 낸다.
 * 페이지 모양을 그대로 따른다 — 건물 · 채널이 같으면 검색 자리(`InboxSearchProvider`)는 그대로, 목록만 상태 탭으로 `key` 가 바뀐다.
 * key 는 페이지와 같은 함수(`inboxSearchSlotKey` · `inboxListKey`)로 만든다.
 */

const server = vi.hoisted(() => ({
  calls: [] as { query: string; input: Record<string, unknown>; resolve: (value: unknown) => void }[],
}));

vi.mock("@/actions/guest-messages", () => ({
  searchGuestConversations: (input: { query: string }) =>
    new Promise((resolve) => {
      server.calls.push({ query: input.query, input: { ...input }, resolve });
    }),
}));

const noop = () => {};
const fakeDocument = { nodeType: 9, activeElement: null, addEventListener: noop, removeEventListener: noop, body: {} };
const fakeLocation = { href: "http://local/mobile/messages?q=ab", pathname: "/mobile/messages" };
vi.stubGlobal("document", fakeDocument);
vi.stubGlobal("window", {
  document: fakeDocument,
  location: fakeLocation,
  history: { replaceState: noop },
  HTMLIFrameElement: class {},
  addEventListener: noop,
  removeEventListener: noop,
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Search = ReturnType<typeof import("@/components/guest-messages/use-inbox-search").useInboxSearch>;
let createRoot: typeof import("react-dom/client").createRoot;
let Provider: typeof import("@/components/guest-messages/inbox-search-provider").InboxSearchProvider;
let useSearch: typeof import("@/components/guest-messages/inbox-search-provider").useInboxSearchContext;

beforeAll(async () => {
  ({ createRoot } = await import("react-dom/client"));
  ({ InboxSearchProvider: Provider, useInboxSearchContext: useSearch } = await import(
    "@/components/guest-messages/inbox-search-provider"
  ));
});

/** 목록이 마지막으로 그린 검색 상태 — 그린 뒤(effect)에 적는다. */
const seen: { current: Search | null } = { current: null };
function List() {
  const search = useSearch();
  useEffect(() => {
    seen.current = search;
  });
  return null;
}

const filter = { building: null, channel: "all" as const };
const hit = (id: string) => ({ row: { id }, match: { hits: ["name"], snippet: null } });
const answerOf = (...ids: string[]) => ({ ok: true, query: "ab", results: ids.map(hit), truncated: false, bodyRecentOnly: false });

function mount(strict: boolean) {
  const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", ownerDocument: fakeDocument, addEventListener: noop, removeEventListener: noop };
  const root = createRoot(container as unknown as Element);
  const page = (status: string): ReactNode => {
    const tree = (
      <Provider key={inboxSearchSlotKey(filter)} {...filter} initialQuery="ab">
        <List key={inboxListKey(status)} />
      </Provider>
    );
    return strict ? <StrictMode>{tree}</StrictMode> : tree;
  };
  return {
    show: (status: string) => act(() => root.render(page(status))),
    unmount: () => act(() => root.unmount()),
  };
}

async function answer(index: number, value: unknown) {
  await act(async () => {
    server.calls[index].resolve(value);
  });
}
const ids = () => (seen.current?.answer?.status === "ready" ? seen.current.answer.results.map((r) => r.row.id) : null);

beforeEach(() => {
  server.calls.length = 0;
  seen.current = null;
});
afterEach(() => {
  vi.useRealTimers();
});

describe.each([
  ["보통", false],
  ["StrictMode", true],
])("상태 탭 바꾸기 — %s", (_label, strict) => {
  /** StrictMode 는 처음 마운트 때 effect 를 두 번 돌려 첫 검색이 두 번 나간다(개발 모드만) — 마지막 것이 진짜 답. */
  async function start() {
    const view = mount(strict);
    await view.show("needs_reply");
    const base = server.calls.length;
    expect(base).toBe(strict ? 2 : 1);
    for (let i = 0; i < base; i += 1) await answer(i, answerOf("c1"));
    expect(ids()).toEqual(["c1"]);
    return { view, base };
  }

  it("A → B: 서버에 다시 묻지 않고 결과도 그대로", async () => {
    const { view, base } = await start();
    await view.show("done");
    expect(server.calls.length).toBe(base);
    expect(seen.current?.loading).toBe(false);
    expect(ids()).toEqual(["c1"]);
    view.unmount();
  });

  it("A → B → C: 가장 새 답을 쓴다", async () => {
    const { view, base } = await start();
    await view.show("done");
    await act(async () => seen.current?.refresh());
    expect(server.calls.length).toBe(base + 1);
    await answer(base, answerOf("c2", "c1"));
    expect(ids()).toEqual(["c2", "c1"]);
    await view.show("snoozed");
    expect(server.calls.length).toBe(base + 1);
    expect(ids()).toEqual(["c2", "c1"]);
    view.unmount();
  });

  it("바꾸기 바로 전 refresh — 그 답이 바꾼 뒤 목록에 들어온다", async () => {
    const { view, base } = await start();
    await act(async () => seen.current?.refresh()); // 「처리 끝」 · 「나중에」 뒤
    expect(server.calls.length).toBe(base + 1);
    await view.show("done"); // 답이 오기 전에 탭을 바꿈
    expect(ids()).toEqual(["c1"]); // 그동안 보이던 결과는 그대로(깜빡이지 않음)
    await answer(base, answerOf("c3"));
    expect(ids()).toEqual(["c3"]);
    expect(server.calls.length).toBe(base + 1);
    view.unmount();
  });

  it("검색어를 지우면 남는 답이 없다 — 같은 말을 다시 치면 새로 묻는다", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { view, base } = await start();
    await act(async () => seen.current?.clear());
    await view.show("done");
    expect(seen.current?.active).toBe(false);
    expect(seen.current?.answer).toBeNull();
    expect(server.calls.length).toBe(base);
    await act(async () => seen.current?.change("ab"));
    expect(seen.current?.answer).toBeNull(); // 지우기 전 결과를 새 결과처럼 보이지 않는다
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(server.calls.length).toBe(base + 1);
    view.unmount();
  });
});

describe("페이지 key · 검색 요청 모양", () => {
  it("검색 자리 key 는 건물 · 채널로만 바뀌고 상태 탭과 상관없다 · 목록 key 는 상태 탭", () => {
    expect(inboxSearchSlotKey({ building: null, channel: "all" })).toBe(inboxSearchSlotKey({ building: null, channel: "all" }));
    expect(inboxSearchSlotKey({ building: "b1", channel: "all" })).not.toBe(inboxSearchSlotKey({ building: null, channel: "all" }));
    expect(inboxSearchSlotKey({ building: null, channel: "airbnb" })).not.toBe(inboxSearchSlotKey({ building: null, channel: "all" }));
    expect(inboxListKey("awaiting")).not.toBe(inboxListKey("done"));
  });

  it("검색 서버 액션에는 상태를 보내지 않는다(검색어 · 건물 · 채널만)", async () => {
    const view = mount(false);
    await view.show("done");
    expect(server.calls.length).toBe(1);
    expect(Object.keys(server.calls[0].input).sort()).toEqual(["building", "channel", "query"]);
    expect(server.calls[0].input).not.toHaveProperty("status");
    await act(async () => seen.current?.refresh());
    expect(server.calls.every((call) => !("status" in call.input))).toBe(true);
    view.unmount();
  });
});
