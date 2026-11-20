import { beforeEach, describe, expect, it, vi } from "vitest";

import { countAwaitingOrNull } from "@/lib/guest-messages/inbox-server";
import { createWriteFreshness } from "@/lib/guest-messages/write-freshness";
import { guestThreadLiveSources, liveSourcesKey, liveSubscriptionKey } from "@/lib/live-sources";
import { createNavBadgeMerger, createNavBadgeOverrideStore, mergeNavBadges } from "@/lib/nav-badge-overrides";
import { createPaneMessageHandler, GUEST_WRITE_MESSAGE, ROW_MESSAGE } from "@/lib/guest-messages/pane-messages";
import { SPLIT_PANE_NAME } from "@/lib/split-pane";

vi.mock("server-only", () => ({}));

/**
 * 손님 메시지 — 버튼 한 번에 나가는 요청 줄이기(2026-11-20, 47 §5-9).
 * ① 쓰기 뒤 revalidatePath 없음 → 캐시에서 되살아난 화면은 `write-freshness` 판정으로 다시 읽고, 메뉴 숫자는 읽기 액션의 수로.
 * ② 대화를 바꿔도 같은 조직 토픽 구독은 그대로(나갔다 다시 들어가며 한 번 더 읽지 않는다).
 */
const ORG = "00000000-0000-4000-8000-000000000900";
const C1 = "00000000-0000-4000-8000-000000000001";
const C2 = "00000000-0000-4000-8000-000000000002";

describe("liveSubscriptionKey — 구독 정체성", () => {
  it("대화만 바뀌면(토픽 줄의 filter 만 다름) 같은 키 — 채널을 다시 열지 않는다", () => {
    expect(liveSubscriptionKey(guestThreadLiveSources(ORG, C1))).toBe(liveSubscriptionKey(guestThreadLiveSources(ORG, C2)));
    expect(liveSourcesKey(guestThreadLiveSources(ORG, C1))).not.toBe(liveSourcesKey(guestThreadLiveSources(ORG, C2)));
  });

  it("조직(토픽)이 바뀌면 다른 키", () => {
    const other = "00000000-0000-4000-8000-000000000901";
    expect(liveSubscriptionKey(guestThreadLiveSources(ORG, C1))).not.toBe(liveSubscriptionKey(guestThreadLiveSources(other, C1)));
  });

  it("토픽 없는 줄(postgres_changes)은 filter 까지 키 — 바뀌면 다시 구독", () => {
    const a = [{ table: "tasks", filter: "organization_id=eq.a" }];
    const b = [{ table: "tasks", filter: "organization_id=eq.b" }];
    expect(liveSubscriptionKey(a)).not.toBe(liveSubscriptionKey(b));
    expect(liveSubscriptionKey(a)).toBe(liveSourcesKey(a));
  });

  it("빈 목록은 빈 키", () => {
    expect(liveSubscriptionKey([])).toBe("");
  });
});

