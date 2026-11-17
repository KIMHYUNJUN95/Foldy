import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bookingKey,
  countAppended,
  createKeyedSingleFlight,
  inboxLiveReducer,
  initialInboxLive,
  pruneLocalLeaving,
  dropRows,
  idsOfKind,
  inUpcoming,
  listKey,
  liveKeysOf,
  mergeAutoRuns,
  mergeInboxRows,
  mergeRuleCounts,
  mergeThread,
  replaceInboxRows,
  runKey,
  threadKey,
  touchesThread,
} from "@/lib/guest-messages/live-merge";
import type { AutoRunView } from "@/lib/guest-messages/auto-model";
import type { InboxConversationRow, InboxListData, InboxMessage, InboxThread } from "@/lib/guest-messages/inbox-model";
import { createLiveChangeBatcher } from "@/lib/live-refresh-schedule";
import {
  autoRunLiveSources,
  guestInboxLiveSources,
  guestThreadLiveSources,
  liveSourcesKey,
  parseLiveSourcesKey,
  pickLiveIds,
} from "@/lib/live-sources";

/** 손님 메시지 실시간(47 §5-9) — 신호 → 열쇠 · 합치기 · 묶기. 순수 로직만(소켓 · 서버 없음). */
const ORG = "00000000-0000-4000-8000-0000000000aa";
const C1 = "00000000-0000-4000-8000-000000000001";
const C2 = "00000000-0000-4000-8000-000000000002";
const C3 = "00000000-0000-4000-8000-000000000003";
const RUN = "00000000-0000-4000-8000-0000000000f1";

function row(id: string, patch: Partial<InboxConversationRow> = {}): InboxConversationRow {
  return {
    id,
    guestName: "Guest",
    channel: "airbnb",
    state: "awaiting",
    snoozeUntil: null,
    propertyName: "아라키초A",
    roomLabel: "201",
    bookingStatus: "confirmed",
    checkInDate: "2026-11-20",
    checkOutDate: "2026-11-22",
    guestLanguage: "en",
    lastMessageAt: "2026-11-13T01:00:00Z",
    lastGuestAt: "2026-11-13T01:00:00Z",
    lastLine: { direction: "guest", body: "hi" },
    status: "awaiting",
    lastReplyAt: null,
    outboxAlert: null,
    replyBlock: null,
    ...patch,
  };
}

function message(id: string, patch: Partial<InboxMessage> = {}): InboxMessage {
  return {
    id,
    direction: "guest",
    body: "hello",
    bodyTranslated: null,
    translatedLang: null,
    bodyLang: null,
    sentAt: "2026-11-13T01:00:00Z",
    authorName: null,
    attachmentCount: 0,
    images: [],
    outbox: null,
    ...patch,
  };
}

function thread(messages: InboxMessage[], patch: Partial<InboxThread> = {}): InboxThread {
  return {
    conversation: row(C1),
    messages,
    reservation: {
      reservationId: null,
      propertyName: "아라키초A",
      roomLabel: "201",
      checkInDate: null,
      checkOutDate: null,
      nights: null,
      adults: null,
      children: null,
      totalGuests: null,
      bookingStatus: null,
      channel: "airbnb",
      guestLanguage: "en",
      bookingNumber: "70001",
      channelReference: null,
      guestEmail: null,
    },
    sendEnabled: false,
    autoRuns: [],
    links: [],
    resolvedDraft: null,
    ...patch,
  };
}

function run(id: string, patch: Partial<AutoRunView> = {}): AutoRunView {
  return {
    id,
    ruleId: "rule-1",
    ruleName: "Check-in",
    providerBookingId: "70001",
    conversationId: C1,
    guestName: "Guest",
    propertyName: null,
    roomLabel: null,
    checkInDate: null,
    checkOutDate: null,
    channel: "airbnb",
    scheduledAt: "2026-11-14T00:00:00Z",
    status: "scheduled",
    skipReason: null,
    missingVariables: [],
    paused: false,
    outboxStatus: null,
    ...patch,
  };
}

