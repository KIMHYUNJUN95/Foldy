import "server-only";

/**
 * 손님 메시지 ↔ 업무 링크 — 읽기 · 쓰기(6단계, 2026-11-13). docs/product/47-guest-messaging.md §6-4 · §5-7
 *
 * - 링크 표 `guest_message_links`(202611130005). 표가 아직 없으면(마이그레이션 전) 읽기는 빈 목록 — 대화 화면은 그대로 열린다.
 * - 업무 상태는 대화를 열 때 그 표들에서 읽는다(트리거 · 알림 없음 — 알림은 막바지에 한꺼번에, 메모리 정책).
 *   할 일 제목은 그 사람이 참여자일 때만(할 일은 참여자만 보는 기록) — 상태는 누구에게나(「할 일 · 끝남」).
 * - 모든 읽기 · 쓰기는 `organization_id` 로 거른다(service_role).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  isLinkTargetType,
  linkTargetState,
  type LinkState,
  type LinkTargetRow,
  type LinkTargetType,
  type ResolvedDraft,
  type ThreadLinkView,
} from "@/lib/guest-messages/task-link-model";
import { GUEST_LANGS } from "@/lib/guest-messages/guest-info-model";
import { buildReplyContext, guestDictionaries, type ReplyContextSource } from "@/lib/guest-messages/reply-context-server";
import { savedReplyText } from "@/lib/guest-messages/saved-reply-model";

type Client = SupabaseClient<Database>;
type LinkRow = {
  id: string;
  conversation_id: string;
  message_id: string | null;
  target_type: string;
  target_id: string;
  created_at: string;
};

const UNKNOWN_STATE: LinkState = { status: "unknown", done: false, doneAt: null, deleted: false };

/** 표마다 읽을 칸 — `doneAt` · 제목 칸 이름이 표마다 다르다. */
const TARGET_TABLES: Record<
  LinkTargetType,
  { table: "maintenance_reports" | "lost_items" | "tasks" | "customer_complaints"; columns: string; doneAt: string; title: string }
> = {
  maintenance: { table: "maintenance_reports", columns: "id, status, completed_at, issue_title", doneAt: "completed_at", title: "issue_title" },
  lost_found: { table: "lost_items", columns: "id, status, handled_at, item_name", doneAt: "handled_at", title: "item_name" },
  task: { table: "tasks", columns: "id, status, completed_at, deleted_at, title", doneAt: "completed_at", title: "title" },
  complaint: { table: "customer_complaints", columns: "id, status, resolved_at, title", doneAt: "resolved_at", title: "title" },
};

/** 업무 줄 읽기 — 읽기 실패면 null(상태 모름), 성공이면 id → 줄(없는 id = 지워짐). */
async function loadTargets(
  db: Client,
  organizationId: string,
  type: LinkTargetType,
  ids: readonly string[],
): Promise<Map<string, LinkTargetRow> | null> {
  const spec = TARGET_TABLES[type];
  const { data, error } = await (db as unknown as SupabaseClient)
    .from(spec.table)
    .select(spec.columns)
    .eq("organization_id", organizationId)
    .in("id", [...ids]);
  if (error) return null;
  const out = new Map<string, LinkTargetRow>();
  for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    out.set(String(row.id), {
      status: typeof row.status === "string" ? row.status : null,
      doneAt: typeof row[spec.doneAt] === "string" ? (row[spec.doneAt] as string) : null,
      deletedAt: typeof row.deleted_at === "string" ? row.deleted_at : null,
      title: typeof row[spec.title] === "string" ? (row[spec.title] as string) : null,
    });
  }
  return out;
}

/** 이 사람이 참여자(작성자 포함)인 할 일 id. 읽기 실패면 빈 집합(제목을 숨긴다). */
async function participantTaskIds(db: Client, userId: string | null, taskIds: readonly string[]): Promise<Set<string>> {
  if (!userId || taskIds.length === 0) return new Set();
  const { data, error } = await db.from("task_participants").select("task_id").eq("user_id", userId).in("task_id", [...taskIds]);
  if (error) return new Set();
  return new Set(((data ?? []) as Array<{ task_id: string }>).map((row) => row.task_id));
}

