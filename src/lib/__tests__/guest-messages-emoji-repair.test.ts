import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const account = vi.hoisted(() => ({ value: null as null | { remaining: number | null; resetsAt: number | null; requestCost: number | null } }));
const cooldown = vi.hoisted(() => ({ active: false, activated: [] as unknown[] }));

vi.mock("@/lib/beds24/account-credit", () => ({ readBeds24AccountCredit: async () => account.value }));
vi.mock("@/lib/beds24/sync-control", () => ({ isBeds24SyncPaused: () => false }));
vi.mock("@/lib/beds24/sync-locks", () => ({
  getBeds24Cooldown: async () => ({ active: cooldown.active, reason: null, remainingSec: 0, until: null }),
  activateBeds24Cooldown: async (_supabase: unknown, args: unknown) => {
    cooldown.activated.push(args);
  },
}));
vi.mock("@/lib/guest-messages/adapter-server", () => ({ recordGuestMessageCredit: async () => {} }));
vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: () => {
    throw new Error("tests must pass a fake supabase");
  },
}));

import { createFakeSupabase } from "@/lib/__tests__/fake-supabase";
import { EMOJI_HEAL_DAILY_MAX_REQUESTS } from "@/lib/guest-messages/emoji-heal";
import { healEmojiAfterWebhook, repairEmojiDamagedMessages, type EmojiHealSuspect } from "@/lib/guest-messages/emoji-repair";
import { healEmojiDamagedMessages, ingestConversationMessages, EMPTY_SEED } from "@/lib/guest-messages/store";
import type { NormalizedMessage } from "@/lib/guest-messages/types";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-11-27T03:00:00.000Z");

type Row = Record<string, unknown>;

function message(externalId: string, body: string, extra: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    provider: "beds24",
    externalId,
    providerBookingId: "5001",
    externalPropertyId: null,
    externalRoomId: null,
    direction: "guest",
    body,
    sentAt: "2026-11-20T01:00:00.000Z",
    read: false,
    attachments: [],
    providerSource: "guest",
    booking: null,
    timeAssumedUtc: false,
    ...extra,
  } as NormalizedMessage;
}

function seedDb(extra: Record<string, Row[]> = {}) {
  return createFakeSupabase({
    organizations: [
      { id: ORG, status: "active" },
      { id: OTHER_ORG, status: "active" },
    ],
    guest_message_channel_state: [],
    guest_conversations: [
      { id: "c1", organization_id: ORG, provider: "beds24", provider_booking_id: "5001", status: "done" },
      { id: "c2", organization_id: ORG, provider: "beds24", provider_booking_id: "5002", status: "done" },
      { id: "cx", organization_id: OTHER_ORG, provider: "beds24", provider_booking_id: "5009", status: "done" },
    ],
    guest_messages: [
      { id: "m1", organization_id: ORG, conversation_id: "c1", provider: "beds24", external_id: "1", direction: "guest", body: "謝謝??", body_translated: "고마워요??", translated_lang: "ko", created_at: "2026-11-14T01:00:00Z", sent_at: "2026-11-14T01:00:00Z", read_at: null },
      { id: "m2", organization_id: ORG, conversation_id: "c1", provider: "beds24", external_id: "2", direction: "guest", body: "really??", body_translated: null, translated_lang: null, created_at: "2026-11-14T02:00:00Z", sent_at: "2026-11-14T02:00:00Z", read_at: null },
      { id: "m3", organization_id: ORG, conversation_id: "c2", provider: "beds24", external_id: "3", direction: "host", body: "Sure ?", body_translated: "물론 ?", translated_lang: "ko", created_at: "2026-11-15T01:00:00Z", sent_at: "2026-11-15T01:00:00Z", read_at: null },
      { id: "mx", organization_id: OTHER_ORG, conversation_id: "cx", provider: "beds24", external_id: "9", direction: "guest", body: "hi ?", body_translated: null, translated_lang: null, created_at: "2026-11-15T02:00:00Z", sent_at: "2026-11-15T02:00:00Z", read_at: null },
    ],
    guest_message_translations: [
      { message_id: "m1", organization_id: ORG, lang: "ko", body: "고마워요??" },
      { message_id: "m1", organization_id: ORG, lang: "en", body: "Thanks??" },
      { message_id: "m2", organization_id: ORG, lang: "ko", body: "정말??" },
    ],
    guest_message_outbox: [],
    reservations: [],
    ...extra,
  });
}

