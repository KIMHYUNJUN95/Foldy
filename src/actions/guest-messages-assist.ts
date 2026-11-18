"use server";

/**
 * AI 답장 도우미 액션 — PC `/admin/messages` · 모바일 `/mobile/messages` 공용. docs/product/49-guest-message-ai-reply-assist.md §8
 *
 * - 권한: `guest_messages.view` **와** `guest_messages.reply`(답장을 쓸 수 있는 사람만). 거부는 redirect 없이 `forbidden`.
 * - 조직 id 는 세션에서만. service_role + 조직 필터 명시(`ai-assist-server.ts`).
 * - 화면에 던지지 않는다 — 실패는 결과 모양으로(개요는 `unavailable` 로 줄을 숨긴다).
 */

import type { Capability } from "@/config/capabilities";
import { buildAssistDraft, buildAssistOverview, recordAssistFeedback } from "@/lib/guest-messages/ai-assist-server";
import {
  ASSIST_WRONG_REASONS,
  type AssistDraftResult,
  type AssistOverview,
  type AssistWrongReason,
} from "@/lib/guest-messages/ai-assist-types";
import { UUID_RE } from "@/lib/guest-messages/inbox-model";
import { loadConversationRow } from "@/lib/guest-messages/inbox-server";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

type Gate =
  | { ok: true; organizationId: string; userId: string; lang: "ko" | "ja" | "en"; canSeeCodes: boolean }
  | { ok: false };

const NEEDED: Capability[] = ["guest_messages.view", "guest_messages.reply"];

async function gate(): Promise<Gate> {
  const session = await getCurrentAppSession().catch(() => null);
  if (!session || !hasOrganizationContext(session)) return { ok: false };
  if (!NEEDED.every((key) => session.capabilities.includes(key))) return { ok: false };
  return {
    ok: true,
    organizationId: session.organization.id,
    userId: session.user.id,
    lang: session.user.preferredLanguage,
    // 답장 칸 넣기 목록과 같은 기준(직원용 출입 코드 보기).
    canSeeCodes: session.capabilities.includes("guest_messages.manage") || session.capabilities.includes("property_info.edit"),
  };
}

function logFailure(scope: string, error: unknown) {
  console.error(`[guest-ai] ${scope} failed`, error instanceof Error ? error.message : "unknown");
}

/** 대화를 열 때 — 정해 둔 문구 추천 · 비슷한 과거 대화 · 한도. 무엇이든 실패하면 `unavailable`(줄 숨김). */
export async function getReplyAssist(conversationId: string): Promise<AssistOverview> {
  const auth = await gate();
  if (!auth.ok) return { kind: "unavailable" };
  if (typeof conversationId !== "string" || !UUID_RE.test(conversationId)) return { kind: "unavailable" };
  const db = getSupabaseServiceClient();
  try {
    const conversation = await loadConversationRow(db, auth.organizationId, conversationId);
    if (!conversation) return { kind: "unavailable" };
    return await buildAssistOverview(db, auth.organizationId, conversation);
  } catch (error) {
    logFailure("overview", error);
    return { kind: "unavailable" };
  }
}

/** 「초안 만들기」 — 보는 직원 언어 초안(번역은 기존 흐름). */
export async function draftGuestReply(conversationId: string): Promise<AssistDraftResult> {
  const auth = await gate();
  if (!auth.ok) return { ok: false, errorKey: "forbidden" };
  if (typeof conversationId !== "string" || !UUID_RE.test(conversationId)) return { ok: false, errorKey: "invalid" };
  const db = getSupabaseServiceClient();
  try {
    const conversation = await loadConversationRow(db, auth.organizationId, conversationId);
    if (!conversation) return { ok: false, errorKey: "not_found" };
    return await buildAssistDraft(db, auth.organizationId, conversation, {
      userId: auth.userId,
      lang: auth.lang,
      canSeeCodes: auth.canSeeCodes,
    });
  } catch (error) {
    logFailure("draft", error);
    return { ok: false, errorKey: "failed" };
  }
}

export type AssistFeedbackResult = { ok: true } | { ok: false; errorKey: "forbidden" | "invalid" | "not_found" | "failed" };

async function feedback(draftId: unknown, kind: "wrong" | "discarded", reason: AssistWrongReason | null): Promise<AssistFeedbackResult> {
  const auth = await gate();
  if (!auth.ok) return { ok: false, errorKey: "forbidden" };
  if (typeof draftId !== "string" || !UUID_RE.test(draftId)) return { ok: false, errorKey: "invalid" };
  if (kind === "wrong" && !reason) return { ok: false, errorKey: "invalid" };
  try {
    const result = await recordAssistFeedback(getSupabaseServiceClient(), auth.organizationId, auth.userId, draftId, kind, reason);
    return result === "ok" ? { ok: true } : { ok: false, errorKey: result };
  } catch (error) {
    logFailure(kind, error);
    return { ok: false, errorKey: "failed" };
  }
}

/** 「틀렸어요」 — 이유 하나(사실 · 말투 · 빠짐 · 기타). 같은 초안에 여러 번 눌러도 된다. */
export async function markAssistWrong(input: { draftId: string; reason: AssistWrongReason }): Promise<AssistFeedbackResult> {
  const reason = (ASSIST_WRONG_REASONS as readonly string[]).includes(input?.reason) ? input.reason : null;
  return feedback(input?.draftId, "wrong", reason);
}

/** 초안을 버림(닫기 · 지우기) — 한 초안에 한 번만 남는다(두 번째는 조용히 무시). */
export async function markAssistDiscarded(draftId: string): Promise<AssistFeedbackResult> {
  return feedback(draftId, "discarded", null);
}
