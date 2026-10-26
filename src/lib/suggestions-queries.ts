// 직원 건의 / 의견함 — 목록 쿼리 (Step 3, 읽기 전용).
//
// 서버 전용 모듈(RLS 범위 서버 클라이언트 사용). `src/lib/suggestions.ts` 와 SEPARATE 로 둔다
// 그 모듈은 클라이언트 컴포넌트가 타입/상수 때문에 import 하는데, 서버
// 클라이언트를 거기 끌어오면 `next/headers` 가 클라이언트 번들에 딸려 들어오기 때문이다.
//
// 가시성은 참여자 전용이며 두 겹으로 강제한다: RLS(`can_view_staff_suggestion`)가
// 최후 방어선이고, 각 쿼리도 조직 + 현재 사용자의
// 관계(작성자 / 수신자 / 참조)로 명시적으로 범위를 제한한다.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { AppSession } from "@/lib/session";
import type { StaffSuggestionStatus } from "@/lib/suggestions";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isPlatformDeveloper } from "@/config/roles";

// 조직 멤버 집합(활성 여부 무관)의 표시 이름을 memberships→profiles 로 해석한다.
async function fetchMemberNames(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  userIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = Array.from(new Set(userIds)).filter(Boolean);
  if (ids.length === 0) return map;
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id, profiles(name)")
    .eq("organization_id", organizationId)
    .in("user_id", ids);
  if (error) return map;
  for (const m of (data ?? []) as Array<{
    user_id: string;
    profiles: { name: string } | { name: string }[] | null;
  }>) {
    const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    if (profile?.name) map.set(m.user_id, profile.name);
  }
  return map;
}

export type SuggestionListItem = {
  id: string;
  status: StaffSuggestionStatus;
  title: string;
  excerpt: string;
  authorName: string;
  recipientName: string;
  referencesCount: number;
  commentCount: number;
  createdAt: string;
};

export type SuggestionListData = {
  sent: SuggestionListItem[];
  received: SuggestionListItem[];
  referenced: SuggestionListItem[];
};

type SuggestionRow = {
  id: string;
  status: string;
  title: string;
  body: string;
  created_by_user_id: string;
  recipient_user_id: string;
  created_at: string;
};

const LIST_COLS = "id, status, title, body, created_by_user_id, recipient_user_id, created_at";

function excerptOf(body: string): string {
  const s = (body ?? "").replace(/\s+/g, " ").trim();
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

function countBy(rows: { suggestion_id: string }[] | null | undefined): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows ?? []) map.set(r.suggestion_id, (map.get(r.suggestion_id) ?? 0) + 1);
  return map;
}

/**
 * 현재 사용자의 세 목록 구간을 한 번에 불러온다: 보낸(작성자), 받은(수신자),
 * 참조된(`staff_suggestion_references` 경유). 참조 + 댓글 수와 수신자
 * 표시 이름은 보이는 건의의 합집합에 대해 해석한다. 스키마가 아직 없으면
 * 예외 없이 빈 구간을 돌려준다.
 */
