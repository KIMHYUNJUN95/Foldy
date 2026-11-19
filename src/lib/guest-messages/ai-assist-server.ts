/**
 * AI 답장 도우미 — 서버 전용(service_role + 조직 필터 명시). docs/product/49-guest-message-ai-reply-assist.md §8
 *
 * 권한은 부르는 쪽(`src/actions/guest-messages-assist.ts`)이 먼저 본다(보기 + 답장).
 * - 임베딩: Voyage(`VOYAGE_API_KEY`) — 질문은 `query`, 정해 둔 문구는 `document`. 키 · 응답 본문은 로그에 남기지 않는다(상태 코드만).
 * - 초안: Anthropic(`ANTHROPIC_API_KEY`). 생각 깊이 낮게 · JSON 모양 고정(structured output).
 *   지시문 캐시는 걸지 않는다 — 지시문이 캐시 최소 길이(약 1,000 토큰)보다 짧아 효과가 없다. 지시문이 길어지면 그때 건다.
 *   강제 도구 호출(`tool_choice: tool`)은 생각(thinking)과 같이 쓸 수 없어 `output_config.format` 으로 모양을 고정한다.
 * - 모델에 주지 않는 것: 출입 코드 · 와이파이 값(모델은 `{entry_code_room}` · `{wifi}` 만 쓴다), 다른 손님 이름 · 연락처(가리기 뒤).
 * - 채우기: 출입 코드는 코드를 볼 수 있는 사람(`canSeeCodes`)에게만, **지금 예약의 방** 손님용 번호로. 직원용 번호는 넣지 않는다.
 * - `GUEST_AI_FAKE=1`: 외부 호출 없이 가짜 숫자 · 고정 초안(로컬 시험).
 */

import "server-only";

import { createHash, randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assistTextOf,
  assistTopicFlags,
  costMicroUsd,
  fakeEmbedding,
  fillAssistPlaceholders,
  filterChecks,
  guestEntryCodeFor,
  maskPastReply,
  maskQuestion,
  normalizeForCompare,
  pickAssistQuestion,
  sentKindFor,
  similarityOf,
  toVectorLiteral,
  tokyoMonthBounds,
  tokyoMonthsAgoStart,
  stripWifiLabelBeforeToken,
  validateDraftOutput,
  ASSIST_TOKENS,
  MASK,
  PAIR_WINDOW_MS,
  type DraftOutput,
  type ThreadMessage,
} from "@/lib/guest-messages/ai-assist-model";
import {
  ASSIST_LIMITS,
  type AssistDraftResult,
  type AssistEventKind,
  type AssistOverview,
  type AssistSimilar,
  type AssistSuggestion,
  type AssistWrongReason,
} from "@/lib/guest-messages/ai-assist-types";
import {
  FAKE_DRAFT_MODEL,
  GUEST_AI_CONFIG,
  guestAiMonthlyCapMicroUsd,
  activeEmbedModel,
  hasAnthropicKey,
  hasVoyageKey,
  isGuestAiFake,
} from "@/lib/guest-messages/ai-config";
import { maskEntryCodes, MASKED_CODE } from "@/lib/guest-messages/auto-model";
import { buildGuestInserts, pickLocalized, type GuestLang } from "@/lib/guest-messages/guest-info-model";
import { buildingBaseFor, loadBuildingGuestInfo, type BuildingGuestInfo } from "@/lib/guest-messages/guest-info-server";
import type { ConversationDbRow } from "@/lib/guest-messages/inbox-server";
import { buildReplyContext, guestDictionaries } from "@/lib/guest-messages/reply-context-server";
import { savedReplyText } from "@/lib/guest-messages/saved-reply-model";
import { loadSavedReplies, type SavedReply } from "@/lib/guest-messages/saved-replies-server";
import { getDictionary } from "@/lib/i18n";
import { localizeBuildingName, localizeRoomPlaceLabel } from "@/lib/room-label-normalization";
import { nightsBetween, replyBlockReason } from "@/lib/guest-messages/inbox-model";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type AssistViewer = { userId: string; lang: GuestLang; canSeeCodes: boolean };

// ── 작은 도구 ─────────────────────────────────────────────────────────────────

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** 질문 줄에 저장 · 검색에 쓰는 건물 이름 — 같은 건물이 늘 같은 글이 되게(별칭 · 공백 차이 없이). */
export function canonicalPropertyName(name: string | null | undefined): string | null {
  return buildingBaseFor(name ?? null)?.canonicalName ?? (name?.trim() || null);
}

/** 이 대화로는 답장을 쓸 수 없다(채널이 답장을 받지 않음) — 도우미도 외부 호출 전에 멈춘다. */
export function assistBlocked(conversation: Pick<ConversationDbRow, "channel">): boolean {
  return replyBlockReason(conversation.channel) !== null;
}

/** 건물 와이파이 이름 · 비밀번호 — 가리기용. */
function wifiValuesOf(building: BuildingGuestInfo | null): string[] {
  if (!building) return [];
  return [building.guestInfo.wifiName, building.guestInfo.wifiPassword].filter((value) => value.trim());
}

