"use server";

/**
 * PC `/admin/messages` 「설정」 · 「정해 둔 문구」 탭만 부르는 액션(모바일은 이 탭이 없다 — 그래서 `src/actions` 가 아니라 여기).
 * docs/product/47-guest-messaging.md §6-1 · §6-2 · §6-3
 *
 * - 권한: 관리자 웹(`getAdminSessionForApi`) + `guest_messages.manage`. 아니면 redirect 없이 `forbidden`.
 * - 쓰기는 service_role, 조직은 세션에서(클라이언트 값 안 씀). 값 검사는 순수 모듈(`settings-model` · `saved-reply-model`).
 */

import { revalidatePath } from "next/cache";
import { getAdminSessionForApi } from "@/lib/admin-session";
import { validateGuestMessageSettingsInput, type SettingsField } from "@/lib/guest-messages/settings-model";
import { validateSavedReplyInput } from "@/lib/guest-messages/saved-reply-model";
import {
  createSavedReply,
  deleteSavedReply,
  reorderSavedReplies,
  setResolvedSavedReply,
  updateSavedReply,
  type SavedReply,
} from "@/lib/guest-messages/saved-replies-server";
import { UUID_RE } from "@/lib/guest-messages/inbox-model";
import { hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/types/database";

type Gate = { ok: true; organizationId: string; userId: string } | { ok: false; errorKey: "forbidden" };

async function manageGate(): Promise<Gate> {
  const auth = await getAdminSessionForApi().catch(() => null);
  if (!auth?.ok || !hasOrganizationContext(auth.session)) return { ok: false, errorKey: "forbidden" };
  if (!auth.session.capabilities.includes("guest_messages.manage")) return { ok: false, errorKey: "forbidden" };
  return { ok: true, organizationId: auth.session.organization.id, userId: auth.session.user.id };
}

function revalidate() {
  revalidatePath("/admin/messages");
  revalidatePath("/mobile/messages");
}

// ── 응답 목표 · 크레딧 선 · 멈춤 기준 ────────────────────────────────────────

export type SaveSettingsResult = { ok: true } | { ok: false; errorKey: "forbidden" | "invalid" | "failed"; field?: SettingsField | null };

export async function saveGuestMessageSettings(input: unknown): Promise<SaveSettingsResult> {
  const access = await manageGate();
  if (!access.ok) return access;
  const checked = validateGuestMessageSettingsInput(input);
  if (!checked.ok) return { ok: false, errorKey: "invalid", field: checked.field };
  const db = getSupabaseServiceClient();
  try {
    // DB 함수 한 번 — settings 는 응답 목표 키만 바꾼다(그 사이 「지금 확인하기」 · 번역 언어가 쓴 키를 덮지 않게).
    const saved = await db.rpc("guest_message_save_settings", {
      p_organization_id: access.organizationId,
      p_response_targets: checked.value.responseTargetMinutes as unknown as Json,
      p_night_pause: checked.value.nightPause,
      p_credit_reserve: checked.value.creditReserve,
      p_stall_hours: checked.value.stallHours,
    });
    if (saved.error) throw new Error(saved.error.message);
    revalidate();
    return { ok: true };
  } catch (error) {
    console.error("[guest-messages] settings save failed", error instanceof Error ? error.message : "unknown");
    return { ok: false, errorKey: "failed" };
  }
}

// ── 정해 둔 문구 ─────────────────────────────────────────────────────────────

export type SavedReplyActionResult =
  | { ok: true; reply: SavedReply }
  | { ok: false; errorKey: "conflict"; current: SavedReply }
  | { ok: false; errorKey: "forbidden" | "invalid" | "too_long" | "empty" | "not_found" | "limit" | "failed" };

export async function saveSavedReplyAction(input: {
  id?: string | null;
  title: string;
  bodies: unknown;
  /** 고칠 때만 — 화면이 본 버전. */
  expectedUpdatedAt?: string | null;
}): Promise<SavedReplyActionResult> {
  const access = await manageGate();
  if (!access.ok) return access;
  const id = input?.id ?? null;
  if (id !== null && (typeof id !== "string" || !UUID_RE.test(id))) return { ok: false, errorKey: "invalid" };
  const expected = input?.expectedUpdatedAt ?? null;
  if (id !== null && (typeof expected !== "string" || Number.isNaN(Date.parse(expected)) || expected.length > 64)) {
    return { ok: false, errorKey: "invalid" };
  }
  const checked = validateSavedReplyInput(input);
  if (!checked.ok) return { ok: false, errorKey: checked.error === "invalid_input" ? "invalid" : checked.error };
  const db = getSupabaseServiceClient();
  try {
    const result = id
      ? await updateSavedReply(db, access.organizationId, id, checked.value, expected as string)
      : await createSavedReply(db, access.organizationId, access.userId, checked.value);
    if (!result.ok) {
      if (result.error === "conflict") return { ok: false, errorKey: "conflict", current: result.current };
      return { ok: false, errorKey: result.error === "save_failed" ? "failed" : result.error };
    }
    revalidate();
    return result;
  } catch (error) {
    console.error("[guest-messages] saved reply save failed", error instanceof Error ? error.message : "unknown");
    return { ok: false, errorKey: "failed" };
  }
}

export async function deleteSavedReplyAction(id: string): Promise<{ ok: true } | { ok: false; errorKey: "forbidden" | "invalid" | "not_found" | "failed" }> {
  const access = await manageGate();
  if (!access.ok) return access;
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, errorKey: "invalid" };
  try {
    const result = await deleteSavedReply(getSupabaseServiceClient(), access.organizationId, id);
    if (!result.ok) return { ok: false, errorKey: result.notFound ? "not_found" : "failed" };
    revalidate();
    return { ok: true };
  } catch (error) {
    console.error("[guest-messages] saved reply delete failed", error instanceof Error ? error.message : "unknown");
    return { ok: false, errorKey: "failed" };
  }
}

