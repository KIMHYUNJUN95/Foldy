import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createFakeSupabase } from "@/lib/__tests__/fake-supabase";
import { loadInboxList, loadInboxRowsByIds } from "@/lib/guest-messages/inbox-server";
import { ingestConversationMessages, resolveConversationSeed, EMPTY_SEED } from "@/lib/guest-messages/store";
import type { NormalizedMessage } from "@/lib/guest-messages/types";

/**
 * 손님 메시지 성능(2026-11-19) — 읽기 횟수 · 동시 실행 · 읽은 줄 수를 가짜 DB 로 센다. 실제 DB · Beds24 는 부르지 않는다.
 * docs/product/47-guest-messaging.md 「성능 — 읽기 묶음」
 */
type Row = Record<string, unknown>;
type Read = { table: string; columns: string | undefined; rows: number };

const ORG = "00000000-0000-4000-8000-000000000900";
const NOW = new Date("2026-11-19T03:00:00.000Z");
const uuid = (prefix: string, n: number) => `00000000-0000-4000-8000-${prefix}${String(n).padStart(12 - prefix.length, "0")}`;

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
    last_guest_at: "2026-11-13T00:00:00Z",
    last_reply_at: null,
    last_message_at: "2026-11-13T00:00:00Z",
    ...patch,
  };
}

/**
 * 가짜 DB 를 감싸 읽기마다 (표 · 고른 칸 · 돌려준 줄 수)를 적고, 지정한 표는 응답을 한 틱 늦춰 동시에 몇 개가 떠 있는지 잰다.
 */
function instrument(fake: ReturnType<typeof createFakeSupabase>, delayTables: readonly string[] = []) {
  const reads: Read[] = [];
  const inFlight: Record<string, { now: number; max: number }> = {};
  const client = {
    ...fake.client,
    from(table: string) {
      const builder = fake.client.from(table) as unknown as Record<string, unknown> & {
        select: (columns?: string) => unknown;
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise<unknown>;
      };
      let columns: string | undefined;
      const select = builder.select.bind(builder);
      builder.select = (cols?: string) => {
        columns = cols;
        select(cols);
        return builder;
      };
      const then = builder.then.bind(builder);
      builder.then = (resolve, reject) => {
        const gauge = (inFlight[table] ??= { now: 0, max: 0 });
        gauge.now += 1;
        gauge.max = Math.max(gauge.max, gauge.now);
        const delay = delayTables.includes(table) ? new Promise((r) => setTimeout(r, 5)) : Promise.resolve();
        return delay.then(() =>
          then((result) => {
            gauge.now -= 1;
            const data = (result as { data: unknown }).data;
            reads.push({ table, columns, rows: Array.isArray(data) ? data.length : data ? 1 : 0 });
            return resolve(result);
          }, reject),
        );
      };
      return builder;
    },
  };
  return { client: client as never, reads, inFlight, rpcCalls: fake.rpcCalls };
}

const lastLinesRpc = { guest_conversation_last_lines: () => ({ data: [], error: null }) };