/** 가릴 값 전부: 출입 코드(공용 + 방) + 와이파이 이름 · 비밀번호. 저장 · 모델 입력 · 모델 출력 모두 이 목록으로 가린다. */
export function secretsOf(building: BuildingGuestInfo | null): string[] {
  if (!building) return [];
  return [
    ...building.sharedAccess.map((access) => access.code),
    ...building.roomAccess.map((room) => room.code),
    ...wifiValuesOf(building),
  ].filter((code) => code.trim());
}

const hideSecrets = (text: string, secrets: readonly string[]) => maskEntryCodes(text, secrets).split(MASKED_CODE).join(MASK);

export function parseVector(raw: unknown): number[] | null {
  if (Array.isArray(raw)) return raw.every((value) => typeof value === "number") ? (raw as number[]) : null;
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.every((value) => typeof value === "number") ? (parsed as number[]) : null;
  } catch {
    return null;
  }
}

function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : text;
}

// ── Voyage 임베딩 ─────────────────────────────────────────────────────────────

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

/** 글 묶음 → 뜻 숫자(입력 순서). 키 없음 · 실패 · 모양 틀림이면 null. */
export async function embedTexts(texts: readonly string[], inputType: "query" | "document"): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  const input = texts.map((text) => clip(text, GUEST_AI_CONFIG.embedMaxChars) || " ");
  if (isGuestAiFake()) return input.map((text) => fakeEmbedding(text, GUEST_AI_CONFIG.embedDim));
  const key = process.env.VOYAGE_API_KEY?.trim();
  if (!key) return null;
  try {
    const response = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        model: GUEST_AI_CONFIG.embedModel,
        input_type: inputType,
        output_dimension: GUEST_AI_CONFIG.embedDim,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      console.error(`[guest-ai] voyage error ${response.status}`);
      return null;
    }
    const json = (await response.json()) as { data?: Array<{ embedding?: unknown; index?: number }> };
    const rows = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (rows.length !== input.length) return null;
    const out: number[][] = [];
    for (const row of rows) {
      const vector = parseVector(row.embedding);
      if (!vector || vector.length !== GUEST_AI_CONFIG.embedDim) return null;
      out.push(vector);
    }
    return out;
  } catch {
    console.error("[guest-ai] voyage request failed");
    return null;
  }
}

// ── 대화 · 질문 ───────────────────────────────────────────────────────────────