export async function reorderSavedRepliesAction(ids: unknown): Promise<{ ok: true } | { ok: false; errorKey: "forbidden" | "invalid" | "failed" }> {
  const access = await manageGate();
  if (!access.ok) return access;
  if (!Array.isArray(ids) || ids.length > 200 || !ids.every((id) => typeof id === "string" && UUID_RE.test(id))) {
    return { ok: false, errorKey: "invalid" };
  }
  try {
    const done = await reorderSavedReplies(getSupabaseServiceClient(), access.organizationId, ids as string[]);
    if (!done) return { ok: false, errorKey: "failed" };
    revalidate();
    return { ok: true };
  } catch (error) {
    console.error("[guest-messages] saved reply reorder failed", error instanceof Error ? error.message : "unknown");
    return { ok: false, errorKey: "failed" };
  }
}

/** 「해결 초안」으로 쓸 문구 정하기 · 풀기(6단계). `null` = 풀기. 초안은 답장 칸에 띄울 뿐 보내지 않는다. */
export async function setResolvedSavedReplyAction(
  id: string | null,
): Promise<{ ok: true } | { ok: false; errorKey: "forbidden" | "invalid" | "not_found" | "failed" }> {
  const access = await manageGate();
  if (!access.ok) return access;
  if (id !== null && (typeof id !== "string" || !UUID_RE.test(id))) return { ok: false, errorKey: "invalid" };
  try {
    const result = await setResolvedSavedReply(getSupabaseServiceClient(), access.organizationId, id);
    if (!result.ok) return { ok: false, errorKey: result.error === "not_found" ? "not_found" : "failed" };
    revalidate();
    return { ok: true };
  } catch (error) {
    console.error("[guest-messages] resolved reply mark failed", error instanceof Error ? error.message : "unknown");
    return { ok: false, errorKey: "failed" };
  }
}
