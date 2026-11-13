"use server";

/**
 * 손님 메시지함 서버 액션 — PC `/admin/messages` · 모바일 `/mobile/messages` 공용(2단계, 2026-11-13).
 * docs/product/47-guest-messaging.md §5 · §8 · §9
 *
 * - 권한은 서버가 본다: 읽기 `guest_messages.view`, 쓰기(답장 · 내부 메모 · 처리 끝 · 나중에 · 번역 · 큐 고치기)는 `view` **와** `reply`.
 *   공용 액션이라 거부는 redirect 없이 `forbidden` 결과로 돌려준다. 관리자 웹 권한은 요구하지 않는다 — §8 에 따라 알바 · 야간 직원에게
 *   권한 키만 개인 부여해도 폰에서 답장할 수 있어야 한다(키가 기준, 문서 14).
 * - 쓰기는 service_role 로, **조직 필터를 항상 명시**한다(RLS 는 일반 사용자에게 몇 칸만 연다 — 05 「손님 메시지」).
 * - 답장은 발송 큐 줄 + 대기 메시지 줄(같은 `outbox_id`)로 넣고, 실제 Beds24 발송은 `after()` 의 발송 작업이 한다.
 *   `GUEST_MESSAGES_SEND_ENABLED=1` 이 아니면 줄은 `queued` 그대로(화면: 「보낼 차례 기다림」).
 * - 조직 id 는 언제나 세션에서 온다(클라이언트가 보낸 값을 쓰지 않는다).
 */

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { Capability } from "@/config/capabilities";
import {
  MAX_NOTE_CHARS,
  MAX_REPLY_CHARS,
  INBOX_STATUS_FILTERS,
  UUID_RE,
  deeplTargetFor,
  defaultReplyTarget,
  isAllowedReplyTarget,
  isStaffViewLang,
  isRetryableOutbox,
  isValidIdempotencyKey,
  normalizeGuestLanguage,
  parseChannelFilter,
  replyBlockReason,
  resolveSnoozeUntil,
  type InboxListData,
  type InboxStatusFilter,
  type InboxThread,
  type SnoozeInput,
} from "@/lib/guest-messages/inbox-model";
import { loadConversationRow, loadInboxList, loadInboxThread } from "@/lib/guest-messages/inbox-server";
import { isGuestMessageSendEnabled, runGuestOutbox } from "@/lib/guest-messages/outbox-runner";
import { createTranslationBudget, deeplTranslate } from "@/lib/review-translate";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { messageTextForTranslation } from "@/lib/guest-messages/message-body";

export type GuestMessageErrorKey =
  | "forbidden"
  | "invalid"
  | "not_found"
  | "direct_booking"
  | "unknown_channel"
  | "too_long"
  | "stale"
  | "failed"
  | "translation_unavailable"
  | "translation_budget";

type Failure = { ok: false; errorKey: GuestMessageErrorKey };
type Ok = { ok: true };

type Gate =
  | {
      ok: true;
      organizationId: string;
      userId: string;
      locale: "ko" | "ja" | "en";
      capabilities: readonly string[];
    }
  | Failure;

async function gate(write: boolean): Promise<Gate> {
  const session = await getCurrentAppSession().catch(() => null);
  if (!session || !hasOrganizationContext(session)) return { ok: false, errorKey: "forbidden" };
  const needed: Capability[] = write ? ["guest_messages.view", "guest_messages.reply"] : ["guest_messages.view"];
  if (!needed.every((key) => session.capabilities.includes(key))) return { ok: false, errorKey: "forbidden" };
  return {
    ok: true,
    organizationId: session.organization.id,
    userId: session.user.id,
    locale: session.user.preferredLanguage,
    capabilities: session.capabilities,
  };
}

/**
 * 자동 안내의 출입 코드 보기 · 자동 안내 큐 줄 고치기 — 임시 결정(47 §5-6 · Q). 코드는 `guest_messages.manage` 또는 `property_info.edit`
 * (답장 칸 넣기 목록과 같은 기준), 자동 안내 줄 고치기 · 취소 · 다시 보내기는 `guest_messages.manage` 만.
 */