/** 최근 손님 · 우리 말(시간 오름차순). 내부 메모 · 시스템 줄은 뺀다. */
export async function loadRecentThread(db: Client, organizationId: string, conversationId: string, limit = 40): Promise<ThreadMessage[]> {
  const { data, error } = await db
    .from("guest_messages")
    .select("id, direction, body, sent_at")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .in("direction", ["guest", "host"])
    .order("sent_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`messages read failed: ${error.code ?? "unknown"}`);
  return ((data ?? []) as ThreadMessage[]).slice().reverse();
}

type PairEmbedding = { literal: string; vector: number[] };

/**
 * 질문 줄 준비 — 이미 같은 모델로 바꿔 둔 줄이 있으면 그 숫자, 없으면 바꿔서 저장(답은 비워 둠 — 보낼 때 · 백필이 채운다).
 * 저장 실패(표 없음 등)는 숫자만 돌려준다(검색은 계속).
 */
async function ensureQuestionEmbedding(
  db: Client,
  organizationId: string,
  conversation: ConversationDbRow,
  question: ThreadMessage,
  codes: readonly string[],
): Promise<PairEmbedding | null> {
  const existing = await db
    .from("guest_reply_pairs")
    .select("id, embedding, embed_model")
    .eq("organization_id", organizationId)
    .eq("question_message_id", question.id)
    .maybeSingle();
  if (existing.error) throw new Error(`pairs read failed: ${existing.error.code ?? "unknown"}`);
  const row = existing.data as { id: string; embedding: unknown; embed_model: string | null } | null;
  // 같은 메시지 · 같은 모델 숫자가 있으면 다시 바꾸지도 쓰지도 않는다(대화를 열 때마다 Voyage · 쓰기가 생기지 않게).
  const stored = row && row.embed_model === activeEmbedModel() ? parseVector(row.embedding) : null;
  if (stored && stored.length === GUEST_AI_CONFIG.embedDim) return { literal: toVectorLiteral(stored), vector: stored };

  const questionText = maskQuestion(assistTextOf(question.body), codes, [conversation.guest_name]);
  const vectors = await embedTexts([questionText], "query");
  if (!vectors) return null;
  const vector = vectors[0];
  const literal = toVectorLiteral(vector);
  const saved = await db.from("guest_reply_pairs").upsert(
    {
      organization_id: organizationId,
      question_message_id: question.id,
      conversation_id: conversation.id,
      property_name: canonicalPropertyName(conversation.property_name),
      asked_at: question.sent_at,
      question_text: questionText,
      embedding: literal,
      embed_model: activeEmbedModel(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "question_message_id" },
  );
  if (saved.error) console.error("[guest-ai] pair save failed", { code: saved.error.code });
  return { literal, vector };
}

// ── 정해 둔 문구 ──────────────────────────────────────────────────────────────

function savedReplyEmbedText(reply: SavedReply): string {
  return [reply.title, reply.bodies.ko, reply.bodies.ja, reply.bodies.en].map((part) => part.trim()).filter(Boolean).join("\n");
}

function savedReplyHash(reply: SavedReply): string {
  return sha256([activeEmbedModel(), reply.title, reply.bodies.ko, reply.bodies.ja, reply.bodies.en].join("\n")).slice(0, 32);
}

/** 문구 뜻 숫자 — 글이 바뀐 것(해시 다름) · 없는 것만 다시 만든다. 실패하면 있는 것만. */
export async function savedReplyVectors(db: Client, organizationId: string, replies: readonly SavedReply[]): Promise<Map<string, number[]>> {
  const vectors = new Map<string, number[]>();
  if (replies.length === 0) return vectors;
  const { data, error } = await db
    .from("guest_saved_reply_embeddings")
    .select("saved_reply_id, body_hash, embedding")
    .eq("organization_id", organizationId);
  if (error) throw new Error(`saved reply embeddings read failed: ${error.code ?? "unknown"}`);
  const stored = new Map(
    ((data ?? []) as Array<{ saved_reply_id: string; body_hash: string; embedding: unknown }>).map((row) => [row.saved_reply_id, row]),
  );
  const stale: SavedReply[] = [];
  for (const reply of replies) {
    const row = stored.get(reply.id);
    const vector = row && row.body_hash === savedReplyHash(reply) ? parseVector(row.embedding) : null;
    if (vector) vectors.set(reply.id, vector);
    else stale.push(reply);
  }
  for (let start = 0; start < stale.length; start += GUEST_AI_CONFIG.embedBatch) {
    const part = stale.slice(start, start + GUEST_AI_CONFIG.embedBatch);
    const made = await embedTexts(part.map(savedReplyEmbedText), "document");
    if (!made) break;
    const rows = part.map((reply, index) => {
      vectors.set(reply.id, made[index]);
      return {
        saved_reply_id: reply.id,
        organization_id: organizationId,
        body_hash: savedReplyHash(reply),
        embedding: toVectorLiteral(made[index]),
        embed_model: activeEmbedModel(),
        updated_at: new Date().toISOString(),
      };
    });
    const saved = await db.from("guest_saved_reply_embeddings").upsert(rows, { onConflict: "saved_reply_id" });
    if (saved.error) console.error("[guest-ai] saved reply embeddings save failed", { code: saved.error.code });
  }
  return vectors;
}

function rankSuggestions(
  question: readonly number[],
  replies: readonly SavedReply[],
  vectors: Map<string, number[]>,
): Array<AssistSuggestion & { reply: SavedReply }> {
  return replies
    .map((reply) => {
      const vector = vectors.get(reply.id);
      return { savedReplyId: reply.id, title: reply.title, score: vector ? cosine(question, vector) : 0, reply };
    })
    .filter((item) => item.score >= ASSIST_LIMITS.minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, ASSIST_LIMITS.suggestions);
}

// ── 비슷한 과거 대화 ──────────────────────────────────────────────────────────

async function findSimilar(
  db: Client,
  organizationId: string,
  conversation: ConversationDbRow,
  question: ThreadMessage,
  embedding: PairEmbedding,
  now: Date,
): Promise<AssistSimilar[]> {
  const { data, error } = await db.rpc("guest_reply_similar", {
    p_organization_id: organizationId,
    p_embedding: embedding.literal,
    p_property_name: canonicalPropertyName(conversation.property_name) ?? undefined,
    p_since: tokyoMonthsAgoStart(now, GUEST_AI_CONFIG.similarMonths),
    p_before: question.sent_at,
    p_limit: ASSIST_LIMITS.similar * 2,
  });
  if (error) throw new Error(`similar search failed: ${error.code ?? "unknown"}`);
  const rows = ((data ?? []) as Array<{
    conversation_id: string;
    property_name: string | null;
    asked_at: string;
    question_text: string;
    reply_text: string | null;
  }>)
    .filter((row) => row.conversation_id !== conversation.id)
    .slice(0, ASSIST_LIMITS.similar);
  // 읽을 때도 그 줄 건물의 코드 · 와이파이를 한 번 더 가린다(가리기 규칙이 늘기 전에 저장된 줄 대비).
  const names = [...new Set(rows.map((row) => row.property_name))];
  const secretsByName = new Map(
    await Promise.all(
      names.map(async (name) => [name, secretsOf(await loadBuildingGuestInfo(db, organizationId, name))] as const),
    ),
  );
  return rows.map((row) => {
    const secrets = secretsByName.get(row.property_name) ?? [];
    return {
      conversationId: row.conversation_id,
      propertyName: row.property_name,
      askedAt: row.asked_at,
      question: hideSecrets(row.question_text, secrets),
      reply: row.reply_text === null ? null : hideSecrets(row.reply_text, secrets),
    };
  });
}

// ── 한 달 상한 ────────────────────────────────────────────────────────────────

/** 이번 달(도쿄) 쓴 비용(micro USD) — 모든 조직 합(키 하나). 읽지 못하면 던진다. */
export async function monthlyCostMicroUsd(db: Client, now: Date): Promise<number> {
  const { data, error } = await db.rpc("guest_reply_assist_cost_since", { p_since: tokyoMonthBounds(now).start });
  if (error) throw new Error(`assist cost read failed: ${error.code ?? "unknown"}`);
  return Number(data ?? 0);
}

async function capReachedSafe(db: Client, now: Date): Promise<boolean> {
  try {
    return (await monthlyCostMicroUsd(db, now)) + GUEST_AI_CONFIG.draftReserveMicroUsd > guestAiMonthlyCapMicroUsd();
  } catch {
    return false;
  }
}

// ── 기록 ──────────────────────────────────────────────────────────────────────

type EventInsert = Database["public"]["Tables"]["guest_reply_assist_events"]["Insert"];
type EventUpdate = Database["public"]["Tables"]["guest_reply_assist_events"]["Update"];

async function insertEvent(db: Client, row: EventInsert): Promise<{ ok: boolean; duplicate: boolean }> {
  const { error } = await db.from("guest_reply_assist_events").insert(row);
  if (!error) return { ok: true, duplicate: false };
  if (error.code === "23505") return { ok: true, duplicate: true };
  console.error("[guest-ai] event save failed", { code: error.code });
  return { ok: false, duplicate: false };
}

type DraftOrigin = { conversation_id: string; placeholders: string[]; draft_hash: string | null; message_id: string | null };

/** 그 초안의 처음 기록(draft · direct) — 이 조직 것만. */
export async function loadDraftOrigin(db: Client, organizationId: string, draftId: string): Promise<DraftOrigin | null> {
  const { data, error } = await db
    .from("guest_reply_assist_events")
    .select("conversation_id, placeholders, draft_hash, message_id")
    .eq("organization_id", organizationId)
    .eq("draft_id", draftId)
    .in("kind", ["draft", "direct"])
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`assist event read failed: ${error.code ?? "unknown"}`);
  return (data as DraftOrigin | null) ?? null;
}

export async function recordAssistFeedback(
  db: Client,
  organizationId: string,
  userId: string,
  draftId: string,
  kind: Extract<AssistEventKind, "wrong" | "discarded">,
  reason: AssistWrongReason | null,
): Promise<"ok" | "not_found" | "failed"> {
  const origin = await loadDraftOrigin(db, organizationId, draftId);
  if (!origin) return "not_found";
  const saved = await insertEvent(db, {
    organization_id: organizationId,
    conversation_id: origin.conversation_id,
    user_id: userId,
    kind,
    draft_id: draftId,
    message_id: origin.message_id,
    wrong_reason: kind === "wrong" ? reason : null,
  });
  return saved.ok ? "ok" : "failed";
}

/** 보낸 뒤 — 초안과 같은 글이면 sent_as_is, 아니면 sent_edited(한 초안에 한 번). 실패는 삼킨다. */
export async function recordAssistSent(
  db: Client,
  input: { organizationId: string; userId: string; conversationId: string; draftId: string; sentText: string },
): Promise<void> {
  try {
    const origin = await loadDraftOrigin(db, input.organizationId, input.draftId);
    if (!origin || origin.conversation_id !== input.conversationId || origin.draft_hash === null) return;
    await insertEvent(db, {
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      user_id: input.userId,
      kind: sentKindFor(origin.draft_hash, sha256(normalizeForCompare(input.sentText))),
      draft_id: input.draftId,
      message_id: origin.message_id,
    });
  } catch {
    console.error("[guest-ai] sent record failed");
  }
}

/**
 * 보낸 답을 그 대화의 **마지막 질문 하나**에 붙인다 — 다음 검색 재료. 규칙은 `pickAssistQuestion` 과 같다:
 * 보내기 전(`sentAt` 앞) 대화에서 마지막 손님 메시지가 답 필요한 질문이고 그 뒤 우리 답이 없을 때만, 12시간 안이면.
 * 가리기 뒤 글만. 실패는 삼킨다.
 */
export async function attachReplyToPairs(
  db: Client,
  organizationId: string,
  conversation: Pick<ConversationDbRow, "id" | "property_name" | "guest_name">,
  replyBody: string,
  sentAt: Date = new Date(),
): Promise<void> {
  try {
    const text = assistTextOf(replyBody);
    if (!text) return;
    const before = sentAt.toISOString();
    const thread = (await loadRecentThread(db, organizationId, conversation.id)).filter((message) => message.sent_at < before);
    const question = pickAssistQuestion(thread);
    if (!question || sentAt.getTime() - Date.parse(question.sent_at) > PAIR_WINDOW_MS) return;
    const building = await loadBuildingGuestInfo(db, organizationId, conversation.property_name);
    const masked = maskPastReply(text, secretsOf(building), [conversation.guest_name]);
    const { error } = await db
      .from("guest_reply_pairs")
      .update({ reply_text: masked, updated_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .eq("conversation_id", conversation.id)
      .eq("question_message_id", question.id)
      .is("reply_text", null);
    if (error) console.error("[guest-ai] pair reply save failed", { code: error.code });
  } catch {
    console.error("[guest-ai] pair reply save failed");
  }
}

// ── 개요(대화를 열 때) ────────────────────────────────────────────────────────

type Prepared = {
  question: ThreadMessage;
  thread: ThreadMessage[];
  building: BuildingGuestInfo | null;
  codes: string[];
  replies: SavedReply[];
  embedding: PairEmbedding | null;
};

async function prepare(db: Client, organizationId: string, conversation: ConversationDbRow): Promise<Prepared | null> {
  const thread = await loadRecentThread(db, organizationId, conversation.id);
  const question = pickAssistQuestion(thread);
  if (!question) return null;
  const [building, replies] = await Promise.all([
    loadBuildingGuestInfo(db, organizationId, conversation.property_name),
    loadSavedReplies(db, organizationId),
  ]);
  const codes = secretsOf(building);
  const embedding = hasVoyageKey() ? await ensureQuestionEmbedding(db, organizationId, conversation, question, codes) : null;
  return { question, thread, building, codes, replies, embedding };
}

export async function buildAssistOverview(
  db: Client,
  organizationId: string,
  conversation: ConversationDbRow,
  now: Date = new Date(),
): Promise<AssistOverview> {
  if (!hasVoyageKey() || assistBlocked(conversation)) return { kind: "unavailable" };
  const prepared = await prepare(db, organizationId, conversation);
  if (!prepared) return { kind: "none" };
  if (!prepared.embedding) return { kind: "unavailable" };
  const [vectors, similar, capReached] = await Promise.all([
    savedReplyVectors(db, organizationId, prepared.replies),
    findSimilar(db, organizationId, conversation, prepared.question, prepared.embedding, now),
    capReachedSafe(db, now),
  ]);
  const suggestions = rankSuggestions(prepared.embedding.vector, prepared.replies, vectors).map(({ savedReplyId, title, score }) => ({
    savedReplyId,
    title,
    score,
  }));
  return { kind: "ready", messageId: prepared.question.id, suggestions, similar, capReached };
}

// ── 초안 ──────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You draft replies for the staff of a small group of short-stay accommodation buildings in Tokyo.
A staff member reads your draft, edits it and decides whether to send it. You never talk to the guest directly.

Facts — where they may come from:
- ONLY from "Reservation", "Building notes" and "Saved replies" in the request. Those are current.
- "Past replies" are earlier answers to similar questions from other guests and other rooms. Use them ONLY for tone,
  structure and what kind of answer is expected. Never copy facts from them (prices, times, rules, facilities, addresses,
  room numbers, links). Parts shown as […] were removed on purpose; never try to fill them.
- If a fact you need is not in the current sources, do not guess: write the sentence neutrally and add it to "checks".

Secrets:
- Never write a door code, room password, key box number or Wi-Fi password yourself. You do not know them.
  Where the guest needs the room's door code, write the token {entry_code_room}. Where the guest needs the Wi-Fi name
  and password, write the token {wifi} on its own line. {wifi} becomes a complete labelled line (name and password with
  their labels), so do not put "Wi-Fi:" or any label in front of it. Use no other tokens.
- Never include other guests' names, phone numbers, emails or links.

Policies are defaults, not promises. Late check-out, early check-in, luggage storage, room changes and anything "free"
depend on that day's next guest, cleaning schedule and room status. Write such answers as "we will check" rather than
a definite yes or no, add the uncertain sentence to "checks", and set needsHuman = true.

Set needsHuman = true when the message involves: cancellation, refund, payment or charges, repair or damage costs,
date changes, extending the stay, changing the number of guests, noise, security, something broken, facility problems,
cleanliness complaints, lost items, or any of the day-dependent requests above.

Use kind = "direct" (and leave text empty) when the question can only be answered by looking at this specific
reservation's live situation — e.g. whether the room is ready right now, approving a special fee, a date change,
a lost item, a breakdown that needs someone on site. Otherwise use kind = "draft".

Output:
- text: the reply, in the language requested in the request (the staff member's language — it is translated for the
  guest later). Plain text, short, warm and polite, no markdown, no signature placeholder.
- checks: up to 4 items. Each "text" MUST be copied exactly, character for character, from your reply text (a sentence
  or phrase the staff should verify). "why": a short reason in the same language as the reply.
- needsHuman: boolean as described above.
- reason: one short sentence in the reply language explaining needsHuman or the "direct" choice, or "" if none.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["draft", "direct"] },
    text: { type: "string" },
    checks: {
      type: "array",
      items: {
        type: "object",
        properties: { text: { type: "string" }, why: { type: "string" } },
        required: ["text", "why"],
        additionalProperties: false,
      },
    },
    needsHuman: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["kind", "text", "checks", "needsHuman", "reason"],
  additionalProperties: false,
} as const;

const LANG_NAMES: Record<GuestLang, string> = { ko: "Korean", ja: "Japanese", en: "English" };

const FAKE_DRAFTS: Record<GuestLang, DraftOutput> = {
  ko: {
    kind: "draft",
    text: "안녕하세요. 문의 감사합니다.\n객실 비밀번호는 {entry_code_room} 입니다.\n{wifi}\n자세한 내용은 확인 후 다시 안내드리겠습니다.",
    checks: [{ text: "자세한 내용은 확인 후 다시 안내드리겠습니다.", why: "시험용 확인 문구" }],
    needsHuman: false,
    reason: null,
  },
  ja: {
    kind: "draft",
    text: "こんにちは。お問い合わせありがとうございます。\nお部屋の暗証番号は {entry_code_room} です。\n{wifi}\n詳細は確認のうえ改めてご案内いたします。",
    checks: [{ text: "詳細は確認のうえ改めてご案内いたします。", why: "テスト用の確認箇所" }],
    needsHuman: false,
    reason: null,
  },
  en: {
    kind: "draft",
    text: "Hello, thank you for your message.\nYour room door code is {entry_code_room}.\n{wifi}\nWe will check the details and get back to you.",
    checks: [{ text: "We will check the details and get back to you.", why: "Test check" }],
    needsHuman: false,
    reason: null,
  },
};

type GuestCounts = { adults: number | null; children: number | null };

async function loadGuestCounts(db: Client, organizationId: string, reservationId: string | null): Promise<GuestCounts> {
  if (!reservationId) return { adults: null, children: null };
  try {
    const { data } = await db
      .from("reservations")
      .select("raw_payload")
      .eq("organization_id", organizationId)
      .eq("id", reservationId)
      .maybeSingle();
    const payload = ((data as { raw_payload?: unknown } | null)?.raw_payload ?? {}) as Record<string, unknown>;
    const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : null);
    return { adults: num(payload.numAdult), children: num(payload.numChild) };
  } catch {
    return { adults: null, children: null };
  }
}

