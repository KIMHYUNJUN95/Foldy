import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const account = vi.hoisted(() => ({ value: null as null | { remaining: number | null; resetsAt: number | null; requestCost: number | null; recordedAt: number; source: string } }));
const cooldown = vi.hoisted(() => ({ active: false, activated: [] as unknown[] }));
const mapping = vi.hoisted(() => ({ byProperty: {} as Record<string, string[]> }));
const credits = vi.hoisted(() => ({ recorded: [] as unknown[] }));

vi.mock("@/lib/beds24/account-credit", () => ({
  readBeds24AccountCredit: async () => account.value,
}));
vi.mock("@/lib/beds24/sync-control", () => ({ isBeds24SyncPaused: () => false }));
vi.mock("@/lib/beds24/sync-locks", () => ({
  getBeds24Cooldown: async () => ({ active: cooldown.active, reason: null, remainingSec: 0, until: cooldown.active ? "2026-11-12T04:00:00.000Z" : null }),
  activateBeds24Cooldown: async (_supabase: unknown, args: unknown) => {
    cooldown.activated.push(args);
  },
}));
vi.mock("@/lib/beds24/webhook-organization", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/beds24/webhook-organization")>()),
  readMappedOrganizationIds: async (_supabase: unknown, args: { externalPropertyId: string | null }) =>
    mapping.byProperty[args.externalPropertyId ?? ""] ?? [],
}));
vi.mock("@/lib/guest-messages/adapter-server", () => ({
  recordGuestMessageCredit: async (...args: unknown[]) => {
    credits.recorded.push(args);
  },
}));
vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: () => {
    throw new Error("tests must pass a fake supabase");
  },
}));

import {
  BACKFILL_POISON_ATTEMPTS,
  backfillGuestMessageHistory,
  backfillStatusAfter,
  backfillStopLine,
  canReadNextPage,
  observedOrder,
  isBackfillFailure,
  type BackfillDeps,
} from "@/lib/guest-messages/backfill";
import { nextConversationState, type ConversationStateFields } from "@/lib/guest-messages/ingest-plan";
import { createFakeSupabase } from "@/lib/__tests__/fake-supabase";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-11-12T03:00:00.000Z");

type Row = Record<string, unknown>;

let runCounter = 0;

function makeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    guest_message_backfill_state: [],
    guest_message_channel_state: [],
    guest_conversations: [],
    guest_messages: [],
    guest_message_outbox: [],
    reservations: [],
    ...seed,
  };
  return createFakeSupabase(tables, {
    // 202611130002 의 거울: 줄이 없으면 만들고, 도는 실행이 없을 때만 잡는다.
    guest_message_backfill_claim: (args, t) => {
      const list = (t.guest_message_backfill_state ??= []);
      let row = list.find((r) => r.organization_id === args.p_organization_id);
      if (!row) {
        row = {
          organization_id: args.p_organization_id,
          status: "idle",
          max_age_days: 999,
          next_page: 1,
          pages_done: 0,
          fetched_count: 0,
          imported_count: 0,
          skipped_count: 0,
          unrouted_count: 0,
          failed_bookings: 0,
          page_attempts: 0,
          failed_booking_ids: [],
          started_at: null,
          finished_at: null,
          lease_until: null,
        };
        list.push(row);
      }
      const now = String(args.p_now);
      const leaseLive = row.status === "running" && row.lease_until && String(row.lease_until) >= now;
      if (leaseLive || (row.status === "done" && !args.p_restart)) return { data: [], error: null };
      if (args.p_restart) {
        Object.assign(row, { next_page: 1, pages_done: 0, fetched_count: 0, imported_count: 0, skipped_count: 0, unrouted_count: 0, failed_bookings: 0, page_attempts: 0, failed_booking_ids: [], finished_at: null });
      }
      Object.assign(row, {
        status: "running",
        run_id: `run-${++runCounter}`,
        lease_until: new Date(Date.parse(now) + 300_000).toISOString(),
        started_at: row.started_at ?? now,
        last_error: null,
      });
      return { data: [{ ...row }], error: null };
    },
    // 202611130001 의 거울(ingest-plan 의 nextConversationState).
    guest_conversation_apply_messages: (args, t) => {
      const conversation = (t.guest_conversations ?? []).find((r) => r.id === args.p_conversation_id);
      if (!conversation) return { data: [], error: null };
      // 실제 DB 처럼 비어 있는 칸은 null(가짜 insert 는 칸을 채우지 않는다).
      const current: ConversationStateFields = {
        status: (conversation.status as ConversationStateFields["status"]) ?? "done",
        snooze_until: (conversation.snooze_until as string | null) ?? null,
        last_guest_at: (conversation.last_guest_at as string | null) ?? null,
        last_reply_at: (conversation.last_reply_at as string | null) ?? null,
        last_message_at: (conversation.last_message_at as string | null) ?? null,
      };
      const next = nextConversationState(
        current,
        {
          guestAt: (args.p_guest_at as string | null) ?? null,
          unreadGuestAt: (args.p_unread_guest_at as string | null) ?? null,
          replyAt: (args.p_reply_at as string | null) ?? null,
          messageAt: (args.p_message_at as string | null) ?? null,
        },
        new Date(String(args.p_now)),
      );
      Object.assign(conversation, next);
      return { data: [next], error: null };
    },
  });
}

