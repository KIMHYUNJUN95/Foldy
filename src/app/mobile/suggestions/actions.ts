"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { notifySuggestionParticipants } from "@/lib/notifications/create";
import { getShareableUsers } from "@/lib/tasks";
import {
  STAFF_SUGGESTION_MAX_IMAGES,
  STAFF_SUGGESTION_STATUSES,
  type StaffSuggestionStatus,
} from "@/lib/suggestions";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { isOwnerOrPlatformDeveloper, isPlatformDeveloper } from "@/config/roles";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

// database.ts omits Relationships, so `service.rpc()` isn't typed; this gives just enough typing for
// the atomic edit RPC (mirrors the pattern in src/app/onboarding/actions.ts). Returns the previous
// reference user_ids.
type SuggestionEditRpcClient = {
  rpc(
    fn: "update_staff_suggestion",
    args: {
      p_id: string;
      p_org: string;
      p_title: string;
      p_body: string;
      p_category: string | null;
      p_recipient: string;
      p_property_id: string | null;
      p_property_name: string | null;
      p_room_id: string | null;
      p_room_label: string | null;
      p_image_urls: string[];
      p_reference_ids: string[];
    },
  ): Promise<{ data: string[] | null; error: { message: string } | null }>;
};

function cleanText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

const NEW = "/mobile/suggestions/new";

/**
 * Create a Staff Suggestion (Step 2 — create flow).
 *
 * Any active org member can create one. Exactly one recipient is required (active same-org member,
 * not the author). Referenced users are optional (active same-org members, deduped, never the author
 * or the recipient). Title and body are required; photos are capped at 5. Initial status is always
 * `submitted`. No status/notification logic here. Writes go through the service-role client because
 * the tables expose read-only participant RLS (see migration 202606160001).
 */
