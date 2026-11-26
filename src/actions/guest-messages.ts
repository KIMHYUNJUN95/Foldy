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
import {
  loadConversationRow,
  loadDonePage,
  loadInboxList,
  loadInboxRowsByIds,
  type InboxDonePage,
  loadInboxThread,
  searchInbox,
  type InboxRowsResult,
  type InboxSearchResult,
  countAwaitingOrNull,
} from "@/lib/guest-messages/inbox-server";
import { normalizeSearchQuery } from "@/lib/guest-messages/inbox-search";
import { parseDoneCursor, type DoneCursor } from "@/lib/guest-messages/inbox-paging";
import { isGuestMessageSendEnabled, runGuestOutbox } from "@/lib/guest-messages/outbox-runner";
import { createTranslationBudget, deeplTranslate } from "@/lib/review-translate";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { messageTextForTranslation } from "@/lib/guest-messages/message-body";
import { ASSIST_PLACEHOLDER_LABELS, hasUnfilledPlaceholder } from "@/lib/guest-messages/ai-assist-model";
import { attachReplyToPairs, draftPlaceholdersFor, recordAssistSent } from "@/lib/guest-messages/ai-assist-server";
import { hasVoyageKey } from "@/lib/guest-messages/ai-config";

const ALL_ASSIST_PLACEHOLDERS = Object.values(ASSIST_PLACEHOLDER_LABELS).flatMap((labels) => Object.values(labels));

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
  | "translation_budget"
  /** AI 초안의 채우지 않은 자리 표시(「[출입 비밀번호]」 등)가 남은 채 보내려 함 — 49 §4. */
  | "assist_placeholder";

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

/*
 * 이 파일의 쓰기(답장 · 메모 · 처리 끝 · 나중에 · 다시 보내기)는 `revalidatePath` 를 부르지 않는다(2026-11-20, 47 §5-9).
 * 부르면 응답에 페이지 전체가 실리고(PC 28kB) 브라우저 라우터 캐시가 비워져 메뉴 링크 미리 받기가 전부 다시 나갔다.
 * 화면이 쓰기 뒤 스스로 고친다 — 대화는 `useThread` 다시 읽기, 목록 줄은 `applyIds`. 캐시에서 되살아난 목록 · 대화는
 * 이 창에서 쓴 뒤면 나타날 때 다시 읽는다(`write-freshness`). 메뉴 숫자는 읽기 액션의 `navAwaitingCount`(`nav-badge-overrides`).
 */

/** 메뉴 숫자 — 레이아웃과 같은 세기(`countAwaitingOrNull`). 못 세면 싣지 않는다(화면이 메뉴 숫자를 덮지 않게). */
export type NavAwaitingCount = { navAwaitingCount?: number };

async function withNavCount<T extends object>(organizationId: string, work: Promise<T>): Promise<T & NavAwaitingCount> {
  const [result, navAwaitingCount] = await Promise.all([work, countAwaitingOrNull(db(), organizationId)]);
  return navAwaitingCount === null ? result : { ...result, navAwaitingCount };
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

export type ListGuestConversationsResult = ({ ok: true } & InboxListData & NavAwaitingCount) | Failure;

function parseStatusFilter(raw: unknown): InboxStatusFilter {
  return typeof raw === "string" && (INBOX_STATUS_FILTERS as readonly string[]).includes(raw) ? (raw as InboxStatusFilter) : "all";
}

function parseBuilding(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 120) : null;
}

/** 화면이 보낸 처리 끝 커서 — 없으면(undefined · null) null, 모양이 틀리면 `false`(그때 `invalid`). */
function optionalCursor(raw: unknown): DoneCursor | null | false {
  if (raw === undefined || raw === null) return null;
  return parseDoneCursor(raw) ?? false;
}

export async function listGuestConversations(
  input: {
    status?: string | null;
    building?: string | null;
    channel?: string | null;
    /** 따라잡기 — 이미 펼친 처리 끝의 끝(커서). 그 범위까지 다시 채운다(2026-11-26). */
    doneUntil?: string | null;
  } = {},
): Promise<ListGuestConversationsResult> {
  const auth = await gate(false);
  if (!auth.ok) return auth;
  const doneUntil = optionalCursor(input.doneUntil);
  if (doneUntil === false) return { ok: false, errorKey: "invalid" };
  try {
    const data = await withNavCount(
      auth.organizationId,
      loadInboxList(
        db(),
        auth.organizationId,
        { status: parseStatusFilter(input.status), building: parseBuilding(input.building), channel: parseChannelFilter(input.channel) },
        new Date(),
        visibilityOf(auth.capabilities),
        { doneUntil },
      ),
    );
    // 읽기에는 부작용이 없다 — 밀린 줄(429 뒤 등)은 다음 보내기 · 발송 작업 경로(/api/guest-messages/outbox)가 보낸다.
    return { ok: true, ...data };
  } catch (error) {
    logFailure("list", error);
    return { ok: false, errorKey: "failed" };
  }
}