function bodyOf(fake: ReturnType<typeof seedDb>, id: string) {
  return (fake.tables.guest_messages ?? []).find((row) => row.id === id);
}

/** 다른 쪽이 상태 줄을 먼저 고친 것처럼 — 새 객체로 바꾼다(가짜 DB 는 읽은 줄을 같은 객체로 돌려줘서 고치면 읽은 값도 바뀐다). */
function bumpState(fake: ReturnType<typeof seedDb>, n: number) {
  const rows = fake.tables.guest_message_channel_state!;
  rows[0] = { ...rows[0], updated_at: `2026-11-27T02:00:0${n}.000000+00:00` };
}

/** `table` 고치기 직전마다 `before(n)`(n = 몇 번째 고치기, 1부터)를 부른다 — 다른 쪽이 먼저 고친 것처럼 꾸밀 때. */
function beforeUpdates(fake: ReturnType<typeof seedDb>, table: string, before: (n: number) => void) {
  const client = fake.client as unknown as { from: (name: string) => Record<string, unknown> };
  const original = client.from.bind(client);
  let n = 0;
  client.from = (name: string) => {
    const query = original(name);
    if (name !== table) return query;
    const update = query.update as (value: unknown) => unknown;
    query.update = (value: unknown) => {
      n += 1;
      before(n);
      return update(value);
    };
    return query;
  };
}

describe("healEmojiDamagedMessages", () => {
  it("가려진 줄만 고치고 손님 말 번역을 지운다", async () => {
    const fake = seedDb();
    const healed = await healEmojiDamagedMessages(fake.client as never, {
      organizationId: ORG,
      provider: "beds24",
      messages: [message("1", "謝謝🙏🏻"), message("2", "really??"), message("3", "Sure 👍", { direction: "host" })],
    });
    expect(healed).toBe(2);
    expect(bodyOf(fake, "m1")).toMatchObject({ body: "謝謝🙏🏻", body_translated: null, translated_lang: null });
    expect(bodyOf(fake, "m2")).toMatchObject({ body: "really??" });
    // 직원 말의 body_translated 는 직원 원문 — 두고 본문만.
    expect(bodyOf(fake, "m3")).toMatchObject({ body: "Sure 👍", body_translated: "물론 ?" });
    expect((fake.tables.guest_message_translations ?? []).map((row) => `${row.message_id}:${row.lang}`)).toEqual(["m2:ko"]);
  });

  it("다른 조직 줄은 건드리지 않는다", async () => {
    const fake = seedDb();
    const healed = await healEmojiDamagedMessages(fake.client as never, {
      organizationId: ORG,
      provider: "beds24",
      messages: [message("9", "hi 😊")],
    });
    expect(healed).toBe(0);
    expect(bodyOf(fake, "mx")).toMatchObject({ body: "hi ?" });
  });

  it("대화를 주면 그 대화 줄만 고친다", async () => {
    const fake = seedDb();
    const healed = await healEmojiDamagedMessages(fake.client as never, {
      organizationId: ORG,
      provider: "beds24",
      conversationId: "c2",
      messages: [message("1", "謝謝🙏🏻")],
    });
    expect(healed).toBe(0);
    expect(bodyOf(fake, "m1")).toMatchObject({ body: "謝謝??" });
  });

  it("읽은 뒤 다른 쪽이 먼저 본문을 바꿨으면 덮지 않고, 실제로 바뀐 줄만 센다(번역도 그 줄만 지움)", async () => {
    const fake = seedDb();
    beforeUpdates(fake, "guest_messages", () => {
      bodyOf(fake, "m1")!.body = "謝謝🙏🏻!";
    });
    const healed = await healEmojiDamagedMessages(fake.client as never, {
      organizationId: ORG,
      provider: "beds24",
      messages: [message("1", "謝謝🙏🏻")],
    });
    expect(healed).toBe(0);
    expect(bodyOf(fake, "m1")).toMatchObject({ body: "謝謝🙏🏻!", body_translated: "고마워요??" });
    expect((fake.tables.guest_message_translations ?? []).filter((row) => row.message_id === "m1")).toHaveLength(2);
  });

  it("들어온 본문에 이모지가 없으면 읽지도 않는다(웹훅 본문)", async () => {
    const fake = seedDb();
    const healed = await healEmojiDamagedMessages(fake.client as never, {
      organizationId: ORG,
      provider: "beds24",
      messages: [message("1", "謝謝??")],
    });
    expect(healed).toBe(0);
    expect(fake.writes.length).toBe(0);
  });
});