describe("신호 → 열쇠 (id 만)", () => {
  it("대화 줄 = 목록 + 대화, 새 메시지 = 목록 + 대화, 메시지 고침(사진 사본) = 대화만", () => {
    expect(liveKeysOf({ table: "guest_conversations", eventType: "UPDATE", record: { id: C1, guest_name: "x" } })).toEqual([
      listKey(C1),
      threadKey(C1),
    ]);
    expect(liveKeysOf({ table: "guest_messages", eventType: "INSERT", record: { id: C2, conversation_id: C1 } })).toEqual([
      listKey(C1),
      threadKey(C1),
    ]);
    expect(liveKeysOf({ table: "guest_messages", eventType: "UPDATE", record: { conversation_id: C1, media_state: "done" } })).toEqual([
      threadKey(C1),
    ]);
    expect(liveKeysOf({ table: "guest_message_outbox", eventType: "UPDATE", record: { conversation_id: C1 } })).toEqual([
      listKey(C1),
      threadKey(C1),
    ]);
  });

  it("자동 안내 실행 줄 = 줄 · 대화 · 예약 번호", () => {
    expect(
      liveKeysOf({ table: "auto_message_runs", eventType: "UPDATE", record: { id: RUN, conversation_id: null, provider_booking_id: "70001" } }),
    ).toEqual([runKey(RUN), bookingKey("70001")]);
  });

  it("id 가 아닌 값 · 삭제 · 모르는 표는 버린다", () => {
    expect(liveKeysOf({ table: "guest_conversations", eventType: "UPDATE", record: { id: "not-a-uuid" } })).toEqual([]);
    expect(liveKeysOf({ table: "guest_messages", eventType: "INSERT", record: { conversation_id: 42 } })).toEqual([]);
    expect(liveKeysOf({ table: "guest_conversations", eventType: "DELETE", record: {} })).toEqual([]);
    expect(liveKeysOf({ table: "profiles", eventType: "UPDATE", record: { id: C1 } })).toEqual([]);
    expect(
      liveKeysOf({ table: "auto_message_runs", eventType: "UPDATE", record: { id: RUN, provider_booking_id: "70001; drop table" } }),
    ).toEqual([runKey(RUN)]);
  });

  it("열쇠 묶음에서 종류별 id · 열린 대화 판정", () => {
    const keys = [listKey(C1), listKey(C1), threadKey(C2), bookingKey("70001"), runKey(RUN)];
    expect(idsOfKind(keys, "c")).toEqual([C1]);
    expect(idsOfKind(keys, "r")).toEqual([RUN]);
    expect(touchesThread(keys, C2, null)).toBe(true);
    expect(touchesThread(keys, C1, null)).toBe(false);
    expect(touchesThread(keys, C1, "70001")).toBe(true);
  });
});