export type ListMoreGuestConversationsResult = ({ ok: true } & InboxDonePage) | Failure;

/**
 * 처리 끝 다음 묶음(무한 스크롤, 47 §5 · §6-1, 2026-11-26) — 권한 · 조직 · 코드 가리기는 목록 읽기와 같다(`guest_messages.view`, 조직은 세션).
 * 커서는 화면이 받은 마지막 처리 끝 줄의 열쇠 — 모양(시각 · uuid)을 확인하고, 읽기는 언제나 세션 조직 안에서만.
 */
export async function listMoreGuestConversations(input: {
  status?: string | null;
  building?: string | null;
  channel?: string | null;
  cursor: string;
}): Promise<ListMoreGuestConversationsResult> {
  const auth = await gate(false);
  if (!auth.ok) return auth;
  const cursor = parseDoneCursor(input?.cursor);
  if (!cursor) return { ok: false, errorKey: "invalid" };
  try {
    const page = await loadDonePage(
      db(),
      auth.organizationId,
      { status: parseStatusFilter(input.status), building: parseBuilding(input.building), channel: parseChannelFilter(input.channel) },
      cursor,
      new Date(),
      visibilityOf(auth.capabilities),
    );
    return { ok: true, ...page };
  } catch (error) {
    logFailure("list more", error);
    return { ok: false, errorKey: "failed" };
  }
}

/** 실시간 줄 다시 읽기 한 번에 받는 대화 수 상한 — 넘는 신호는 화면이 목록 전체 다시 읽기로 바꾼다(`LIVE_CHANGE_MAX_KEYS`). */
const LIVE_ROWS_LIMIT = 50;

export type GetGuestConversationRowsResult = ({ ok: true } & InboxRowsResult & NavAwaitingCount) | Failure;

/**
 * 실시간 — 신호가 온 대화 몇 개만 목록 줄로 다시 읽는다(47 §5-9). 권한 · 조직은 목록 읽기와 같다(`guest_messages.view`, 조직은 세션).
 * id 는 신호에서 온 힌트일 뿐이라 조직 밖 id 는 `missing` 으로만 돌아온다.
 * `doneHasMore`(+ `doneCursor`)가 오면 화면이 받은 처리 끝 범위로 창을 판정한다(더 불러온 줄도 실시간으로 고쳐지게).
 */
export async function getGuestConversationRows(input: {
  ids: readonly string[];
  status?: string | null;
  building?: string | null;
  channel?: string | null;
  doneCursor?: string | null;
  doneHasMore?: boolean;
}): Promise<GetGuestConversationRowsResult> {
  const auth = await gate(false);
  if (!auth.ok) return auth;
  const ids = Array.isArray(input?.ids) ? [...new Set(input.ids)] : [];
  if (ids.length === 0 || ids.length > LIVE_ROWS_LIMIT || !ids.every((id) => typeof id === "string" && UUID_RE.test(id))) {
    return { ok: false, errorKey: "invalid" };
  }
  const doneCursor = optionalCursor(input.doneCursor);
  if (doneCursor === false) return { ok: false, errorKey: "invalid" };
  const doneWindow = typeof input.doneHasMore === "boolean" ? { cursor: doneCursor, hasMore: input.doneHasMore } : null;
  try {
    const result = await withNavCount(
      auth.organizationId,
      loadInboxRowsByIds(
        db(),
        auth.organizationId,
        ids.map((id) => id.toLowerCase()),
        { status: parseStatusFilter(input.status), building: parseBuilding(input.building), channel: parseChannelFilter(input.channel) },
        new Date(),
        visibilityOf(auth.capabilities),
        doneWindow,
      ),
    );
    return { ok: true, ...result };
  } catch (error) {
    logFailure("live rows", error);
    return { ok: false, errorKey: "failed" };
  }
}

export type SearchGuestConversationsResult = ({ ok: true; query: string } & InboxSearchResult) | Failure;

/** 검색 — 그 조직의 대화 전체(목록 창 밖 포함). 상태 탭은 보지 않고(전체 상태) 건물 · 채널 필터는 그대로 건다. 47 §5-10. */
export async function searchGuestConversations(input: {
  query: string;
  building?: string | null;
  channel?: string | null;
}): Promise<SearchGuestConversationsResult> {
  const auth = await gate(false);
  if (!auth.ok) return auth;
  const query = normalizeSearchQuery(input?.query);
  if (!query) return { ok: false, errorKey: "invalid" };
  const building = typeof input?.building === "string" && input.building.trim() ? input.building.trim().slice(0, 120) : null;
  try {
    const result = await searchInbox(
      db(),
      auth.organizationId,
      query,
      { building, channel: parseChannelFilter(input?.channel) },
      new Date(),
      visibilityOf(auth.capabilities),
    );
    return { ok: true, query, ...result };
  } catch (error) {
    logFailure("search", error);
    return { ok: false, errorKey: "failed" };
  }
}