export async function createStaffSuggestion(formData: FormData) {
  const session = await getCurrentAppSession();
  if (!session) {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/suggestions/new")}`);
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const title = cleanText(formData.get("title"));
  const body = cleanText(formData.get("body"));
  const category = cleanText(formData.get("category"));
  const recipientId = cleanText(formData.get("recipientId"));
  const referenceIds = parseStringArray(String(formData.get("referencesJson") ?? "[]"));

  const propertyId = cleanText(formData.get("propertyId")) || null;
  const propertyName = cleanText(formData.get("propertyName")) || null;
  const roomId = cleanText(formData.get("roomId")) || null;
  const roomLabel = cleanText(formData.get("roomLabel")) || null;

  const imageUrls = formData
    .getAll("imageUrls")
    .map((v) => String(v))
    .filter(Boolean)
    .slice(0, STAFF_SUGGESTION_MAX_IMAGES);

  if (!title) redirect(`${NEW}?error=missing_title`);
  if (!body) redirect(`${NEW}?error=missing_body`);
  if (!recipientId) redirect(`${NEW}?error=missing_recipient`);

  // Same-org active members (excludes the author). Validates recipient + references in one place.
  const allowed = new Set((await getShareableUsers(session)).map((u) => u.id));
  if (recipientId === session.user.id || !allowed.has(recipientId)) {
    redirect(`${NEW}?error=invalid_recipient`);
  }

  // References: active members only, never the author or the recipient, deduped.
  const references = Array.from(new Set(referenceIds)).filter(
    (uid) => uid !== session.user.id && uid !== recipientId && allowed.has(uid),
  );

  const id = crypto.randomUUID();
  const supabase = getSupabaseServiceClient();

  const insert: Database["public"]["Tables"]["staff_suggestions"]["Insert"] = {
    id,
    organization_id: session.organization.id,
    created_by_user_id: session.user.id,
    recipient_user_id: recipientId,
    title,
    body,
    category: category || null,
    status: "submitted",
    property_id: propertyId,
    property_name: propertyName,
    room_id: roomId,
    room_label: roomLabel,
    image_urls: imageUrls,
  };
  const { error } = await supabase.from("staff_suggestions").insert(insert);
  if (error) {
    redirect(`${NEW}?error=save_failed`);
  }

  if (references.length > 0) {
    const referenceRows: Database["public"]["Tables"]["staff_suggestion_references"]["Insert"][] =
      references.map((uid) => ({
        organization_id: session.organization.id,
        suggestion_id: id,
        user_id: uid,
      }));
    const { error: refError } = await supabase
      .from("staff_suggestion_references")
      .insert(referenceRows);
    if (refError) {
      // Roll back the parent so we never leave a suggestion with a partial reference set.
      await supabase.from("staff_suggestions").delete().eq("id", id);
      redirect(`${NEW}?error=save_failed`);
    }
  }

  // Notify the recipient (created) and any referenced users (referenced); the author is skipped.
  await notifySuggestionParticipants(supabase, {
    organizationId: session.organization.id,
    suggestionId: id,
    recipientUserIds: [recipientId],
    actorUserId: session.user.id,
    dedupeBase: `suggestion_created:${id}`,
    payload: { suggestionId: id, suggestionTitle: title, actorUserId: session.user.id, event: "created" },
  });
  if (references.length > 0) {
    await notifySuggestionParticipants(supabase, {
      organizationId: session.organization.id,
      suggestionId: id,
      recipientUserIds: references,
      actorUserId: session.user.id,
      dedupeBase: `suggestion_referenced:${id}`,
      payload: {
        suggestionId: id,
        suggestionTitle: title,
        actorUserId: session.user.id,
        event: "referenced",
      },
    });
  }

  redirect("/mobile/suggestions?created=1");
}

// Author edits the main suggestion (title / body / category / recipient / references / context /
// photos) — allowed ONLY while `status = 'submitted'`. References are fully re-synced; newly added
// referenced users get a `referenced` notification.
export async function updateStaffSuggestion(formData: FormData) {
  const session = await getCurrentAppSession();
  if (!session) {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/suggestions")}`);
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const suggestionId = cleanText(formData.get("suggestionId"));
  if (!suggestionId) redirect("/mobile/suggestions");
  const EDIT = `/mobile/suggestions/${suggestionId}/edit`;

  const title = cleanText(formData.get("title"));
  const body = cleanText(formData.get("body"));
  const category = cleanText(formData.get("category"));
  const recipientId = cleanText(formData.get("recipientId"));
  const referenceIds = parseStringArray(String(formData.get("referencesJson") ?? "[]"));
  const propertyId = cleanText(formData.get("propertyId")) || null;
  const propertyName = cleanText(formData.get("propertyName")) || null;
  const roomId = cleanText(formData.get("roomId")) || null;
  const roomLabel = cleanText(formData.get("roomLabel")) || null;
  const imageUrls = formData
    .getAll("imageUrls")
    .map((v) => String(v))
    .filter(Boolean)
    .slice(0, STAFF_SUGGESTION_MAX_IMAGES);

  if (!title) redirect(`${EDIT}?error=missing_title`);
  if (!body) redirect(`${EDIT}?error=missing_body`);
  if (!recipientId) redirect(`${EDIT}?error=missing_recipient`);

  const supabase = getSupabaseServiceClient();
  const { data: rawCurrent } = await supabase
    .from("staff_suggestions")
    .select("id, created_by_user_id, recipient_user_id, status")
    .eq("id", suggestionId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  const current = rawCurrent as
    | { id: string; created_by_user_id: string; recipient_user_id: string; status: string }
    | null;
  // Author-only, and only while submitted — otherwise just bounce back to the detail (no leak).
  if (!current || current.created_by_user_id !== session.user.id || current.status !== "submitted") {
    redirect(`/mobile/suggestions/${suggestionId}`);
  }
  const previousRecipientId = current.recipient_user_id;

  const allowed = new Set((await getShareableUsers(session)).map((u) => u.id));
  if (recipientId === session.user.id || !allowed.has(recipientId)) {
    redirect(`${EDIT}?error=invalid_recipient`);
  }
  const references = Array.from(new Set(referenceIds)).filter(
    (uid) => uid !== session.user.id && uid !== recipientId && allowed.has(uid),
  );

  // Atomic edit: the RPC updates the row + re-syncs references (delete + insert) in ONE transaction,
  // so a failed re-insert can never leave the suggestion with its references half-wiped. It returns
  // the previous reference ids so we can notify only the newly added ones. (Runs via the service
  // client, which already bypasses RLS.)
  const { data: oldRefsData, error: rpcError } = await (
    supabase as unknown as SuggestionEditRpcClient
  ).rpc("update_staff_suggestion", {
    p_id: suggestionId,
    p_org: session.organization.id,
    p_title: title,
    p_body: body,
    p_category: category || null,
    p_recipient: recipientId,
    p_property_id: propertyId,
    p_property_name: propertyName,
    p_room_id: roomId,
    p_room_label: roomLabel,
    p_image_urls: imageUrls,
    p_reference_ids: references,
  });
  if (rpcError) {
    redirect(`${EDIT}?error=save_failed`);
  }
  const oldIds = new Set((oldRefsData ?? []) as string[]);

  // Notify newly added referenced users.
  const added = references.filter((uid) => !oldIds.has(uid));
  if (added.length > 0) {
    await notifySuggestionParticipants(supabase, {
      organizationId: session.organization.id,
      suggestionId,
      recipientUserIds: added,
      actorUserId: session.user.id,
      dedupeBase: `suggestion_referenced:${suggestionId}`,
      payload: {
        suggestionId,
        suggestionTitle: title,
        actorUserId: session.user.id,
        event: "referenced",
      },
    });
  }

  // Notify the recipient only when it actually changed (self-suppressed by the helper).
  if (recipientId !== previousRecipientId) {
    await notifySuggestionParticipants(supabase, {
      organizationId: session.organization.id,
      suggestionId,
      recipientUserIds: [recipientId],
      actorUserId: session.user.id,
      dedupeBase: `suggestion_created:${suggestionId}`,
      payload: {
        suggestionId,
        suggestionTitle: title,
        actorUserId: session.user.id,
        event: "created",
      },
    });
  }

  revalidatePath("/mobile/suggestions");
  redirect(`/mobile/suggestions/${suggestionId}`);
}

// Author deletes the main suggestion — allowed ONLY while `status = 'submitted'`. Hard delete;
// references + comments cascade.
export async function deleteStaffSuggestion(formData: FormData) {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) {
    redirect("/mobile/suggestions");
  }
  const suggestionId = cleanText(formData.get("suggestionId"));
  if (!suggestionId) redirect("/mobile/suggestions");

  const supabase = getSupabaseServiceClient();
  const { data: rawCurrent } = await supabase
    .from("staff_suggestions")
    .select("id, created_by_user_id, status")
    .eq("id", suggestionId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  const current = rawCurrent as
    | { id: string; created_by_user_id: string; status: string }
    | null;
  if (!current || current.created_by_user_id !== session.user.id || current.status !== "submitted") {
    redirect(`/mobile/suggestions/${suggestionId}`);
  }

  await supabase
    .from("staff_suggestions")
    .delete()
    .eq("id", suggestionId)
    .eq("organization_id", session.organization.id);

  revalidatePath("/mobile/suggestions");
  redirect("/mobile/suggestions");
}

// ── Comments (Step 5) ───────────────────────────────────────────────────────────
//
// Comments are allowed at every suggestion status (no status gating). Create is open to any visible
// participant (author / recipient / referenced); update + delete are comment-author-only. A comment
// must not be fully empty (text or at least one photo), capped at 5 photos. Writes use the
// service-role client (read-only participant RLS), so authorization is enforced here. These actions
// return a result object (the composer stays on the detail page) rather than redirecting.

export type CommentActionResult =
  | { ok: true }
  | {
      ok: false;
      error: "unauthorized" | "forbidden" | "empty" | "too_many_photos" | "not_found" | "save_failed";
    };

function commentImageUrls(formData: FormData): string[] {
  return formData
    .getAll("imageUrls")
    .map((v) => String(v))
    .filter(Boolean)
    .slice(0, STAFF_SUGGESTION_MAX_IMAGES);
}

type ServiceClient = ReturnType<typeof getSupabaseServiceClient>;

async function loadParticipantIds(
  supabase: ServiceClient,
  organizationId: string,
  suggestionId: string,
): Promise<{
  authorId: string;
  recipientId: string;
  referenceIds: string[];
  title: string;
} | null> {
  const { data: sug } = await supabase
    .from("staff_suggestions")
    .select("created_by_user_id, recipient_user_id, title")
    .eq("id", suggestionId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  const row = sug as
    | { created_by_user_id: string; recipient_user_id: string; title: string }
    | null;
  if (!row) return null;
  const { data: refs } = await supabase
    .from("staff_suggestion_references")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("suggestion_id", suggestionId);
  return {
    authorId: row.created_by_user_id,
    recipientId: row.recipient_user_id,
    referenceIds: ((refs ?? []) as { user_id: string }[]).map((r) => r.user_id),
    title: row.title,
  };
}

export async function createStaffSuggestionComment(
  formData: FormData,
): Promise<CommentActionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, error: "unauthorized" };

  const suggestionId = cleanText(formData.get("suggestionId"));
  const body = cleanText(formData.get("body"));
  const imageUrls = commentImageUrls(formData);
  if (!suggestionId) return { ok: false, error: "not_found" };
  if (!body && imageUrls.length === 0) return { ok: false, error: "empty" };

  const supabase = getSupabaseServiceClient();
  const participants = await loadParticipantIds(supabase, session.organization.id, suggestionId);
  if (!participants) return { ok: false, error: "not_found" };

  const uid = session.user.id;
  const isParticipant =
    uid === participants.authorId ||
    uid === participants.recipientId ||
    participants.referenceIds.includes(uid) ||
    // 플랫폼 개발자는 모든 건의를 보고 상태도 바꾸므로 댓글도 단다(2026-10-23).
    isPlatformDeveloper(session.user.role);
  if (!isParticipant) return { ok: false, error: "forbidden" };

  const insert: Database["public"]["Tables"]["staff_suggestion_comments"]["Insert"] = {
    organization_id: session.organization.id,
    suggestion_id: suggestionId,
    created_by_user_id: uid,
    body: body || null,
    image_urls: imageUrls,
  };
  const { data: inserted, error } = await supabase
    .from("staff_suggestion_comments")
    .insert(insert)
    .select("id")
    .single();
  if (error) return { ok: false, error: "save_failed" };

  // Notify the other visible participants (author / recipient / referenced), skipping the commenter.
  const commentId = (inserted as { id: string } | null)?.id ?? suggestionId;
  await notifySuggestionParticipants(supabase, {
    organizationId: session.organization.id,
    suggestionId,
    recipientUserIds: [participants.authorId, participants.recipientId, ...participants.referenceIds],
    actorUserId: uid,
    dedupeBase: `suggestion_comment:${commentId}`,
    payload: {
      suggestionId,
      suggestionTitle: participants.title,
      actorUserId: uid,
      event: "comment",
    },
  });

  revalidatePath(`/mobile/suggestions/${suggestionId}`);
  return { ok: true };
}

export async function updateStaffSuggestionComment(
  formData: FormData,
): Promise<CommentActionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, error: "unauthorized" };

  const commentId = cleanText(formData.get("commentId"));
  const body = cleanText(formData.get("body"));
  const imageUrls = commentImageUrls(formData);
  if (!commentId) return { ok: false, error: "not_found" };
  if (!body && imageUrls.length === 0) return { ok: false, error: "empty" };

  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("staff_suggestion_comments")
    .select("id, suggestion_id, created_by_user_id, organization_id")
    .eq("id", commentId)
    .maybeSingle();
  const comment = data as {
    id: string;
    suggestion_id: string;
    created_by_user_id: string;
    organization_id: string;
  } | null;
  if (!comment || comment.organization_id !== session.organization.id) {
    return { ok: false, error: "not_found" };
  }
  // Edit is comment-author-only, independent of suggestion status.
  if (comment.created_by_user_id !== session.user.id) return { ok: false, error: "forbidden" };

  const { error } = await supabase
    .from("staff_suggestion_comments")
    .update({ body: body || null, image_urls: imageUrls })
    .eq("id", commentId)
    .eq("organization_id", session.organization.id);
  if (error) return { ok: false, error: "save_failed" };

  revalidatePath(`/mobile/suggestions/${comment.suggestion_id}`);
  return { ok: true };
}