describe("목록 합치기", () => {
  it("새로 든 줄은 넣고 정렬, 바뀐 줄은 고치고, 필터에서 빠진 줄은 예전 값 그대로 접기 표시", () => {
    const a = row(C1, { lastMessageAt: "2026-11-13T01:00:00Z" });
    const b = row(C2, { lastMessageAt: "2026-11-13T02:00:00Z" });
    const incoming = row(C3, { lastMessageAt: "2026-11-13T03:00:00Z" });
    const doneB = row(C2, { state: "done" });
    const merged = mergeInboxRows([b, a], [
      { row: incoming, matches: true },
      { row: doneB, matches: false },
    ]);
    expect(merged.rows.map((r) => r.id)).toEqual([C3, C2, C1]);
    expect(merged.entered).toEqual([C3]);
    expect(merged.left).toEqual([C2]);
    // 접히는 동안 예전 값(답장 기다림) 그대로 — 자리를 옮기지 않는다.
    expect(merged.rows.find((r) => r.id === C2)).toBe(b);
    expect(dropRows(merged.rows, new Set(merged.left)).map((r) => r.id)).toEqual([C3, C1]);
  });

  it("새 메시지(손님이든 직원이든)가 온 대화는 맨 위로", () => {
    const a = row(C1, { lastMessageAt: "2026-11-13T01:00:00Z" });
    const b = row(C2, { lastMessageAt: "2026-11-13T02:00:00Z" });
    const replied = row(C1, { state: "done", lastMessageAt: "2026-11-13T05:00:00Z", lastLine: { direction: "host", body: "ok" } });
    const merged = mergeInboxRows([b, a], [{ row: replied, matches: true }]);
    expect(merged.rows.map((r) => r.id)).toEqual([C1, C2]);
  });

  it("값이 같으면 같은 객체(다시 그리지 않음), 없어진 id 는 접기", () => {
    const a = row(C1);
    const merged = mergeInboxRows([a, row(C2)], [{ row: row(C1), matches: true }], [C2]);
    expect(merged.rows[0]).toBe(a);
    expect(merged.left).toEqual([C2]);
    expect(merged.entered).toEqual([]);
  });

  it("미리 보기 · 상태가 바뀐 줄은 새 값으로 다시 정렬", () => {
    const a = row(C1, { lastMessageAt: "2026-11-13T01:00:00Z" });
    const b = row(C2, { lastMessageAt: "2026-11-13T02:00:00Z" });
    const aOverdue = row(C1, { lastMessageAt: "2026-11-13T04:00:00Z", lastLine: { direction: "guest", body: "still there?" } });
    const merged = mergeInboxRows([b, a], [{ row: aOverdue, matches: true }]);
    expect(merged.rows.map((r) => r.id)).toEqual([C1, C2]);
    expect(merged.rows[0].lastLine?.body).toBe("still there?");
  });

  it("목록 통째로 갈아 끼우기(따라잡기) — 같은 줄은 같은 객체, 빠진 줄은 접기, 새 줄은 나타나기", () => {
    const a = row(C1);
    const b = row(C2);
    const merged = replaceInboxRows([a, b], [row(C1), row(C3)]);
    expect(merged.rows.find((r) => r.id === C1)).toBe(a);
    expect(merged.entered).toEqual([C3]);
    expect(merged.left).toEqual([C2]);
    expect(merged.rows.map((r) => r.id).sort()).toEqual([C1, C2, C3].sort());
  });
});

describe("대화 합치기", () => {
  const image = { sourceUrl: "https://a0.muscache.com/im/pictures/x.jpg", thumb: "t1", full: "f1", fallback: null, stored: true, unavailable: false };

  it("바뀐 것이 없으면 예전 대화 그대로(서명 URL 만 새로 나와도)", () => {
    const prev = thread([message("m1", { images: [image] })]);
    const next = thread([message("m1", { images: [{ ...image, thumb: "t2", full: "f2" }] })]);
    expect(mergeThread(prev, next)).toBe(prev);
  });

  it("새 말이 붙으면 앞 말 · 예약 · 자동 안내는 같은 객체", () => {
    const m1 = message("m1");
    const prev = thread([m1]);
    const next = thread([message("m1"), message("m2", { body: "new" })]);
    const merged = mergeThread(prev, next);
    expect(merged).not.toBe(prev);
    expect(merged.messages[0]).toBe(m1);
    expect(merged.messages[1].body).toBe("new");
    expect(merged.reservation).toBe(prev.reservation);
    expect(merged.autoRuns).toBe(prev.autoRuns);
  });

  it("발송 상태(보낼 차례 → 보냄) · 사진 사본(Airbnb → 저장소)은 그 말만 새 값", () => {
    const queued = message("m1", { direction: "host", outbox: { id: "o1", kind: "reply", status: "queued", errorCode: null, nextTryAt: null, retryable: false, locked: false } });
    const photo = message("m2", { images: [{ ...image, stored: false }] });
    const prev = thread([queued, photo]);
    const next = thread([
      { ...queued, outbox: { ...queued.outbox!, status: "sent" } },
      { ...photo, images: [{ ...image, stored: true, thumb: "copy" }] },
    ]);
    const merged = mergeThread(prev, next);
    expect(merged.messages[0].outbox?.status).toBe("sent");
    expect(merged.messages[1].images[0].stored).toBe(true);
    expect(merged.messages[1].images[0].thumb).toBe("copy");
  });

  it("다른 대화면 새 것을 그대로", () => {
    const prev = thread([message("m1")]);
    const next = thread([message("m9")], { conversation: row(C2) });
    expect(mergeThread(prev, next)).toBe(next);
    expect(mergeThread(null, next)).toBe(next);
  });

  it("아래에 붙은 말 수 — 손님 말 · 우리 답장만", () => {
    const next = [message("m1"), message("m2"), message("m3", { direction: "internal" }), message("m4", { direction: "host" })];
    expect(countAppended(new Set(["m1"]), next)).toBe(2);
  });
});