function visibilityOf(capabilities: readonly string[]) {
  return {
    canSeeCodes: capabilities.includes("guest_messages.manage") || capabilities.includes("property_info.edit"),
    canManageAuto: capabilities.includes("guest_messages.manage"),
  };
}

/** 자동 안내 큐 줄이면 manage 가 있어야 한다. 읽기 실패는 `failed`. */
async function guardAutoOutbox(organizationId: string, outboxId: string, capabilities: readonly string[]): Promise<Failure | null> {
  if (visibilityOf(capabilities).canManageAuto) return null;
  const found = await db().from("guest_message_outbox").select("kind").eq("organization_id", organizationId).eq("id", outboxId).maybeSingle();
  if (found.error) return { ok: false, errorKey: "failed" };
  return (found.data as { kind: string } | null)?.kind === "auto" ? { ok: false, errorKey: "forbidden" } : null;
}

function db() {
  return getSupabaseServiceClient();
}

function revalidateInbox() {
  revalidatePath("/admin/messages");
  revalidatePath("/mobile/messages");
}

/** 보낼 차례인 줄을 응답 뒤에 보낸다(발송이 꺼져 있으면 아무것도 안 함). 실패는 로그만 — 줄은 큐에 남는다. */
function kickOutbox(organizationId: string) {
  if (!isGuestMessageSendEnabled()) return;
  after(async () => {
    try {
      await runGuestOutbox(db(), organizationId);
    } catch (error) {
      console.error("[guest-messages] outbox run failed", error instanceof Error ? error.message : "unknown");
    }
  });
}

function logFailure(where: string, error: unknown) {
  console.error(`[guest-messages] ${where}`, error instanceof Error ? error.message : "unknown");
}

// ── 읽기 ─────────────────────────────────────────────────────────────────────

export type ListGuestConversationsResult = ({ ok: true } & InboxListData) | Failure;

export async function listGuestConversations(
  input: {
    status?: string | null;
    building?: string | null;
    channel?: string | null;
  } = {},
): Promise<ListGuestConversationsResult> {
  const auth = await gate(false);
  if (!auth.ok) return auth;
  const status = (INBOX_STATUS_FILTERS as readonly string[]).includes(input.status ?? "")
    ? (input.status as InboxStatusFilter)
    : "awaiting";
  const building = typeof input.building === "string" && input.building.trim() ? input.building.trim().slice(0, 120) : null;
  try {
    const data = await loadInboxList(db(), auth.organizationId, {
      status,
      building,
      channel: parseChannelFilter(input.channel),
    }, new Date(), visibilityOf(auth.capabilities));
    // 읽기에는 부작용이 없다 — 밀린 줄(429 뒤 등)은 다음 보내기 · 발송 작업 경로(/api/guest-messages/outbox)가 보낸다.
    return { ok: true, ...data };
  } catch (error) {
    logFailure("list", error);
    return { ok: false, errorKey: "failed" };
  }
}

export type GetGuestConversationResult = { ok: true; thread: InboxThread } | Failure;

export async function getGuestConversation(conversationId: string): Promise<GetGuestConversationResult> {
  const auth = await gate(false);
  if (!auth.ok) return auth;
  if (typeof conversationId !== "string" || !UUID_RE.test(conversationId)) return { ok: false, errorKey: "invalid" };
  try {
    const thread = await loadInboxThread(db(), auth.organizationId, conversationId, {
      sendEnabled: isGuestMessageSendEnabled(),
      locale: auth.locale,
      visibility: visibilityOf(auth.capabilities),
      viewerUserId: auth.userId,
    });
    if (!thread) return { ok: false, errorKey: "not_found" };
    return { ok: true, thread };
  } catch (error) {
    logFailure("thread", error);
    return { ok: false, errorKey: "failed" };
  }
}

// ── 답장 · 내부 메모 ─────────────────────────────────────────────────────────