function raw(id: number, bookingId: number, time: string, extra: Partial<Row> = {}): Row {
  return { id, bookingId, propertyId: 176431, roomId: 708660, time, read: false, source: "guest", message: `m${id}`, ...extra };
}

function pageResponse(rows: Row[], nextPageExists: boolean, headers: Record<string, string> = {}, status = 200) {
  return new Response(JSON.stringify({ success: true, data: rows, pages: { nextPageExists } }), {
    status,
    headers: { "content-type": "application/json", "x-five-min-limit-remaining": "500", "x-five-min-limit-resets-in": "300", "x-request-cost": "1", ...headers },
  });
}

function fetchFrom(pages: Record<number, () => Response>) {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const page = Number(new URL(url).searchParams.get("page"));
    const make = pages[page];
    if (!make) throw new Error(`unexpected page ${page}`);
    return make();
  }) as typeof fetch;
  return { fetchImpl, urls };
}

function deps(db: ReturnType<typeof makeDb>, fetchImpl: typeof fetch, extra: Partial<BackfillDeps> = {}): BackfillDeps {
  return {
    supabase: db.client as unknown as BackfillDeps["supabase"],
    fetchImpl,
    resolveToken: async () => ({ ok: true, token: "test-token" }) as never,
    baseUrl: "https://beds24.test/api/v2",
    now: () => NOW,
    ...extra,
  };
}

function state(db: ReturnType<typeof makeDb>) {
  return db.tables.guest_message_backfill_state.find((r) => r.organization_id === ORG) as Row;
}

beforeEach(() => {
  account.value = null;
  cooldown.active = false;
  cooldown.activated = [];
  mapping.byProperty = { "176431": [ORG] };
  credits.recorded = [];
});

