import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createFakeSupabase } from "@/lib/__tests__/fake-supabase";
import { compareInboxRows, sortInboxRows, type InboxConversationRow, type InboxListData } from "@/lib/guest-messages/inbox-model";
import {
  afterCursorClauses,
  channelSql,
  combineOrGroups,
  DONE_PAGE_SIZE,
  encodeDoneCursor,
  parseDoneCursor,
  statusIncludesDone,
  untilCursorClauses,
} from "@/lib/guest-messages/inbox-paging";
import { loadDonePage, loadInboxList, loadInboxRowsByIds } from "@/lib/guest-messages/inbox-server";
import { inboxLiveReducer, initialInboxLive } from "@/lib/guest-messages/live-merge";

/**
 * 손님 메시지 목록 — 열린 대화 먼저 · 처리 끝 무한 스크롤(2026-11-26). docs/product/47-guest-messaging.md §5 · §6-1
 * 가짜 DB(`fake-supabase` 의 `.or()` 흉내)로 키셋 커서 · SQL 필터를 확인한다. 실제 DB 는 부르지 않는다.
 */
type Row = Record<string, unknown>;

const ORG = "00000000-0000-4000-8000-000000000900";
const OTHER_ORG = "00000000-0000-4000-8000-000000000901";
const NOW = new Date("2026-11-26T03:00:00.000Z");
const uuid = (prefix: string, n: number) => `00000000-0000-4000-8000-${prefix}${String(n).padStart(12 - prefix.length, "0")}`;
const lastLinesRpc = { guest_conversation_last_lines: () => ({ data: [], error: null }) };

function conversation(id: string, patch: Row = {}): Row {
  return {
    id,
    organization_id: ORG,
    provider: "beds24",
    provider_booking_id: `b-${id.slice(-4)}`,
    reservation_id: null,
    property_name: "아라키초A",
    room_label: "201",
    channel: "airbnb",
    booking_status: "confirmed",
    check_in_date: "2026-11-20",
    check_out_date: "2026-11-22",
    guest_name: "Guest",
    guest_language: "en",
    status: "awaiting",
    snooze_until: null,
    last_guest_at: "2026-11-13T00:00:00.000Z",
    last_reply_at: null,
    last_message_at: "2026-11-13T00:00:00.000Z",
    ...patch,
  };
}

/** 처리 끝 n 개 — i 가 클수록 최근(같은 형식의 ISO 시각이라 가짜 DB 의 글자 비교 = 시각 비교). */
function doneRows(count: number, prefix = "2", patch: (i: number) => Row = () => ({})): Row[] {
  return Array.from({ length: count }, (_, i) =>
    conversation(uuid(prefix, i), {
      status: "done",
      last_message_at: new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString(),
      ...patch(i),
    }),
  );
}

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
    checkInDate: null,
    checkOutDate: null,
    guestLanguage: "en",
    lastMessageAt: "2026-11-13T01:00:00.000Z",
    lastGuestAt: "2026-11-13T01:00:00.000Z",
    lastLine: null,
    status: "awaiting",
    lastReplyAt: null,
    outboxAlert: null,
    replyBlock: null,
    ...patch,
  } as InboxConversationRow;
}

describe("정렬 — 열린 대화 먼저(한 비교 함수)", () => {
  it("답장 기다림 · 나중에(끝난 나중에 포함)가 처리 끝보다 위, 묶음 안은 최근 순 · 같으면 id", () => {
    const rows = sortInboxRows([
      row("done-newest", { status: "done", state: "done", lastMessageAt: "2026-11-26T00:00:00.000Z" }),
      row("awaiting-old", { lastMessageAt: "2026-11-01T00:00:00.000Z" }),
      row("snoozed-expired", { status: "snoozed", state: "awaiting", lastMessageAt: "2026-11-10T00:00:00.000Z" }),
      row("snoozed", { status: "snoozed", state: "snoozed", lastMessageAt: "2026-11-12T00:00:00.000Z" }),
      row("done-b", { status: "done", state: "done", lastMessageAt: "2026-11-20T00:00:00.000Z" }),
      row("done-a", { status: "done", state: "done", lastMessageAt: "2026-11-20T00:00:00.000Z" }),
      row("done-null", { status: "done", state: "done", lastMessageAt: null }),
      row("open-null", { lastMessageAt: null }),
    ]);
    expect(rows.map((r) => r.id)).toEqual([
      "snoozed",
      "snoozed-expired",
      "awaiting-old",
      "open-null",
      "done-newest",
      "done-a",
      "done-b",
      "done-null",
    ]);
  });

  it("비교는 대칭이고 같은 줄은 0", () => {
    const a = row("a", { status: "done" });
    const b = row("b");
    expect(compareInboxRows(a, b)).toBeGreaterThan(0);
    expect(compareInboxRows(b, a)).toBeLessThan(0);
    expect(compareInboxRows(a, a)).toBe(0);
  });
});