export async function loadThreadLinks(
  db: Client,
  organizationId: string,
  conversationId: string,
  viewerUserId: string | null,
): Promise<ThreadLinkView[]> {
  const { data, error } = await db
    .from("guest_message_links")
    .select("id, conversation_id, message_id, target_type, target_id, created_at")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) return [];
  const rows = ((data ?? []) as LinkRow[]).filter((row) => isLinkTargetType(row.target_type));
  if (rows.length === 0) return [];

  const byType = new Map<LinkTargetType, string[]>();
  for (const row of rows) {
    const type = row.target_type as LinkTargetType;
    byType.set(type, [...(byType.get(type) ?? []), row.target_id]);
  }
  const targetMaps = new Map<LinkTargetType, Map<string, LinkTargetRow> | null>();
  const [, mine] = await Promise.all([
    Promise.all(
      [...byType.entries()].map(async ([type, ids]) => {
        targetMaps.set(type, await loadTargets(db, organizationId, type, ids));
      }),
    ),
    participantTaskIds(db, viewerUserId, byType.get("task") ?? []),
  ]);

  return rows.map((row) => {
    const type = row.target_type as LinkTargetType;
    const targets = targetMaps.get(type);
    const target = targets ? (targets.get(row.target_id) ?? null) : undefined;
    const state = target === undefined ? UNKNOWN_STATE : linkTargetState(type, target);
    const title = target && (type !== "task" || mine.has(row.target_id)) ? target.title : null;
    return {
      id: row.id,
      targetType: type,
      targetId: row.target_id,
      messageId: row.message_id,
      createdAt: row.created_at,
      title: state.deleted ? null : title,
      state,
    };
  });
}

/** 업무 표의 만든 사람 칸. */
const CREATOR_COLUMN: Record<LinkTargetType, string> = {
  maintenance: "reported_by_user_id",
  lost_found: "reported_by_user_id",
  task: "created_by_user_id",
  complaint: "created_by_user_id",
};

/** 이 시간 안에 이 사람이 만든 업무만 대화에 잇는다 — 같은 요청 id 로 남의 · 옛 업무를 끌어오지 않게. */
export const LINK_TARGET_FRESH_MS = 10 * 60 * 1000;

/**
 * 링크를 넣기 전에 — 업무가 **이 조직 · 이 사람이 방금(10분 안) 만든 것**인지. 요청 id 를 다시 보내면 각 기능의 만들기 함수가
 * 이미 있는 줄을 돌려주는데(멱등), 그 줄이 남의 것이거나 오래된 것이면 대화에 붙이지 않는다. 읽기 실패도 false.
 */
export async function isOwnFreshTarget(
  db: Client,
  input: { organizationId: string; targetType: LinkTargetType; targetId: string; userId: string; now?: number },
): Promise<boolean> {
  const creator = CREATOR_COLUMN[input.targetType];
  const { data, error } = await (db as unknown as SupabaseClient)
    .from(TARGET_TABLES[input.targetType].table)
    .select(`id, created_at, ${creator}`)
    .eq("organization_id", input.organizationId)
    .eq("id", input.targetId)
    .maybeSingle();
  if (error || !data) return false;
  const row = data as unknown as Record<string, unknown>;
  if (row[creator] !== input.userId) return false;
  const createdAt = typeof row.created_at === "string" ? Date.parse(row.created_at) : Number.NaN;
  return Number.isFinite(createdAt) && (input.now ?? Date.now()) - createdAt <= LINK_TARGET_FRESH_MS;
}

export type InsertLinkResult = { ok: true; duplicate: boolean } | { ok: false; error: "conflict" | "failed" };