export type SendGuestReplyResult = { ok: true; outboxId: string; duplicate: boolean; sendEnabled: boolean } | Failure;

/**
 * 답장 보내기 — 발송 큐 줄 + 대기 메시지 줄(`outbox_id` 로 이음). 같은 `idempotencyKey` 로 두 번 오면 첫 줄을 돌려준다.
 * `original` 은 번역해서 보낼 때 직원이 쓴 원문(화면 표시용 — `body_translated`, 언어는 세션 언어).
 */
export async function sendGuestReply(input: {
  conversationId: string;
  body: string;
  idempotencyKey: string;
  original?: string | null;
  /** 번역해서 보낼 때 고른 언어(미리 보기와 같은 것). 원문 그대로면 비운다. */
  bodyLang?: string | null;
}): Promise<SendGuestReplyResult> {
  const auth = await gate(true);
  if (!auth.ok) return auth;
  if (typeof input?.conversationId !== "string" || !UUID_RE.test(input.conversationId)) return { ok: false, errorKey: "invalid" };
  if (!isValidIdempotencyKey(input.idempotencyKey)) return { ok: false, errorKey: "invalid" };
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) return { ok: false, errorKey: "invalid" };
  if (Array.from(body).length > MAX_REPLY_CHARS) return { ok: false, errorKey: "too_long" };
  const original = typeof input.original === "string" && input.original.trim() ? input.original.trim().slice(0, MAX_REPLY_CHARS) : null;

  const supabase = db();
  try {
    const conversation = await loadConversationRow(supabase, auth.organizationId, input.conversationId);
    if (!conversation) return { ok: false, errorKey: "not_found" };
    const block = replyBlockReason(conversation.channel);
    if (block) return { ok: false, errorKey: block };
    // 고를 수 있는 언어만 남긴다(모르는 값은 버림 — 표시용 칸이라 거절하지 않는다).
    const bodyLang =
      original && isAllowedReplyTarget(auth.locale, normalizeGuestLanguage(conversation.guest_language), input.bodyLang)
        ? input.bodyLang
        : null;

    const sendEnabled = isGuestMessageSendEnabled();
    // 큐 줄 + 대기 메시지 줄을 DB 함수 하나로(그 사이에 발송 작업이 큐 줄만 보내는 틈이 없게). 같은 키면 첫 줄을 돌려준다.
    const enqueued = await supabase.rpc("guest_message_enqueue_reply", {
      p_organization_id: auth.organizationId,
      p_conversation_id: conversation.id,
      p_provider: conversation.provider,
      p_body: body,
      p_original: original,
      p_original_lang: original ? auth.locale : null,
      p_idempotency_key: input.idempotencyKey,
      p_user_id: auth.userId,
      p_now: new Date().toISOString(),
      p_body_lang: bodyLang,
    });
    if (enqueued.error) throw new Error(`enqueue failed: ${enqueued.error.message}`);
    const row = (Array.isArray(enqueued.data) ? enqueued.data[0] : enqueued.data) as
      { outbox_id: string; duplicate: boolean; same_body: boolean } | undefined;
    if (!row?.outbox_id) throw new Error("enqueue returned no row");
    // 같은 키인데 글이 다르다 — 화면이 고친 글에 옛 키를 썼다. 새 글을 옛 줄로 덮지 않는다.
    if (row.duplicate && !row.same_body) return { ok: false, errorKey: "stale" };
    if (row.duplicate)
      return {
        ok: true,
        outboxId: row.outbox_id,
        duplicate: true,
        sendEnabled,
      };
    const outboxId = row.outbox_id;

    kickOutbox(auth.organizationId);
    revalidateInbox();
    return { ok: true, outboxId, duplicate: false, sendEnabled };
  } catch (error) {
    logFailure("send", error);
    return { ok: false, errorKey: "failed" };
  }
}

