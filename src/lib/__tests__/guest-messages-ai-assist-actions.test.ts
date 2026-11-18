import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase } from "@/lib/__tests__/fake-supabase";

/**
 * AI 답장 도우미 액션 — 권한(보기 + 답장) · 조직 · 코드 채우기 기준 · 자리 표시 남은 채 보내기 막기 · 기록.
 * 외부 호출은 `GUEST_AI_FAKE=1`(가짜 숫자 · 고정 초안). 실제 SQL(pgvector)은 로컬 DB 에서 따로. docs/product/49 §4 · §8
 */
const state = vi.hoisted(() => ({
  session: null as null | {
    organization: { id: string };
    user: { id: string; preferredLanguage: "ko" | "ja" | "en" };
    capabilities: string[];
  },
  db: null as unknown,
  after: [] as Array<() => unknown>,
  claude: null as null | ((...args: unknown[]) => unknown),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => state.after.push(fn) }));
vi.mock("@/lib/session", () => ({
  getCurrentAppSession: async () => state.session,
  hasOrganizationContext: (session: { organization: { id: string } }) => session.organization.id !== "platform",
}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => state.db }));
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status = 500;
  }
  class Anthropic {
    static APIError = APIError;
    static AuthenticationError = class extends APIError {};
    static PermissionDeniedError = class extends APIError {};
    messages = {
      create: async (...args: unknown[]) => {
        if (!state.claude) throw new Error("Claude must not be called in this test");
        return state.claude(...args);
      },
    };
  }
  return { default: Anthropic };
});
vi.mock("@/lib/guest-messages/adapter-server", () => ({
  createServerBeds24GuestMessageAdapter: () => {
    throw new Error("real adapter must not be built in tests");
  },
}));

import { draftGuestReply, getReplyAssist, markAssistDiscarded, markAssistWrong } from "@/actions/guest-messages-assist";
import { sendGuestReply } from "@/actions/guest-messages";
import { ASSIST_PLACEHOLDER_LABELS } from "@/lib/guest-messages/ai-assist-model";
import { GUEST_AI_CONFIG } from "@/lib/guest-messages/ai-config";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = uuid(900);
const OTHER_ORG = uuid(901);
const USER = uuid(800);
const CONV = uuid(1);
const FOREIGN = uuid(3);
const OLD_CONV = uuid(4);
const Q = uuid(11);
const REPLY = ["guest_messages.view", "guest_messages.reply"];
const MANAGE = [...REPLY, "guest_messages.manage"];
/** 시험용 가짜 번호(실제 건물 번호 아님). */
const ROOM_101 = "50101";
const ROOM_102 = "50102";
const STAFF_ONLY = "70707";

type Tables = Record<string, Array<Record<string, unknown>>>;
let fake: ReturnType<typeof createFakeSupabase>;
let enqueueSeq = 0;

function conversation(over: Record<string, unknown>) {
  return {
    id: CONV,
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
    last_guest_at: "2026-11-18T01:00:00.000Z",
    last_reply_at: null,
    last_message_at: "2026-11-18T01:00:00.000Z",
    ...over,
  };
}