function buildingNotes(building: BuildingGuestInfo | null, lang: GuestLang, codes: readonly string[]): string {
  if (!building) return "(no notes for this building)";
  const base = buildingBaseFor(building.canonicalName);
  const lines: string[] = [];
  if (base) lines.push(`Address: ${base.address[lang] || base.address.en}`);
  const fields = ["checkIn", "checkOut", "luggage", "parking", "trash", "directions", "freeText"] as const;
  for (const field of fields) {
    const picked = pickLocalized(building.guestInfo[field], lang);
    if (picked) lines.push(`${field}: ${hideSecrets(picked.text, codes)}`);
  }
  lines.push(`Wi-Fi: ${building.guestInfo.wifiName.trim() || building.guestInfo.wifiPassword.trim() ? "available — write {wifi}" : "not recorded"}`);
  return lines.join("\n");
}

function buildUserPrompt(args: {
  lang: GuestLang;
  conversation: ConversationDbRow;
  counts: GuestCounts;
  prepared: Prepared;
  savedReplies: string[];
  similar: AssistSimilar[];
}): string {
  const { lang, conversation, counts, prepared } = args;
  const dict = getDictionary(lang);
  const building = conversation.property_name ? localizeBuildingName(conversation.property_name, dict.cleaning.buildingLabels) : "unknown";
  const room = conversation.room_label ? localizeRoomPlaceLabel(conversation.room_label, dict.cleaning.buildingLabels) : "unknown";
  const thread = prepared.thread
    .slice(-GUEST_AI_CONFIG.threadLines)
    .map((message) => {
      const text = clip(hideSecrets(assistTextOf(message.body), prepared.codes), 800);
      return `${message.direction === "guest" ? "Guest" : "Us"} (${message.sent_at}): ${text || "(photo)"}`;
    })
    .join("\n");
  const sections = [
    `Write the reply in ${LANG_NAMES[lang]}.`,
    [
      "## Reservation",
      `Building: ${building}`,
      `Room: ${room}`,
      `Check-in: ${conversation.check_in_date ?? "unknown"} / Check-out: ${conversation.check_out_date ?? "unknown"} / Nights: ${nightsBetween(conversation.check_in_date, conversation.check_out_date) ?? "unknown"}`,
      `Guests: adults ${counts.adults ?? "unknown"}, children ${counts.children ?? "unknown"}`,
      `Channel: ${conversation.channel ?? "unknown"}`,
    ].join("\n"),
    `## Building notes\n${buildingNotes(prepared.building, lang, prepared.codes)}`,
    `## Saved replies (current wording the team uses)\n${args.savedReplies.length ? args.savedReplies.map((text, i) => `[${i + 1}] ${clip(text, 1200)}`).join("\n\n") : "(none matched)"}`,
    `## Past replies (tone and structure only — never copy facts)\n${
      args.similar.length
        ? args.similar.map((item, i) => `[${i + 1}] Q: ${clip(item.question, 500)}\nA: ${clip(item.reply ?? "", 900)}`).join("\n\n")
        : "(none)"
    }`,
    `## Conversation (latest last)\n${thread}`,
    `## Message to answer\n${clip(hideSecrets(assistTextOf(prepared.question.body), prepared.codes), 2000)}`,
  ];
  return sections.join("\n\n");
}