describe("write-freshness — 캐시에서 되살아난 화면 상황표", () => {
  const list = { kind: "list" } as const;
  const thread = (conversationId: string) => ({ kind: "thread", conversationId }) as const;
  /** 화면이 나타날 때 하는 일 그대로 — 판정(순수) 뒤 받은 번호 붙이기. 다시 읽어야 하면 true. */
  const appear = (f: ReturnType<typeof createWriteFreshness>, server: object, scope: Parameters<typeof f.isStale>[1]) => {
    const stale = f.isStale(server, scope);
    f.observe(server);
    return stale;
  };

  it("쓰기 없음 — 몇 번을 돌아와도 다시 읽지 않는다(추가 요청 0)", () => {
    const f = createWriteFreshness();
    const cachedList = {};
    const cachedThread = {};
    for (let i = 0; i < 3; i++) {
      expect(appear(f, cachedList, list)).toBe(false);
      expect(appear(f, cachedThread, thread(C1))).toBe(false);
    }
  });

  it("쓰기 뒤 첫 복귀 · 두 번째 복귀 — 캐시된 값은 계속 옛것이라 매번 다시 읽는다", () => {
    const f = createWriteFreshness();
    const cachedList = {};
    const cachedThread = {};
    appear(f, cachedList, list);
    appear(f, cachedThread, thread(C1));
    f.markWrite(C1);
    expect(appear(f, cachedList, list)).toBe(true);
    expect(appear(f, cachedThread, thread(C1))).toBe(true);
    expect(appear(f, cachedList, list)).toBe(true);
    expect(appear(f, cachedThread, thread(C1))).toBe(true);
  });

  it("다시 읽기 실패 뒤 복귀 — 판정이 아무것도 지우지 않아 다음에 또 다시 읽고, 새 값을 받으면 그친다", () => {
    const f = createWriteFreshness();
    const cached = {};
    appear(f, cached, list);
    f.markWrite(C1);
    expect(appear(f, cached, list)).toBe(true); // 다시 읽기 실패 — 새 값을 못 받음
    expect(appear(f, cached, list)).toBe(true); // 다음 복귀에 또
    const reloaded = {};
    expect(appear(f, reloaded, list)).toBe(false); // 성공해 새 값을 받으면 그 값은 새것
    expect(appear(f, reloaded, list)).toBe(false);
  });

  it("판정은 순수하다 — 받지 않은 값을 물어봐도 번호를 붙이지 않는다(그 뒤 받으면 그때가 받은 때)", () => {
    const f = createWriteFreshness();
    const later = {};
    expect(f.isStale(later, list)).toBe(false);
    f.markWrite(C1);
    expect(f.isStale(later, list)).toBe(false); // 아직 안 받음 = 새 렌더로 본다
    f.observe(later);
    expect(f.isStale(later, list)).toBe(false); // 쓰기 뒤에 받음
  });

  it("다른 대화 화면 진입 — 목록은 어느 대화든, 대화는 그 대화에 쓴 것만 본다", () => {
    const f = createWriteFreshness();
    const cachedList = {};
    const otherThread = {};
    appear(f, cachedList, list);
    appear(f, otherThread, thread(C2));
    f.markWrite(C1);
    expect(appear(f, otherThread, thread(C2))).toBe(false);
    expect(appear(f, cachedList, list)).toBe(true);
    expect(appear(f, {}, thread(C2))).toBe(false); // 처음 들어가는 다른 대화(새 렌더)도 요청 없음
  });
});

describe("write-freshness — PC 콘솔: 처음 연 대화(?c=A)로 다른 대화를 거쳐 돌아오기", () => {
  const A = { conversation: { id: C1 } };

  it("A 에서 쓰고 B 를 거쳐 A 로 돌아오면(읽어 둔 A 없음 · initial 은 옛 A) 옛 A 를 그리지 않는다 — 돌아올 때마다", () => {
    const f = createWriteFreshness();
    expect(f.shownInitialIsStale(A, C1, false)).toBe(false); // ?c=A 첫 렌더 — 아직 안 받음
    f.observe(A);
    f.markWrite(C1); // A 에서 답장 · 처리 끝
    expect(f.shownInitialIsStale(A, C2, false)).toBe(false); // B — initial 은 A 라 판정 밖
    expect(f.shownInitialIsStale(A, C1, false)).toBe(true);
    expect(f.shownInitialIsStale(A, C1, false)).toBe(true);
  });

  it("읽어 둔 A 를 보는 동안 받은 새 initial(A') → A 에 쓰기 → B → A 복귀 = 다시 읽기(리뷰 4차 재현)", () => {
    const f = createWriteFreshness();
    f.observe(A);
    const A2 = { conversation: { id: C1 } }; // 업무 만들기의 revalidatePath 로 새 서버 렌더
    expect(f.shownInitialIsStale(A2, C1, true)).toBe(false); // 읽어 둔 A 를 보이는 중 — 판정 밖
    f.observe(A2); // 받은 때 번호(효과)
    f.markWrite(C1);
    expect(f.shownInitialIsStale(A2, C2, false)).toBe(false);
    expect(f.shownInitialIsStale(A2, C1, false)).toBe(true);
  });

  it("쓰기가 없으면 몇 번 오가도 요청 0 · 읽어 둔 A 를 보이고 있으면 판정 밖", () => {
    const f = createWriteFreshness();
    f.observe(A);
    for (const id of [C1, C2, C1, C2, C1]) expect(f.shownInitialIsStale(A, id, false)).toBe(false);
    f.markWrite(C1);
    expect(f.shownInitialIsStale(A, C1, true)).toBe(false);
    expect(f.shownInitialIsStale(null, C1, false)).toBe(false);
    expect(f.shownInitialIsStale(A, null, false)).toBe(false);
  });

  it("다른 대화(B)에만 썼으면 A 로 돌아와도 그대로 보인다", () => {
    const f = createWriteFreshness();
    f.observe(A);
    f.markWrite(C2);
    expect(f.shownInitialIsStale(A, C1, false)).toBe(false);
  });
});