export async function deleteStaffSuggestionComment(
  formData: FormData,
): Promise<CommentActionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, error: "unauthorized" };

  const commentId = cleanText(formData.get("commentId"));
  if (!commentId) return { ok: false, error: "not_found" };

  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("staff_suggestion_comments")
    .select("id, suggestion_id, created_by_user_id, organization_id")
    .eq("id", commentId)
    .maybeSingle();
  const comment = data as {
    id: string;
    suggestion_id: string;
    created_by_user_id: string;
    organization_id: string;
  } | null;
  if (!comment || comment.organization_id !== session.organization.id) {
    return { ok: false, error: "not_found" };
  }
  if (comment.created_by_user_id !== session.user.id) return { ok: false, error: "forbidden" };

  const { error } = await supabase
    .from("staff_suggestion_comments")
    .delete()
    .eq("id", commentId)
    .eq("organization_id", session.organization.id);
  if (error) return { ok: false, error: "save_failed" };

  revalidatePath(`/mobile/suggestions/${comment.suggestion_id}`);
  return { ok: true };
}

// ── Status (Step 6) ─────────────────────────────────────────────────────────────
//
// Only the recipient can change status. Transitions are freely reversible among the four statuses.
// `on_hold` requires a hold reason; `completed` requires a completion note (also enforced by DB
// CHECKs). Status never changes automatically. Service-role write (read-only participant RLS).