/** 내부 메모 — 손님에게 안 보이고 상태를 바꾸지 않는다(§4-0). 직접 예약에도 쓸 수 있다. */
export async function addGuestInternalNote(input: { conversationId: string; body: string }): Promise<Ok | Failure> {
  const auth = await gate(true);
  if (!auth.ok) return auth;
  if (typeof input?.conversationId !== "string" || !UUID_RE.test(input.conversationId)) return { ok: false, errorKey: "invalid" };
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) return { ok: false, errorKey: "invalid" };
  if (Array.from(body).length > MAX_NOTE_CHARS) return { ok: false, errorKey: "too_long" };
  const supabase = db();
  try {
    const conversation = await loadConversationRow(supabase, auth.organizationId, input.conversationId);
    if (!conversation) return { ok: false, errorKey: "not_found" };
    const inserted = await supabase.from("guest_messages").insert({
      organization_id: auth.organizationId,
      conversation_id: conversation.id,
      provider: conversation.provider,
      direction: "internal",
      body,
      sent_at: new Date().toISOString(),
      author_user_id: auth.userId,
    });
    if (inserted.error) throw new Error(inserted.error.message);
    revalidateInbox();
    return { ok: true };
  } catch (error) {
    logFailure("note", error);
    return { ok: false, errorKey: "failed" };
  }
}

// ── 처리 끝 · 나중에 ─────────────────────────────────────────────────────────

async function updateConversationStatus(
  organizationId: string,
  conversationId: string,
  patch: {
    status: "awaiting" | "done" | "snoozed";
    snooze_until: string | null;
  },
): Promise<Ok | Failure> {
  if (typeof conversationId !== "string" || !UUID_RE.test(conversationId)) return { ok: false, errorKey: "invalid" };
  try {
    const updated = await db()
      .from("guest_conversations")
      .update(patch)
      .eq("organization_id", organizationId)
      .eq("id", conversationId)
      .select("id");
    if (updated.error) throw new Error(updated.error.message);
    if ((updated.data ?? []).length === 0) return { ok: false, errorKey: "not_found" };
    revalidateInbox();
    return { ok: true };
  } catch (error) {
    logFailure("status", error);
    return { ok: false, errorKey: "failed" };
  }
}

/** 「처리 끝」(done = true) · 되돌리기(done = false → 답장 기다림). */
export async function setGuestConversationDone(conversationId: string, done: boolean): Promise<Ok | Failure> {
  const auth = await gate(true);
  if (!auth.ok) return auth;
  return updateConversationStatus(auth.organizationId, conversationId, {
    status: done ? "done" : "awaiting",
    snooze_until: null,
  });
}

/** 「나중에」 — 도쿄 기준 시각까지 목록 「나중에」로. 끝나면 다시 답장 기다림(§6-1). */
export async function snoozeGuestConversation(
  conversationId: string,
  input: SnoozeInput,
): Promise<(Ok & { snoozeUntil: string }) | Failure> {
  const auth = await gate(true);
  if (!auth.ok) return auth;
  const until = input && typeof input === "object" ? resolveSnoozeUntil(input, new Date()) : null;
  if (!until) return { ok: false, errorKey: "invalid" };
  const result = await updateConversationStatus(auth.organizationId, conversationId, { status: "snoozed", snooze_until: until });
  return result.ok ? { ok: true, snoozeUntil: until } : result;
}

/** 「나중에」 풀기 — 손님 말이 답장보다 나중이면 답장 기다림, 아니면 처리 끝. */
export async function unsnoozeGuestConversation(conversationId: string): Promise<Ok | Failure> {
  const auth = await gate(true);
  if (!auth.ok) return auth;
  if (typeof conversationId !== "string" || !UUID_RE.test(conversationId)) return { ok: false, errorKey: "invalid" };
  try {
    const conversation = await loadConversationRow(db(), auth.organizationId, conversationId);
    if (!conversation) return { ok: false, errorKey: "not_found" };
    const guest = conversation.last_guest_at ? Date.parse(conversation.last_guest_at) : null;
    const reply = conversation.last_reply_at ? Date.parse(conversation.last_reply_at) : null;
    const waiting = guest !== null && (reply === null || guest > reply);
    return updateConversationStatus(auth.organizationId, conversationId, {
      status: waiting ? "awaiting" : "done",
      snooze_until: null,
    });
  } catch (error) {
    logFailure("unsnooze", error);
    return { ok: false, errorKey: "failed" };
  }
}