type ModelUsage = { model: string; inputTokens: number; outputTokens: number; costMicroUsd: number };

/** 실패해도 쓴 토큰 · 비용은 돌려준다(거절 · 잘림 · 모양 틀림도 요금이 나간다). 요청 자체가 실패하면 0. */
type ModelCall =
  | ({ ok: true; output: DraftOutput } & ModelUsage)
  | ({ ok: false; reason: "unavailable" | "failed" } & ModelUsage);

const NO_USAGE: ModelUsage = { model: GUEST_AI_CONFIG.draftModel, inputTokens: 0, outputTokens: 0, costMicroUsd: 0 };

/** 손님 메시지 AI 의 JSON 출력 호출 하나 — 초안(§8)과 과거 답 후보(§9)가 같이 쓴다. 키 없음 · 키 거절은 `unavailable`, 그 밖은 `failed`. */
export type GuestJsonCall = ({ ok: true; parsed: unknown } | { ok: false; reason: "unavailable" | "failed" }) & ModelUsage;

export async function callGuestJsonModel(request: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  timeoutMs: number;
  logTag: string;
}): Promise<GuestJsonCall> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return { ok: false, reason: "unavailable", ...NO_USAGE };
  const client = new Anthropic();
  let response: Anthropic.Message;
  try {
    response = await client.messages.create(
      {
        model: GUEST_AI_CONFIG.draftModel,
        max_tokens: request.maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort: "low", format: { type: "json_schema", schema: request.schema } },
        system: request.system,
        messages: [{ role: "user", content: request.user }],
      },
      { timeout: request.timeoutMs, maxRetries: 1 },
    );
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      console.error(`${request.logTag} Claude API key rejected`);
      return { ok: false, reason: "unavailable", ...NO_USAGE };
    }
    console.error(error instanceof Anthropic.APIError ? `${request.logTag} Claude API error ${error.status}` : `${request.logTag} Claude request failed`);
    return { ok: false, reason: "failed", ...NO_USAGE };
  }
  const usage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_creation_input_tokens: response.usage.cache_creation_input_tokens,
    cache_read_input_tokens: response.usage.cache_read_input_tokens,
  };
  const base: ModelUsage = {
    model: GUEST_AI_CONFIG.draftModel,
    inputTokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens,
    costMicroUsd: costMicroUsd(usage, GUEST_AI_CONFIG.draftPricePerMTok),
  };
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return { ok: false, reason: "failed", ...base };
  const text = response.content.find((block): block is Anthropic.TextBlock => block.type === "text")?.text;
  try {
    return { ok: true, parsed: text ? JSON.parse(text) : null, ...base };
  } catch {
    return { ok: false, reason: "failed", ...base };
  }
}

