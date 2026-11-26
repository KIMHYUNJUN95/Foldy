import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase } from "@/lib/__tests__/fake-supabase";

/**
 * 예약 패널 「메시지」 칸 액션 — 권한(보기만 / 답장) · 조직 · 예약 ↔ 대화 찾기 · 첫 메시지로 대화 만들기 · 발송 꺼짐.
 * docs/product/33-calendar-write-features.md → 「예약 패널 — 메시지」 · 47 §8
 */
const state = vi.hoisted(() => ({
  session: null as null | {
    organization: { id: string };
    user: { id: string; preferredLanguage: "ko" | "ja" | "en" };
    capabilities: string[];
  },
  db: null as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("@/lib/session", () => ({
  getCurrentAppSession: async () => state.session,
  hasOrganizationContext: (session: { organization: { id: string } }) => session.organization.id !== "platform",
}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => state.db }));
vi.mock("@/lib/guest-messages/adapter-server", () => ({
  createServerBeds24GuestMessageAdapter: () => {
    throw new Error("real adapter must not be built in tests");
  },
}));

import { loadReservationMessages, sendReservationMessage } from "@/actions/reservation-messages";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = uuid(900);
const OTHER_ORG = uuid(901);
const USER = uuid(800);
const RES = uuid(10);
const RES_NO_CONV = uuid(11);
const RES_DIRECT = uuid(12);
const RES_FOREIGN = uuid(13);
const RES_MANUAL = uuid(14);
const RES_NO_NUMBER = uuid(15);
const CONV = uuid(1);
const VIEW = ["guest_messages.view"];
const REPLY = ["guest_messages.view", "guest_messages.reply"];

type Tables = Record<string, Array<Record<string, unknown>>>;
let tables: Tables;
let enqueueSeq = 0;

function reservation(over: Record<string, unknown>) {
  return {
    id: RES,
    organization_id: ORG,
    source: "Airbnb",
    source_reservation_id: "71234567::abc",
    raw_payload: { id: 71234567 },
    property_name: "아라키초A",
    room_label: "101",
    guest_name: "Emma",
    check_in_date: "2026-11-27",
    check_out_date: "2026-11-29",
    ...over,
  };
}

function conversation(over: Record<string, unknown>) {
  return {
    id: CONV,
    organization_id: ORG,
    provider: "beds24",
    provider_booking_id: "71234567",
    reservation_id: RES,
    channel: "airbnb",
    guest_language: "en",
    status: "awaiting",
    last_guest_at: "2026-11-25T03:00:00.000Z",
    last_reply_at: "2026-11-25T01:00:00.000Z",
    last_message_at: "2026-11-25T03:00:00.000Z",
    ...over,
  };
}

function message(id: number, direction: string, sentAt: string, over: Record<string, unknown> = {}) {
  return {
    id: uuid(100 + id),
    organization_id: ORG,
    conversation_id: CONV,
    direction,
    body: `m${id}`,
    body_translated: null,
    sent_at: sentAt,
    outbox_id: null,
    ...over,
  };
}

const RPC = {
  guest_message_enqueue_reply: (args: Record<string, unknown>, t: Tables) => {
    const id = uuid(500 + ++enqueueSeq);
    (t.guest_message_outbox ??= []).push({
      id,
      organization_id: args.p_organization_id,
      conversation_id: args.p_conversation_id,
      body: args.p_body,
      idempotency_key: args.p_idempotency_key,
      status: "queued",
    });
    return { data: [{ outbox_id: id, duplicate: false, same_body: true }], error: null };
  },
};

beforeEach(() => {
  vi.stubEnv("GUEST_MESSAGES_SEND_ENABLED", "");
  vi.stubEnv("VERCEL_ENV", "");
  state.session = { organization: { id: ORG }, user: { id: USER, preferredLanguage: "ko" }, capabilities: REPLY };
  enqueueSeq = 0;
  tables = {
    reservations: [
      reservation({}),
      reservation({ id: RES_NO_CONV, source_reservation_id: "72000001::x", raw_payload: { id: 72000001 } }),
      reservation({ id: RES_DIRECT, source: "direct", source_reservation_id: "72000002::x", raw_payload: { id: 72000002 } }),
      reservation({ id: RES_FOREIGN, organization_id: OTHER_ORG, raw_payload: { id: 79999999 } }),
      // 우리 쪽에서 만든 수기 예약 — Beds24 번호가 아직 없다.
      reservation({ id: RES_MANUAL, source: "manual", source_reservation_id: null, raw_payload: {} }),
      // 채널은 Airbnb 인데 번호가 없다(드묾) — 「채널 모름」 안내.
      reservation({ id: RES_NO_NUMBER, source_reservation_id: null, raw_payload: {} }),
    ],
    guest_conversations: [conversation({})],
    guest_messages: [
      message(1, "guest", "2026-11-24T10:00:00.000Z"),
      message(2, "host", "2026-11-25T01:00:00.000Z", { outbox_id: uuid(700) }),
      message(3, "internal", "2026-11-25T02:00:00.000Z"),
      message(4, "guest", "2026-11-25T02:30:00.000Z"),
      message(5, "guest", "2026-11-25T03:00:00.000Z", { body_translated: "번역" }),
    ],
    guest_message_outbox: [{ id: uuid(700), organization_id: ORG, status: "failed", error_code: "network" }],
    properties: [],
    rooms: [],
  };
  // 가짜 DB 는 새 줄에 「id-N」을 붙인다 — 실제 DB 처럼 uuid 로(보내기 액션이 uuid 를 검사한다).
  const conversations = tables.guest_conversations;
  conversations.push = (...rows) => {
    for (const row of rows) {
      row.id = uuid(300 + conversations.length);
      Array.prototype.push.call(conversations, row);
    }
    return conversations.length;
  };
  state.db = createFakeSupabase(tables, RPC).client;
});

describe("loadReservationMessages", () => {
  it("returns forbidden without guest_messages.view (no redirect)", async () => {
    state.session!.capabilities = ["ops.view"];
    expect(await loadReservationMessages(RES)).toEqual({ ok: false, errorKey: "forbidden" });
  });

  it("finds the conversation by reservation id and shows the latest two guest/host messages, oldest first", async () => {
    const result = await loadReservationMessages(RES);
    if (!result.ok) throw new Error(result.errorKey);
    expect(result.conversationId).toBe(CONV);
    expect(result.access).toBe("reply");
    expect(result.messages.map((row) => row.body)).toEqual(["m4", "m5"]);
    expect(result.messages[1].bodyTranslated).toBe("번역");
    // 마지막 답장(01:00) 뒤 손님 메시지 2개 — 내부 메모는 세지 않는다.
    expect(result.unreadCount).toBe(2);
    expect(result.sendEnabled).toBe(false);
    expect(result.blocked).toBeNull();
  });

  it("attaches outbox state to host messages and marks failed sends retryable", async () => {
    tables.guest_messages = tables.guest_messages.filter((row) => row.direction !== "guest" || row.body === "m1");
    const result = await loadReservationMessages(RES);
    if (!result.ok) throw new Error(result.errorKey);
    const host = result.messages.find((row) => row.direction === "host");
    expect(host?.outbox).toEqual({ id: uuid(700), status: "failed", retryable: true });
  });

  it("falls back to the Beds24 booking number when the conversation has no reservation id", async () => {
    tables.guest_conversations[0].reservation_id = null;
    const result = await loadReservationMessages(RES);
    if (!result.ok) throw new Error(result.errorKey);
    expect(result.conversationId).toBe(CONV);
  });

  it("returns an empty section (first message) when no conversation exists", async () => {
    const result = await loadReservationMessages(RES_NO_CONV);
    expect(result).toMatchObject({ ok: true, conversationId: null, messages: [], unreadCount: 0, blocked: null });
  });

  it("gives view-only staff the link but not the reply box", async () => {
    state.session!.capabilities = VIEW;
    const result = await loadReservationMessages(RES);
    expect(result).toMatchObject({ ok: true, access: "view", conversationId: CONV });
  });

  it("marks direct bookings as blocked", async () => {
    const result = await loadReservationMessages(RES_DIRECT);
    expect(result).toMatchObject({ ok: true, conversationId: null, blocked: "direct_booking" });
  });

  it("counts every unread guest message, not just the latest page (2026-11-26)", async () => {
    for (let i = 0; i < 25; i += 1) {
      tables.guest_messages.push(message(200 + i, "guest", `2026-11-25T04:${String(i).padStart(2, "0")}:00.000Z`));
    }
    const result = await loadReservationMessages(RES);
    if (!result.ok) throw new Error(result.errorKey);
    // 마지막 답장(01:00) 뒤 손님 메시지 2 + 25 — 최근 20줄만 세면 20에서 멈췄다.
    expect(result.unreadCount).toBe(27);
    expect(result.messages).toHaveLength(2);
  });

  it("shows the direct-booking notice for a manual booking with no Beds24 number (not unknown channel)", async () => {
    const result = await loadReservationMessages(RES_MANUAL);
    expect(result).toMatchObject({ ok: true, conversationId: null, blocked: "direct_booking" });
  });

  it("falls back to unknown channel only when the channel is also unknown", async () => {
    const result = await loadReservationMessages(RES_NO_NUMBER);
    expect(result).toMatchObject({ ok: true, conversationId: null, blocked: "unknown_channel" });
  });

  it("does not read another organization's reservation", async () => {
    expect(await loadReservationMessages(RES_FOREIGN)).toEqual({ ok: false, errorKey: "not_found" });
  });

  it("rejects a non-uuid id", async () => {
    expect(await loadReservationMessages("abc")).toEqual({ ok: false, errorKey: "invalid" });
  });
});

describe("sendReservationMessage", () => {
  const KEY = "res-key-12345678";

  it("is forbidden for view-only staff", async () => {
    state.session!.capabilities = VIEW;
    const result = await sendReservationMessage({ reservationId: RES, body: "Hello", idempotencyKey: KEY });
    expect(result).toEqual({ ok: false, errorKey: "forbidden" });
    expect(enqueueSeq).toBe(0);
  });

  it("queues the reply on the existing conversation", async () => {
    const result = await sendReservationMessage({ reservationId: RES, body: "Hello", idempotencyKey: KEY });
    expect(result).toMatchObject({ ok: true, conversationId: CONV, duplicate: false, sendEnabled: false });
    expect(tables.guest_conversations).toHaveLength(1);
    expect(tables.guest_message_outbox.at(-1)).toMatchObject({ conversation_id: CONV, body: "Hello" });
  });

  it("creates the conversation on the first message, linked to the reservation and its channel", async () => {
    const result = await sendReservationMessage({ reservationId: RES_NO_CONV, body: "Welcome", idempotencyKey: KEY });
    if (!result.ok) throw new Error(result.errorKey);
    expect(tables.guest_conversations).toHaveLength(2);
    const created = tables.guest_conversations[1];
    expect(created).toMatchObject({
      id: result.conversationId,
      organization_id: ORG,
      provider: "beds24",
      provider_booking_id: "72000001",
      reservation_id: RES_NO_CONV,
      channel: "airbnb",
    });
    expect(tables.guest_message_outbox.at(-1)).toMatchObject({ conversation_id: result.conversationId, body: "Welcome" });
  });

  it("reports sendEnabled when sending is switched on", async () => {
    vi.stubEnv("GUEST_MESSAGES_SEND_ENABLED", "1");
    const result = await sendReservationMessage({ reservationId: RES, body: "Hello", idempotencyKey: KEY });
    expect(result).toMatchObject({ ok: true, sendEnabled: true });
  });

  it("does not create an empty conversation for a direct booking", async () => {
    const result = await sendReservationMessage({ reservationId: RES_DIRECT, body: "Hi", idempotencyKey: KEY });
    expect(result).toEqual({ ok: false, errorKey: "direct_booking" });
    expect(tables.guest_conversations).toHaveLength(1);
  });

  it("never touches another organization's reservation", async () => {
    const result = await sendReservationMessage({ reservationId: RES_FOREIGN, body: "Hi", idempotencyKey: KEY });
    expect(result).toEqual({ ok: false, errorKey: "not_found" });
    expect(enqueueSeq).toBe(0);
  });

  it("rejects a bad idempotency key before creating a conversation (2026-11-26)", async () => {
    const result = await sendReservationMessage({ reservationId: RES_NO_CONV, body: "Welcome", idempotencyKey: "bad key!" });
    expect(result).toEqual({ ok: false, errorKey: "invalid" });
    expect(tables.guest_conversations).toHaveLength(1);
    expect(enqueueSeq).toBe(0);
  });

  it("rejects a too-long body before creating a conversation", async () => {
    const result = await sendReservationMessage({ reservationId: RES_NO_CONV, body: "あ".repeat(4001), idempotencyKey: KEY });
    expect(result).toEqual({ ok: false, errorKey: "too_long" });
    expect(tables.guest_conversations).toHaveLength(1);
    expect(enqueueSeq).toBe(0);
  });

  it("rejects an empty body without writing", async () => {
    const result = await sendReservationMessage({ reservationId: RES, body: "   ", idempotencyKey: KEY });
    expect(result).toEqual({ ok: false, errorKey: "invalid" });
    expect(enqueueSeq).toBe(0);
  });
});