// ── 번역 ─────────────────────────────────────────────────────────────────────

const STAFF_DEEPL: Record<"ko" | "ja" | "en", string> = {
  ko: "KO",
  ja: "JA",
  en: "EN-US",
};

async function recordTranslationUsage(organizationId: string, feature: "guest_message" | "guest_reply", chars: number) {
  const recorded = await db().from("translation_usage").insert({ organization_id: organizationId, feature, char_count: chars });
  if (recorded.error) console.error("[guest-messages] translation usage write failed", recorded.error.code ?? "unknown");
}

export type TranslateResult = { ok: true; text: string; cached: boolean } | Failure;

/**
 * 손님 말 → 보는 사람 언어. 원문은 서버가 DB 에서 읽는다(클라이언트 글을 번역하지 않음 — 문서 25 와 같은 이유).
 * 같은 언어 번역이 있으면 그대로(크레딧 · 한도 0). 리뷰 번역과 같은 DeepL 키 · 월 한도(`createTranslationBudget({ strict })`).
 */
export async function translateGuestMessage(messageId: string, lang?: string | null): Promise<TranslateResult> {
  // 번역은 「읽기」다 — 보기 권한만으로(게스트 피드백 리뷰 번역과 같다).
  const auth = await gate(false);
  if (!auth.ok) return auth;
  if (typeof messageId !== "string" || !UUID_RE.test(messageId)) return { ok: false, errorKey: "invalid" };
  // 볼 언어 — 한국어 · 일본어 · 영어 중 하나(기본은 보는 사람 언어).
  if (lang != null && !isStaffViewLang(lang)) return { ok: false, errorKey: "invalid" };
  const viewLang = lang ?? auth.locale;
  const supabase = db();
  try {
    const found = await supabase
      .from("guest_messages")
      .select("id, direction, body, body_translated, translated_lang")
      .eq("organization_id", auth.organizationId)
      .eq("id", messageId)
      .maybeSingle();
    if (found.error) throw new Error(found.error.message);
    const message = found.data as {
      id: string;
      direction: string;
      body: string;
      body_translated: string | null;
      translated_lang: string | null;
    } | null;
    if (!message || message.direction !== "guest") return { ok: false, errorKey: "not_found" };
    // 언어별 캐시(202611130001) — 이 언어 번역이 있으면 그대로(크레딧 · 한도 0). 옛 칸(body_translated)도 같은 언어면 쓴다.
    const cached = await supabase
      .from("guest_message_translations")
      .select("body")
      .eq("organization_id", auth.organizationId)
      .eq("message_id", message.id)
      .eq("lang", viewLang)
      .maybeSingle();
    const cachedBody = (cached.data as { body: string } | null)?.body;
    if (cachedBody) return { ok: true, text: cachedBody, cached: true };
    if (message.body_translated && message.translated_lang === viewLang) {
      return { ok: true, text: message.body_translated, cached: true };
    }
    // 사진 · 링크 주소는 번역에 보내지 않는다(글 조각만, 47 §5-8). 글이 없으면(사진만) 번역할 것이 없다.
    const text = messageTextForTranslation(message.body);
    if (!text) return { ok: false, errorKey: "invalid" };
    const result = await deeplTranslate({
      text,
      targetLang: STAFF_DEEPL[viewLang],
      budget: createTranslationBudget({ strict: true }),
    });
    if (result.status !== "ok") {
      return {
        ok: false,
        errorKey: result.reason === "budget_exhausted" ? "translation_budget" : "translation_unavailable",
      };
    }
    await recordTranslationUsage(auth.organizationId, "guest_message", result.chars);
    // 없는 언어만 채운다 — 다른 언어 번역 · 이미 있는 같은 언어 번역은 덮지 않는다(보기 권한만으로도 안전).
    const saved = await supabase.from("guest_message_translations").upsert(
      {
        message_id: message.id,
        organization_id: auth.organizationId,
        lang: viewLang,
        body: result.text,
      },
      { onConflict: "message_id,lang", ignoreDuplicates: true },
    );
    if (saved.error) console.error("[guest-messages] translation cache write failed", saved.error.code ?? "unknown");
    return { ok: true, text: result.text, cached: false };
  } catch (error) {
    logFailure("translate", error);
    return { ok: false, errorKey: "translation_unavailable" };
  }
}