export type StatusActionResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "unauthorized"
        | "forbidden"
        | "invalid_status"
        | "missing_hold_reason"
        | "missing_completion_note"
        | "not_found"
        | "save_failed";
    };

export async function updateStaffSuggestionStatus(
  formData: FormData,
): Promise<StatusActionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, error: "unauthorized" };

  const suggestionId = cleanText(formData.get("suggestionId"));
  const targetStatus = cleanText(formData.get("status")) as StaffSuggestionStatus;
  const holdReason = cleanText(formData.get("holdReason"));
  const completionNote = cleanText(formData.get("completionNote"));

  if (!suggestionId) return { ok: false, error: "not_found" };
  if (!STAFF_SUGGESTION_STATUSES.includes(targetStatus)) return { ok: false, error: "invalid_status" };
  if (targetStatus === "on_hold" && !holdReason) return { ok: false, error: "missing_hold_reason" };
  if (targetStatus === "completed" && !completionNote) {
    return { ok: false, error: "missing_completion_note" };
  }

  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("staff_suggestions")
    .select("id, recipient_user_id, organization_id, created_by_user_id, title")
    .eq("id", suggestionId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  const sug = data as {
    id: string;
    recipient_user_id: string;
    organization_id: string;
    created_by_user_id: string;
    title: string;
  } | null;
  if (!sug) return { ok: false, error: "not_found" };
  // Recipient-only — author and referenced users cannot change status. 플랫폼 개발자는 예외(2026-10-23).
  if (!isOwnerOrPlatformDeveloper(session.user, sug.recipient_user_id)) return { ok: false, error: "forbidden" };

  // Persist the note that the target status requires; leave the other note untouched (it is hidden
  // by the detail UI unless its status is active).
  const updatePayload: Database["public"]["Tables"]["staff_suggestions"]["Update"] = { status: targetStatus };
  if (targetStatus === "on_hold") updatePayload.hold_reason = holdReason;
  if (targetStatus === "completed") updatePayload.completion_note = completionNote;

  const { error } = await supabase
    .from("staff_suggestions")
    .update(updatePayload)
    .eq("id", suggestionId)
    .eq("organization_id", session.organization.id);
  if (error) return { ok: false, error: "save_failed" };

  // Record the change as a thread event so the comment sheet can show an inline status log.
  await supabase.from("staff_suggestion_events").insert({
    organization_id: session.organization.id,
    suggestion_id: suggestionId,
    actor_user_id: session.user.id,
    status: targetStatus,
  });

  // Notify the author and referenced users (the acting recipient is skipped).
  const { data: refRows } = await supabase
    .from("staff_suggestion_references")
    .select("user_id")
    .eq("organization_id", session.organization.id)
    .eq("suggestion_id", suggestionId);
  const referenceIds = ((refRows ?? []) as { user_id: string }[]).map((r) => r.user_id);
  await notifySuggestionParticipants(supabase, {
    organizationId: session.organization.id,
    suggestionId,
    recipientUserIds: [sug.created_by_user_id, ...referenceIds],
    actorUserId: session.user.id,
    dedupeBase: `suggestion_status:${suggestionId}:${targetStatus}`,
    payload: {
      suggestionId,
      suggestionTitle: sug.title,
      actorUserId: session.user.id,
      event: "status",
      status: targetStatus,
    },
  });

  revalidatePath("/mobile/suggestions");
  revalidatePath(`/mobile/suggestions/${suggestionId}`);
  return { ok: true };
}
