// Staff Suggestions / Feedback Box — list queries (Step 3, read-only).
//
// Server-only module (uses the RLS-scoped server client). Kept SEPARATE from `src/lib/suggestions.ts`
// because that module is imported by client components for its types/constants — pulling the server
// client in there would drag `next/headers` into the client bundle.
//
// Visibility is participant-only and enforced two ways: RLS (`can_view_staff_suggestion`) is the
// backstop, and each query is also explicitly scoped to the organization + the current user's
// relationship (author / recipient / referenced).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { AppSession } from "@/lib/session";
import type { StaffSuggestionStatus } from "@/lib/suggestions";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isPlatformDeveloper } from "@/config/roles";

// Resolve display names for a set of org members (active or not) via memberships→profiles.
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
 * Load the three list segments for the current user in one pass: Sent (author), Received (recipient),
 * and Referenced (through `staff_suggestion_references`). Reference + comment counts and recipient
 * display names are resolved for the union of visible suggestions. Returns empty segments gracefully
 * if the schema is not present yet.
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

  // Any error (incl. schema-not-applied) → treat that segment as empty rather than throwing.
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

  // Reference + comment counts and author/recipient names for the union of visible suggestions.
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

// ── Detail ─────────────────────────────────────────────────────────────────────

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

// A status-change entry, shown inline in the comment thread (e.g. "○○ changed status to reviewing").
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
 * Load one suggestion for the current user. Visibility is participant-only: RLS hides non-participant
 * rows (so `maybeSingle()` returns null), and we additionally derive the viewer's role and bail if
 * the user is neither author, recipient, nor a referenced user. Returns null when not found / not
 * allowed so callers can redirect without leaking existence.
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
  if (!viewerRole) return null; // defensive — RLS should already prevent this
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