export type PreviewReplyTranslationResult = { ok: true; text: string; language: string } | Failure;

/**
 * 답장 → 고른 언어 미리 보기(보내기 전 확인 — §9). 기본은 손님 언어, 직원이 영어 · 일본어 · 한국어로 바꿀 수 있다.
 * 실패하면 화면이 「원문으로 보낼까요?」를 묻는다.
 */
export async function previewReplyTranslation(input: {
  conversationId: string;
  text: string;
  targetLang?: string | null;
}): Promise<PreviewReplyTranslationResult> {
  const auth = await gate(true);
  if (!auth.ok) return auth;
  if (typeof input?.conversationId !== "string" || !UUID_RE.test(input.conversationId)) return { ok: false, errorKey: "invalid" };
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) return { ok: false, errorKey: "invalid" };
  if (Array.from(text).length > MAX_REPLY_CHARS) return { ok: false, errorKey: "too_long" };
  try {
    const conversation = await loadConversationRow(db(), auth.organizationId, input.conversationId);
    if (!conversation) return { ok: false, errorKey: "not_found" };
    const guestLanguage = normalizeGuestLanguage(conversation.guest_language);
    const language = input.targetLang == null ? defaultReplyTarget(auth.locale, guestLanguage) : input.targetLang;
    if (!isAllowedReplyTarget(auth.locale, guestLanguage, language)) return { ok: false, errorKey: "translation_unavailable" };
    const target = deeplTargetFor(language);
    if (!target) return { ok: false, errorKey: "translation_unavailable" };
    const result = await deeplTranslate({
      text,
      targetLang: target,
      sourceLang: STAFF_DEEPL[auth.locale].slice(0, 2),
      budget: createTranslationBudget({ strict: true }),
    });
    if (result.status !== "ok") {
      return {
        ok: false,
        errorKey: result.reason === "budget_exhausted" ? "translation_budget" : "translation_unavailable",
      };
    }
    await recordTranslationUsage(auth.organizationId, "guest_reply", result.chars);
    return { ok: true, text: result.text, language };
  } catch (error) {
    logFailure("preview translate", error);
    return { ok: false, errorKey: "translation_unavailable" };
  }
}

// ── 발송 큐 고치기 · 취소 · 다시 보내기 ──────────────────────────────────────

function validOutboxId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** 보낼 차례 기다리는 답장 고치기(아직 잡히지 않은 `queued` 만). */
export async function editGuestOutbox(outboxId: string, body: string): Promise<Ok | Failure> {
  const auth = await gate(true);
  if (!auth.ok) return auth;
  if (!validOutboxId(outboxId)) return { ok: false, errorKey: "invalid" };
  const autoGuard = await guardAutoOutbox(auth.organizationId, outboxId, auth.capabilities);
  if (autoGuard) return autoGuard;
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) return { ok: false, errorKey: "invalid" };
  if (Array.from(text).length > MAX_REPLY_CHARS) return { ok: false, errorKey: "too_long" };
  const supabase = db();
  try {
    const updated = await supabase
      .from("guest_message_outbox")
      .update({ body: text })
      .eq("organization_id", auth.organizationId)
      .eq("id", outboxId)
      .eq("status", "queued")
      .select("id");
    if (updated.error) throw new Error(updated.error.message);
    if ((updated.data ?? []).length === 0) return { ok: false, errorKey: "stale" };
    // 고친 글은 번역 원문과 더는 맞지 않는다 — 원문 표시는 지운다.
    const message = await supabase
      .from("guest_messages")
      .update({ body: text, body_translated: null, translated_lang: null })
      .eq("organization_id", auth.organizationId)
      .eq("outbox_id", outboxId);
    if (message.error) throw new Error(message.error.message);
    revalidateInbox();
    return { ok: true };
  } catch (error) {
    logFailure("edit outbox", error);
    return { ok: false, errorKey: "failed" };
  }
}

