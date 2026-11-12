/**
 * 정해 둔 문구 — 읽기 · 쓰기(서버 전용, service_role + 조직 필터 명시). docs/product/47-guest-messaging.md §6-3
 * 권한은 부르는 쪽이 본다(읽기 = 메시지 보기, 쓰기 = `guest_messages.manage`).
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Localized } from "@/lib/guest-messages/guest-info-model";
import { SAVED_REPLY_LIMITS, type SavedReplyInput } from "@/lib/guest-messages/saved-reply-model";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type SavedReply = {
  id: string;
  title: string;
  bodies: Localized;
  sortOrder: number;
  updatedAt: string;
};

type Row = {
  id: string;
  title: string;
  body_ko: string;
  body_ja: string;
  body_en: string;
  sort_order: number;
  updated_at: string;
};

const COLUMNS = "id, title, body_ko, body_ja, body_en, sort_order, updated_at";

function toReply(row: Row): SavedReply {
  return {
    id: row.id,
    title: row.title,
    bodies: { ko: row.body_ko ?? "", ja: row.body_ja ?? "", en: row.body_en ?? "" },
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
  };
}

export async function loadSavedReplies(db: Client, organizationId: string): Promise<SavedReply[]> {
  const { data, error } = await db
    .from("guest_message_saved_replies")
    .select(COLUMNS)
    .eq("organization_id", organizationId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(SAVED_REPLY_LIMITS.count);
  if (error) throw new Error(`saved replies read failed: ${error.code ?? error.message}`);
  return ((data ?? []) as Row[]).map(toReply);
}

export type SavedReplyWriteResult =
  | { ok: true; reply: SavedReply }
  | { ok: false; error: "conflict"; current: SavedReply }
  | { ok: false; error: "not_found" | "limit" | "save_failed" };

export async function createSavedReply(
  db: Client,
  organizationId: string,
  userId: string,
  input: SavedReplyInput,
): Promise<SavedReplyWriteResult> {
  const existing = await db
    .from("guest_message_saved_replies")
    .select("sort_order", { count: "exact" })
    .eq("organization_id", organizationId)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (existing.error) return { ok: false, error: "save_failed" };
  if ((existing.count ?? 0) >= SAVED_REPLY_LIMITS.count) return { ok: false, error: "limit" };
  const top = ((existing.data ?? []) as Array<{ sort_order: number }>)[0]?.sort_order ?? -10;
  const inserted = await db
    .from("guest_message_saved_replies")
    .insert({
      organization_id: organizationId,
      title: input.title,
      body_ko: input.bodies.ko,
      body_ja: input.bodies.ja,
      body_en: input.bodies.en,
      sort_order: Math.min(100000, top + 10),
      created_by: userId,
    })
    .select(COLUMNS)
    .single();
  if (inserted.error || !inserted.data) {
    console.error("[saved-replies] insert failed", { code: inserted.error?.code });
    return { ok: false, error: "save_failed" };
  }
  return { ok: true, reply: toReply(inserted.data as Row) };
}

export async function updateSavedReply(
  db: Client,
  organizationId: string,
  id: string,
  input: SavedReplyInput,
  /** 화면이 본 버전 — 그 사이 다른 사람이 고쳤으면 충돌 + 최신 값(덮지 않음). */
  expectedUpdatedAt: string,
): Promise<SavedReplyWriteResult> {
  const updated = await db
    .from("guest_message_saved_replies")
    .update({ title: input.title, body_ko: input.bodies.ko, body_ja: input.bodies.ja, body_en: input.bodies.en })
    .eq("organization_id", organizationId)
    .eq("id", id)
    .eq("updated_at", expectedUpdatedAt)
    .select(COLUMNS)
    .maybeSingle();
  if (updated.error) {
    console.error("[saved-replies] update failed", { code: updated.error.code });
    return { ok: false, error: "save_failed" };
  }
  if (updated.data) return { ok: true, reply: toReply(updated.data as Row) };
  const current = await db.from("guest_message_saved_replies").select(COLUMNS).eq("organization_id", organizationId).eq("id", id).maybeSingle();
  if (current.error) return { ok: false, error: "save_failed" };
  return current.data ? { ok: false, error: "conflict", current: toReply(current.data as Row) } : { ok: false, error: "not_found" };
}

/** 지우기 — 기본 삭제 정책대로 하드 삭제(CLAUDE.md 9). 화면이 확인을 받는다. */
export async function deleteSavedReply(db: Client, organizationId: string, id: string): Promise<{ ok: boolean; notFound?: boolean }> {
  const removed = await db.from("guest_message_saved_replies").delete().eq("organization_id", organizationId).eq("id", id).select("id");
  if (removed.error) {
    console.error("[saved-replies] delete failed", { code: removed.error.code });
    return { ok: false };
  }
  return (removed.data ?? []).length > 0 ? { ok: true } : { ok: false, notFound: true };
}

/**
 * 순서 바꾸기 — 화면이 보낸 id 순서로 10 간격 다시 매김(이 조직 줄만, 모르는 id 는 무시, 빠진 줄은 뒤에).
 * DB 함수 한 번(`guest_message_saved_replies_reorder` — unnest with ordinality, update 하나)이라 중간에 끊겨 반만 바뀌지 않는다.
 * 순서만 바뀌면 글 버전(`updated_at`)은 그대로다(트리거).
 */
export async function reorderSavedReplies(db: Client, organizationId: string, orderedIds: readonly string[]): Promise<boolean> {
  const current = await loadSavedReplies(db, organizationId);
  const known = new Set(current.map((reply) => reply.id));
  const ids = [...new Set(orderedIds.filter((id) => known.has(id)))];
  for (const reply of current) if (!ids.includes(reply.id)) ids.push(reply.id);
  if (ids.length === 0) return true;
  const result = await db.rpc("guest_message_saved_replies_reorder", { p_organization_id: organizationId, p_ids: ids });
  if (result.error) {
    console.error("[saved-replies] reorder failed", { code: result.error.code });
    return false;
  }
  return true;
}

/**
 * 「해결 초안」 문구 정하기(6단계, 2026-11-13) — 조직마다 하나(`guest_message_saved_replies_resolved_unique`).
 * DB 함수 `guest_message_set_resolved_reply` 하나로 지우기 + 붙이기를 한 트랜잭션에(중간 실패로 표시가 사라지지 않게). `id = null` 이면 지우기만.
 * 고른 줄이 이 조직에 없으면 `not_found`.
 */
export async function setResolvedSavedReply(
  db: Client,
  organizationId: string,
  id: string | null,
): Promise<{ ok: true } | { ok: false; error: "not_found" | "save_failed" }> {
  const { data, error } = await db.rpc("guest_message_set_resolved_reply", { p_organization_id: organizationId, p_id: id });
  if (error) return { ok: false, error: "save_failed" };
  return data === true ? { ok: true } : { ok: false, error: "not_found" };
}