describe("backfillGuestMessageHistory — paging + cursor", () => {
  it("reads maxAge=999 without a filter, saves the cursor, and resumes on the next run", async () => {
    const db = makeDb();
    const { fetchImpl, urls } = fetchFrom({
      1: () => pageResponse([raw(1, 100, "2024-01-01T00:00:00Z"), raw(2, 100, "2024-01-01T01:00:00Z", { source: "host" })], true),
      2: () => pageResponse([raw(3, 200, "2024-02-01T00:00:00Z")], true),
      3: () => pageResponse([raw(4, 300, "2024-03-01T00:00:00Z")], false),
    });

    const first = await backfillGuestMessageHistory(ORG, {}, deps(db, fetchImpl, { maxPages: 2 }));
    expect(first.stoppedEarly).toBe("max_pages");
    expect(first.status).toBe("paused");
    expect(first.pages).toBe(2);
    expect(first.imported).toBe(3);
    expect(state(db)).toMatchObject({ status: "paused", next_page: 3, pages_done: 2, imported_count: 3, lease_until: null });
    expect(urls[0]).toBe("https://beds24.test/api/v2/bookings/messages?maxAge=999&page=1");
    expect(urls.every((url) => !url.includes("filter="))).toBe(true);

    const second = await backfillGuestMessageHistory(ORG, {}, deps(db, fetchImpl, { maxPages: 2 }));
    // 이어 받기는 앞 페이지(2)부터 다시 — 겹친 페이지는 숫자에 다시 안 든다.
    expect(urls.slice(2)).toEqual([
      "https://beds24.test/api/v2/bookings/messages?maxAge=999&page=2",
      "https://beds24.test/api/v2/bookings/messages?maxAge=999&page=3",
    ]);
    expect(second.status).toBe("done");
    expect(state(db)).toMatchObject({ status: "done", pages_done: 3, imported_count: 4, finished_at: NOW.toISOString() });
    expect(db.tables.guest_messages).toHaveLength(4);
    expect(db.tables.guest_conversations).toHaveLength(3);

    const third = await backfillGuestMessageHistory(ORG, {}, deps(db, fetchImpl));
    expect(third.skipped).toBe("done");
    expect(urls).toHaveLength(4);
  });

  it("restart re-reads from page 1 and dedupes against existing rows", async () => {
    const db = makeDb();
    const { fetchImpl } = fetchFrom({ 1: () => pageResponse([raw(1, 100, "2024-01-01T00:00:00Z")], false) });
    await backfillGuestMessageHistory(ORG, {}, deps(db, fetchImpl));
    const again = await backfillGuestMessageHistory(ORG, { restart: true }, deps(db, fetchImpl));
    expect(again.imported).toBe(0);
    expect(again.duplicates).toBe(1);
    expect(db.tables.guest_messages).toHaveLength(1);
    expect(state(db)).toMatchObject({ status: "done", imported_count: 0, skipped_count: 1 });
  });

  it("a second run while one is in flight is refused as busy", async () => {
    const db = makeDb({
      guest_message_backfill_state: [
        { organization_id: ORG, status: "running", next_page: 4, lease_until: "2026-11-12T03:04:00.000Z" },
      ],
    });
    const { fetchImpl, urls } = fetchFrom({});
    const result = await backfillGuestMessageHistory(ORG, {}, deps(db, fetchImpl));
    expect(result.skipped).toBe("busy");
    expect(urls).toHaveLength(0);
  });

  it("does not advance the cursor past a page whose booking failed", async () => {
    const db = makeDb();
    const failing = db.client.from;
    db.client.from = ((table: string) => {
      if (table === "guest_messages") throw new Error("boom");
      return failing(table);
    }) as typeof db.client.from;
    const { fetchImpl } = fetchFrom({ 1: () => pageResponse([raw(1, 100, "2024-01-01T00:00:00Z")], true) });
    const result = await backfillGuestMessageHistory(ORG, {}, deps(db, fetchImpl));
    expect(result.stoppedEarly).toBe("failed_bookings");
    expect(isBackfillFailure(result)).toBe(true);
    expect(state(db)).toMatchObject({
      status: "failed",
      next_page: 1,
      last_error: "failed_bookings",
      page_attempts: 1,
      pages_done: 0,
      fetched_count: 0,
      imported_count: 0,
    });
  });
});

describe("backfillGuestMessageHistory — credit", () => {
  it("does not call Beds24 when the account is below the reserve", async () => {
    account.value = { remaining: 5, resetsAt: NOW.getTime() + 120_000, requestCost: 1, recordedAt: NOW.getTime(), source: "x" };
    const db = makeDb();
    const { fetchImpl, urls } = fetchFrom({});
    const result = await backfillGuestMessageHistory(ORG, {}, deps(db, fetchImpl));
    expect(result.skipped).toBe("low_credit");
    expect(urls).toHaveLength(0);
    expect(state(db)).toMatchObject({ status: "paused", last_error: "low_credit", next_page: 1 });
    expect(state(db).resume_after).toBe(new Date(NOW.getTime() + 120_000).toISOString());
  });

  it("stops after a page that drops the remaining credit under the reserve, keeping the cursor", async () => {
    const db = makeDb();
    const { fetchImpl, urls } = fetchFrom({
      1: () => pageResponse([raw(1, 100, "2024-01-01T00:00:00Z")], true, { "x-five-min-limit-remaining": "15", "x-five-min-limit-resets-in": "90" }),
    });
    const result = await backfillGuestMessageHistory(ORG, {}, deps(db, fetchImpl));
    expect(result.stoppedEarly).toBe("low_credit");
    expect(urls).toHaveLength(1);
    expect(state(db)).toMatchObject({ status: "paused", next_page: 2, imported_count: 1 });
    expect(credits.recorded).toHaveLength(1);
  });

  it("skips during an account cooldown", async () => {
    cooldown.active = true;
    const db = makeDb();
    const { fetchImpl, urls } = fetchFrom({});
    const result = await backfillGuestMessageHistory(ORG, {}, deps(db, fetchImpl));
    expect(result.skipped).toBe("cooldown");
    expect(result.resumeAfter).toBe("2026-11-12T04:00:00.000Z");
    expect(urls).toHaveLength(0);
  });

  it("429 → account cooldown, stop, record when it resets", async () => {
    const db = makeDb();
    const { fetchImpl } = fetchFrom({
      1: () => pageResponse([raw(1, 100, "2024-01-01T00:00:00Z")], true),
      2: () => pageResponse([], false, { "x-five-min-limit-resets-in": "200" }, 429),
    });
    const result = await backfillGuestMessageHistory(ORG, {}, deps(db, fetchImpl));
    expect(result.stoppedEarly).toBe("rate_limited");
    expect(cooldown.activated).toEqual([{ reason: "rate_limit", resetInSec: 200 }]);
    expect(state(db)).toMatchObject({ status: "paused", next_page: 2, last_error: "rate_limited" });
    expect(state(db).resume_after).toBe(new Date(NOW.getTime() + 200_000).toISOString());
    expect(isBackfillFailure(result)).toBe(false);
  });
});