describe("커서 — 만들기 · 읽기", () => {
  const ID = "00000000-0000-4000-8000-0000000000ab";

  it("시각 · id 를 그대로 싣고, 시각이 없으면 빈칸", () => {
    expect(encodeDoneCursor({ last_message_at: "2026-11-26T01:02:03.123456+00:00", id: ID })).toBe(`2026-11-26T01:02:03.123456+00:00|${ID}`);
    expect(encodeDoneCursor({ last_message_at: null, id: ID })).toBe(`|${ID}`);
    expect(parseDoneCursor(`2026-11-26T01:02:03.123456+00:00|${ID}`)).toEqual({ lastMessageAt: "2026-11-26T01:02:03.123456+00:00", id: ID });
    expect(parseDoneCursor(`2026-11-26T01:02:03Z|${ID.toUpperCase()}`)).toEqual({ lastMessageAt: "2026-11-26T01:02:03Z", id: ID });
    expect(parseDoneCursor(`|${ID}`)).toEqual({ lastMessageAt: null, id: ID });
  });

  it("모양이 틀리면 null — PostgREST 식에 끼어들 글자(쉼표 · 괄호)를 막는다", () => {
    for (const bad of [
      "",
      ID,
      "2026-11-26T01:02:03Z|not-a-uuid",
      `2026-11-26|${ID}`,
      `2026-11-26T01:02:03Z,id.gt.0|${ID}`,
      `2026-11-26T01:02:03Z)|${ID}`,
      `2026-13-45T99:99:99Z|${ID}`,
      `${"9".repeat(80)}|${ID}`,
      42,
      null,
    ]) {
      expect(parseDoneCursor(bad)).toBeNull();
    }
  });
});

describe("SQL 식 — 커서 범위 · 채널 · 묶기", () => {
  const ID = "00000000-0000-4000-8000-0000000000ab";
  it("커서 뒤 / 커서까지", () => {
    expect(afterCursorClauses({ lastMessageAt: "T", id: ID })).toEqual([
      "last_message_at.lt.T",
      `and(last_message_at.eq.T,id.gt.${ID})`,
      "last_message_at.is.null",
    ]);
    expect(afterCursorClauses({ lastMessageAt: null, id: ID })).toEqual([`and(last_message_at.is.null,id.gt.${ID})`]);
    expect(untilCursorClauses({ lastMessageAt: "T", id: ID })).toEqual(["last_message_at.gt.T", `and(last_message_at.eq.T,id.lte.${ID})`]);
    expect(untilCursorClauses({ lastMessageAt: null, id: ID })).toEqual([
      "last_message_at.not.is.null",
      `and(last_message_at.is.null,id.lte.${ID})`,
    ]);
  });

  it("채널 · 상태 · 묶기", () => {
    expect(channelSql("all")).toBeNull();
    expect(channelSql("booking")).toEqual({ eq: "booking" });
    expect(channelSql("other")).toEqual({ clauses: ["channel.is.null", "channel.not.in.(airbnb,booking,direct)"] });
    expect(statusIncludesDone("all")).toBe(true);
    expect(statusIncludesDone("done")).toBe(true);
    expect(statusIncludesDone("awaiting")).toBe(false);
    expect(statusIncludesDone("snoozed")).toBe(false);
    expect(combineOrGroups([[], []])).toBeNull();
    expect(combineOrGroups([["a", "b"]])).toBe("a,b");
    expect(combineOrGroups([["a", "b"], ["c"]])).toBe("and(or(a,b),c)");
  });
});