describe("자동 안내 「보낼 예정」 합치기", () => {
  const now = new Date("2026-11-13T00:00:00Z");

  it("그 자리에서 상태 고침 · 새 줄은 시각 순 자리 · 취소 · 없어진 줄은 뺌", () => {
    const r1 = run("r1", { scheduledAt: "2026-11-14T00:00:00Z" });
    const r2 = run("r2", { scheduledAt: "2026-11-15T00:00:00Z" });
    const r3 = run("r3", { scheduledAt: "2026-11-16T00:00:00Z" });
    const merged = mergeAutoRuns(
      [r1, r2, r3],
      [run("r1", { scheduledAt: "2026-11-14T00:00:00Z", status: "queued", outboxStatus: "queued" }), run("r2", { status: "cancelled" }), run("r0", { scheduledAt: "2026-11-13T12:00:00Z" })],
      ["r3"],
      { ruleId: null, now },
    );
    expect(merged.map((r) => r.id)).toEqual(["r0", "r1"]);
    expect(merged[1].status).toBe("queued");
  });

  it("바뀐 것이 없으면 같은 배열 · 다른 규칙 필터 · 하루 넘게 지난 줄은 들지 않음", () => {
    const r1 = run("r1");
    const current = [r1];
    expect(mergeAutoRuns(current, [run("r1")], [], { ruleId: null, now })).toBe(current);
    expect(inUpcoming(run("x", { ruleId: "other" }), "rule-1", now)).toBe(false);
    expect(inUpcoming(run("x", { scheduledAt: "2026-11-11T00:00:00Z" }), null, now)).toBe(false);
    expect(mergeAutoRuns(current, [run("r9", { ruleId: "other" })], [], { ruleId: "rule-1", now })).toBe(current);
  });

  it("규칙 숫자만 합친다(이름 · 글은 화면 값)", () => {
    const current: Array<{ id: string; name: string; nextSendAt: string | null; scheduledCount: number; blockedCount: number }> = [
      { id: "a", name: "편집 중", nextSendAt: null, scheduledCount: 1, blockedCount: 0 },
    ];
    const merged = mergeRuleCounts(current, [{ id: "a", nextSendAt: "2026-11-14T00:00:00Z", scheduledCount: 2, blockedCount: 1 }]);
    expect(merged[0]).toEqual({ id: "a", name: "편집 중", nextSendAt: "2026-11-14T00:00:00Z", scheduledCount: 2, blockedCount: 1 });
    expect(mergeRuleCounts(merged, [{ id: "a", nextSendAt: "2026-11-14T00:00:00Z", scheduledCount: 2, blockedCount: 1 }])).toBe(merged);
  });
});