describe("pane-messages — 태블릿 칸이 보낸 신호를 바깥 목록이 받기", () => {
  type Win = { location: { origin: string }; parent?: unknown; name?: string };
  const self: Win = { location: { origin: "https://app.test" } };
  const pane: Win = { location: self.location, parent: self, name: SPLIT_PANE_NAME };
  function setup() {
    const calls = { marked: [] as string[], applied: [] as string[][], rows: [] as Array<[string, boolean]> };
    const handle = createPaneMessageHandler({
      self: self as never,
      freshness: { markWrite: (id: string) => calls.marked.push(id) },
      applyIds: (ids: string[]) => {
        calls.applied.push(ids);
      },
      setRowLeaving: (id: string, leaving: boolean) => calls.rows.push([id, leaving]),
    });
    return { calls, handle };
  }
  const event = (data: unknown, source: unknown = pane, origin = "https://app.test") => ({ data, source, origin }) as never;

  it("칸의 쓰기(gm-write) — 표시를 남기고 그 대화를 바로 다시 읽는다(메뉴 숫자도 같이, 실시간 없이)", () => {
    const { calls, handle } = setup();
    handle(event({ type: GUEST_WRITE_MESSAGE, id: C1 }));
    expect(calls.marked).toEqual([C1]);
    expect(calls.applied).toEqual([[C1]]);
  });

  it("줄 접힘(gm-row)은 접기 · 펴기만", () => {
    const { calls, handle } = setup();
    handle(event({ type: ROW_MESSAGE, id: C1, leaving: true }));
    handle(event({ type: ROW_MESSAGE, id: C1, leaving: false }));
    expect(calls.rows).toEqual([
      [C1, true],
      [C1, false],
    ]);
    expect(calls.applied).toEqual([]);
  });

  it("다른 출처 · 칸이 아닌 창(자기 자신 · 다른 이름 · 다른 부모 · 없음) · 모양이 틀린 신호는 버린다", () => {
    const { calls, handle } = setup();
    const write = { type: GUEST_WRITE_MESSAGE, id: C1 };
    handle(event(write, pane, "https://evil.test"));
    handle(event(write, self));
    handle(event(write, { ...pane, name: "other" }));
    handle(event(write, { ...pane, parent: {} }));
    handle(event(write, null));
    handle(event({ type: GUEST_WRITE_MESSAGE, id: 3 }));
    handle(event({ type: ROW_MESSAGE, id: C1, leaving: "yes" }));
    expect(calls).toEqual({ marked: [], applied: [], rows: [] });
  });
});