/**
 * 링크 한 줄 넣기. 업무 하나에 링크 하나(`unique (organization_id, target_type, target_id)`) — 같은 대화로 다시 오면 그대로 성공,
 * 다른 대화에 이미 붙어 있으면 `conflict`(DB 트리거가 대화 · 메시지의 조직도 다시 본다).
 */
export async function insertGuestMessageLink(
  db: Client,
  input: {
    organizationId: string;
    conversationId: string;
    messageId: string | null;
    targetType: LinkTargetType;
    targetId: string;
    createdBy: string;
  },
): Promise<InsertLinkResult> {
  const { error } = await db.from("guest_message_links").insert({
    organization_id: input.organizationId,
    conversation_id: input.conversationId,
    message_id: input.messageId,
    target_type: input.targetType,
    target_id: input.targetId,
    created_by: input.createdBy,
  });
  if (!error) return { ok: true, duplicate: false };
  if ((error as { code?: string }).code !== "23505") return { ok: false, error: "failed" };
  const existing = await db
    .from("guest_message_links")
    .select("conversation_id")
    .eq("organization_id", input.organizationId)
    .eq("target_type", input.targetType)
    .eq("target_id", input.targetId)
    .maybeSingle();
  const found = existing.data as { conversation_id: string } | null;
  if (found?.conversation_id === input.conversationId) return { ok: true, duplicate: true };
  return { ok: false, error: found ? "conflict" : "failed" };
}

/** 업무 → 대화(업무 상세의 「손님 메시지에서」). 없거나 읽기 실패면 null. */
export async function findConversationForTarget(
  db: Client,
  organizationId: string,
  targetType: LinkTargetType,
  targetId: string,
): Promise<{ conversationId: string; guestName: string | null } | null> {
  const { data, error } = await db
    .from("guest_message_links")
    .select("conversation_id")
    .eq("organization_id", organizationId)
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .maybeSingle();
  if (error || !data) return null;
  const conversationId = (data as { conversation_id: string }).conversation_id;
  const conv = await db
    .from("guest_conversations")
    .select("guest_name")
    .eq("organization_id", organizationId)
    .eq("id", conversationId)
    .maybeSingle();
  if (conv.error || !conv.data) return null;
  return { conversationId, guestName: (conv.data as { guest_name: string | null }).guest_name };
}

/** 「해결됐어요」로 표시한 문구(조직마다 하나). 칸이 아직 없거나(마이그레이션 전) 없으면 null. */
export async function loadResolvedSavedReply(
  db: Client,
  organizationId: string,
): Promise<{ id: string; bodies: { ko: string; ja: string; en: string } } | null> {
  const { data, error } = await db
    .from("guest_message_saved_replies")
    .select("id, body_ko, body_ja, body_en")
    .eq("organization_id", organizationId)
    .eq("purpose", "resolved")
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { id: string; body_ko: string; body_ja: string; body_en: string };
  return { id: row.id, bodies: { ko: row.body_ko, ja: row.body_ja, en: row.body_en } };
}

/**
 * 「해결됐어요」 초안 글 — 표시한 문구가 있으면 그 문구(변수는 대화 값, 그 언어가 비면 영어), 없으면 사전 기본 문구(업무 종류마다).
 * 보내지 않는다 — 답장 칸에 띄울 글만 만든다.
 */
export async function buildResolvedDraft(
  db: Client,
  organizationId: string,
  conversation: ReplyContextSource,
  link: ThreadLinkView,
): Promise<ResolvedDraft> {
  const dictionaries = guestDictionaries();
  const saved = await loadResolvedSavedReply(db, organizationId).catch(() => null);
  const context = buildReplyContext(conversation, dictionaries);
  const texts = Object.fromEntries(
    GUEST_LANGS.map((lang) => {
      const fromSaved = saved ? savedReplyText(saved.bodies, lang, context) : null;
      return [lang, fromSaved?.text ?? dictionaries[lang].guestMessages.taskResolvedDraft[link.targetType]];
    }),
  ) as ResolvedDraft["texts"];
  return { linkId: link.id, targetType: link.targetType, texts, fromSavedReply: Boolean(saved) };
}