describe("목록 미리 보기 · 발송 줄 — 묶음을 차례로 기다리지 않는다", () => {
  it("마지막 한 줄은 대화가 250개여도 RPC 한 번, 발송 줄 묶음(100개씩 3개)은 동시에", async () => {
    const open = Array.from({ length: 250 }, (_, i) =>
      conversation(uuid("1", i), { last_message_at: new Date(Date.UTC(2026, 10, 1) + i * 60_000).toISOString() }),
    );
    const fake = createFakeSupabase({ guest_conversations: open, guest_message_outbox: [] }, lastLinesRpc);
    const db = instrument(fake, ["guest_message_outbox"]);
    const list = await loadInboxList(db.client, ORG, { status: "all", building: null }, NOW);
    expect(list.rows).toHaveLength(250);
    const lastLineCalls = db.rpcCalls.filter((call) => call.name === "guest_conversation_last_lines");
    expect(lastLineCalls).toHaveLength(1);
    expect((lastLineCalls[0].args as { p_conversation_ids: string[] }).p_conversation_ids).toHaveLength(250);
    expect(db.reads.filter((read) => read.table === "guest_message_outbox")).toHaveLength(3);
    expect(db.inFlight.guest_message_outbox.max).toBe(3);
  });

  it("발송 줄 묶음 하나가 실패하면 목록 읽기도 실패한다(예전처럼 던진다)", async () => {
    const open = Array.from({ length: 150 }, (_, i) => conversation(uuid("1", i)));
    const fake = createFakeSupabase({ guest_conversations: open }, lastLinesRpc);
    const client = {
      ...fake.client,
      from(table: string) {
        if (table !== "guest_message_outbox") return fake.client.from(table);
        const builder = fake.client.from(table) as unknown as { then: (resolve: (v: unknown) => unknown) => Promise<unknown> };
        builder.then = (resolve) => Promise.resolve(resolve({ data: null, error: { message: "boom" } }));
        return builder;
      },
    };
    await expect(loadInboxList(client as never, ORG, { status: "all", building: null }, NOW)).rejects.toThrow(/outbox read failed/);
  });
});

describe("실시간 줄 다시 읽기 — 신호 온 id 만큼만", () => {
  function doneRows(count: number) {
    return Array.from({ length: count }, (_, i) =>
      conversation(uuid("2", i), {
        status: "done",
        last_message_at: new Date(Date.UTC(2026, 10, 1) + i * 60_000).toISOString(),
      }),
    );
  }

  it("처리 끝이 몇 천 개여도 처리 끝 창은 경계 한 줄만 읽고, 열린 대화도 전체 칸을 다시 읽지 않는다", async () => {
    const done = doneRows(3000);
    const awaiting = [conversation(uuid("3", 1)), conversation(uuid("3", 2), { channel: "booking" })];
    const fake = createFakeSupabase({ guest_conversations: [...done, ...awaiting], guest_message_outbox: [] }, lastLinesRpc);
    const db = instrument(fake);
    const newest = String(done[2999].id);
    const result = await loadInboxRowsByIds(db.client, ORG, [newest], { status: "all", building: null }, NOW);
    expect(result.updates.map((update) => update.matches)).toEqual([true]);
    expect(result.awaitingCount).toBe(2);
    const conversationReads = db.reads.filter((read) => read.table === "guest_conversations");
    // 찾은 줄(1) + 열린 대화 좁은 칸(2) + 처리 끝 경계(1) — 3,000개와 무관.
    expect(conversationReads.reduce((sum, read) => sum + read.rows, 0)).toBeLessThanOrEqual(1 + awaiting.length + 1);
    const wide = conversationReads.filter((read) => read.columns?.includes("guest_language"));
    expect(wide.map((read) => read.rows)).toEqual([1]);
  });

  it("처리 끝 창 경계 — 같은 시각이면 id 순으로, 시각 없는 줄은 맨 뒤(목록과 같은 순서)", async () => {
    // 200개 중 마지막 두 줄이 같은 시각: id 가 작은 쪽만 창 안.
    const done = doneRows(199);
    const tieAt = new Date(Date.UTC(2026, 9, 1)).toISOString();
    const tieIn = conversation(uuid("4", 1), { status: "done", last_message_at: tieAt });
    const tieOut = conversation(uuid("4", 2), { status: "done", last_message_at: tieAt });
    const noTime = conversation(uuid("4", 0), { status: "done", last_message_at: null });
    const fake = createFakeSupabase({ guest_conversations: [...done, tieOut, noTime, tieIn], guest_message_outbox: [] }, lastLinesRpc);
    const result = await loadInboxRowsByIds(
      fake.client as never,
      ORG,
      [String(tieIn.id), String(tieOut.id), String(noTime.id), String(done[0].id)],
      { status: "done", building: null },
      NOW,
    );
    const byId = new Map(result.updates.map((update) => [update.row.id, update.matches]));
    expect(byId.get(String(tieIn.id))).toBe(true);
    expect(byId.get(String(tieOut.id))).toBe(false);
    expect(byId.get(String(noTime.id))).toBe(false);
    expect(byId.get(String(done[0].id))).toBe(true);

    // 목록도 같은 200개를 고른다.
    const list = await loadInboxList(fake.client as never, ORG, { status: "done", building: null }, NOW);
    const listed = new Set(list.rows.map((row) => row.id));
    expect(listed.has(String(tieIn.id))).toBe(true);
    expect(listed.has(String(tieOut.id))).toBe(false);
    expect(listed.has(String(noTime.id))).toBe(false);
  });

  it("머리 숫자 — 끝난 「나중에」 · 시각 없는 「나중에」는 기다림, 건물 · 채널 필터는 따른다", async () => {
    const rows = [
      conversation(uuid("5", 1)),
      conversation(uuid("5", 2), { status: "snoozed", snooze_until: "2026-11-19T02:00:00Z" }),
      conversation(uuid("5", 3), { status: "snoozed", snooze_until: null }),
      conversation(uuid("5", 4), { status: "snoozed", snooze_until: "2026-11-20T00:00:00Z" }),
      conversation(uuid("5", 5), { property_name: "다른건물" }),
      conversation(uuid("5", 6), { channel: "expedia" }),
    ];
    const fake = createFakeSupabase({ guest_conversations: rows, guest_message_outbox: [] }, lastLinesRpc);
    const ids = [String(rows[0].id)];
    const all = await loadInboxRowsByIds(fake.client as never, ORG, ids, { status: "all", building: null }, NOW);
    expect(all.awaitingCount).toBe(5);
    const building = await loadInboxRowsByIds(fake.client as never, ORG, ids, { status: "all", building: "아라키초A" }, NOW);
    expect(building.awaitingCount).toBe(4);
    const other = await loadInboxRowsByIds(fake.client as never, ORG, ids, { status: "all", building: null, channel: "other" }, NOW);
    expect(other.awaitingCount).toBe(1);
    // 목록의 머리 숫자와 같다.
    const list = await loadInboxList(fake.client as never, ORG, { status: "all", building: null }, NOW);
    expect(list.awaitingCount).toBe(all.awaitingCount);
  });
});

