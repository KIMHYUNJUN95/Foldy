import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase } from "@/lib/__tests__/fake-supabase";

/**
 * 손님 메시지 2단계 — 메시지함 서버 액션 · 발송 작업 · 정렬/「나중에」 순수 함수. 세션 · DB · DeepL · Beds24 는 가짜다.
 * 실제 RLS 는 마이그레이션 적용 뒤 따로(문서 47 §8). docs/product/47-guest-messaging.md
 */
const state = vi.hoisted(() => ({
  session: null as null | {
    organization: { id: string };
    user: { id: string; preferredLanguage: "ko" | "ja" | "en" };
    capabilities: string[];
  },
  db: null as unknown,
  after: [] as Array<() => unknown>,
  deepl: { status: "ok", text: "번역문", detectedSourceLanguage: "EN", chars: 12 } as Record<string, unknown>,
  deeplCalls: 0,
  deeplArgs: [] as Array<Record<string, unknown>>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => state.after.push(fn) }));
vi.mock("@/lib/session", () => ({
  getCurrentAppSession: async () => state.session,
  hasOrganizationContext: (session: { organization: { id: string } }) => session.organization.id !== "platform",
}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => state.db }));
vi.mock("@/lib/review-translate", () => ({
  createTranslationBudget: () => ({}),
  deeplTranslate: async (args: Record<string, unknown>) => {
    state.deeplCalls += 1;
    state.deeplArgs.push(args);
    return state.deepl;
  },
}));
vi.mock("@/lib/guest-messages/adapter-server", () => ({
  createServerBeds24GuestMessageAdapter: () => {
    throw new Error("real adapter must not be built in tests");
  },
}));

import {
  addGuestInternalNote,
  getGuestConversation,
  listGuestConversations,
  previewReplyTranslation,
  retryGuestOutbox,
  sendGuestReply,
  setGuestConversationDone,
  snoozeGuestConversation,
  translateGuestMessage,
  unsnoozeGuestConversation,
} from "@/actions/guest-messages";
import { outboundChannelRefusal } from "@/lib/guest-messages/beds24-adapter";
import {
  defaultReplyTarget,
  isAllowedReplyTarget,
  matchesChannelFilter,
  parseChannelFilter,
  replyBlockReason,
  replyTranslationTargets,
  resolveSnoozeUntil,
  sortInboxRows,
  type InboxConversationRow,
} from "@/lib/guest-messages/inbox-model";
import { isGuestMessageSendEnabled, runGuestOutbox } from "@/lib/guest-messages/outbox-runner";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = uuid(900);
const OTHER_ORG = uuid(901);
const USER = uuid(800);
const AIRBNB = uuid(1);
const DIRECT = uuid(2);
const FOREIGN = uuid(3);
const MSG = uuid(11);
const KEY = "key-12345678";
const ALL = ["guest_messages.view", "guest_messages.reply"];

function conversation(over: Record<string, unknown>) {
  return {
    id: AIRBNB,
    organization_id: ORG,
    provider: "beds24",
    provider_booking_id: "71234567",
    reservation_id: null,
    property_name: "아라키초A",
    room_label: "101",
    channel: "airbnb",
    booking_status: "confirmed",
    check_in_date: "2026-11-20",
    check_out_date: "2026-11-23",
    guest_name: "Emma",
    guest_language: "en",
    status: "awaiting",
    snooze_until: null,
    last_guest_at: "2026-11-12T01:00:00.000Z",
    last_reply_at: null,
    last_message_at: "2026-11-12T01:00:00.000Z",
    ...over,
  };
}

let fake: ReturnType<typeof createFakeSupabase>;
let enqueueSeq = 0;

type Tables = Record<string, Array<Record<string, unknown>>>;
/** DB 함수 흉내 — 마이그레이션 202611130001 의 guest_message_enqueue_reply · guest_conversation_last_lines 와 같은 결과. */
const RPC = {
  guest_message_enqueue_reply: (args: Record<string, unknown>, tables: Tables) => {
    const existing = tables.guest_message_outbox.find(
      (row) => row.organization_id === args.p_organization_id && row.idempotency_key === args.p_idempotency_key,
    );
    if (existing) return { data: [{ outbox_id: existing.id, duplicate: true, same_body: existing.body === args.p_body }], error: null };
    const id = uuid(500 + ++enqueueSeq);
    tables.guest_message_outbox.push({
      id,
      organization_id: args.p_organization_id,
      conversation_id: args.p_conversation_id,
      kind: "reply",
      body: args.p_body,
      status: "queued",
      attempts: 0,
      next_try_at: args.p_now,
      created_at: args.p_now,
      idempotency_key: args.p_idempotency_key,
      created_by: args.p_user_id,
    });
    tables.guest_messages.push({
      id: uuid(600 + enqueueSeq),
      organization_id: args.p_organization_id,
      conversation_id: args.p_conversation_id,
      provider: args.p_provider,
      direction: "host",
      body: args.p_body,
      body_translated: args.p_original,
      translated_lang: args.p_original ? args.p_original_lang : null,
      body_lang: args.p_original ? (args.p_body_lang ?? null) : null,
      sent_at: args.p_now,
      author_user_id: args.p_user_id,
      outbox_id: id,
    });
    return { data: [{ outbox_id: id, duplicate: false, same_body: true }], error: null };
  },
  guest_conversation_last_lines: (args: Record<string, unknown>, tables: Tables) => {
    const ids = new Set(args.p_conversation_ids as string[]);
    const latest = new Map<string, Record<string, unknown>>();
    for (const row of tables.guest_messages) {
      if (row.organization_id !== args.p_organization_id || !ids.has(String(row.conversation_id))) continue;
      if (row.direction !== "guest" && row.direction !== "host") continue;
      const prev = latest.get(String(row.conversation_id));
      if (!prev || String(row.sent_at) > String(prev.sent_at)) latest.set(String(row.conversation_id), row);
    }
    return { data: [...latest.values()], error: null };
  },
};