const RPC = {
  guest_reply_similar: (args: Record<string, unknown>, tables: Tables) => ({
    data: (tables.guest_reply_pairs ?? [])
      .filter((row) => row.organization_id === args.p_organization_id && row.reply_text !== null && row.embedding)
      .filter((row) => !args.p_before || String(row.asked_at) < String(args.p_before))
      .map((row) => ({ pair_id: row.id, ...row, distance: 0.1 })),
    error: null,
  }),
  guest_reply_assist_cost_since: (args: Record<string, unknown>, tables: Tables) => ({
    data: (tables.guest_reply_assist_events ?? [])
      .filter((row) => String(row.created_at ?? "9999") >= String(args.p_since))
      .reduce((sum, row) => sum + Number(row.cost_micro_usd ?? 0), 0),
    error: null,
  }),
  // SQL 과 같은 판정: 잡아 둔 것 포함 합 + 이번 몫이 한도를 넘으면 false, 아니면 pending 줄을 넣는다.
  guest_reply_assist_reserve: (args: Record<string, unknown>, tables: Tables) => {
    const spent = (tables.guest_reply_assist_events ?? [])
      .filter((row) => String(row.created_at ?? "9999") >= String(args.p_since))
      .reduce((sum, row) => sum + Number(row.cost_micro_usd ?? 0), 0);
    if (spent + Number(args.p_reserve_micro_usd) > Number(args.p_cap_micro_usd)) return { data: false, error: null };
    tables.guest_reply_assist_events.push({
      id: uuid(600 + tables.guest_reply_assist_events.length),
      organization_id: args.p_organization_id,
      conversation_id: args.p_conversation_id,
      user_id: args.p_user_id,
      kind: "pending",
      draft_id: args.p_draft_id,
      message_id: args.p_message_id,
      cost_micro_usd: args.p_reserve_micro_usd,
      placeholders: [],
      created_at: new Date().toISOString(),
    });
    return { data: true, error: null };
  },
  guest_message_enqueue_reply: (args: Record<string, unknown>, tables: Tables) => {
    const id = uuid(500 + ++enqueueSeq);
    tables.guest_message_outbox.push({ id, organization_id: args.p_organization_id, body: args.p_body, idempotency_key: args.p_idempotency_key });
    return { data: [{ outbox_id: id, duplicate: false, same_body: true }], error: null };
  },
};