describe("ingestConversationMessages 가 API 본문으로 고친다", () => {
  it("이미 있는 줄(ignoreDuplicates)도 되살린다", async () => {
    const fake = seedDb();
    const result = await ingestConversationMessages(fake.client as never, {
      organizationId: ORG,
      provider: "beds24",
      providerBookingId: "5001",
      seed: EMPTY_SEED,
      messages: [message("1", "謝謝🙏🏻")],
      now: NOW,
    });
    expect(result.healed).toBe(1);
    expect(bodyOf(fake, "m1")).toMatchObject({ body: "謝謝🙏🏻" });
  });

  it("웹훅의 가려진 본문은 진짜 이모지를 덮지 않는다", async () => {
    const fake = seedDb();
    (fake.tables.guest_messages ?? []).find((row) => row.id === "m1")!.body = "謝謝🙏🏻";
    await ingestConversationMessages(fake.client as never, {
      organizationId: ORG,
      provider: "beds24",
      providerBookingId: "5001",
      seed: EMPTY_SEED,
      messages: [message("1", "謝謝??")],
      now: NOW,
    });
    expect(bodyOf(fake, "m1")).toMatchObject({ body: "謝謝🙏🏻" });
  });
});

describe("repairEmojiDamagedMessages", () => {
  beforeEach(() => {
    account.value = null;
    cooldown.active = false;
    cooldown.activated = [];
  });

  function fetchFor(byBooking: Record<string, unknown[] | unknown[][]>, calls: string[], inits: Array<RequestInit | undefined> = []) {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      inits.push(init);
      const params = new URL(url).searchParams;
      const entry = byBooking[params.get("bookingId") ?? ""] ?? [];
      // 페이지별로 주면(배열의 배열) 그 페이지, 아니면 한 페이지.
      const pages = Array.isArray(entry[0]) ? (entry as unknown[][]) : [entry as unknown[]];
      const index = Number(params.get("page") ?? "1") - 1;
      const data = pages[index] ?? [];
      return new Response(JSON.stringify({ success: true, data, pages: { nextPageExists: index + 1 < pages.length } }), {
        status: 200,
        headers: { "x-five-min-limit-remaining": "180", "x-five-min-limit-resets-in": "200", "x-request-cost": "1" },
      });
    }) as typeof fetch;
  }

  const deps = (fake: ReturnType<typeof seedDb>, fetchImpl: typeof fetch) => ({
    supabase: fake.client as never,
    fetchImpl,
    resolveToken: async () => ({ ok: true as const, token: "t" }),
    baseUrl: "https://beds24.test/api/v2",
    now: () => NOW,
  });

  it("「?」 들어간 대화만 예약마다 한 번 읽고, 맞는 줄만 고친다", async () => {
    const fake = seedDb();
    const calls: string[] = [];
    const inits: Array<RequestInit | undefined> = [];
    const fetchImpl = fetchFor(
      {
        "5001": [
          { id: 1, bookingId: 5001, source: "guest", message: "謝謝🙏🏻", time: "2026-11-14T01:00:00Z" },
          { id: 2, bookingId: 5001, source: "guest", message: "really??", time: "2026-11-14T02:00:00Z" },
        ],
        "5002": [{ id: 3, bookingId: 5002, source: "host", message: "Sure 👍", time: "2026-11-15T01:00:00Z" }],
      },
      calls,
      inits,
    );
    const result = await repairEmojiDamagedMessages(ORG, { since: "2026-11-13T00:00:00.000Z", maxBookings: 10 }, deps(fake, fetchImpl));
    expect(calls).toEqual([
      "https://beds24.test/api/v2/bookings/messages?bookingId=5001&maxAge=999&page=1",
      "https://beds24.test/api/v2/bookings/messages?bookingId=5002&maxAge=999&page=1",
    ]);
    // 요청마다 시간 제한(AbortSignal).
    expect(inits.every((init) => init?.signal instanceof AbortSignal)).toBe(true);
    expect(result).toMatchObject({ skipped: null, stoppedEarly: null, bookings: 2, healed: 2, nextCursor: null });
    expect(bodyOf(fake, "m1")).toMatchObject({ body: "謝謝🙏🏻" });
    expect(bodyOf(fake, "m2")).toMatchObject({ body: "really??" });
    expect(bodyOf(fake, "mx")).toMatchObject({ body: "hi ?" });
  });

  it("다른 예약 메시지가 섞여 오면(필터 무시) 그 줄은 안 쓰고 멈춘다 — 경고 로그(본문 없이)", async () => {
    const fake = seedDb();
    const calls: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = fetchFor(
      { "5001": [{ id: 3, bookingId: 5002, source: "host", message: "Sure 👍" }] },
      calls,
    );
    const result = await repairEmojiDamagedMessages(ORG, { since: "2026-11-13T00:00:00.000Z", maxBookings: 10 }, deps(fake, fetchImpl));
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ stoppedEarly: "filter_ignored", healed: 0, nextCursor: "2026-11-14T01:00:00.000Z" });
    expect(bodyOf(fake, "m3")).toMatchObject({ body: "Sure ?" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("Sure");
    warn.mockRestore();
  });

  it("예약 메시지가 여러 페이지면 다음 페이지도(상한 3)", async () => {
    const fake = seedDb();
    const calls: string[] = [];
    const filler = (n: number) => Array.from({ length: 2 }, (_, i) => ({ id: 100 + n * 10 + i, bookingId: 5001, source: "guest", message: "hi" }));
    const fetchImpl = fetchFor(
      { "5001": [filler(1), [{ id: 1, bookingId: 5001, source: "guest", message: "謝謝🙏🏻" }], filler(3), filler(4)] },
      calls,
    );
    const result = await repairEmojiDamagedMessages(ORG, { since: "2026-11-13T00:00:00.000Z", maxBookings: 1 }, deps(fake, fetchImpl));
    expect(calls).toEqual([1, 2, 3].map((page) => `https://beds24.test/api/v2/bookings/messages?bookingId=5001&maxAge=999&page=${page}`));
    expect(result).toMatchObject({ bookings: 1, requests: 3, healed: 1 });
    expect(bodyOf(fake, "m1")).toMatchObject({ body: "謝謝🙏🏻" });
  });

  it("시간 예산을 넘기면 멈추고 커서를 돌려준다", async () => {
    const fake = seedDb();
    const calls: string[] = [];
    let t = NOW.getTime();
    const inner = fetchFor({}, calls);
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      t += 50_000;
      return inner(input, init);
    }) as typeof fetch;
    const result = await repairEmojiDamagedMessages(
      ORG,
      { since: "2026-11-13T00:00:00.000Z", maxBookings: 10 },
      { ...deps(fake, fetchImpl), now: () => new Date(t) },
    );
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ stoppedEarly: "time_budget", nextCursor: "2026-11-15T01:00:00.000Z", nextCursorId: "m3" });
  });

  it("발송 큐로 보낸 직원 줄(outbox_id)은 후보가 아니다", async () => {
    const fake = seedDb();
    for (const row of fake.tables.guest_messages ?? []) if (row.conversation_id === "c1") row.outbox_id = "o1";
    const calls: string[] = [];
    await repairEmojiDamagedMessages(ORG, { since: "2026-11-13T00:00:00.000Z", maxBookings: 10 }, deps(fake, fetchFor({}, calls)));
    expect(calls.map((url) => new URL(url).searchParams.get("bookingId"))).toEqual(["5002"]);
  });

  it("조직이 없거나 활성이 아니면 아무것도 안 한다", async () => {
    const fake = seedDb();
    fake.tables.organizations![0].status = "suspended";
    const calls: string[] = [];
    const result = await repairEmojiDamagedMessages(ORG, { since: "2026-11-13T00:00:00.000Z" }, deps(fake, fetchFor({}, calls)));
    expect(result.skipped).toBe("organization");
    expect(calls).toHaveLength(0);
  });

  it("후보가 없으면 Beds24 를 부르지 않는다", async () => {
    const fake = seedDb();
    const calls: string[] = [];
    const result = await repairEmojiDamagedMessages(ORG, { since: "2026-11-20T00:00:00.000Z", maxBookings: 10 }, deps(fake, fetchFor({}, calls)));
    expect(calls).toHaveLength(0);
    expect(result).toMatchObject({ attempted: false, bookings: 0, healed: 0 });
  });

  it("계정 크레딧이 선 아래면 부르지 않는다", async () => {
    const fake = seedDb();
    account.value = { remaining: 5, resetsAt: NOW.getTime() + 60_000, requestCost: 1 };
    const calls: string[] = [];
    const result = await repairEmojiDamagedMessages(ORG, { since: "2026-11-13T00:00:00.000Z", maxBookings: 10 }, deps(fake, fetchFor({}, calls)));
    expect(calls).toHaveLength(0);
    expect(result.skipped).toBe("low_credit");
    expect(result.nextCursor).toBe("2026-11-13T00:00:00.000Z");
  });

  it("같은 시각 줄이 몰려 있어도 커서(시각 + id)로 다음 대화로 넘어간다", async () => {
    const at = "2026-11-14T01:00:00.000Z";
    const fake = seedDb({
      guest_conversations: [
        { id: "c1", organization_id: ORG, provider: "beds24", provider_booking_id: "5001", status: "done" },
        { id: "c2", organization_id: ORG, provider: "beds24", provider_booking_id: "5002", status: "done" },
        { id: "c3", organization_id: ORG, provider: "beds24", provider_booking_id: "5003", status: "done" },
      ],
      guest_messages: ["1", "2", "3"].map((n) => ({
        id: `t${n}`, organization_id: ORG, conversation_id: `c${n}`, provider: "beds24", external_id: `e${n}`, direction: "guest",
        // 진짜 물음표 — 다시 읽어도 안 바뀐다.
        body: "really??", body_translated: null, translated_lang: null, created_at: at, sent_at: at, read_at: null,
      })),
    });
    const calls: string[] = [];
    const run = (since: string, sinceId: string | null) =>
      repairEmojiDamagedMessages(ORG, { since, sinceId, maxBookings: 1 }, deps(fake, fetchFor({}, calls)));
    const first = await run("2026-11-13T00:00:00.000Z", null);
    expect(first).toMatchObject({ nextCursor: at, nextCursorId: "t2" });
    const second = await run(first.nextCursor!, first.nextCursorId);
    expect(second).toMatchObject({ nextCursor: at, nextCursorId: "t3" });
    const third = await run(second.nextCursor!, second.nextCursorId);
    expect(third).toMatchObject({ nextCursor: null, nextCursorId: null });
    expect(calls.map((url) => new URL(url).searchParams.get("bookingId"))).toEqual(["5001", "5002", "5003"]);
  });

  it("429 면 쿨다운 켜고 멈춘다 — 커서는 못 읽은 대화부터", async () => {
    const fake = seedDb();
    const fetchImpl = (async () =>
      new Response("{}", { status: 429, headers: { "x-five-min-limit-resets-in": "120" } })) as typeof fetch;
    const result = await repairEmojiDamagedMessages(ORG, { since: "2026-11-13T00:00:00.000Z", maxBookings: 10 }, deps(fake, fetchImpl));
    expect(result.stoppedEarly).toBe("rate_limited");
    expect(cooldown.activated).toHaveLength(1);
    expect(result.nextCursor).toBe("2026-11-14T01:00:00.000Z");
  });
});