describe("mergeNavBadges · 메뉴 숫자 고쳐 쓰기", () => {
  it("처음 그리는 서버 숫자(번호 없음)는 그대로", () => {
    const store = createNavBadgeOverrideStore();
    store.report("messages", 1, store.begin());
    const server = { messages: 5 };
    expect(mergeNavBadges(server, store.stampOf(server), store.snapshot())).toBe(server);
  });

  it("서버 숫자 뒤에 시작한 읽기가 이긴다 — 캐시로 같은 묶음이 다시 그려져도", () => {
    const store = createNavBadgeOverrideStore();
    const server = { messages: 5, tasks: 2 };
    store.stamp(server);
    store.report("messages", 4, store.begin());
    expect(mergeNavBadges(server, store.stampOf(server), store.snapshot())).toEqual({ messages: 4, tasks: 2 });
    store.stamp(server); // 다시 그려도 번호는 그대로
    expect(mergeNavBadges(server, store.stampOf(server), store.snapshot())).toEqual({ messages: 4, tasks: 2 });
  });

  it("L1 — 서버 렌더보다 먼저 시작해 늦게 온 읽기는 더 새 서버 숫자를 덮지 않는다", () => {
    const store = createNavBadgeOverrideStore();
    const at = store.begin(); // 읽기 시작
    const fresh = { messages: 7 };
    store.stamp(fresh); // 그사이 새 서버 렌더가 그려짐
    store.report("messages", 3, at); // 옛 읽기 응답이 늦게 도착
    expect(mergeNavBadges(fresh, store.stampOf(fresh), store.snapshot())).toBe(fresh);
  });

  it("나중에 시작한 읽기가 먼저 알렸으면 먼저 시작한 읽기의 늦은 응답은 버린다", () => {
    const store = createNavBadgeOverrideStore();
    const server = { messages: 5 };
    store.stamp(server);
    const early = store.begin();
    const late = store.begin();
    store.report("messages", 2, late);
    store.report("messages", 9, early);
    expect(mergeNavBadges(server, store.stampOf(server), store.snapshot())).toEqual({ messages: 2 });
  });

  it("값이 같으면 같은 객체 · 0 은 0 으로 · 잘못된 수는 무시", () => {
    const store = createNavBadgeOverrideStore();
    const server = { messages: 3 };
    store.stamp(server);
    store.report("messages", 3, store.begin());
    expect(mergeNavBadges(server, store.stampOf(server), store.snapshot())).toBe(server);
    store.report("messages", 0, store.begin());
    expect(mergeNavBadges(server, store.stampOf(server), store.snapshot())).toEqual({ messages: 0 });
    const before = store.snapshot();
    store.report("messages", Number.NaN, store.begin());
    store.report("messages", -1, store.begin());
    expect(store.snapshot()).toBe(before);
  });

  it("알리면 구독자에게 알린다", () => {
    const store = createNavBadgeOverrideStore();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.report("messages", 1, store.begin());
    off();
    store.report("messages", 2, store.begin());
    expect(calls).toBe(1);
  });
});

describe("createNavBadgeMerger — 덮은 숫자가 있어도 내용이 같으면 같은 객체", () => {
  it("다시 그려도 · 알림 지도가 새로 바뀌어도 내용이 같으면 앞의 객체를 돌려준다", () => {
    const store = createNavBadgeOverrideStore();
    const merge = createNavBadgeMerger();
    const server = { messages: 5, tasks: 1 };
    store.stamp(server);
    store.report("messages", 2, store.begin());
    const first = merge(server, store.stampOf(server), store.snapshot());
    expect(first).toEqual({ messages: 2, tasks: 1 });
    expect(merge(server, store.stampOf(server), store.snapshot())).toBe(first);
    store.report("messages", 2, store.begin()); // 같은 수 · 새 번호 → 새 지도
    expect(merge(server, store.stampOf(server), store.snapshot())).toBe(first);
    store.report("messages", 1, store.begin());
    expect(merge(server, store.stampOf(server), store.snapshot())).toEqual({ messages: 1, tasks: 1 });
  });

  it("덮을 것이 없으면 서버 객체 그대로", () => {
    const merge = createNavBadgeMerger();
    const server = { messages: 5 };
    expect(merge(server, undefined, new Map())).toBe(server);
  });
});