beforeEach(() => {
  vi.stubEnv("GUEST_AI_FAKE", "1");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("GUEST_MESSAGES_SEND_ENABLED", "");
  vi.stubEnv("GUEST_AI_MONTHLY_CAP_USD", "");
  state.session = { organization: { id: ORG }, user: { id: USER, preferredLanguage: "en" }, capabilities: MANAGE };
  state.after = [];
  state.claude = null;
  fake = createFakeSupabase(
    {
      guest_conversations: [
        conversation({}),
        conversation({ id: FOREIGN, organization_id: OTHER_ORG }),
        conversation({ id: OLD_CONV, guest_name: "Old Guest" }),
      ],
      guest_messages: [
        { id: Q, organization_id: ORG, conversation_id: CONV, direction: "guest", body: "What is the door code for our room please?", sent_at: "2026-11-18T01:00:00.000Z" },
        { id: uuid(12), organization_id: OTHER_ORG, conversation_id: FOREIGN, direction: "guest", body: "What is the door code for our room please?", sent_at: "2026-11-18T01:00:00.000Z" },
      ],
      guest_reply_pairs: [
        {
          id: uuid(70),
          organization_id: ORG,
          question_message_id: uuid(71),
          conversation_id: OLD_CONV,
          property_name: "아라키초A",
          asked_at: "2026-10-01T00:00:00.000Z",
          question_text: "door code?",
          reply_text: "It is […].",
          embedding: "[1]",
          embed_model: "voyage-4",
        },
      ],
      guest_saved_reply_embeddings: [],
      guest_reply_assist_events: [],
      guest_message_saved_replies: [],
      guest_message_outbox: [],
      property_operation_infos: [
        {
          organization_id: ORG,
          canonical_name: "아라키초A",
          address_ko: "",
          address_ja: "",
          address_en: "",
          note: "",
          updated_at: null,
          shared_access: [{ labelKey: "storagePassword", code: STAFF_ONLY }],
          room_access: [
            { roomLabel: "101", code: ROOM_101 },
            { roomLabel: "102", code: ROOM_102 },
          ],
          guest_info: { wifiName: "Arakicho-A", wifiPassword: "wifi-pass" },
          guest_info_updated_at: null,
        },
      ],
    },
    RPC,
  );
  state.db = fake.client;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("권한 · 조직", () => {
  it("세션 없음 · 보기만 있음이면 forbidden(개요는 unavailable) — 아무것도 쓰지 않는다", async () => {
    state.session = null;
    expect(await getReplyAssist(CONV)).toEqual({ kind: "unavailable" });
    expect(await draftGuestReply(CONV)).toEqual({ ok: false, errorKey: "forbidden" });
    state.session = { organization: { id: ORG }, user: { id: USER, preferredLanguage: "en" }, capabilities: ["guest_messages.view"] };
    expect(await draftGuestReply(CONV)).toEqual({ ok: false, errorKey: "forbidden" });
    expect(await markAssistWrong({ draftId: uuid(99), reason: "fact" })).toEqual({ ok: false, errorKey: "forbidden" });
    expect(await markAssistDiscarded(uuid(99))).toEqual({ ok: false, errorKey: "forbidden" });
    expect(fake.tables.guest_reply_assist_events).toHaveLength(0);
    expect(fake.tables.guest_reply_pairs).toHaveLength(1);
  });

  it("다른 조직 대화는 not_found · 개요 unavailable", async () => {
    expect(await draftGuestReply(FOREIGN)).toEqual({ ok: false, errorKey: "not_found" });
    expect(await getReplyAssist(FOREIGN)).toEqual({ kind: "unavailable" });
    expect(await draftGuestReply("nope")).toEqual({ ok: false, errorKey: "invalid" });
  });

  it("다른 조직 초안 id 로는 틀렸어요 · 버림을 남길 수 없다", async () => {
    fake.tables.guest_reply_assist_events.push({ id: uuid(80), organization_id: OTHER_ORG, conversation_id: FOREIGN, kind: "draft", draft_id: uuid(81), placeholders: [] });
    expect(await markAssistWrong({ draftId: uuid(81), reason: "fact" })).toEqual({ ok: false, errorKey: "not_found" });
    expect(await markAssistWrong({ draftId: uuid(81), reason: "bogus" as "fact" })).toEqual({ ok: false, errorKey: "invalid" });
  });
});

describe("개요", () => {
  it("질문 줄을 만들고 비슷한 과거 대화를 돌려준다(다른 조직 · 지금 대화 제외)", async () => {
    const overview = await getReplyAssist(CONV);
    expect(overview).toMatchObject({ kind: "ready", messageId: Q, capReached: false, suggestions: [] });
    if (overview.kind !== "ready") return;
    expect(overview.similar.map((item) => item.conversationId)).toEqual([OLD_CONV]);
    const pair = fake.tables.guest_reply_pairs.find((row) => row.question_message_id === Q);
    // 가짜 모드 숫자는 "fake" 로 — 진짜 키로 돌리면 다시 바꾼다.
    expect(pair).toMatchObject({ organization_id: ORG, conversation_id: CONV, embed_model: "fake" });
    expect(pair?.reply_text ?? null).toBeNull();
    expect(String(pair?.question_text)).not.toContain("Emma");
  });

  it("이미 답했으면 none", async () => {
    fake.tables.guest_messages.push({ id: uuid(13), organization_id: ORG, conversation_id: CONV, direction: "host", body: "Sure", sent_at: "2026-11-18T02:00:00.000Z" });
    expect(await getReplyAssist(CONV)).toEqual({ kind: "none" });
  });

  it("키가 없으면 unavailable", async () => {
    vi.stubEnv("GUEST_AI_FAKE", "");
    vi.stubEnv("VOYAGE_API_KEY", "");
    expect(await getReplyAssist(CONV)).toEqual({ kind: "unavailable" });
  });
});

describe("초안 · 코드 채우기", () => {
  it("코드 볼 수 있는 사람 — 지금 방 손님용 번호만(다른 방 · 직원용 아님)", async () => {
    const result = await draftGuestReply(CONV);
    expect(result).toMatchObject({ ok: true, kind: "draft", lang: "en", placeholders: [] });
    if (!result.ok || result.kind !== "draft") return;
    expect(result.text).toContain(ROOM_101);
    expect(result.text).not.toContain(ROOM_102);
    expect(result.text).not.toContain(STAFF_ONLY);
    expect(result.text).toContain("Arakicho-A");
    const [event] = fake.tables.guest_reply_assist_events;
    expect(event).toMatchObject({ organization_id: ORG, kind: "draft", draft_id: result.draftId, message_id: Q, user_id: USER });
    expect(JSON.stringify(event)).not.toContain(ROOM_101);
  });

  it("코드 권한이 없으면 자리 표시가 남고, 남은 채로 보내면 서버가 막는다", async () => {
    state.session!.capabilities = REPLY;
    const result = await draftGuestReply(CONV);
    if (!result.ok || result.kind !== "draft") throw new Error("draft expected");
    expect(result.text).not.toContain(ROOM_101);
    expect(result.placeholders).toEqual([ASSIST_PLACEHOLDER_LABELS.entryCode.en]);
    const blocked = await sendGuestReply({ conversationId: CONV, body: result.text, idempotencyKey: "key-12345678", assistDraftId: result.draftId });
    expect(blocked).toEqual({ ok: false, errorKey: "assist_placeholder" });
    // 번역해서 보낼 때 — 원문에 남아 있어도 막는다.
    const viaOriginal = await sendGuestReply({
      conversationId: CONV,
      body: "translated",
      original: result.text,
      idempotencyKey: "key-12345679",
      assistDraftId: result.draftId,
    });
    expect(viaOriginal).toEqual({ ok: false, errorKey: "assist_placeholder" });
    // 원문은 채웠는데 번역문에 다른 언어 자리 표시가 남아도 막는다.
    const viaBody = await sendGuestReply({
      conversationId: CONV,
      body: `Code: ${ASSIST_PLACEHOLDER_LABELS.entryCode.ja}`,
      original: "Code: 12345",
      idempotencyKey: "key-12345670",
      assistDraftId: result.draftId,
    });
    expect(viaBody).toEqual({ ok: false, errorKey: "assist_placeholder" });
    expect(fake.tables.guest_message_outbox).toHaveLength(0);
  });

  it("그대로 보내면 sent_as_is, 고치면 sent_edited — 한 초안에 한 번", async () => {
    const result = await draftGuestReply(CONV);
    if (!result.ok || result.kind !== "draft") throw new Error("draft expected");
    const sent = await sendGuestReply({ conversationId: CONV, body: `  ${result.text}\n`, idempotencyKey: "key-12345678", assistDraftId: result.draftId });
    expect(sent.ok).toBe(true);
    for (const fn of state.after) await fn();
    expect(fake.tables.guest_reply_assist_events.map((row) => row.kind)).toEqual(["draft", "sent_as_is"]);

    const second = await draftGuestReply(CONV);
    if (!second.ok || second.kind !== "draft") throw new Error("draft expected");
    state.after = [];
    await sendGuestReply({ conversationId: CONV, body: `${second.text} Thanks!`, idempotencyKey: "key-22345678", assistDraftId: second.draftId });
    for (const fn of state.after) await fn();
    expect(fake.tables.guest_reply_assist_events.filter((row) => row.draft_id === second.draftId).map((row) => row.kind)).toEqual(["draft", "sent_edited"]);
  });

  it("보내면 그 대화 질문 줄에 가린 답이 붙는다", async () => {
    await getReplyAssist(CONV);
    vi.useFakeTimers({ now: new Date("2026-11-18T02:00:00.000Z"), toFake: ["Date"] });
    try {
      await sendGuestReply({ conversationId: CONV, body: `Your code is ${ROOM_101}, Emma.`, idempotencyKey: "key-12345678" });
      for (const fn of state.after) await fn();
    } finally {
      vi.useRealTimers();
    }
    const pair = fake.tables.guest_reply_pairs.find((row) => row.question_message_id === Q);
    expect(pair?.reply_text).toBeTruthy();
    expect(String(pair?.reply_text)).not.toContain(ROOM_101);
    expect(String(pair?.reply_text)).not.toContain("Emma");
  });

  it("한 달 한도에 닿으면 cap(개요는 capReached)", async () => {
    vi.stubEnv("GUEST_AI_MONTHLY_CAP_USD", "1");
    fake.tables.guest_reply_assist_events.push({
      id: uuid(90),
      organization_id: OTHER_ORG,
      conversation_id: FOREIGN,
      kind: "draft",
      draft_id: uuid(91),
      cost_micro_usd: 1_000_000,
      created_at: new Date().toISOString(),
      placeholders: [],
    });
    expect(await draftGuestReply(CONV)).toEqual({ ok: false, errorKey: "cap" });
    expect(await getReplyAssist(CONV)).toMatchObject({ kind: "ready", capReached: true });
  });

  it("버림은 한 번 · 틀렸어요는 이유와 함께", async () => {
    const result = await draftGuestReply(CONV);
    if (!result.ok) throw new Error("draft expected");
    expect(await markAssistWrong({ draftId: result.draftId, reason: "tone" })).toEqual({ ok: true });
    expect(await markAssistDiscarded(result.draftId)).toEqual({ ok: true });
    expect(fake.tables.guest_reply_assist_events.find((row) => row.kind === "wrong")).toMatchObject({ wrong_reason: "tone", message_id: Q });
    expect(await markAssistDiscarded(uuid(98))).toEqual({ ok: false, errorKey: "not_found" });
  });
});

describe("검토 보강(2026-11-18)", () => {
  it("요금은 모델과 함께 고정 — claude-sonnet-5-5 입력 2 · 출력 10 · 캐시 읽기 0.1 · 쓰기 2.5 (USD / 100만 토큰)", () => {
    expect(GUEST_AI_CONFIG.draftModel).toBe("claude-sonnet-5-5");
    expect(GUEST_AI_CONFIG.draftPricePerMTok).toEqual({ input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 });
  });

  it("초안 id 없이 보내도 자리 표시가 남았으면 막는다(본문 · 원문, 세 언어 + 날것 토큰)", async () => {
    const send = (body: string, original: string | null, key: string) =>
      sendGuestReply({ conversationId: CONV, body, original, idempotencyKey: key });
    expect(await send(`Your code is ${ASSIST_PLACEHOLDER_LABELS.entryCode.ko}`, null, "key-a2345678")).toEqual({ ok: false, errorKey: "assist_placeholder" });
    expect(await send("Wi-Fi: see below", `Wi-Fi: ${ASSIST_PLACEHOLDER_LABELS.wifi.ja}`, "key-b2345678")).toEqual({ ok: false, errorKey: "assist_placeholder" });
    expect(await send("Code {entry_code_room}", null, "key-c2345678")).toEqual({ ok: false, errorKey: "assist_placeholder" });
    expect(fake.tables.guest_message_outbox).toHaveLength(0);
    expect(await send("Check-in is from 3pm.", null, "key-d2345678")).toMatchObject({ ok: true });
  });

  it("답장을 받지 않는 채널이면 개요 unavailable · 초안 forbidden — 외부 호출 · 기록 없음", async () => {
    fake.tables.guest_conversations[0].channel = "direct";
    expect(await getReplyAssist(CONV)).toEqual({ kind: "unavailable" });
    expect(await draftGuestReply(CONV)).toEqual({ ok: false, errorKey: "forbidden" });
    expect(fake.tables.guest_reply_pairs).toHaveLength(1);
    expect(fake.tables.guest_reply_assist_events).toHaveLength(0);
  });

  it("모델이 거절 · 잘림이어도 쓴 비용은 남는다(failed)", async () => {
    vi.stubEnv("GUEST_AI_FAKE", "");
    vi.stubEnv("VOYAGE_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    state.claude = () => ({
      stop_reason: "max_tokens",
      content: [{ type: "text", text: "{" }],
      usage: { input_tokens: 1000, output_tokens: 2000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });
    expect(await draftGuestReply(CONV)).toEqual({ ok: false, errorKey: "failed" });
    expect(fake.tables.guest_reply_assist_events).toHaveLength(1);
    expect(fake.tables.guest_reply_assist_events[0]).toMatchObject({
      kind: "failed",
      input_tokens: 1000,
      output_tokens: 2000,
      cost_micro_usd: 2000 + 20000,
    });
  });

  it("모델 이유 글에 이 건물 코드가 나오면 가린다", async () => {
    vi.stubEnv("GUEST_AI_FAKE", "");
    vi.stubEnv("VOYAGE_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    state.claude = () => ({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ kind: "direct", text: "", checks: [], needsHuman: true, reason: `Code ${STAFF_ONLY} is broken` }) }],
      usage: { input_tokens: 10, output_tokens: 10 },
    });
    const result = await draftGuestReply(CONV);
    expect(result).toMatchObject({ ok: true, kind: "direct" });
    if (!result.ok || result.kind !== "direct") return;
    expect(result.reason).not.toContain(STAFF_ONLY);
    expect(fake.tables.guest_reply_assist_events[0]).toMatchObject({ kind: "direct", cost_micro_usd: 20 + 100 });
  });

  it("한도 바로 아래면 잡아 둘 몫이 없어 cap — 기록 없음", async () => {
    vi.stubEnv("GUEST_AI_MONTHLY_CAP_USD", "1");
    fake.tables.guest_reply_assist_events.push({
      id: uuid(92),
      organization_id: OTHER_ORG,
      conversation_id: FOREIGN,
      kind: "draft",
      draft_id: uuid(93),
      cost_micro_usd: 1_000_000 - GUEST_AI_CONFIG.draftReserveMicroUsd + 1,
      created_at: new Date().toISOString(),
      placeholders: [],
    });
    expect(await draftGuestReply(CONV)).toEqual({ ok: false, errorKey: "cap" });
    expect(fake.tables.guest_reply_assist_events).toHaveLength(1);
  });

  it("질문 줄 건물 이름 = 검색에 넘기는 이름(정본)", async () => {
    fake.tables.guest_conversations[0].property_name = " 아라키초A ";
    await getReplyAssist(CONV);
    const pair = fake.tables.guest_reply_pairs.find((row) => row.question_message_id === Q);
    const call = fake.rpcCalls.find((c) => c.name === "guest_reply_similar")?.args as Record<string, unknown> | undefined;
    expect(pair?.property_name).toBe("아라키초A");
    expect(call?.p_property_name).toBe("아라키초A");
  });

  it("이미 같은 모델 숫자가 있으면 다시 쓰지 않는다", async () => {
    await getReplyAssist(CONV);
    const writes = fake.writes.length;
    await getReplyAssist(CONV);
    expect(fake.writes.filter((w) => (w as { table?: string }).table === "guest_reply_pairs").length).toBe(
      fake.writes.slice(0, writes).filter((w) => (w as { table?: string }).table === "guest_reply_pairs").length,
    );
  });

  it("보낸 답은 마지막 질문 하나에만 붙는다", async () => {
    const Q0 = uuid(14);
    fake.tables.guest_messages.unshift({ id: Q0, organization_id: ORG, conversation_id: CONV, direction: "guest", body: "Is there a hair dryer in the room?", sent_at: "2026-11-18T00:30:00.000Z" });
    fake.tables.guest_reply_pairs.push({ id: uuid(72), organization_id: ORG, question_message_id: Q0, conversation_id: CONV, property_name: "아라키초A", asked_at: "2026-11-18T00:30:00.000Z", question_text: "dryer?", reply_text: null, embedding: "[1]", embed_model: "voyage-4" });
    await getReplyAssist(CONV);
    vi.useFakeTimers({ now: new Date("2026-11-18T02:00:00.000Z"), toFake: ["Date"] });
    try {
      await sendGuestReply({ conversationId: CONV, body: "Here is the information you asked for.", idempotencyKey: "key-e2345678" });
      for (const fn of state.after) await fn();
    } finally {
      vi.useRealTimers();
    }
    expect(fake.tables.guest_reply_pairs.find((row) => row.question_message_id === Q)?.reply_text).toBeTruthy();
    expect(fake.tables.guest_reply_pairs.find((row) => row.question_message_id === Q0)?.reply_text ?? null).toBeNull();
  });
});

describe("와이파이 가리기 · 이름표 겹침(2026-11-18)", () => {
  it("저장된 과거 답에 와이파이 값이 남아 있어도 비슷한 대화로 나갈 때 가린다", async () => {
    fake.tables.guest_reply_pairs[0].reply_text = "Wi-Fi: Arakicho-A / Password: wifi-pass";
    fake.tables.guest_reply_pairs[0].question_text = "what is the wifi-pass?";
    const overview = await getReplyAssist(CONV);
    if (overview.kind !== "ready") throw new Error("ready expected");
    const shown = JSON.stringify(overview.similar);
    expect(shown).not.toContain("Arakicho-A");
    expect(shown).not.toContain("wifi-pass");
  });

  it("질문 줄을 저장할 때 와이파이 값을 가린다", async () => {
    fake.tables.guest_messages[0].body = "The wifi password wifi-pass does not work, network Arakicho-A";
    await getReplyAssist(CONV);
    const pair = fake.tables.guest_reply_pairs.find((row) => row.question_message_id === Q);
    expect(String(pair?.question_text)).not.toContain("wifi-pass");
    expect(String(pair?.question_text)).not.toContain("Arakicho-A");
  });

  it("보낸 답을 질문 줄에 붙일 때 와이파이 값을 가린다", async () => {
    await getReplyAssist(CONV);
    vi.useFakeTimers({ now: new Date("2026-11-18T02:00:00.000Z"), toFake: ["Date"] });
    try {
      await sendGuestReply({ conversationId: CONV, body: "Wi-Fi: Arakicho-A / Password: wifi-pass", idempotencyKey: "key-w2345678" });
      for (const fn of state.after) await fn();
    } finally {
      vi.useRealTimers();
    }
    const reply = String(fake.tables.guest_reply_pairs.find((row) => row.question_message_id === Q)?.reply_text);
    expect(reply).not.toContain("wifi-pass");
    expect(reply).not.toContain("Arakicho-A");
  });

  it("모델 입력(대화 · 질문)에 와이파이 값을 넣지 않고, 모델 글에 나온 값 · 앞에 붙인 이름표는 정리한다", async () => {
    vi.stubEnv("GUEST_AI_FAKE", "");
    vi.stubEnv("VOYAGE_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    fake.tables.guest_messages[0].body = "Is the wifi password still wifi-pass? It does not work.";
    let prompt = "";
    state.claude = (...args: unknown[]) => {
      prompt = JSON.stringify(args);
      return {
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: JSON.stringify({ kind: "draft", text: "Hello.\nWi-Fi: {wifi}\nPassword is wifi-pass.", checks: [], needsHuman: false, reason: "wifi-pass" }),
          },
        ],
        usage: { input_tokens: 10, output_tokens: 10 },
      };
    };
    const result = await draftGuestReply(CONV);
    if (!result.ok || result.kind !== "draft") throw new Error("draft expected");
    expect(result.text.match(/Wi-Fi:/g)?.length).toBe(2);
    expect(result.text).not.toMatch(/Wi-Fi:\s*Wi-Fi:/);
    expect(result.reason).not.toContain("wifi-pass");
    expect(prompt).toContain("Message to answer");
    expect(prompt).not.toContain("wifi-pass");
    expect(prompt).not.toContain("Arakicho-A");
  });

  it("가짜 초안은 「와이파이: 와이파이:」 가 되지 않는다(ko · ja · en)", async () => {
    for (const lang of ["ko", "ja", "en"] as const) {
      state.session!.user.preferredLanguage = lang;
      fake.tables.guest_reply_assist_events.length = 0;
      const result = await draftGuestReply(CONV);
      if (!result.ok || result.kind !== "draft") throw new Error("draft expected");
      expect(result.text).not.toMatch(/(와이파이|Wi-Fi):\s*(와이파이|Wi-Fi):/);
      expect(result.text).toContain("Arakicho-A");
    }
  });
});