describe("웹훅 뒤 그 예약만 다시 읽기", () => {
  beforeEach(() => {
    account.value = null;
    cooldown.active = false;
    cooldown.activated = [];
  });

  function bookingFetch(byBooking: Record<string, unknown[]>, calls: string[]) {
    return (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const data = byBooking[new URL(url).searchParams.get("bookingId") ?? ""] ?? [];
      return new Response(JSON.stringify({ success: true, data, pages: { nextPageExists: false } }), {
        status: 200,
        headers: { "x-five-min-limit-remaining": "180", "x-five-min-limit-resets-in": "200", "x-request-cost": "1" },
      });
    }) as typeof fetch;
  }
  const stateRow = (extra: Row = {}) => ({
    organization_id: ORG,
    credit_reserve: 20,
    settings: { responseTargetMinutes: 30 },
    updated_at: "2026-11-27T02:00:00.000000+00:00",
    ...extra,
  });
  const heal = (fake: ReturnType<typeof seedDb>, fetchImpl: typeof fetch, suspects: EmojiHealSuspect[]) =>
    healEmojiAfterWebhook(fake.client as never, suspects, {
      fetchImpl,
      resolveToken: async () => ({ ok: true as const, token: "t" }),
      baseUrl: "https://beds24.test/api/v2",
      now: () => NOW,
    });
  const suspect = (extra: Partial<EmojiHealSuspect> = {}): EmojiHealSuspect => ({
    organizationId: ORG,
    conversationId: "c1",
    providerBookingId: "5001",
    insertedAt: "2026-11-27T02:59:59.000Z",
    ...extra,
  });
  const healState = (fake: ReturnType<typeof seedDb>) =>
    ((fake.tables.guest_message_channel_state ?? [])[0]?.settings as { emojiHeal?: Record<string, unknown> } | undefined)?.emojiHeal;

  it("그 예약 하나만 한 번 읽고 고친다 — 같은 배달의 같은 예약은 한 번, 다른 설정 키는 그대로", async () => {
    const fake = seedDb({ guest_message_channel_state: [stateRow()] });
    const calls: string[] = [];
    const result = await heal(
      fake,
      bookingFetch({ "5001": [{ id: 1, bookingId: 5001, source: "guest", message: "謝謝🙏🏻", time: "2026-11-14T01:00:00Z" }] }, calls),
      [suspect(), suspect()],
    );
    expect(calls).toEqual(["https://beds24.test/api/v2/bookings/messages?bookingId=5001&maxAge=999&page=1"]);
    expect(result).toMatchObject({ bookings: 1, requests: 1, healed: 1, skipped: null, stoppedEarly: null });
    expect(bodyOf(fake, "m1")).toMatchObject({ body: "謝謝🙏🏻" });
    // c2 는 이번 배달에 없었다 — 안 읽는다.
    expect(bodyOf(fake, "m3")).toMatchObject({ body: "Sure ?" });
    expect(healState(fake)).toEqual({ day: "2026-11-27", used: 1, recent: { "5001": NOW.toISOString() } });
    expect(fake.tables.guest_message_channel_state![0].settings).toMatchObject({ responseTargetMinutes: 30 });
  });

  it("이 줄이 들어간 뒤 같은 예약을 이미 읽었으면(연달아 온 배달) 다시 안 읽는다", async () => {
    const fake = seedDb({
      guest_message_channel_state: [stateRow({ settings: { emojiHeal: { day: "2026-11-27", used: 4, recent: { "5001": "2026-11-27T02:59:59.500Z" } } } })],
    });
    const calls: string[] = [];
    const result = await heal(fake, bookingFetch({}, calls), [suspect()]);
    expect(calls).toHaveLength(0);
    expect(result.bookings).toBe(0);
  });

  it("그날 상한을 다 썼으면 부르지 않는다", async () => {
    const fake = seedDb({
      guest_message_channel_state: [stateRow({ settings: { emojiHeal: { day: "2026-11-27", used: EMOJI_HEAL_DAILY_MAX_REQUESTS } } })],
    });
    const calls: string[] = [];
    await heal(fake, bookingFetch({}, calls), [suspect()]);
    expect(calls).toHaveLength(0);
  });

  it("계정 크레딧이 선 아래 · 쿨다운이면 부르지 않는다", async () => {
    const calls: string[] = [];
    account.value = { remaining: 5, resetsAt: NOW.getTime() + 60_000, requestCost: 1 };
    expect(await heal(seedDb({ guest_message_channel_state: [stateRow()] }), bookingFetch({}, calls), [suspect()])).toMatchObject({ skipped: "low_credit" });
    account.value = null;
    cooldown.active = true;
    expect(await heal(seedDb({ guest_message_channel_state: [stateRow()] }), bookingFetch({}, calls), [suspect()])).toMatchObject({ skipped: "cooldown" });
    expect(calls).toHaveLength(0);
  });

  it("필터가 무시되면 그 응답은 안 쓰고 그날은 멈춘다", async () => {
    const fake = seedDb({ guest_message_channel_state: [stateRow()] });
    const calls: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await heal(
      fake,
      bookingFetch({ "5001": [{ id: 77, bookingId: 7777, source: "guest", message: "secret 🙏", time: "2026-11-14T01:00:00Z" }] }, calls),
      [suspect()],
    );
    warn.mockRestore();
    expect(result.stoppedEarly).toBe("filter_ignored");
    expect(healState(fake)).toMatchObject({ used: EMOJI_HEAL_DAILY_MAX_REQUESTS });
  });

  it("429 면 쿨다운 켜고 멈춘다 · 무슨 일이 있어도 던지지 않는다", async () => {
    const fake = seedDb({ guest_message_channel_state: [stateRow()] });
    const limited = (async () => new Response("{}", { status: 429, headers: { "x-five-min-limit-resets-in": "120" } })) as typeof fetch;
    expect(await heal(fake, limited, [suspect()])).toMatchObject({ stoppedEarly: "rate_limited" });
    expect(cooldown.activated).toHaveLength(1);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { from: () => { throw new Error("db down"); } };
    await expect(healEmojiAfterWebhook(broken as never, [suspect()], { baseUrl: "https://beds24.test/api/v2" })).resolves.toMatchObject({ bookings: 0 });
    errorSpy.mockRestore();
  });

  it("읽기가 실패하면(요청 오류 · 0번) 몫을 돌려주고 읽은 표시를 지운다 — 다음 배달은 다시 읽는다", async () => {
    const fake = seedDb({ guest_message_channel_state: [stateRow()] });
    const broken = (async () => {
      throw new Error("network");
    }) as typeof fetch;
    expect(await heal(fake, broken, [suspect()])).toMatchObject({ stoppedEarly: "request_error", requests: 0 });
    expect(healState(fake)).toEqual({ day: "2026-11-27", used: 0, recent: {} });
    const calls: string[] = [];
    await heal(fake, bookingFetch({}, calls), [suspect()]);
    expect(calls).toHaveLength(1);
  });

  it("HTTP 오류면 쓴 요청은 세고 읽은 표시는 지운다", async () => {
    const fake = seedDb({ guest_message_channel_state: [stateRow()] });
    const failing = (async () => new Response("{}", { status: 500 })) as typeof fetch;
    expect(await heal(fake, failing, [suspect()])).toMatchObject({ stoppedEarly: "http_error", requests: 1 });
    expect(healState(fake)).toEqual({ day: "2026-11-27", used: 1, recent: {} });
  });

  it("몫 잡기 쓰기가 3번 다 밀리면 부르지 않고 아무것도 남기지 않는다", async () => {
    const fake = seedDb({ guest_message_channel_state: [stateRow()] });
    beforeUpdates(fake, "guest_message_channel_state", (n) => {
      bumpState(fake, n);
    });
    const calls: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await heal(fake, bookingFetch({}, calls), [suspect()])).toMatchObject({ bookings: 0, requests: 0 });
    warn.mockRestore();
    expect(calls).toHaveLength(0);
    expect(healState(fake)).toBeUndefined();
  });

  it("끝난 뒤 맞추기 쓰기가 몇 번 밀려도 끝내 맞춘다(잡을 때 센 1 이 남지 않게)", async () => {
    const fake = seedDb({ guest_message_channel_state: [stateRow()] });
    // 1번째 고치기 = 몫 잡기(통과), 2~4번째 = 맞추기가 3번 밀림.
    beforeUpdates(fake, "guest_message_channel_state", (n) => {
      if (n >= 2 && n <= 4) bumpState(fake, n);
    });
    const failing = (async () => {
      throw new Error("network");
    }) as typeof fetch;
    await heal(fake, failing, [suspect()]);
    expect(healState(fake)).toEqual({ day: "2026-11-27", used: 0, recent: {} });
  });

  it("그날 상한에 처음 닿으면 경고 한 번(조직 id 만) — 다음 배달은 조용히 건너뛴다", async () => {
    const fake = seedDb({
      guest_message_channel_state: [stateRow({ settings: { emojiHeal: { day: "2026-11-27", used: EMOJI_HEAL_DAILY_MAX_REQUESTS - 1 } } })],
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await heal(fake, bookingFetch({}, []), [suspect()]);
    await heal(fake, bookingFetch({}, []), [suspect({ providerBookingId: "5002", conversationId: "c2" })]);
    const capWarns = warn.mock.calls.filter(([text]) => String(text).includes("daily cap"));
    warn.mockRestore();
    expect(capWarns).toEqual([["[guest-messages/emoji-heal] daily cap reached — rest of the day stays masked", { organizationId: ORG }]]);
  });

  it("시간 예산이 다 되면 다음 예약은 잡지도 않는다", async () => {
    const fake = seedDb({ guest_message_channel_state: [stateRow()] });
    let t = NOW.getTime();
    const calls: string[] = [];
    const inner = bookingFetch({}, calls);
    const slow = (async (input: RequestInfo | URL, init?: RequestInit) => {
      t += 14_500;
      return inner(input, init);
    }) as typeof fetch;
    const result = await healEmojiAfterWebhook(fake.client as never, [suspect(), suspect({ providerBookingId: "5002", conversationId: "c2" })], {
      fetchImpl: slow,
      resolveToken: async () => ({ ok: true as const, token: "t" }),
      baseUrl: "https://beds24.test/api/v2",
      now: () => new Date(t),
    });
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ bookings: 1, stoppedEarly: "time_budget" });
    expect(Object.keys((healState(fake) as { recent: Record<string, string> }).recent)).toEqual(["5001"]);
  });

  it("마감 직전(2초 안)이면 새 요청을 시작하지 않는다 — 토큰 푸는 데 시간이 걸린 경우", async () => {
    const fake = seedDb({ guest_message_channel_state: [stateRow()] });
    let t = NOW.getTime();
    const calls: string[] = [];
    const result = await healEmojiAfterWebhook(fake.client as never, [suspect()], {
      fetchImpl: bookingFetch({}, calls),
      resolveToken: async () => {
        t += 13_500;
        return { ok: true as const, token: "t" };
      },
      baseUrl: "https://beds24.test/api/v2",
      now: () => new Date(t),
    });
    expect(calls).toHaveLength(0);
    expect(result).toMatchObject({ stoppedEarly: "time_budget", requests: 0 });
    expect(healState(fake)).toMatchObject({ used: 0, recent: {} });
  });

  it("받기: 「?」가 든 새 줄이 들어가면 그 예약을 후보로 돌려준다(이모지 그대로 · 이미 있던 줄은 아님)", async () => {
    const fake = seedDb();
    const seedArgs = { organizationId: ORG, provider: "beds24" as const, providerBookingId: "5001", seed: EMPTY_SEED, now: NOW };
    const masked = await ingestConversationMessages(fake.client as never, { ...seedArgs, messages: [message("new1", "thanks??")] });
    expect(masked.maskedInserted).toBe(true);
    const plain = await ingestConversationMessages(fake.client as never, { ...seedArgs, messages: [message("new2", "thanks 🙏 ?"), message("new3", "ok")] });
    expect(plain.maskedInserted).toBe(false);
    const again = await ingestConversationMessages(fake.client as never, { ...seedArgs, messages: [message("new1", "thanks??")] });
    expect(again.maskedInserted).toBe(false);
  });
});

describe("웹훅 받기가 다시 읽을 예약을 돌려준다", () => {
  it("「?」가 든 새 줄이 들어간 예약만, 예약마다 한 번", async () => {
    const { ingestBeds24WebhookMessages } = await import("@/lib/guest-messages/webhook-ingest");
    const fake = seedDb();
    const summary = await ingestBeds24WebhookMessages({
      supabase: fake.client as never,
      body: {
        booking: { id: 5001, propertyId: 1, roomId: 2, status: "confirmed" },
        messages: [
          { id: 901, bookingId: 5001, time: "2026-11-27T02:58:00Z", source: "guest", message: "thanks??" },
          { id: 902, bookingId: 5001, time: "2026-11-27T02:59:00Z", source: "guest", message: "see you??" },
        ],
      },
      bookingPayloads: [{ id: 5001, propertyId: 1, roomId: 2, status: "confirmed" }],
      results: [],
      organizationIdDefault: ORG,
      now: NOW,
    });
    expect(summary.emojiSuspects).toEqual([
      { organizationId: ORG, conversationId: "c1", providerBookingId: "5001", insertedAt: expect.any(String) },
    ]);
  });
});