async function callDraftModel(system: string, user: string, lang: GuestLang): Promise<ModelCall> {
  if (isGuestAiFake()) return { ok: true, output: FAKE_DRAFTS[lang], model: FAKE_DRAFT_MODEL, inputTokens: 0, outputTokens: 0, costMicroUsd: 0 };
  const call = await callGuestJsonModel({
    system,
    user,
    schema: OUTPUT_SCHEMA,
    maxTokens: GUEST_AI_CONFIG.draftMaxTokens,
    timeoutMs: 60_000,
    logTag: "[guest-ai]",
  });
  const { model, inputTokens, outputTokens, costMicroUsd: cost } = call;
  const base: ModelUsage = { model, inputTokens, outputTokens, costMicroUsd: cost };
  if (!call.ok) return { ok: false, reason: call.reason, ...base };
  const output = validateDraftOutput(call.parsed);
  if (!output) return { ok: false, reason: "failed", ...base };
  return { ok: true, output, ...base };
}

function wifiText(building: BuildingGuestInfo | null, lang: GuestLang): string | null {
  if (!building) return null;
  const copy = getDictionary(lang).guestMessages;
  return (
    buildGuestInserts(building.guestInfo, lang, {
      wifi: copy.insertWifiFormat,
      wifiNameOnly: copy.insertWifiNameOnly,
      wifiPasswordOnly: copy.insertWifiPasswordOnly,
    }).find((item) => item.key === "wifi")?.text ?? null
  );
}