describe("backfillGuestMessageHistory — history never creates awaiting", () => {
  it("old unread guest messages land as done; a recent unanswered one is awaiting", async () => {
    const db = makeDb();
    const { fetchImpl } = fetchFrom({
      1: () =>
        pageResponse(
          [
            raw(1, 100, "2025-05-01T00:00:00Z"),
            raw(2, 200, "2026-11-12T01:00:00Z"),
          ],
          false,
        ),
    });
    await backfillGuestMessageHistory(ORG, {}, deps(db, fetchImpl));
    const byBooking = Object.fromEntries(db.tables.guest_conversations.map((r) => [r.provider_booking_id, r.status]));
    expect(byBooking).toEqual({ "100": "done", "200": "awaiting" });
  });

  it("an old unread message added to an existing conversation does not reopen it", async () => {
    const db = makeDb({
      guest_conversations: [
        {
          id: "conv-1",
          organization_id: ORG,
          provider: "beds24",
          provider_booking_id: "100",
          status: "done",
          snooze_until: null,
          last_guest_at: null,
          last_reply_at: null,
          last_message_at: null,
        },
      ],
    });
    const { fetchImpl } = fetchFrom({ 1: () => pageResponse([raw(9, 100, "2025-05-01T00:00:00Z")], false) });
    await backfillGuestMessageHistory(ORG, {}, deps(db, fetchImpl));
    expect(db.tables.guest_conversations[0]).toMatchObject({ status: "done", last_guest_at: "2025-05-01T00:00:00.000Z" });
  });
});

describe("backfillGuestMessageHistory — organization routing", () => {
  it("skips (and counts) bookings with no organization or another organization", async () => {
    mapping.byProperty = { "176431": [ORG], "999": [OTHER_ORG] };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = makeDb();
    const { fetchImpl } = fetchFrom({
      1: () =>
        pageResponse(
          [
            raw(1, 100, "2024-01-01T00:00:00Z"),
            raw(2, 200, "2024-01-01T00:00:00Z", { propertyId: 555 }),
            raw(3, 300, "2024-01-01T00:00:00Z", { propertyId: 999 }),
          ],
          false,
        ),
    });
    const result = await backfillGuestMessageHistory(ORG, {}, deps(db, fetchImpl));
    expect(result.imported).toBe(1);
    expect(result.unrouted).toBe(2);
    expect(db.tables.guest_conversations.map((r) => r.organization_id)).toEqual([ORG]);
    expect(warn).toHaveBeenCalledWith("[guest-messages/backfill] booking skipped — organization", { providerBookingId: "200", reason: "unknown" });
    expect(state(db)).toMatchObject({ unrouted_count: 2 });
    warn.mockRestore();
  });
});

describe("backfillGuestMessageHistory — measure mode", () => {
  it("reads only the first page with maxAge=7, records cost, and inserts nothing", async () => {
    const db = makeDb();
    const { fetchImpl, urls } = fetchFrom({
      1: () =>
        pageResponse([raw(1, 100, "2026-11-10T00:00:00Z"), raw(2, 100, "2026-11-11T00:00:00Z")], true, {
          "x-request-cost": "2",
          "x-five-min-limit-remaining": "480",
          "x-five-min-limit-resets-in": "100",
        }),
    });
    const result = await backfillGuestMessageHistory(ORG, { mode: "measure" }, deps(db, fetchImpl));
    expect(urls).toEqual(["https://beds24.test/api/v2/bookings/messages?maxAge=7&page=1"]);
    expect(result.measure).toEqual({ at: NOW.toISOString(), rows: 2, requestCost: 2, remaining: 480, resetsIn: 100, nextPageExists: true, order: "asc" });
    expect(db.tables.guest_messages).toHaveLength(0);
    expect(state(db)).toMatchObject({ last_measure: result.measure });
    expect(state(db).next_page ?? 1).toBe(1);
  });
});