export async function getSuggestionListData(session: AppSession): Promise<SuggestionListData> {
  const supabase = await getSupabaseServerClient();
  const orgId = session.organization.id;
  const uid = session.user.id;
  // 플랫폼 개발자는 조직의 건의를 전부 본다(2026-10-23) — 내가 쓴 것 말고는 모두 「받은」 칸에 모인다
  // (상태도 바꿀 수 있으니 받는 사람 자리). RLS 는 is_platform_admin() 으로 이미 통과한다.
  const developer = isPlatformDeveloper(session.user.role);
  const receivedQuery = supabase
    .from("staff_suggestions")
    .select(LIST_COLS)
    .eq("organization_id", orgId);

  const [sentRes, receivedRes, refRes] = await Promise.all([
    supabase
      .from("staff_suggestions")
      .select(LIST_COLS)
      .eq("organization_id", orgId)
      .eq("created_by_user_id", uid)
      .order("created_at", { ascending: false }),
    (developer ? receivedQuery.neq("created_by_user_id", uid) : receivedQuery.eq("recipient_user_id", uid)).order(
      "created_at",
      { ascending: false },
    ),
    supabase
      .from("staff_suggestion_references")
      .select(`suggestion_id, created_at, staff_suggestions(${LIST_COLS})`)
      .eq("organization_id", orgId)
      .eq("user_id", uid)
      .order("created_at", { ascending: false }),
  ]);

  // 어떤 오류(스키마 미적용 포함)든 던지지 않고 그 구간을 빈 것으로 처리한다.
  const sentRows = (sentRes.error ? [] : (sentRes.data ?? [])) as SuggestionRow[];
  const receivedRows = (receivedRes.error ? [] : (receivedRes.data ?? [])) as SuggestionRow[];
  const referencedRows = (
    refRes.error
      ? []
      : ((refRes.data ?? []) as { staff_suggestions: SuggestionRow | SuggestionRow[] | null }[])
          .map((r) => (Array.isArray(r.staff_suggestions) ? r.staff_suggestions[0] : r.staff_suggestions))
          .filter((r): r is SuggestionRow => Boolean(r))
  ).filter((r) => !developer || !receivedRows.some((x) => x.id === r.id));

  const allRows = [...sentRows, ...receivedRows, ...referencedRows];
  const ids = Array.from(new Set(allRows.map((r) => r.id)));
  const personIds = Array.from(
    new Set(allRows.flatMap((r) => [r.created_by_user_id, r.recipient_user_id])),
  );

  // 보이는 건의의 합집합에 대한 참조 + 댓글 수와 작성자/수신자 이름.
  const [refCountRes, commentCountRes, nameById] = await Promise.all([
    ids.length
      ? supabase.from("staff_suggestion_references").select("suggestion_id").in("suggestion_id", ids)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supabase.from("staff_suggestion_comments").select("suggestion_id").in("suggestion_id", ids)
      : Promise.resolve({ data: [], error: null }),
    fetchMemberNames(supabase, orgId, personIds),
  ]);

  const refCounts = countBy(refCountRes.error ? [] : (refCountRes.data as { suggestion_id: string }[]));
  const commentCounts = countBy(
    commentCountRes.error ? [] : (commentCountRes.data as { suggestion_id: string }[]),
  );

  const toItem = (r: SuggestionRow): SuggestionListItem => ({
    id: r.id,
    status: r.status as StaffSuggestionStatus,
    title: r.title,
    excerpt: excerptOf(r.body),
    authorName: nameById.get(r.created_by_user_id) ?? "",
    recipientName: nameById.get(r.recipient_user_id) ?? "",
    referencesCount: refCounts.get(r.id) ?? 0,
    commentCount: commentCounts.get(r.id) ?? 0,
    createdAt: r.created_at,
  });

  return {
    sent: sentRows.map(toItem),
    received: receivedRows.map(toItem),
    referenced: referencedRows.map(toItem),
  };
}

// ── 상세 ──────────────────────────────────────────────────────

export type SuggestionViewerRole = "author" | "recipient" | "referenced";

export type SuggestionPerson = { id: string; name: string };

export type SuggestionComment = {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: SuggestionViewerRole;
  body: string | null;
  imageUrls: string[];
  imageCount: number;
  createdAt: string;
};

// 상태 변경 항목, 댓글 스레드 안에 인라인으로 표시(예: "○○ 님이 상태를 검토 중으로 변경").
export type SuggestionStatusEvent = {
  id: string;
  actorId: string;
  actorName: string;
  status: StaffSuggestionStatus;
  createdAt: string;
};

export type SuggestionDetail = {
  id: string;
  status: StaffSuggestionStatus;
  title: string;
  body: string;
  category: string | null;
  holdReason: string | null;
  completionNote: string | null;
  propertyId: string | null;
  propertyName: string | null;
  roomId: string | null;
  roomLabel: string | null;
  imageUrls: string[];
  createdAt: string;
  updatedAt: string;
  author: SuggestionPerson;
  recipient: SuggestionPerson;
  references: SuggestionPerson[];
  comments: SuggestionComment[];
  events: SuggestionStatusEvent[];
  viewerRole: SuggestionViewerRole;
  /** 상태를 바꿀 수 있는가 — 받는 사람 또는 플랫폼 개발자(2026-10-23). */
  viewerCanChangeStatus: boolean;
};

type DetailRow = {
  id: string;
  status: string;
  title: string;
  body: string;
  category: string | null;
  hold_reason: string | null;
  completion_note: string | null;
  property_id: string | null;
  property_name: string | null;
  room_id: string | null;
  room_label: string | null;
  image_urls: string[] | null;
  created_at: string;
  updated_at: string;
  created_by_user_id: string;
  recipient_user_id: string;
};

/**
 * 현재 사용자의 건의 하나를 불러온다. 가시성은 참여자 전용: RLS 가 참여자가 아닌
 * 행을 숨기고(`maybeSingle()` 이 null 을 돌려줌), 추가로 보는 사람의 역할을 도출해서
 * 작성자도 수신자도 참조 사용자도 아니면 빠져나간다. 없거나 허용되지 않으면 null 을 돌려줘서
 * 호출자가 존재 여부를 노출하지 않고 리다이렉트할 수 있다.
 */