type Settle = Pick<EventUpdate, "model" | "input_tokens" | "output_tokens" | "cost_micro_usd" | "draft_hash" | "placeholders"> & {
  kind: Extract<AssistEventKind, "draft" | "direct" | "failed">;
};

/** 잡아 둔 `pending` 줄을 실제 결과 · 비용으로 바꾼다. 실패하면 잡아 둔 값이 남는다(한도 쪽으로 안전). */
async function settleReserved(db: Client, organizationId: string, draftId: string, patch: Settle): Promise<void> {
  const { error } = await db
    .from("guest_reply_assist_events")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("draft_id", draftId)
    .eq("kind", "pending");
  if (error) console.error("[guest-ai] draft record save failed", { code: error.code });
}

export async function buildAssistDraft(
  db: Client,
  organizationId: string,
  conversation: ConversationDbRow,
  viewer: AssistViewer,
  now: Date = new Date(),
): Promise<AssistDraftResult> {
  if (assistBlocked(conversation)) return { ok: false, errorKey: "forbidden" };
  if (!hasAnthropicKey()) return { ok: false, errorKey: "unavailable" };
  const prepared = await prepare(db, organizationId, conversation);
  if (!prepared) return { ok: false, errorKey: "invalid" };

  // 한도 확인 + 비용 잡아 두기를 DB 잠금 하나 안에서(동시에 눌러도 한도를 크게 넘지 않게). 부른 뒤 같은 줄을 실제 값으로 바꾼다.
  const draftId = randomUUID();
  const reserved = await db.rpc("guest_reply_assist_reserve", {
    p_organization_id: organizationId,
    p_conversation_id: conversation.id,
    p_user_id: viewer.userId,
    p_draft_id: draftId,
    p_message_id: prepared.question.id,
    p_since: tokyoMonthBounds(now).start,
    p_cap_micro_usd: guestAiMonthlyCapMicroUsd(),
    p_reserve_micro_usd: GUEST_AI_CONFIG.draftReserveMicroUsd,
  });
  if (reserved.error) {
    console.error("[guest-ai] cap reserve failed", { code: reserved.error.code });
    return { ok: false, errorKey: "unavailable" };
  }
  if (reserved.data !== true) return { ok: false, errorKey: "cap" };

  let similar: AssistSimilar[] = [];
  let matched: SavedReply[] = [];
  if (prepared.embedding) {
    try {
      const [vectors, found] = await Promise.all([
        savedReplyVectors(db, organizationId, prepared.replies),
        findSimilar(db, organizationId, conversation, prepared.question, prepared.embedding, now),
      ]);
      similar = found;
      matched = rankSuggestions(prepared.embedding.vector, prepared.replies, vectors).map((item) => item.reply);
    } catch {
      console.error("[guest-ai] assist search failed — drafting without references");
    }
  }
  const context = buildReplyContext(conversation, guestDictionaries());
  const savedTexts = matched
    .map((reply) => savedReplyText(reply.bodies, viewer.lang, context)?.text ?? null)
    .filter((text): text is string => Boolean(text))
    .map((text) => hideSecrets(text, prepared.codes));
  const counts = await loadGuestCounts(db, organizationId, conversation.reservation_id);
  const user = buildUserPrompt({ lang: viewer.lang, conversation, counts, prepared, savedReplies: savedTexts, similar });

  const call = await callDraftModel(SYSTEM_PROMPT, user, viewer.lang);
  const usage = {
    model: call.model,
    input_tokens: call.inputTokens,
    output_tokens: call.outputTokens,
    cost_micro_usd: call.costMicroUsd,
  };
  if (!call.ok) {
    await settleReserved(db, organizationId, draftId, { ...usage, kind: "failed" });
    return { ok: false, errorKey: call.reason };
  }

  const flags = assistTopicFlags(assistTextOf(prepared.question.body));
  const needsHuman = call.output.needsHuman || flags.sensitive || flags.dayDependent;
  const reason = call.output.reason === null ? null : hideSecrets(call.output.reason, prepared.codes);

  if (call.output.kind === "direct") {
    await settleReserved(db, organizationId, draftId, { ...usage, kind: "direct" });
    return { ok: true, kind: "direct", draftId, reason };
  }

  // 모델이 코드 값을 어디서 봤더라도(가리기 빠짐) 그대로 내보내지 않는다 — 자리 표시로 돌려 이 방 값으로만 채운다.
  // 모델 글에 와이파이 값이 나오면 {wifi} 로, 출입 코드면 {entry_code_room} 로 되돌린 뒤 채운다. 「Wi-Fi: {wifi}」 처럼 앞에 붙인 이름은 뗀다.
  const wifiValues = wifiValuesOf(prepared.building);
  const withoutWifi = maskEntryCodes(call.output.text, wifiValues).split(MASKED_CODE).join(ASSIST_TOKENS.wifi);
  const safeText = stripWifiLabelBeforeToken(
    maskEntryCodes(withoutWifi, prepared.codes).split(MASKED_CODE).join(ASSIST_TOKENS.entryCode),
  );
  const filled = fillAssistPlaceholders(
    safeText,
    {
      entryCode: viewer.canSeeCodes ? guestEntryCodeFor(prepared.building, conversation.room_label) : null,
      wifi: wifiText(prepared.building, viewer.lang),
    },
    viewer.lang,
  );
  const checks = filterChecks(filled.text, call.output.checks);
  await settleReserved(db, organizationId, draftId, {
    ...usage,
    kind: "draft",
    draft_hash: sha256(normalizeForCompare(filled.text)),
    placeholders: filled.placeholders,
  });
  return {
    ok: true,
    kind: "draft",
    draftId,
    text: filled.text,
    lang: viewer.lang,
    checks,
    needsHuman,
    reason,
    placeholders: filled.placeholders,
  };
}

/** 그 초안의 자리 표시가 보내려는 글에 남아 있나 — 기록을 못 읽으면 모든 언어 자리 표시로 본다. */
export async function draftPlaceholdersFor(db: Client, organizationId: string, draftId: string): Promise<string[] | null> {
  try {
    const origin = await loadDraftOrigin(db, organizationId, draftId);
    return origin ? origin.placeholders ?? [] : [];
  } catch {
    return null;
  }
}

export { similarityOf };