describe("countAwaitingOrNull — 메뉴와 같은 세기, 못 세면 null", () => {
  function stub(result: { count: number | null; error: unknown } | Error) {
    const calls: Array<[string, unknown[]]> = [];
    const chain: Record<string, (...args: unknown[]) => unknown> = {};
    for (const name of ["from", "select", "eq"]) {
      chain[name] = (...args: unknown[]) => {
        calls.push([name, args]);
        return chain;
      };
    }
    chain.or = (...args: unknown[]) => {
      calls.push(["or", args]);
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    };
    return { db: chain as never, calls };
  }
  const now = new Date("2026-11-20T00:00:00.000Z");

  it("조직 · 기다림(끝난 나중에 포함)으로 정확히 센다", async () => {
    const { db, calls } = stub({ count: 612, error: null });
    expect(await countAwaitingOrNull(db, ORG, now)).toBe(612);
    expect(calls).toContainEqual(["eq", ["organization_id", ORG]]);
    expect(calls).toContainEqual(["or", ["status.eq.awaiting,and(status.eq.snoozed,snooze_until.lte.2026-11-20T00:00:00.000Z)"]]);
  });

  it("오류 · 숫자 없음 · 던짐은 null(0 으로 덮지 않게)", async () => {
    expect(await countAwaitingOrNull(stub({ count: null, error: { message: "x" } }).db, ORG, now)).toBeNull();
    expect(await countAwaitingOrNull(stub({ count: null, error: null }).db, ORG, now)).toBeNull();
    expect(await countAwaitingOrNull(stub(new Error("net")).db, ORG, now)).toBeNull();
  });
});

const actions = vi.hoisted(() => ({
  ok: true,
  calls: [] as string[],
}));
vi.mock("@/actions/guest-messages", () => {
  const result = () => (actions.ok ? { ok: true } : { ok: false, errorKey: "failed" });
  const named = (name: string) =>
    vi.fn(async () => {
      actions.calls.push(name);
      return result();
    });
  return {
    sendGuestReply: named("sendGuestReply"),
    addGuestInternalNote: named("addGuestInternalNote"),
    setGuestConversationDone: named("setGuestConversationDone"),
    snoozeGuestConversation: named("snoozeGuestConversation"),
    unsnoozeGuestConversation: named("unsnoozeGuestConversation"),
    retryGuestOutbox: named("retryGuestOutbox"),
  };
});

describe("guestWrites — 성공한 쓰기만 표시를 남긴다", () => {
  beforeEach(() => {
    actions.ok = true;
    actions.calls = [];
  });

  it("여섯 쓰기 모두 성공하면 그 대화에 쓰기 표시, 실패하면 남기지 않는다", async () => {
    const { guestWrites } = await import("@/components/guest-messages/guest-writes");
    const { guestWriteFreshness } = await import("@/lib/guest-messages/write-freshness");
    const writes: Array<() => Promise<unknown>> = [
      () => guestWrites.sendReply({ conversationId: C1, body: "Hi", idempotencyKey: "k".repeat(32) }),
      () => guestWrites.addNote({ conversationId: C1, body: "memo" }),
      () => guestWrites.setDone(C1, true),
      () => guestWrites.snooze(C1, { preset: "3h" }),
      () => guestWrites.unsnooze(C1),
      () => guestWrites.retry(C1, "00000000-0000-4000-8000-0000000000aa"),
    ];
    for (const write of writes) {
      const cached = {};
      guestWriteFreshness.observe(cached);
      actions.ok = false;
      await write();
      expect(guestWriteFreshness.isStale(cached, { kind: "thread", conversationId: C1 })).toBe(false);
      actions.ok = true;
      await write();
      expect(guestWriteFreshness.isStale(cached, { kind: "thread", conversationId: C1 })).toBe(true);
    }
    expect(actions.calls).toHaveLength(12);
  });
});