describe("변경 묶기 (createLiveChangeBatcher)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(options: { maxKeys?: number } = {}) {
    let clock = 0;
    const flush = vi.fn();
    const catchUp = vi.fn();
    const batcher = createLiveChangeBatcher({ flush, catchUp, debounceMs: 600, maxWaitMs: 3000, maxKeys: options.maxKeys ?? 40, catchUpHiddenMs: 60_000, now: () => clock });
    const advance = (ms: number) => {
      clock += ms;
      vi.advanceTimersByTime(ms);
    };
    return { batcher, flush, catchUp, advance };
  }

  it("같은 열쇠가 몰려 와도 한 번, 한 묶음으로", () => {
    const { batcher, flush, advance } = setup();
    batcher.add(["c:1"], true);
    advance(200);
    batcher.add(["c:1", "c:2"], true);
    advance(599);
    expect(flush).not.toHaveBeenCalled();
    advance(1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0][0].sort()).toEqual(["c:1", "c:2"]);
  });

  it("계속 와도 maxWait 안에는 한 번 내보낸다", () => {
    const { batcher, flush, advance } = setup();
    for (let i = 0; i < 12; i += 1) {
      batcher.add([`c:${i}`], true);
      advance(300);
    }
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("열쇠가 넘치면(홍수) 하나하나 대신 따라잡기 한 번", () => {
    const { batcher, flush, catchUp, advance } = setup({ maxKeys: 3 });
    batcher.add(["c:1", "c:2", "c:3", "c:4"], true);
    batcher.add(["c:5"], true);
    advance(600);
    expect(flush).not.toHaveBeenCalled();
    expect(catchUp).toHaveBeenCalledTimes(1);
  });

  it("숨은 탭에 온 열쇠는 보일 때, 오래 숨었으면 따라잡기, 다시 붙으면 따라잡기", () => {
    const { batcher, flush, catchUp, advance } = setup();
    batcher.onHidden();
    batcher.add(["c:1"], false);
    advance(5_000);
    expect(flush).not.toHaveBeenCalled();
    batcher.onVisible();
    advance(600);
    expect(flush).toHaveBeenCalledWith(["c:1"]);

    batcher.onHidden();
    advance(61_000);
    batcher.onVisible();
    advance(600);
    expect(catchUp).toHaveBeenCalledTimes(1);

    batcher.onReconnect();
    advance(600);
    expect(catchUp).toHaveBeenCalledTimes(2);
  });

  it("닫힌 뒤에는 아무것도 부르지 않는다", () => {
    const { batcher, flush, advance } = setup();
    batcher.add(["c:1"], true);
    batcher.dispose();
    advance(5_000);
    expect(flush).not.toHaveBeenCalled();
  });
});

describe("손님 메시지 구독 묶음", () => {
  it("목록은 조직 + 메시지는 INSERT 만, 대화는 그 대화 + 조직 실행 줄", () => {
    // 2026-11-16 — publication 이 아니라 조직 private 토픽으로 받는다(트리거가 id 칸만 보냄).
    const topic = `guest-messages:${ORG}`;
    expect(guestInboxLiveSources(ORG)).toEqual([
      { table: "guest_conversations", filter: `organization_id=eq.${ORG}`, topic },
      { table: "guest_messages", filter: `organization_id=eq.${ORG}`, event: "INSERT", topic },
      { table: "guest_message_outbox", filter: `organization_id=eq.${ORG}`, topic },
    ]);
    expect(guestThreadLiveSources(ORG, C1)).toEqual([
      { table: "guest_conversations", filter: `id=eq.${C1}`, topic },
      { table: "guest_messages", filter: `conversation_id=eq.${C1}`, topic },
      { table: "guest_message_outbox", filter: `conversation_id=eq.${C1}`, topic },
      { table: "auto_message_runs", filter: `organization_id=eq.${ORG}`, topic },
    ]);
    expect(autoRunLiveSources(ORG)).toEqual([{ table: "auto_message_runs", filter: `organization_id=eq.${ORG}`, topic }]);
  });

  it("신호 행은 id 칸만 남기고 본문 · 이름 · 첨부는 버린다", () => {
    expect(
      pickLiveIds({ id: C2, conversation_id: C1, organization_id: ORG, body: "door code 1234", guest_name: "Kim", attachments: [{ x: 1 }], provider_booking_id: "70001" }),
    ).toEqual({ id: C2, conversation_id: C1, organization_id: ORG, provider_booking_id: "70001" });
    expect(pickLiveIds(null)).toEqual({});
  });

  it("구독 열쇠는 왕복해도 같다(종류 포함)", () => {
    const sources = [...guestInboxLiveSources(ORG), ...guestThreadLiveSources(ORG, C1)];
    expect(parseLiveSourcesKey(liveSourcesKey(sources))).toEqual(sources);
    expect(parseLiveSourcesKey("")).toEqual([]);
  });
});