/** 보내기 취소 — 기다리는 줄 · 보내지 못한 줄만(나갔을 수도 있는 줄은 안 됨). 나가지 않은 대기 메시지 줄은 지운다(하드 삭제). */
export async function cancelGuestOutbox(outboxId: string): Promise<Ok | Failure> {
  const auth = await gate(true);
  if (!auth.ok) return auth;
  if (!validOutboxId(outboxId)) return { ok: false, errorKey: "invalid" };
  const autoGuard = await guardAutoOutbox(auth.organizationId, outboxId, auth.capabilities);
  if (autoGuard) return autoGuard;
  const supabase = db();
  try {
    const updated = await supabase
      .from("guest_message_outbox")
      .update({ status: "cancelled" })
      .eq("organization_id", auth.organizationId)
      .eq("id", outboxId)
      .in("status", ["queued", "failed"])
      .select("id");
    if (updated.error) throw new Error(updated.error.message);
    if ((updated.data ?? []).length === 0) return { ok: false, errorKey: "stale" };
    const removed = await supabase
      .from("guest_messages")
      .delete()
      .eq("organization_id", auth.organizationId)
      .eq("outbox_id", outboxId)
      .is("external_id", null);
    if (removed.error) throw new Error(removed.error.message);
    revalidateInbox();
    return { ok: true };
  } catch (error) {
    logFailure("cancel outbox", error);
    return { ok: false, errorKey: "failed" };
  }
}

/**
 * 다시 보내기 — 보내지 못한 줄(직접 예약 · 채널 모름 제외)과 「나갔는지 모름」 줄. 모름은 손님에게 두 번 갈 수 있어서
 * 화면이 먼저 확인을 받고 `confirmUncertain: true` 로 부른다.
 */
export async function retryGuestOutbox(outboxId: string, options: { confirmUncertain?: boolean } = {}): Promise<Ok | Failure> {
  const auth = await gate(true);
  if (!auth.ok) return auth;
  if (!validOutboxId(outboxId)) return { ok: false, errorKey: "invalid" };
  const autoGuard = await guardAutoOutbox(auth.organizationId, outboxId, auth.capabilities);
  if (autoGuard) return autoGuard;
  const supabase = db();
  try {
    const found = await supabase
      .from("guest_message_outbox")
      .select("id, status, error_code")
      .eq("organization_id", auth.organizationId)
      .eq("id", outboxId)
      .maybeSingle();
    if (found.error) throw new Error(found.error.message);
    const row = found.data as {
      id: string;
      status: "failed" | "uncertain" | "queued" | "sending" | "sent" | "cancelled";
      error_code: string | null;
    } | null;
    if (!row) return { ok: false, errorKey: "not_found" };
    if (!isRetryableOutbox(row.status, row.error_code)) return { ok: false, errorKey: "stale" };
    if (row.status === "uncertain" && options.confirmUncertain !== true) return { ok: false, errorKey: "invalid" };
    const updated = await supabase
      .from("guest_message_outbox")
      .update({
        status: "queued",
        next_try_at: new Date().toISOString(),
        error_code: null,
      })
      .eq("organization_id", auth.organizationId)
      .eq("id", outboxId)
      .eq("status", row.status)
      .select("id");
    if (updated.error) throw new Error(updated.error.message);
    if ((updated.data ?? []).length === 0) return { ok: false, errorKey: "stale" };
    kickOutbox(auth.organizationId);
    revalidateInbox();
    return { ok: true };
  } catch (error) {
    logFailure("retry outbox", error);
    return { ok: false, errorKey: "failed" };
  }
}