describe("목록 첫 읽기 · 더 불러오기 — 키셋 커서", () => {
  it("열린 대화는 다 · 처리 끝은 첫 묶음만, 커서와 「더 있음」을 준다", async () => {
    const open = [conversation(uuid("1", 1)), conversation(uuid("1", 2), { status: "snoozed", snooze_until: "2026-11-27T00:00:00Z" })];
    const done = doneRows(450);
    const fake = createFakeSupabase({ guest_conversations: [...done, ...open], guest_message_outbox: [] }, lastLinesRpc);
    const list = await loadInboxList(fake.client as never, ORG, { status: "all", building: null }, NOW);
    expect(list.rows).toHaveLength(2 + DONE_PAGE_SIZE);
    expect(list.rows.slice(0, 2).every((r) => r.status !== "done")).toBe(true);
    expect(list.rows[2].id).toBe(String(done[449].id));
    expect(list.doneHasMore).toBe(true);
    expect(list.doneCursor).toBe(encodeDoneCursor(done[250] as never));
    expect(list.awaitingCount).toBe(1);
  });

  it("다음 묶음을 끝까지 넘기면 겹침 · 빠짐 없이 전부, 같은 시각 · 시각 없는 줄도", async () => {
    const tieAt = "2026-10-05T00:00:00.000Z";
    const done = [
      ...doneRows(430),
      ...Array.from({ length: 5 }, (_, i) => conversation(uuid("6", i), { status: "done", last_message_at: tieAt })),
      ...Array.from({ length: 3 }, (_, i) => conversation(uuid("7", i), { status: "done", last_message_at: null })),
    ];
    const fake = createFakeSupabase({ guest_conversations: done, guest_message_outbox: [] }, lastLinesRpc);
    const first = await loadInboxList(fake.client as never, ORG, { status: "done", building: null }, NOW);
    const seen = first.rows.map((r) => r.id);
    let cursor = first.doneCursor;
    let more = first.doneHasMore;
    let pages = 0;
    while (more && cursor) {
      const parsed = parseDoneCursor(cursor);
      expect(parsed).not.toBeNull();
      const page = await loadDonePage(fake.client as never, ORG, { status: "done", building: null }, parsed!, NOW);
      seen.push(...page.rows.map((r) => r.id));
      cursor = page.doneCursor;
      more = page.doneHasMore;
      pages += 1;
    }
    expect(pages).toBe(2);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(done.length);
    // 서버 순서 = 화면 정렬(같은 비교 함수).
    const expected = [...done]
      .sort((a, b) => {
        const at = (r: Row) => (r.last_message_at as string | null) ?? "";
        if (!at(a) !== !at(b)) return at(a) ? -1 : 1;
        if (at(a) !== at(b)) return at(a) < at(b) ? 1 : -1;
        return String(a.id) < String(b.id) ? -1 : 1;
      })
      .map((r) => String(r.id));
    expect(seen).toEqual(expected);
  });

  it("건물 · 채널 필터는 SQL 에서 — 묶음이 그 필터의 줄로 꽉 찬다, 「그 밖」은 빈 채널 · 모르는 채널 포함", async () => {
    const done = [
      ...doneRows(300, "2", (i) => ({ channel: i % 3 === 0 ? "booking" : "airbnb", property_name: i % 2 === 0 ? "아라키초A" : "다카다노바바" })),
      conversation(uuid("8", 1), { status: "done", channel: null, last_message_at: "2026-09-01T00:00:00.000Z" }),
      conversation(uuid("8", 2), { status: "done", channel: "expedia", last_message_at: "2026-09-02T00:00:00.000Z" }),
    ];
    const fake = createFakeSupabase({ guest_conversations: done, guest_message_outbox: [] }, lastLinesRpc);
    const booking = await loadInboxList(fake.client as never, ORG, { status: "done", building: "아라키초A", channel: "booking" }, NOW);
    expect(booking.rows.length).toBe(50);
    expect(booking.rows.every((r) => r.channel === "booking" && r.propertyName === "아라키초A")).toBe(true);
    expect(booking.doneHasMore).toBe(false);
    // 건물 고르기 목록은 필터와 상관없이 다 보인다.
    expect(booking.buildings).toEqual(["다카다노바바", "아라키초A"]);
    const other = await loadInboxList(fake.client as never, ORG, { status: "done", building: null, channel: "other" }, NOW);
    expect(other.rows.map((r) => r.id).sort()).toEqual([uuid("8", 1), uuid("8", 2)].sort());
  });

  it("상태 탭이 처리 끝을 빼면 처리 끝은 읽지 않고 더 불러오기도 없다", async () => {
    const fake = createFakeSupabase(
      { guest_conversations: [...doneRows(300), conversation(uuid("1", 1))], guest_message_outbox: [] },
      lastLinesRpc,
    );
    const list = await loadInboxList(fake.client as never, ORG, { status: "awaiting", building: null }, NOW);
    expect(list.rows.map((r) => r.id)).toEqual([uuid("1", 1)]);
    expect(list.doneCursor).toBeNull();
    expect(list.doneHasMore).toBe(false);
    const page = await loadDonePage(fake.client as never, ORG, { status: "snoozed", building: null }, { lastMessageAt: null, id: uuid("1", 1) }, NOW);
    expect(page).toEqual({ rows: [], doneCursor: null, doneHasMore: false });
  });

  it("다른 조직 줄은 더 불러오기에도 안 나온다", async () => {
    const mine = doneRows(210);
    const theirs = doneRows(50, "9", () => ({ organization_id: OTHER_ORG }));
    const fake = createFakeSupabase({ guest_conversations: [...mine, ...theirs], guest_message_outbox: [] }, lastLinesRpc);
    const first = await loadInboxList(fake.client as never, ORG, { status: "all", building: null }, NOW);
    const page = await loadDonePage(fake.client as never, ORG, { status: "all", building: null }, parseDoneCursor(first.doneCursor)!, NOW);
    expect(page.rows).toHaveLength(10);
    expect(page.doneHasMore).toBe(false);
    expect(page.rows.every((r) => !r.id.startsWith("00000000-0000-4000-8000-9"))).toBe(true);
  });

  it("따라잡기(doneUntil) — 이미 펼친 범위까지 다시 채우고, 뒤가 남았는지 안다", async () => {
    const done = doneRows(500);
    const fake = createFakeSupabase({ guest_conversations: done, guest_message_outbox: [] }, lastLinesRpc);
    const until = parseDoneCursor(encodeDoneCursor(done[100] as never))!;
    const list = await loadInboxList(fake.client as never, ORG, { status: "all", building: null }, NOW, undefined, { doneUntil: until });
    expect(list.rows).toHaveLength(400);
    expect(list.doneCursor).toBe(encodeDoneCursor(done[100] as never));
    expect(list.doneHasMore).toBe(true);
    const end = parseDoneCursor(encodeDoneCursor(done[0] as never))!;
    const all = await loadInboxList(fake.client as never, ORG, { status: "all", building: null }, NOW, undefined, { doneUntil: end });
    expect(all.rows).toHaveLength(500);
    expect(all.doneHasMore).toBe(false);
  });
});