export async function getSuggestionDetail(
  session: AppSession,
  id: string,
): Promise<SuggestionDetail | null> {
  const supabase = await getSupabaseServerClient();
  const orgId = session.organization.id;
  const uid = session.user.id;

  const { data: rawSug, error } = await supabase
    .from("staff_suggestions")
    .select(
      "id, status, title, body, category, hold_reason, completion_note, property_id, property_name, room_id, room_label, image_urls, created_at, updated_at, created_by_user_id, recipient_user_id",
    )
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error || !rawSug) return null;
  const sug = rawSug as DetailRow;

  const { data: refRows } = await supabase
    .from("staff_suggestion_references")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("suggestion_id", id);
  const referenceIds = ((refRows ?? []) as { user_id: string }[]).map((r) => r.user_id);

  let viewerRole: SuggestionViewerRole | null = null;
  if (sug.created_by_user_id === uid) viewerRole = "author";
  else if (sug.recipient_user_id === uid) viewerRole = "recipient";
  else if (referenceIds.includes(uid)) viewerRole = "referenced";
  // 플랫폼 개발자는 관계없는 건의도 연다(보기 전용 자리 = referenced, 상태 변경은 아래 플래그로).
  const developer = isPlatformDeveloper(session.user.role);
  if (!viewerRole && developer) viewerRole = "referenced";
  if (!viewerRole) return null; // 방어적 처리 — RLS 가 이미 막아야 한다
  const viewerCanChangeStatus = viewerRole === "recipient" || developer;

  const { data: commentRows } = await supabase
    .from("staff_suggestion_comments")
    .select("id, created_by_user_id, body, image_urls, created_at")
    .eq("organization_id", orgId)
    .eq("suggestion_id", id)
    .order("created_at", { ascending: true });
  const comments = (commentRows ?? []) as Array<{
    id: string;
    created_by_user_id: string;
    body: string | null;
    image_urls: string[] | null;
    created_at: string;
  }>;

  const { data: eventRows } = await supabase
    .from("staff_suggestion_events")
    .select("id, actor_user_id, status, created_at")
    .eq("organization_id", orgId)
    .eq("suggestion_id", id)
    .order("created_at", { ascending: true });
  const events = (eventRows ?? []) as Array<{
    id: string;
    actor_user_id: string | null;
    status: string;
    created_at: string;
  }>;

  const nameById = await fetchMemberNames(supabase, orgId, [
    sug.created_by_user_id,
    sug.recipient_user_id,
    ...referenceIds,
    ...comments.map((c) => c.created_by_user_id),
    ...events.map((e) => e.actor_user_id).filter((v): v is string => !!v),
  ]);

  const roleOf = (userId: string): SuggestionViewerRole =>
    userId === sug.created_by_user_id
      ? "author"
      : userId === sug.recipient_user_id
        ? "recipient"
        : "referenced";

  return {
    id: sug.id,
    status: sug.status as StaffSuggestionStatus,
    title: sug.title,
    body: sug.body,
    category: sug.category,
    holdReason: sug.hold_reason,
    completionNote: sug.completion_note,
    propertyId: sug.property_id,
    propertyName: sug.property_name,
    roomId: sug.room_id,
    roomLabel: sug.room_label,
    imageUrls: Array.isArray(sug.image_urls) ? sug.image_urls : [],
    createdAt: sug.created_at,
    updatedAt: sug.updated_at,
    author: { id: sug.created_by_user_id, name: nameById.get(sug.created_by_user_id) ?? "" },
    recipient: { id: sug.recipient_user_id, name: nameById.get(sug.recipient_user_id) ?? "" },
    references: referenceIds.map((rid) => ({ id: rid, name: nameById.get(rid) ?? "" })),
    comments: comments.map((c) => ({
      id: c.id,
      authorId: c.created_by_user_id,
      authorName: nameById.get(c.created_by_user_id) ?? "",
      authorRole: roleOf(c.created_by_user_id),
      body: c.body,
      imageUrls: Array.isArray(c.image_urls) ? c.image_urls : [],
      imageCount: Array.isArray(c.image_urls) ? c.image_urls.length : 0,
      createdAt: c.created_at,
    })),
    events: events.map((e) => ({
      id: e.id,
      actorId: e.actor_user_id ?? "",
      actorName: e.actor_user_id ? nameById.get(e.actor_user_id) ?? "" : "",
      status: e.status as StaffSuggestionStatus,
      createdAt: e.created_at,
    })),
    viewerRole,
    viewerCanChangeStatus,
  };
}