async function sendOne(body = "Hi"): Promise<string> {
  const sent = await sendGuestReply({ conversationId: AIRBNB, body, idempotencyKey: KEY });
  if (!sent.ok) throw new Error("send failed");
  return sent.outboxId;
}

beforeEach(() => {
  state.session = { organization: { id: ORG }, user: { id: USER, preferredLanguage: "ko" }, capabilities: ALL };
  state.after = [];
  state.deeplCalls = 0;
  state.deeplArgs = [];
  state.deepl = { status: "ok", text: "번역문", detectedSourceLanguage: "EN", chars: 12 };
  fake = createFakeSupabase({
    guest_conversations: [
      conversation({}),
      conversation({ id: DIRECT, channel: "direct", guest_name: "Direct" }),
      conversation({ id: FOREIGN, organization_id: OTHER_ORG, guest_name: "Other org" }),
    ],
    guest_messages: [
      {
        id: MSG,
        organization_id: ORG,
        conversation_id: AIRBNB,
        direction: "guest",
        body: "What time is check-in?",
        body_translated: null,
        translated_lang: null,
        sent_at: "2026-11-12T01:00:00.000Z",
      },
    ],
    guest_message_outbox: [],
    guest_message_channel_state: [],
    guest_message_translations: [],
    translation_usage: [],
    memberships: [{ user_id: USER, organization_id: ORG, status: "active" }],
    profiles: [{ id: USER, name: "Staff A" }],
  }, RPC);
  state.db = fake.client;
  vi.stubEnv("GUEST_MESSAGES_SEND_ENABLED", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("권한 · 조직", () => {
  it("세션이 없거나 볼 권한이 없으면 forbidden", async () => {
    state.session = null;
    expect(await listGuestConversations()).toEqual({ ok: false, errorKey: "forbidden" });
    state.session = { organization: { id: ORG }, user: { id: USER, preferredLanguage: "ko" }, capabilities: [] };
    expect(await listGuestConversations()).toEqual({ ok: false, errorKey: "forbidden" });
  });

  it("보기만 있으면 읽기 · 번역은 되고 답장 · 메모 · 상태 바꾸기는 forbidden", async () => {
    state.session!.capabilities = ["guest_messages.view"];
    expect((await listGuestConversations()).ok).toBe(true);
    expect((await translateGuestMessage(MSG)).ok).toBe(true);
    expect(await sendGuestReply({ conversationId: AIRBNB, body: "Hi", idempotencyKey: KEY })).toEqual({ ok: false, errorKey: "forbidden" });
    expect(await addGuestInternalNote({ conversationId: AIRBNB, body: "memo" })).toEqual({ ok: false, errorKey: "forbidden" });
    expect(await setGuestConversationDone(AIRBNB, true)).toEqual({ ok: false, errorKey: "forbidden" });
    expect(fake.tables.guest_message_outbox).toHaveLength(0);
  });

  it("목록은 내 조직 대화만 — 다른 조직 대화에는 답장 · 상태 바꾸기가 not_found", async () => {
    const list = await listGuestConversations({ status: "all" });
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.rows.map((row) => row.id).sort()).toEqual([AIRBNB, DIRECT].sort());
    expect(await sendGuestReply({ conversationId: FOREIGN, body: "Hi", idempotencyKey: KEY })).toEqual({ ok: false, errorKey: "not_found" });
    expect(await setGuestConversationDone(FOREIGN, true)).toEqual({ ok: false, errorKey: "not_found" });
    expect(fake.tables.guest_conversations.find((row) => row.id === FOREIGN)?.status).toBe("awaiting");
  });
});

describe("답장 보내기", () => {
  it("발송 큐 줄 + 대기 메시지 줄을 outbox_id 로 잇고, 발송이 꺼져 있으면 queued 그대로 · 대화는 답장 기다림", async () => {
    const result = await sendGuestReply({ conversationId: AIRBNB, body: " Check-in is 15:00 ", idempotencyKey: KEY, original: "체크인은 3시예요" });
    expect(result).toMatchObject({ ok: true, duplicate: false, sendEnabled: false });
    const [outbox] = fake.tables.guest_message_outbox;
    expect(outbox).toMatchObject({ organization_id: ORG, conversation_id: AIRBNB, status: "queued", body: "Check-in is 15:00", created_by: USER });
    const pending = fake.tables.guest_messages.find((row) => row.outbox_id === outbox.id);
    expect(pending).toMatchObject({ direction: "host", body: "Check-in is 15:00", body_translated: "체크인은 3시예요", translated_lang: "ko", author_user_id: USER });
    expect(pending?.external_id).toBeUndefined();
    expect(state.after).toHaveLength(0);
    expect(fake.tables.guest_conversations.find((row) => row.id === AIRBNB)?.status).toBe("awaiting");
  });

  it("같은 키로 두 번 누르면 한 줄만", async () => {
    const first = await sendGuestReply({ conversationId: AIRBNB, body: "Hi", idempotencyKey: KEY });
    const second = await sendGuestReply({ conversationId: AIRBNB, body: "Hi", idempotencyKey: KEY });
    expect(second).toMatchObject({ ok: true, duplicate: true });
    if (first.ok && second.ok) expect(second.outboxId).toBe(first.outboxId);
    expect(fake.tables.guest_message_outbox).toHaveLength(1);
    expect(fake.tables.guest_messages.filter((row) => row.direction === "host")).toHaveLength(1);
  });

  it("직접 예약 · 모르는 채널은 막고 아무것도 넣지 않는다 — 내부 메모는 된다", async () => {
    expect(await sendGuestReply({ conversationId: DIRECT, body: "Hi", idempotencyKey: KEY })).toEqual({ ok: false, errorKey: "direct_booking" });
    fake.tables.guest_conversations[0].channel = null;
    expect(await sendGuestReply({ conversationId: AIRBNB, body: "Hi", idempotencyKey: KEY })).toEqual({ ok: false, errorKey: "unknown_channel" });
    expect(fake.tables.guest_message_outbox).toHaveLength(0);
    expect(await addGuestInternalNote({ conversationId: DIRECT, body: "전화로 안내함" })).toEqual({ ok: true });
    expect(fake.tables.guest_messages.find((row) => row.direction === "internal")).toMatchObject({ conversation_id: DIRECT, author_user_id: USER });
  });

  it("잘못된 키 · 빈 글 · 너무 긴 글", async () => {
    expect(await sendGuestReply({ conversationId: AIRBNB, body: "Hi", idempotencyKey: "short" })).toEqual({ ok: false, errorKey: "invalid" });
    expect(await sendGuestReply({ conversationId: AIRBNB, body: "   ", idempotencyKey: KEY })).toEqual({ ok: false, errorKey: "invalid" });
    expect(await sendGuestReply({ conversationId: AIRBNB, body: "가".repeat(4001), idempotencyKey: KEY })).toEqual({ ok: false, errorKey: "too_long" });
  });

  it("발송이 켜져 있으면 응답 뒤(after)에 발송 작업을 건다", async () => {
    vi.stubEnv("GUEST_MESSAGES_SEND_ENABLED", "1");
    await sendGuestReply({ conversationId: AIRBNB, body: "Hi", idempotencyKey: KEY });
    expect(state.after).toHaveLength(1);
  });

  it("대화에서 쓰던 답장 고치기 · 보내기 취소 액션은 없다(2026-11-13)", async () => {
    const actions = await import("@/actions/guest-messages");
    expect(actions).not.toHaveProperty("editGuestOutbox");
    expect(actions).not.toHaveProperty("cancelGuestOutbox");
  });

  it("나갔는지 모르는 줄은 확인 없이 다시 보내지 않는다", async () => {
    const outboxId = await sendOne();
    fake.tables.guest_message_outbox[0].status = "uncertain";
    expect((await retryGuestOutbox(outboxId)).ok).toBe(false);
    expect(fake.tables.guest_message_outbox[0].status).toBe("uncertain");
    expect(await retryGuestOutbox(outboxId, { confirmUncertain: true })).toEqual({ ok: true });
    expect(fake.tables.guest_message_outbox[0].status).toBe("queued");
  });
});

describe("처리 끝 · 나중에", () => {
  it("처리 끝 → done, 되돌리기 → awaiting", async () => {
    expect(await setGuestConversationDone(AIRBNB, true)).toEqual({ ok: true });
    expect(fake.tables.guest_conversations[0]).toMatchObject({ status: "done", snooze_until: null });
    expect(await setGuestConversationDone(AIRBNB, false)).toEqual({ ok: true });
    expect(fake.tables.guest_conversations[0].status).toBe("awaiting");
  });

  it("나중에 → snoozed + 시각, 풀면 손님 말이 답장보다 나중일 때만 답장 기다림", async () => {
    const result = await snoozeGuestConversation(AIRBNB, { preset: "3h" });
    expect(result.ok).toBe(true);
    expect(fake.tables.guest_conversations[0].status).toBe("snoozed");
    expect(await unsnoozeGuestConversation(AIRBNB)).toEqual({ ok: true });
    expect(fake.tables.guest_conversations[0].status).toBe("awaiting");
    fake.tables.guest_conversations[0].status = "snoozed";
    fake.tables.guest_conversations[0].last_reply_at = "2026-11-12T02:00:00.000Z";
    await unsnoozeGuestConversation(AIRBNB);
    expect(fake.tables.guest_conversations[0].status).toBe("done");
  });

  it("「내일 9시」는 도쿄 기준, 지난 시각 · 30일 넘음 · 없는 날짜는 거절", () => {
    // 도쿄 11/12 23:30 = UTC 11/12 14:30 → 내일 9시 = 도쿄 11/13 09:00 = UTC 11/13 00:00
    const now = new Date("2026-11-12T14:30:00.000Z");
    expect(resolveSnoozeUntil({ preset: "tomorrow9" }, now)).toBe("2026-11-13T00:00:00.000Z");
    // 도쿄 11/13 00:30(UTC 11/12 15:30)이면 「내일」은 11/14
    expect(resolveSnoozeUntil({ preset: "tomorrow9" }, new Date("2026-11-12T15:30:00.000Z"))).toBe("2026-11-14T00:00:00.000Z");
    expect(resolveSnoozeUntil({ date: "2026-11-13", time: "18:00" }, now)).toBe("2026-11-13T09:00:00.000Z");
    expect(resolveSnoozeUntil({ date: "2026-11-12", time: "20:00" }, now)).toBeNull();
    expect(resolveSnoozeUntil({ date: "2027-01-30", time: "09:00" }, now)).toBeNull();
    expect(resolveSnoozeUntil({ date: "2026-11-31", time: "09:00" }, now)).toBeNull();
    expect(resolveSnoozeUntil({ date: "2026-11-13", time: "24:00" }, now)).toBeNull();
  });
});

describe("번역", () => {
  it("번역하면 저장하고 사용량을 남긴다, 같은 언어 번역은 다시 부르지 않는다", async () => {
    expect(await translateGuestMessage(MSG)).toEqual({ ok: true, text: "번역문", cached: false });
    expect(fake.tables.translation_usage).toHaveLength(1);
    expect(fake.tables.translation_usage[0]).toMatchObject({ organization_id: ORG, feature: "guest_message", char_count: 12 });
    expect(await translateGuestMessage(MSG)).toEqual({ ok: true, text: "번역문", cached: true });
    expect(state.deeplCalls).toBe(1);
  });

  it("번역을 못 하면 원문 그대로 두고 이유를 돌려준다", async () => {
    state.deepl = { status: "unavailable", reason: "budget_exhausted" };
    expect(await translateGuestMessage(MSG)).toEqual({ ok: false, errorKey: "translation_budget" });
    state.deepl = { status: "unavailable", reason: "failed" };
    expect(await translateGuestMessage(MSG)).toEqual({ ok: false, errorKey: "translation_unavailable" });
    expect(fake.tables.guest_messages[0].body_translated).toBeNull();
    expect(fake.tables.translation_usage).toHaveLength(0);
  });
});

describe("발송 작업", () => {
  it("플래그가 꺼져 있으면 아무것도 안 한다", async () => {
    expect(isGuestMessageSendEnabled(undefined)).toBe(false);
    expect(isGuestMessageSendEnabled("true")).toBe(false);
    expect(isGuestMessageSendEnabled("1")).toBe(true);
    await sendGuestReply({ conversationId: AIRBNB, body: "Hi", idempotencyKey: KEY });
    const send = vi.fn();
    expect(await runGuestOutbox(fake.client as never, ORG, { enabled: false, adapter: { send } })).toEqual({ ran: false, reason: "disabled" });
    expect(send).not.toHaveBeenCalled();
    expect(fake.tables.guest_message_outbox[0].status).toBe("queued");
  });

  it("켜져 있으면 보내고, 대기 메시지 줄에 번호를 잇고, 대화 상태 함수를 부른다", async () => {
    const sent = await sendGuestReply({ conversationId: AIRBNB, body: "Hi", idempotencyKey: KEY });
    if (!sent.ok) throw new Error("send failed");
    const send = vi.fn(async (items: Array<{ outboxId: string }>) => ({
      kind: "sent" as const,
      items: items.map((item) => ({ outboxId: item.outboxId, ok: true as const, externalId: "beds24-555" })),
      credit: { remaining: 900, resetsAt: null, requestCost: 1 },
    }));
    const result = await runGuestOutbox(fake.client as never, ORG, { enabled: true, adapter: { send }, now: new Date(Date.now() + 1000) });
    expect(result).toMatchObject({ ran: true, sent: 1 });
    expect(fake.tables.guest_message_outbox[0]).toMatchObject({ status: "sent", external_id: "beds24-555" });
    const linked = fake.tables.guest_messages.filter((row) => row.outbox_id === sent.outboxId);
    expect(linked).toHaveLength(1);
    expect(linked[0].external_id).toBe("beds24-555");
    expect(fake.rpcCalls.map((call) => call.name)).toContain("guest_conversation_apply_messages");
  });

  it("어댑터가 던지면 잡은 줄을 「모름」으로 — 다시 보내지 않는다", async () => {
    await sendGuestReply({ conversationId: AIRBNB, body: "Hi", idempotencyKey: KEY });
    const send = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(runGuestOutbox(fake.client as never, ORG, { enabled: true, adapter: { send }, now: new Date(Date.now() + 1000) })).rejects.toThrow();
    expect(fake.tables.guest_message_outbox[0].status).toBe("uncertain");
  });
});

describe("정렬 · 막힘 판정", () => {
  const base = (over: Partial<InboxConversationRow>): InboxConversationRow =>
    ({
      id: "x",
      state: "awaiting",
      snoozeUntil: null,
      lastGuestAt: "2026-11-12T00:00:00.000Z",
      lastMessageAt: "2026-11-12T00:00:00.000Z",
      waiting: { waitingMinutes: 10, targetMinutes: 60, ratio: 0.1, overdue: false },
      ...over,
    }) as InboxConversationRow;

  it("답장 기다림은 목표 넘은 줄 → 목표에 가까운 줄 순", () => {
    const rows = sortInboxRows([
      base({ id: "calm" }),
      base({ id: "near", waiting: { waitingMinutes: 50, targetMinutes: 60, ratio: 0.83, overdue: false } as never }),
      base({ id: "over", waiting: { waitingMinutes: 70, targetMinutes: 60, ratio: 1.16, overdue: true } as never }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["over", "near", "calm"]);
  });

  it("보낼 수 있는 채널 판정이 Beds24 어댑터와 같다", () => {
    for (const channel of ["airbnb", "booking", "expedia", "agoda", "vrbo", "direct", "other", null] as const) {
      expect(replyBlockReason(channel)).toBe(outboundChannelRefusal(channel as never));
    }
  });
});

describe("리뷰 반영 — 2026-11-13", () => {
  it("같은 키인데 글이 다르면 stale — 옛 줄을 새 글로 보내지 않는다", async () => {
    await sendOne("first text");
    expect(await sendGuestReply({ conversationId: AIRBNB, body: "edited text", idempotencyKey: KEY })).toEqual({ ok: false, errorKey: "stale" });
    expect(fake.tables.guest_message_outbox).toHaveLength(1);
    expect(fake.tables.guest_message_outbox[0].body).toBe("first text");
  });

  it("목록 읽기는 발송 작업을 걸지 않는다(발송이 켜져 있어도)", async () => {
    vi.stubEnv("GUEST_MESSAGES_SEND_ENABLED", "1");
    expect((await listGuestConversations()).ok).toBe(true);
    expect(state.after).toHaveLength(0);
  });

  it("목록 미리 보기는 대화마다 마지막 손님 말 · 답장(DB 함수)", async () => {
    fake.tables.guest_messages.push(
      { id: uuid(12), organization_id: ORG, conversation_id: AIRBNB, direction: "host", body: "15:00 です", sent_at: "2026-11-12T02:00:00.000Z" },
      { id: uuid(13), organization_id: ORG, conversation_id: AIRBNB, direction: "internal", body: "memo", sent_at: "2026-11-12T03:00:00.000Z" },
      { id: uuid(14), organization_id: ORG, conversation_id: DIRECT, direction: "guest", body: "cash?", sent_at: "2026-11-12T00:30:00.000Z" },
    );
    const list = await listGuestConversations({ status: "all" });
    if (!list.ok) throw new Error("list failed");
    const byId = new Map(list.rows.map((row) => [row.id, row]));
    expect(byId.get(AIRBNB)?.lastLine).toEqual({ direction: "host", body: "15:00 です" });
    expect(byId.get(DIRECT)?.lastLine).toEqual({ direction: "guest", body: "cash?" });
    expect(fake.rpcCalls.map((call) => call.name)).toContain("guest_conversation_last_lines");
  });

  it("번역은 언어마다 따로 — 다른 언어 번역을 덮지 않는다", async () => {
    await translateGuestMessage(MSG);
    state.session!.user.preferredLanguage = "ja";
    state.deepl = { status: "ok", text: "翻訳", detectedSourceLanguage: "EN", chars: 12 };
    expect(await translateGuestMessage(MSG)).toEqual({ ok: true, text: "翻訳", cached: false });
    const rows = fake.tables.guest_message_translations;
    expect(rows.map((row) => [row.lang, row.body]).sort()).toEqual([
      ["ja", "翻訳"],
      ["ko", "번역문"],
    ]);
    expect(fake.tables.guest_messages[0].body_translated).toBeNull();
    // 보기만 있어도 없는 언어를 채울 뿐 — 있는 번역은 그대로.
    state.session!.capabilities = ["guest_messages.view"];
    state.session!.user.preferredLanguage = "ko";
    expect(await translateGuestMessage(MSG)).toEqual({ ok: true, text: "번역문", cached: true });
    expect(state.deeplCalls).toBe(2);
  });

  it("대화의 손님 말은 보는 사람 언어 번역을, 작성자 이름은 조직 구성원만", async () => {
    await translateGuestMessage(MSG);
    const outsider = uuid(801);
    fake.tables.profiles.push({ id: outsider, name: "Outsider" });
    fake.tables.guest_messages.push(
      { id: uuid(15), organization_id: ORG, conversation_id: AIRBNB, direction: "internal", body: "a", sent_at: "2026-11-12T02:00:00.000Z", author_user_id: USER },
      { id: uuid(16), organization_id: ORG, conversation_id: AIRBNB, direction: "internal", body: "b", sent_at: "2026-11-12T02:10:00.000Z", author_user_id: outsider },
    );
    const result = await getGuestConversation(AIRBNB);
    if (!result.ok) throw new Error(result.errorKey);
    const guest = result.thread.messages.find((m) => m.id === MSG);
    expect(guest).toMatchObject({ bodyTranslated: "번역문", translatedLang: "ko" });
    expect(result.thread.messages.find((m) => m.id === uuid(15))?.authorName).toBe("Staff A");
    expect(result.thread.messages.find((m) => m.id === uuid(16))?.authorName).toBeNull();
  });

  it("발송 작업은 잡을 때 돌려받은 글을 보내고 잡은 시각을 적는다", async () => {
    await sendOne("original");
    const send = vi.fn(async (items: Array<{ outboxId: string; body: string }>) => ({
      kind: "sent" as const,
      items: items.map((item) => ({ outboxId: item.outboxId, ok: true as const, externalId: "x-1" })),
      credit: { remaining: 900, resetsAt: null, requestCost: 1 },
    }));
    await runGuestOutbox(fake.client as never, ORG, { enabled: true, adapter: { send }, now: new Date(Date.now() + 1000) });
    expect(send.mock.calls[0][0][0].body).toBe("original");
    expect(fake.tables.guest_message_outbox[0].claimed_at).toBeTruthy();
  });

  it("오래 sending 으로 멈춘 줄은 「모름」으로 — 다시 보내지 않는다", async () => {
    await sendOne();
    Object.assign(fake.tables.guest_message_outbox[0], { status: "sending", claimed_at: new Date(Date.now() - 11 * 60_000).toISOString() });
    const send = vi.fn();
    expect(await runGuestOutbox(fake.client as never, ORG, { enabled: true, adapter: { send } })).toEqual({ ran: false, reason: "empty" });
    expect(fake.tables.guest_message_outbox[0]).toMatchObject({ status: "uncertain", error_code: "stuck" });
    expect(send).not.toHaveBeenCalled();
  });

  it("결과를 적을 줄이 없어도(그 사이 풀림) 나간 글은 메시지 줄에 잇는다", async () => {
    const outboxId = await sendOne();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn(async (items: Array<{ outboxId: string }>) => {
      fake.tables.guest_message_outbox[0].status = "uncertain";
      return {
        kind: "sent" as const,
        items: items.map((item) => ({ outboxId: item.outboxId, ok: true as const, externalId: "x-2" })),
        credit: { remaining: 900, resetsAt: null, requestCost: 1 },
      };
    });
    await runGuestOutbox(fake.client as never, ORG, { enabled: true, adapter: { send }, now: new Date(Date.now() + 1000) });
    expect(errors.mock.calls.some((call) => String(call[0]).includes("matched no row"))).toBe(true);
    expect(fake.tables.guest_messages.find((row) => row.outbox_id === outboxId)?.external_id).toBe("x-2");
    errors.mockRestore();
  });
});

describe("번역 언어 고르기 — 2026-11-13", () => {
  it("보낼 언어 후보: 손님 언어 먼저, 그다음 ko · ja · en 중 직원 언어가 아닌 것", () => {
    expect(replyTranslationTargets("ko", "en")).toEqual(["en", "ja"]);
    expect(replyTranslationTargets("ko", "fr")).toEqual(["fr", "ja", "en"]);
    expect(replyTranslationTargets("ko", null)).toEqual(["ja", "en"]);
    expect(replyTranslationTargets("en", "en")).toEqual(["ko", "ja"]);
    expect(replyTranslationTargets("ja", "xx")).toEqual(["ko", "en"]);
    expect(defaultReplyTarget("ko", "en")).toBe("en");
    expect(defaultReplyTarget("ko", "ko")).toBeNull();
    expect(defaultReplyTarget("ko", null)).toBeNull();
    expect(isAllowedReplyTarget("ko", "en", "ja")).toBe(true);
    expect(isAllowedReplyTarget("ko", "en", "de")).toBe(false);
    expect(isAllowedReplyTarget("ko", "en", "ko")).toBe(false);
    expect(isAllowedReplyTarget("ko", "en", 3)).toBe(false);
  });

  it("미리 보기는 기본 손님 언어, 고르면 그 언어로 — 고를 수 없는 언어는 DeepL 을 부르지 않는다", async () => {
    expect(await previewReplyTranslation({ conversationId: AIRBNB, text: "체크인은 3시" })).toMatchObject({ ok: true, language: "en" });
    expect(state.deeplArgs[0]).toMatchObject({ targetLang: "EN-US", sourceLang: "KO" });
    expect(await previewReplyTranslation({ conversationId: AIRBNB, text: "체크인은 3시", targetLang: "ja" })).toMatchObject({
      ok: true,
      language: "ja",
    });
    expect(state.deeplArgs[1]).toMatchObject({ targetLang: "JA" });
    expect(await previewReplyTranslation({ conversationId: AIRBNB, text: "체크인은 3시", targetLang: "de" })).toEqual({
      ok: false,
      errorKey: "translation_unavailable",
    });
    expect(await previewReplyTranslation({ conversationId: AIRBNB, text: "체크인은 3시", targetLang: "ko" })).toEqual({
      ok: false,
      errorKey: "translation_unavailable",
    });
    expect(state.deeplCalls).toBe(2);
  });

  it("손님 언어를 몰라도 영어 · 일본어로는 번역해서 보낼 수 있다", async () => {
    fake.tables.guest_conversations[0].guest_language = null;
    expect(await previewReplyTranslation({ conversationId: AIRBNB, text: "안녕하세요" })).toEqual({
      ok: false,
      errorKey: "translation_unavailable",
    });
    expect(await previewReplyTranslation({ conversationId: AIRBNB, text: "안녕하세요", targetLang: "en" })).toMatchObject({
      ok: true,
      language: "en",
    });
  });

  it("보낸 답장에 고른 언어를 남긴다 — 번역 안 한 글 · 고를 수 없는 언어는 남기지 않는다", async () => {
    const sent = await sendGuestReply({ conversationId: AIRBNB, body: "15時です", idempotencyKey: KEY, original: "3시예요", bodyLang: "ja" });
    if (!sent.ok) throw new Error("send failed");
    expect(fake.tables.guest_messages.find((row) => row.outbox_id === sent.outboxId)?.body_lang).toBe("ja");
    const thread = await getGuestConversation(AIRBNB);
    if (!thread.ok) throw new Error("thread failed");
    expect(thread.thread.messages.find((m) => m.direction === "host")).toMatchObject({ bodyLang: "ja", bodyTranslated: "3시예요" });

    const odd = await sendGuestReply({ conversationId: AIRBNB, body: "Hallo", idempotencyKey: "key-22222222", original: "안녕", bodyLang: "de" });
    const plain = await sendGuestReply({ conversationId: AIRBNB, body: "Hi", idempotencyKey: "key-33333333", bodyLang: "ja" });
    if (!odd.ok || !plain.ok) throw new Error("send failed");
    expect(fake.tables.guest_messages.find((row) => row.outbox_id === odd.outboxId)?.body_lang).toBeNull();
    expect(fake.tables.guest_messages.find((row) => row.outbox_id === plain.outboxId)?.body_lang).toBeNull();
  });

  it("손님 말은 고른 언어(ko · ja · en)로 번역해 그 언어 칸에 저장한다", async () => {
    expect(await translateGuestMessage(MSG, "ja")).toMatchObject({ ok: true, cached: false });
    expect(state.deeplArgs[0]).toMatchObject({ targetLang: "JA" });
    expect(fake.tables.guest_message_translations.map((row) => row.lang)).toEqual(["ja"]);
    expect(await translateGuestMessage(MSG, "ja")).toMatchObject({ ok: true, cached: true });
    expect(await translateGuestMessage(MSG, "fr")).toEqual({ ok: false, errorKey: "invalid" });
    expect(state.deeplCalls).toBe(1);
  });
});

describe("채널 필터 — 2026-11-13", () => {
  it("주소 값 읽기 · 채널 맞추기(그 밖 = Expedia · Agoda · Vrbo · 모름)", () => {
    expect(parseChannelFilter("booking")).toBe("booking");
    expect(parseChannelFilter("BOOKING")).toBe("all");
    expect(parseChannelFilter(undefined)).toBe("all");
    expect(matchesChannelFilter("airbnb", "airbnb")).toBe(true);
    expect(matchesChannelFilter("booking", "airbnb")).toBe(false);
    expect(matchesChannelFilter("expedia", "other")).toBe(true);
    expect(matchesChannelFilter(null, "other")).toBe(true);
    expect(matchesChannelFilter("direct", "other")).toBe(false);
    expect(matchesChannelFilter("direct", "all")).toBe(true);
  });

  it("목록 · 머리 숫자가 채널 필터를 따른다", async () => {
    fake.tables.guest_conversations.push(conversation({ id: uuid(4), channel: "expedia", guest_name: "Exp" }));
    const ids = async (channel: string) => {
      const list = await listGuestConversations({ status: "all", channel });
      if (!list.ok) throw new Error("list failed");
      return { ids: list.rows.map((row) => row.id).sort(), awaiting: list.awaitingCount };
    };
    expect(await ids("airbnb")).toEqual({ ids: [AIRBNB], awaiting: 1 });
    expect(await ids("direct")).toEqual({ ids: [DIRECT], awaiting: 1 });
    expect(await ids("other")).toEqual({ ids: [uuid(4)], awaiting: 1 });
    expect(await ids("booking")).toEqual({ ids: [], awaiting: 0 });
    expect((await ids("nonsense")).ids).toHaveLength(3);
  });
});

describe("자동 안내 출입 코드 — 5단계 리뷰(임시 결정, 47 §5-6)", () => {
  const AUTO_OB = uuid(520);
  const AUTO_MSG = uuid(521);
  beforeEach(() => {
    fake.tables.property_operation_infos = [
      {
        organization_id: ORG,
        canonical_name: "아라키초A",
        shared_access: [{ labelKey: "storage", code: "5190" }],
        room_access: [{ roomLabel: "101", code: "2468*" }],
        updated_at: "2026-11-01T00:00:00.000Z",
        guest_info: {},
        guest_info_updated_at: null,
      },
    ];
    fake.tables.guest_message_outbox.push({ id: AUTO_OB, organization_id: ORG, conversation_id: AIRBNB, kind: "auto", status: "queued", body: "Door 5190 · room 2468*", next_try_at: "2026-11-30T00:00:00.000Z", created_at: "2026-11-12T03:00:00.000Z" });
    fake.tables.guest_messages.push({ id: AUTO_MSG, organization_id: ORG, conversation_id: AIRBNB, direction: "host", body: "Door 5190 · room 2468*", sent_at: "2026-11-12T03:00:00.000Z", outbox_id: AUTO_OB });
  });

  it("코드를 볼 권한이 없으면 자동 안내 글의 코드를 가리고 다시 보내기를 막는다(보낼 글은 그대로)", async () => {
    const result = await getGuestConversation(AIRBNB);
    if (!result.ok) throw new Error(result.errorKey);
    const auto = result.thread.messages.find((m) => m.id === AUTO_MSG);
    expect(auto?.body).toBe("Door •••• · room ••••");
    expect(auto?.outbox).toMatchObject({ kind: "auto", locked: true });
    expect(await retryGuestOutbox(AUTO_OB)).toEqual({ ok: false, errorKey: "forbidden" });
    expect(fake.tables.guest_message_outbox.find((row) => row.id === AUTO_OB)).toMatchObject({ status: "queued", body: "Door 5190 · room 2468*" });
    const list = await listGuestConversations({ status: "all" });
    if (!list.ok) throw new Error("list failed");
    expect(list.rows.find((row) => row.id === AIRBNB)?.lastLine).toEqual({ direction: "host", body: "Door •••• · room ••••" });
  });

  it("manage(또는 건물 정보 고치기)가 있으면 그대로 보이고, manage 면 다시 보내기가 막히지 않는다", async () => {
    state.session!.capabilities = [...ALL, "property_info.edit"];
    let result = await getGuestConversation(AIRBNB);
    if (!result.ok) throw new Error(result.errorKey);
    expect(result.thread.messages.find((m) => m.id === AUTO_MSG)).toMatchObject({ body: "Door 5190 · room 2468*", outbox: { locked: true } });
    state.session!.capabilities = [...ALL, "guest_messages.manage"];
    result = await getGuestConversation(AIRBNB);
    if (!result.ok) throw new Error(result.errorKey);
    expect(result.thread.messages.find((m) => m.id === AUTO_MSG)?.outbox).toMatchObject({ locked: false });
    const retried = await retryGuestOutbox(AUTO_OB);
    expect(retried.ok ? null : retried.errorKey).not.toBe("forbidden");
  });

  it("코드를 읽지 못하면 숫자 묶음을 모두 가린다", async () => {
    const original = fake.client.from;
    fake.client.from = ((table: string) => {
      if (table === "property_operation_infos") throw new Error("boom");
      return original(table);
    }) as typeof fake.client.from;
    const result = await getGuestConversation(AIRBNB);
    if (!result.ok) throw new Error(result.errorKey);
    expect(result.thread.messages.find((m) => m.id === AUTO_MSG)?.body).toBe("Door •••• · room ••••");
  });
});