describe("실시간 줄 — 화면이 받은 처리 끝 범위로 창 판정", () => {
  it("더 불러온 범위 안의 처리 끝은 matches, 밖은 아님 · 다 받았으면 전부 안", async () => {
    const done = doneRows(600);
    const fake = createFakeSupabase({ guest_conversations: done, guest_message_outbox: [] }, lastLinesRpc);
    const deep = String(done[150].id); // 451번째 — 첫 묶음 밖
    const outside = String(done[10].id);
    const cursor = parseDoneCursor(encodeDoneCursor(done[100] as never))!;
    const withWindow = await loadInboxRowsByIds(
      fake.client as never,
      ORG,
      [deep, outside],
      { status: "all", building: null },
      NOW,
      undefined,
      { cursor, hasMore: true },
    );
    const byId = new Map(withWindow.updates.map((u) => [u.row.id, u.matches]));
    expect(byId.get(deep)).toBe(true);
    expect(byId.get(outside)).toBe(false);
    const finished = await loadInboxRowsByIds(fake.client as never, ORG, [outside], { status: "all", building: null }, NOW, undefined, {
      cursor,
      hasMore: false,
    });
    expect(finished.updates[0].matches).toBe(true);
    // 범위를 안 보내면(예전 화면) 첫 묶음 경계.
    const legacy = await loadInboxRowsByIds(fake.client as never, ORG, [deep], { status: "all", building: null }, NOW);
    expect(legacy.updates[0].matches).toBe(false);
  });
});