export type GetGuestConversationResult = ({ ok: true; thread: InboxThread } & NavAwaitingCount) | Failure;

export async function getGuestConversation(conversationId: string): Promise<GetGuestConversationResult> {
  const auth = await gate(false);
  if (!auth.ok) return auth;
  if (typeof conversationId !== "string" || !UUID_RE.test(conversationId)) return { ok: false, errorKey: "invalid" };
  try {
    // 메뉴 숫자도 같이 — 대화 화면에서 처리 끝 · 나중에 · 답장 뒤 다시 읽을 때 탭바 · 서랍 · 레일 숫자를 고친다(47 §5-9).
    const { thread, navAwaitingCount } = await withNavCount(
      auth.organizationId,
      loadInboxThread(db(), auth.organizationId, conversationId, {
        sendEnabled: isGuestMessageSendEnabled(),
        locale: auth.locale,
        visibility: visibilityOf(auth.capabilities),
        viewerUserId: auth.userId,
      }).then((thread) => ({ thread })),
    );
    if (!thread) return { ok: false, errorKey: "not_found" };
    return navAwaitingCount === undefined ? { ok: true, thread } : { ok: true, thread, navAwaitingCount };
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
  /** AI 초안(`draftGuestReply` 의 `draftId`)에서 시작한 답장 — 자리 표시 검사 · 「그대로 / 고쳐 보냄」 기록(49 §8). */
  assistDraftId?: string | null;
}): Promise<SendGuestReplyResult> {
  const auth = await gate(true);
  if (!auth.ok) return auth;
  if (typeof input?.conversationId !== "string" || !UUID_RE.test(input.conversationId)) return { ok: false, errorKey: "invalid" };
  if (!isValidIdempotencyKey(input.idempotencyKey)) return { ok: false, errorKey: "invalid" };
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) return { ok: false, errorKey: "invalid" };
  if (Array.from(body).length > MAX_REPLY_CHARS) return { ok: false, errorKey: "too_long" };
  const original = typeof input.original === "string" && input.original.trim() ? input.original.trim().slice(0, MAX_REPLY_CHARS) : null;
  const assistDraftId = typeof input.assistDraftId === "string" && UUID_RE.test(input.assistDraftId) ? input.assistDraftId : null;

  const supabase = db();
  try {
    const conversation = await loadConversationRow(supabase, auth.organizationId, input.conversationId);
    if (!conversation) return { ok: false, errorKey: "not_found" };
    const block = replyBlockReason(conversation.channel);
    if (block) return { ok: false, errorKey: block };
    // 초안 id 가 없어도 늘 본다 — 다시 만들기가 실패해 옛 초안이 답장 칸에 남은 채 보내는 경우도 막는다.
    // 직원 원문(original)과 손님에게 갈 글(body) 둘 다. 세 언어 자리 표시 전부 + 날것 토큰 + (있으면) 그 초안의 자리 표시.
    const draftPlaceholders = assistDraftId ? ((await draftPlaceholdersFor(supabase, auth.organizationId, assistDraftId)) ?? []) : [];
    const placeholders = [...draftPlaceholders, ...ALL_ASSIST_PLACEHOLDERS];
    if (hasUnfilledPlaceholder(body, placeholders) || (original !== null && hasUnfilledPlaceholder(original, placeholders)))
      return { ok: false, errorKey: "assist_placeholder" };
    // 고를 수 있는 언어만 남긴다(모르는 값은 버림 — 표시용 칸이라 거절하지 않는다).
    const bodyLang =
      original && isAllowedReplyTarget(auth.locale, normalizeGuestLanguage(conversation.guest_language), input.bodyLang)
        ? input.bodyLang
        : null;

    const sendEnabled = isGuestMessageSendEnabled();
    const sentAt = new Date();
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
      p_now: sentAt.toISOString(),
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

    // 도우미를 쓰는 조직에서만(키 있음) — 초안 결과 기록 · 질문 줄에 이번 답 붙이기. 실패는 삼킨다.
    if (assistDraftId || hasVoyageKey()) {
      after(async () => {
        if (assistDraftId)
          await recordAssistSent(supabase, {
            organizationId: auth.organizationId,
            userId: auth.userId,
            conversationId: conversation.id,
            draftId: assistDraftId,
            sentText: original ?? body,
          });
        await attachReplyToPairs(supabase, auth.organizationId, conversation, body, sentAt);
      });
    }
    kickOutbox(auth.organizationId);
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

// ── 발송 큐 다시 보내기 ──────────────────────────────────────

function validOutboxId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
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
    return { ok: true };
  } catch (error) {
    logFailure("retry outbox", error);
    return { ok: false, errorKey: "failed" };
  }
}