function message(patch: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    provider: "beds24",
    providerBookingId: "93328947",
    externalId: "1",
    providerSource: "guest",
    direction: "guest",
    body: "Hello",
    sentAt: "2026-11-19T02:00:00Z",
    read: false,
    timeAssumedUtc: false,
    attachments: [],
    externalPropertyId: null,
    externalRoomId: null,
    booking: null,
    ...patch,
  } as NormalizedMessage;
}

describe("웹훅 넣기 — 왕복 줄이기", () => {
  it("이미 있는 메시지 찾기는 external_id 를 100개씩 나눠(250개 → 3번) 동시에, 자동 안내 줄 읽기는 예전처럼 메아리 뒤에", async () => {
    const fake = createFakeSupabase(
      {
        guest_conversations: [conversation(uuid("6", 1), { provider_booking_id: "93328947", status: "done" })],
        guest_messages: [{ organization_id: ORG, provider: "beds24", external_id: "7", read_at: null }],
        guest_message_outbox: [],
      },
      { guest_conversation_apply_messages: () => ({ data: [], error: null }) },
    );
    const db = instrument(fake, ["guest_messages", "guest_message_outbox"]);
    const messages = Array.from({ length: 250 }, (_, i) =>
      message({ externalId: String(i + 1), direction: i % 2 ? "host" : "guest", sentAt: new Date(Date.UTC(2026, 10, 19) + i * 1000).toISOString() }),
    );
    const result = await ingestConversationMessages(db.client, {
      organizationId: ORG,
      provider: "beds24",
      providerBookingId: "93328947",
      seed: EMPTY_SEED,
      messages,
      now: NOW,
    });
    expect(result.duplicates).toBe(1);
    expect(result.inserted).toBe(249);
    const lookups = db.reads.filter((read) => read.table === "guest_messages" && read.columns === "external_id, read_at");
    expect(lookups).toHaveLength(3);
    // 찾기 3묶음이 동시에 떠 있었다.
    expect(db.inFlight.guest_messages.max).toBeGreaterThanOrEqual(3);
    // 자동 안내 줄 읽기는 앞당기지 않는다 — 찾기 · 메아리 읽기 **뒤에** 한 번(발송 처리와 겹칠 때 낡은 줄을 읽지 않게).
    const autoIndex = db.reads.findIndex((read) => read.table === "guest_message_outbox" && read.columns === "id, external_id");
    const echoIndex = db.reads.findIndex((read) => read.table === "guest_message_outbox" && read.columns === "id, status, external_id, body, sent_at, created_at");
    const lastLookup = db.reads.map((read) => read.columns).lastIndexOf("external_id, read_at");
    expect(db.reads.filter((read) => read.table === "guest_message_outbox" && read.columns === "id, external_id")).toHaveLength(1);
    expect(echoIndex).toBeGreaterThan(lastLookup);
    expect(autoIndex).toBeGreaterThan(echoIndex);
  });

  it("예약 · 건물 · 객실 찾기는 동시에 — 우선순위(예약 id → raw id → bookId, 예약 건물 이름이 먼저)는 그대로", async () => {
    const fake = createFakeSupabase({
      reservations: [
        { id: "r-book", organization_id: ORG, property_name: "예약건물", room_label: "301", guest_name: "R", check_in_date: "2026-11-20", check_out_date: "2026-11-21", source: "airbnb", raw_payload: { bookId: "555" } },
      ],
      properties: [{ id: "p-1", organization_id: ORG, external_provider: "beds24", external_property_id: "P9", name: "건물표이름" }],
      rooms: [{ id: "room-1", organization_id: ORG, external_provider: "beds24", external_room_id: "R9" }],
    });
    const db = instrument(fake, ["reservations", "properties", "rooms"]);
    const seed = await resolveConversationSeed(db.client, {
      organizationId: ORG,
      providerBookingId: "555",
      booking: null,
      externalPropertyId: "P9",
      externalRoomId: "R9",
    });
    expect(seed).toMatchObject({ reservation_id: "r-book", property_name: "예약건물", property_id: "p-1", room_id: "room-1", channel: "airbnb" });
    expect(db.inFlight.properties.max).toBe(1);
    // 세 갈래가 겹쳤다: 예약 찾기(raw id → bookId, 차례) 도중 건물 · 객실 읽기가 이미 떠 있다.
    const order = db.reads.map((read) => read.table);
    expect(order.indexOf("properties")).toBeLessThan(order.lastIndexOf("reservations"));
    expect(order.indexOf("rooms")).toBeLessThan(order.lastIndexOf("reservations"));
  });

  it("예약을 못 찾으면 건물 표 이름으로, 한 갈래가 실패해도 나머지는 채운다", async () => {
    const fake = createFakeSupabase({
      reservations: [],
      properties: [{ id: "p-1", organization_id: ORG, external_provider: "beds24", external_property_id: "P9", name: "건물표이름" }],
      rooms: [],
    });
    const client = {
      ...fake.client,
      from(table: string) {
        if (table === "rooms") throw new Error("rooms down");
        return fake.client.from(table);
      },
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const seed = await resolveConversationSeed(client as never, {
      organizationId: ORG,
      providerBookingId: "1",
      booking: null,
      externalPropertyId: "P9",
      externalRoomId: "R9",
    });
    expect(seed).toMatchObject({ reservation_id: null, property_id: "p-1", property_name: "건물표이름", room_id: null });
    errorSpy.mockRestore();
  });
});