describe("목록 리듀서 — 더 불러온 줄 붙이기", () => {
  const listOf = (rows: InboxConversationRow[], doneCursor: string | null = "c1", doneHasMore = true): InboxListData => ({
    rows,
    awaitingCount: 0,
    buildings: [],
    doneCursor,
    doneHasMore,
  });
  const done = (id: string, at: string) => row(id, { status: "done", state: "done", lastMessageAt: at });

  it("겹치는 id 는 지금 값을 두고 새 줄만 붙인다 — 열린 대화 위 · 처리 끝 최근 순, 커서 · 더 있음 갱신", () => {
    const current = done("d1", "2026-11-20T00:00:00.000Z");
    let state = initialInboxLive(listOf([row("o1"), current]));
    state = inboxLiveReducer(state, {
      type: "appendDone",
      seq: 1,
      sinceReplace: 0,
      from: "c1",
      page: {
        rows: [done("d1", "2026-11-25T00:00:00.000Z"), done("d2", "2026-11-19T00:00:00.000Z")],
        doneCursor: "c2",
        doneHasMore: false,
      },
    });
    expect(state.list?.rows.map((r) => r.id)).toEqual(["o1", "d1", "d2"]);
    expect(state.list?.rows[1]).toBe(current);
    expect(state.list?.doneCursor).toBe("c2");
    expect(state.list?.doneHasMore).toBe(false);
    expect(state.paged).toBe(true);
  });

  it("보낸 뒤 통째 읽기가 있었거나 커서가 달라졌으면 버린다", () => {
    const base = initialInboxLive(listOf([row("o1")]));
    const page = { rows: [done("d9", "2026-11-01T00:00:00.000Z")], doneCursor: "c2", doneHasMore: true };
    const replaced = inboxLiveReducer(base, { type: "replace", seq: 2, data: listOf([row("o1")]) });
    expect(inboxLiveReducer(replaced, { type: "appendDone", seq: 1, sinceReplace: 0, from: "c1", page })).toBe(replaced);
    expect(inboxLiveReducer(base, { type: "appendDone", seq: 1, sinceReplace: 0, from: "other", page })).toBe(base);
  });

  it("그 뒤에 보낸 줄 읽기가 가진 id 는 붙이지 않고, 붙인 줄은 더 옛날 줄 읽기 응답에 접히지 않는다", () => {
    let state = initialInboxLive(listOf([row("o1")]));
    state = inboxLiveReducer(state, { type: "claim", ids: ["d-old"], seq: 1 });
    state = inboxLiveReducer(state, { type: "claim", ids: ["d-new"], seq: 3 });
    state = inboxLiveReducer(state, {
      type: "appendDone",
      seq: 2,
      sinceReplace: 0,
      from: "c1",
      page: { rows: [done("d-old", "2026-11-02T00:00:00.000Z"), done("d-new", "2026-11-01T00:00:00.000Z")], doneCursor: "c2", doneHasMore: true },
    });
    expect(state.list?.rows.map((r) => r.id)).toEqual(["o1", "d-old"]);
    // seq 1 응답(옛날) — 「창 밖」이라 해도 d-old 는 이제 seq 2 를 가져 무시된다.
    state = inboxLiveReducer(state, {
      type: "rows",
      seq: 1,
      result: { updates: [{ row: done("d-old", "2026-11-02T00:00:00.000Z"), matches: false }], missing: [], awaitingCount: 0 },
    });
    expect(state.leaving.has("d-old")).toBe(false);
  });

  it("필터가 바뀐 통째 읽기는 펼침 표시를 지우고, 따라잡기(keepPaged)는 둔다", () => {
    let state = initialInboxLive(listOf([row("o1")]));
    state = inboxLiveReducer(state, { type: "appendDone", seq: 1, sinceReplace: 0, from: "c1", page: { rows: [], doneCursor: "c2", doneHasMore: true } });
    expect(state.paged).toBe(true);
    state = inboxLiveReducer(state, { type: "replace", seq: 2, keepPaged: true, data: listOf([row("o1")], "c2") });
    expect(state.paged).toBe(true);
    state = inboxLiveReducer(state, { type: "replace", seq: 3, data: listOf([row("o1")]) });
    expect(state.paged).toBe(false);
  });
});