describe("backfillStatusAfter", () => {
  it("maps stop reasons to resumable vs failed", () => {
    expect(backfillStatusAfter(null, false)).toBe("done");
    expect(backfillStatusAfter("max_pages", true)).toBe("paused");
    expect(backfillStatusAfter("rate_limited", true)).toBe("paused");
    expect(backfillStatusAfter("token", true)).toBe("failed");
    expect(backfillStatusAfter("http_error", true)).toBe("failed");
  });
});

describe("backfill review fixes (2026-11-12)", () => {
  it("stop line sits well above the outbox reserve and the account cooldown line", () => {
    expect(backfillStopLine(20)).toBe(100);
    expect(backfillStopLine(90)).toBe(130);
    expect(backfillStopLine(0)).toBeGreaterThan(10);
    expect(canReadNextPage({ remaining: 109, lastRequestCost: 5, stopLine: 100, pagesReadThisRun: 1 })).toBe("low_credit");
    expect(canReadNextPage({ remaining: 120, lastRequestCost: 5, stopLine: 100, pagesReadThisRun: 1 })).toBe("ok");
    expect(canReadNextPage({ remaining: null, lastRequestCost: null, stopLine: 100, pagesReadThisRun: 0 })).toBe("ok");
    expect(canReadNextPage({ remaining: null, lastRequestCost: null, stopLine: 100, pagesReadThisRun: 1 })).toBe("credit_unknown");
  });

  it("checks the line before each page using the last request cost", async () => {
    const db = makeDb();
    const { fetchImpl, urls } = fetchFrom({
      1: () => pageResponse([raw(1, 100, "2024-01-01T00:00:00Z")], true, { "x-five-min-limit-remaining": "150", "x-request-cost": "30" }),
    });
    const result = await backfillGuestMessageHistory(ORG, {}, deps(db, fetchImpl));
    expect(urls).toHaveLength(1); // 150 − 30×2 = 90 < 100
    expect(result.stoppedEarly).toBe("low_credit");
    expect(state(db)).toMatchObject({ status: "paused", next_page: 2, last_error: "low_credit" });
  });

  it("with unknown remaining credit reads only the first page", async () => {
    const db = makeDb();
    const noCredit = () =>
      new Response(JSON.stringify({ data: [raw(1, 100, "2024-01-01T00:00:00Z")], pages: { nextPageExists: true } }), { status: 200 });
    const { fetchImpl, urls } = fetchFrom({ 1: noCredit, 2: noCredit });
    const result = await backfillGuestMessageHistory(ORG, {}, deps(db, fetchImpl));
    expect(urls).toHaveLength(1);
    expect(result.stoppedEarly).toBe("credit_unknown");
    expect(state(db)).toMatchObject({ status: "paused", next_page: 2 });
  });

  it("a run that lost its lease to another run stops and writes nothing more", async () => {
    const db = makeDb();
    const { fetchImpl, urls } = fetchFrom({
      1: () => {
        // 다른 실행이 잡았다(run_id 바뀜).
        Object.assign(state(db), { run_id: "someone-else" });
        return pageResponse([raw(1, 100, "2024-01-01T00:00:00Z")], true);
      },
      2: () => pageResponse([], false),
    });
    const result = await backfillGuestMessageHistory(ORG, {}, deps(db, fetchImpl));
    expect(result.stoppedEarly).toBe("lost_lease");
    expect(urls).toHaveLength(1);
    expect(state(db)).toMatchObject({ run_id: "someone-else", next_page: 1, pages_done: 0, status: "running" });
  });

  it("extends the lease on every page", async () => {
    const db = makeDb();
    let clock = NOW.getTime();
    const { fetchImpl } = fetchFrom({
      1: () => pageResponse([raw(1, 100, "2024-01-01T00:00:00Z")], true),
      2: () => pageResponse([], false),
    });
    const leases: unknown[] = [];
    const original = db.client.from;
    db.client.from = ((table: string) => {
      clock += 10_000;
      if (table === "guest_message_backfill_state") leases.push(state(db)?.lease_until);
      return original(table);
    }) as typeof db.client.from;
    await backfillGuestMessageHistory(ORG, {}, deps(db, fetchImpl, { now: () => new Date(clock) }));
    const distinct = new Set(leases.filter(Boolean));
    expect(distinct.size).toBeGreaterThanOrEqual(2);
  });

  it(`after ${BACKFILL_POISON_ATTEMPTS} failures on the same page records the booking ids and moves on`, async () => {
    const db = makeDb();
    const original = db.client.from;
    db.client.from = ((table: string) => {
      if (table === "guest_messages") throw new Error("boom");
      return original(table);
    }) as typeof db.client.from;
    const { fetchImpl } = fetchFrom({
      1: () => pageResponse([raw(1, 100, "2024-01-01T00:00:00Z")], true),
      2: () => pageResponse([], false),
    });
    for (let i = 1; i < BACKFILL_POISON_ATTEMPTS; i += 1) {
      const attempt = await backfillGuestMessageHistory(ORG, {}, deps(db, fetchImpl));
      expect(attempt.stoppedEarly).toBe("failed_bookings");
      expect(state(db)).toMatchObject({ next_page: 1, page_attempts: i });
    }
    const last = await backfillGuestMessageHistory(ORG, {}, deps(db, fetchImpl));
    expect(last.status).toBe("done");
    expect(state(db)).toMatchObject({ next_page: 3, page_attempts: 0, failed_booking_ids: ["100"], failed_bookings: 1, pages_done: 2 });
  });

  it("never routes through BEDS24_DEFAULT_ORGANIZATION_ID", async () => {
    process.env.BEDS24_DEFAULT_ORGANIZATION_ID = ORG;
    try {
      mapping.byProperty = {};
      const db = makeDb();
      const { fetchImpl } = fetchFrom({ 1: () => pageResponse([raw(1, 100, "2024-01-01T00:00:00Z")], false) });
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await backfillGuestMessageHistory(ORG, {}, deps(db, fetchImpl));
      expect(result.unrouted).toBe(1);
      expect(db.tables.guest_conversations).toHaveLength(0);
    } finally {
      delete process.env.BEDS24_DEFAULT_ORGANIZATION_ID;
      vi.restoreAllMocks();
    }
  });

  it("an overlap page picks up rows that drifted across the page boundary", async () => {
    const db = makeDb({
      guest_message_backfill_state: [
        { organization_id: ORG, status: "paused", next_page: 3, pages_done: 2, fetched_count: 2, imported_count: 2, skipped_count: 0, unrouted_count: 0, failed_bookings: 0, page_attempts: 0, failed_booking_ids: [], max_age_days: 999 },
      ],
    });
    const { fetchImpl } = fetchFrom({
      2: () => pageResponse([raw(77, 700, "2024-01-01T00:00:00Z")], true),
      3: () => pageResponse([raw(78, 800, "2024-01-02T00:00:00Z")], false),
    });
    await backfillGuestMessageHistory(ORG, {}, deps(db, fetchImpl));
    expect(state(db)).toMatchObject({ status: "done", pages_done: 3, fetched_count: 3, imported_count: 4 });
  });

  it("measure mode runs at most once per 5 minutes", async () => {
    const db = makeDb({
      guest_message_backfill_state: [{ organization_id: ORG, status: "idle", next_page: 1, last_measure: { at: "2026-11-12T02:57:00.000Z" } }],
    });
    const { fetchImpl, urls } = fetchFrom({});
    const result = await backfillGuestMessageHistory(ORG, { mode: "measure" }, deps(db, fetchImpl));
    expect(result.skipped).toBe("too_soon");
    expect(urls).toHaveLength(0);
  });

  it("observedOrder reports the sort direction", () => {
    expect(observedOrder(["2024-01-02T00:00:00Z", "2024-01-01T00:00:00Z"])).toBe("desc");
    expect(observedOrder(["2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z"])).toBe("asc");
    expect(observedOrder(["2024-01-01T00:00:00Z", "2024-01-03T00:00:00Z", "2024-01-02T00:00:00Z"])).toBe("mixed");
    expect(observedOrder(["2024-01-01T00:00:00Z"])).toBe("unknown");
  });
});