describe("목록 상태 리듀서 — 순서 · 접힘 (리뷰 반영)", () => {
  const listOf = (rows: InboxConversationRow[], awaitingCount = rows.length): InboxListData => ({ rows, awaitingCount, buildings: [] });
  const ids = (state: ReturnType<typeof initialInboxLive>) => state.list?.rows.map((r) => r.id) ?? [];

  it("서버가 준 새 목록에서 빠진 줄은 접힘 → drop 으로 빠지고, 되돌리기로 다시 오면 접힘이 풀린다", () => {
    let state = initialInboxLive(listOf([row(C1), row(C2)]));
    state = inboxLiveReducer(state, { type: "replace", seq: 1, data: listOf([row(C2)]) });
    expect([...state.leaving]).toEqual([C1]);
    expect(ids(state)).toContain(C1);
    // 접히는 중에 되돌리기 — 다시 들어온다.
    state = inboxLiveReducer(state, { type: "replace", seq: 2, data: listOf([row(C1), row(C2)]) });
    expect(state.leaving.size).toBe(0);
    state = inboxLiveReducer(state, { type: "drop", ids: [C1] });
    expect(ids(state).sort()).toEqual([C1, C2].sort());
  });

  it("drop 은 아직 접힌 줄만 빼고, 다 빠지면 빈 목록(빈 상태가 보인다)", () => {
    let state = initialInboxLive(listOf([row(C1)]));
    state = inboxLiveReducer(state, { type: "claim", ids: [C1], seq: 1 });
    state = inboxLiveReducer(state, { type: "rows", seq: 1, result: { updates: [{ row: row(C1, { state: "done" }), matches: false }], missing: [], awaitingCount: 0 } });
    expect([...state.leaving]).toEqual([C1]);
    expect(state.list?.awaitingCount).toBe(0);
    state = inboxLiveReducer(state, { type: "drop", ids: [C1] });
    expect(ids(state)).toEqual([]);
    expect(state.leaving.size).toBe(0);
  });

  it("줄 다시 읽기가 matches 로 돌아오면 접힘에서 빠진다", () => {
    let state = initialInboxLive(listOf([row(C1)]));
    state = inboxLiveReducer(state, { type: "replace", seq: 1, data: listOf([]) });
    expect(state.leaving.has(C1)).toBe(true);
    state = inboxLiveReducer(state, { type: "claim", ids: [C1], seq: 2 });
    state = inboxLiveReducer(state, { type: "rows", seq: 2, result: { updates: [{ row: row(C1, { guestName: "back" }), matches: true }], missing: [], awaitingCount: 1 } });
    expect(state.leaving.has(C1)).toBe(false);
    expect(state.list?.rows[0].guestName).toBe("back");
  });

  it("applyIds([B]) 가 진행 중인 applyIds([A]) 의 응답을 버리지 않는다(id 마다 번호)", () => {
    let state = initialInboxLive(listOf([row(C1), row(C2)]));
    state = inboxLiveReducer(state, { type: "claim", ids: [C1], seq: 1 });
    state = inboxLiveReducer(state, { type: "claim", ids: [C2], seq: 2 });
    state = inboxLiveReducer(state, { type: "rows", seq: 2, result: { updates: [{ row: row(C2, { guestName: "B2" }), matches: true }], missing: [], awaitingCount: 2 } });
    state = inboxLiveReducer(state, { type: "rows", seq: 1, result: { updates: [{ row: row(C1, { guestName: "A1" }), matches: true }], missing: [], awaitingCount: 9 } });
    expect(state.list?.rows.find((r) => r.id === C1)?.guestName).toBe("A1");
    expect(state.list?.rows.find((r) => r.id === C2)?.guestName).toBe("B2");
    // 머리 숫자는 더 늦게 보낸 응답(seq 2) 것.
    expect(state.list?.awaitingCount).toBe(2);
  });

  it("같은 id 를 다시 읽으면 옛 응답은 버린다", () => {
    let state = initialInboxLive(listOf([row(C1)]));
    state = inboxLiveReducer(state, { type: "claim", ids: [C1], seq: 1 });
    state = inboxLiveReducer(state, { type: "claim", ids: [C1], seq: 2 });
    state = inboxLiveReducer(state, { type: "rows", seq: 2, result: { updates: [{ row: row(C1, { guestName: "new" }), matches: true }], missing: [], awaitingCount: 1 } });
    state = inboxLiveReducer(state, { type: "rows", seq: 1, result: { updates: [{ row: row(C1, { guestName: "old" }), matches: false }], missing: [], awaitingCount: 1 } });
    expect(state.list?.rows[0].guestName).toBe("new");
    expect(state.leaving.size).toBe(0);
  });

  it("먼저 시작한 통째 읽기는 나중에 시작한 줄 읽기의 줄을 덮지 않는다", () => {
    let state = initialInboxLive(listOf([row(C1)]));
    // 통째 읽기 seq 1 시작 → 줄 읽기 seq 2 시작 · 응답(새 값) → 통째 읽기 응답(옛 값, C1 없음)
    state = inboxLiveReducer(state, { type: "claim", ids: [C1], seq: 2 });
    state = inboxLiveReducer(state, { type: "rows", seq: 2, result: { updates: [{ row: row(C1, { guestName: "fresh" }), matches: true }], missing: [], awaitingCount: 1 } });
    state = inboxLiveReducer(state, { type: "replace", seq: 1, data: listOf([row(C2)]) });
    expect(state.list?.rows.find((r) => r.id === C1)?.guestName).toBe("fresh");
    expect(state.leaving.has(C1)).toBe(false);
    expect(ids(state)).toContain(C2);
  });

  it("나중에 시작한 통째 읽기가 먼저 끝나면 옛 줄 응답 · 옛 통째 읽기는 버린다", () => {
    let state = initialInboxLive(listOf([row(C1)]));
    state = inboxLiveReducer(state, { type: "claim", ids: [C1], seq: 1 });
    state = inboxLiveReducer(state, { type: "replace", seq: 3, data: listOf([row(C1, { guestName: "latest" })]) });
    state = inboxLiveReducer(state, { type: "rows", seq: 1, result: { updates: [{ row: row(C1, { guestName: "stale" }), matches: true }], missing: [], awaitingCount: 1 } });
    state = inboxLiveReducer(state, { type: "replace", seq: 2, data: listOf([]) });
    expect(state.list?.rows[0].guestName).toBe("latest");
    expect(state.leaving.size).toBe(0);
  });

  it("먼저 접어 둔 줄은 다른 줄이 바뀌어도 접힌 채, 그 줄이 목록에서 빠질 때만 지운다", () => {
    const local: ReadonlySet<string> = new Set([C1]);
    expect(pruneLocalLeaving(local, [row(C1), row(C2), row(C3)])).toBe(local);
    expect([...pruneLocalLeaving(local, [row(C2)])]).toEqual([]);
  });
});

describe("같은 대화 읽기 하나로 (createKeyedSingleFlight)", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  }

  it("진행 중에 또 부르면 끝난 뒤 한 번 더 읽고, 마지막 값만 반영 · 두 쪽 모두 그때 끝난다", async () => {
    const calls: Array<ReturnType<typeof deferred<string>>> = [];
    const applied: string[] = [];
    const load = createKeyedSingleFlight<string, string>(
      () => {
        const d = deferred<string>();
        calls.push(d);
        return d.promise;
      },
      (_key, value) => applied.push(value),
      () => true,
    );
    let firstDone = false;
    const first = load("c1").then(() => (firstDone = true));
    const second = load("c1");
    expect(calls).toHaveLength(1);
    calls[0].resolve("old");
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toHaveLength(2);
    expect(applied).toEqual([]);
    expect(firstDone).toBe(false);
    calls[1].resolve("new");
    await Promise.all([first, second]);
    expect(applied).toEqual(["new"]);
    expect(firstDone).toBe(true);
  });

  it("다른 대화로 옮기면 반영하지 않고, 읽기가 던지면 반영 없이 끝난다", async () => {
    let current = "c1";
    const applied: string[] = [];
    const load = createKeyedSingleFlight<string, string>(
      async (key) => {
        if (key === "boom") throw new Error("network");
        return key;
      },
      (_key, value) => applied.push(value),
      (key) => key === current,
    );
    const pending = load("c1");
    current = "c2";
    await pending;
    current = "boom";
    await load("boom");
    expect(applied).toEqual([]);
  });
});
