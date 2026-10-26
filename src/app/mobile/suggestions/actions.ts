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
import { isOwnStoragePublicUrl } from "@/lib/storage-url-guard";
import type { Database } from "@/types/database";

// database.ts 에는 Relationships 가 없어서 `service.rpc()` 에 타입이 붙지 않는다. 원자적 수정 RPC 에 필요한 만큼만
// 타입을 붙인다(src/app/onboarding/actions.ts 의 패턴과 같음). 이전 참조 user_id 들을
// 돌려준다.
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
 * 제안 · 댓글 사진 주소 — 우리 Storage 의 `{조직}/suggestion-images/{무작위 id}/{파일}` 아래만 받는다(2026-10-26).
 * 업로더(`suggestions-compose` · `suggestion-comment-composer`)는 올릴 때마다 무작위 폴더를 하나 만든다.
 * 예전엔 아무 문자열이나 저장됐다. `keep` 은 이미 이 글에 저장된 주소(수정 때 그대로 다시 보내는 것)라 그대로 통과.
 */
function areSuggestionImageUrls(urls: string[], organizationId: string, keep: readonly string[] = []): boolean {
  const prefix = `${organizationId}/suggestion-images/`;
  return urls.every(
    (url) => keep.includes(url) || isOwnStoragePublicUrl(url, "request-images", prefix, { subfolders: 1 }),
  );
}

/**
 * 직원 제안 생성(2단계 — 생성 흐름).
 *
 * 활성 조직 구성원이면 누구나 만들 수 있다. 받는 사람은 정확히 1명이어야 한다(같은 조직의 활성 구성원, 작성자 제외).
 * 참조 사용자는 선택이다(같은 조직의 활성 구성원, 중복 제거, 작성자와 받는 사람은 제외).
 * 제목과 본문은 필수이고 사진은 5장까지다. 초기 상태는 항상 `submitted` 이다. 여기에는 상태/알림 로직이 없다.
 * 테이블이 참여자 읽기 전용 RLS 만 열어 두므로 쓰기는 service-role 클라이언트로 한다
 * (마이그레이션 202606160001 참고).
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
  if (!areSuggestionImageUrls(imageUrls, session.organization.id)) redirect(`${NEW}?error=save_failed`);

  // 같은 조직의 활성 구성원(작성자 제외). 받는 사람과 참조를 한 곳에서 검증한다.
  const allowed = new Set((await getShareableUsers(session)).map((u) => u.id));
  if (recipientId === session.user.id || !allowed.has(recipientId)) {
    redirect(`${NEW}?error=invalid_recipient`);
  }

  // 참조: 활성 구성원만, 작성자와 받는 사람은 제외, 중복 제거.
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
      // 부모를 롤백해 참조가 일부만 들어간 제안이 남지 않게 한다.
      await supabase.from("staff_suggestions").delete().eq("id", id);
      redirect(`${NEW}?error=save_failed`);
    }
  }

  // 받는 사람(created)과 참조된 사용자(referenced)에게 알린다. 작성자는 건너뛴다.
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

// 작성자가 제안 본문(제목 / 본문 / 분류 / 받는 사람 / 참조 / 맥락 /
// 사진)을 수정한다 — `status = 'submitted'` 일 때만 가능. 참조는 통째로 다시 맞추고, 새로 추가된
// 참조 사용자에게는 `referenced` 알림을 보낸다.
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
    .select("id, created_by_user_id, recipient_user_id, status, image_urls")
    .eq("id", suggestionId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  const current = rawCurrent as
    | {
        id: string;
        created_by_user_id: string;
        recipient_user_id: string;
        status: string;
        image_urls: string[] | null;
      }
    | null;
  // 작성자만, 그리고 submitted 상태일 때만 — 아니면 상세로 돌려보낸다(정보 노출 없음).
  if (!current || current.created_by_user_id !== session.user.id || current.status !== "submitted") {
    redirect(`/mobile/suggestions/${suggestionId}`);
  }
  const previousRecipientId = current.recipient_user_id;
  if (!areSuggestionImageUrls(imageUrls, session.organization.id, current.image_urls ?? [])) {
    redirect(`${EDIT}?error=save_failed`);
  }

  const allowed = new Set((await getShareableUsers(session)).map((u) => u.id));
  if (recipientId === session.user.id || !allowed.has(recipientId)) {
    redirect(`${EDIT}?error=invalid_recipient`);
  }
  const references = Array.from(new Set(referenceIds)).filter(
    (uid) => uid !== session.user.id && uid !== recipientId && allowed.has(uid),
  );

  // 원자적 수정: RPC 가 한 트랜잭션에서 행을 갱신하고 참조를 다시 맞춘다(삭제 + 삽입).
  // 그래서 다시 넣기가 실패해도 참조가 반쯤 지워진 채 남지 않는다. 이전 참조 id 를 돌려주므로
  // 새로 추가된 사람에게만 알릴 수 있다. (service 클라이언트로 실행하며, 이미 RLS 를
  // 우회한다.)
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

  // 새로 추가된 참조 사용자에게 알린다.
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

  // 받는 사람이 실제로 바뀐 경우에만 알린다(본인에게는 헬퍼가 알림을 막는다).
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

// 작성자가 제안 본문을 삭제한다 — `status = 'submitted'` 일 때만 가능. 완전 삭제이며,
// 참조와 댓글은 cascade 로 지워진다.
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

// ── 댓글 (5단계) ───────────────────────────────────────────────────────────
//
// 댓글은 어떤 제안 상태에서도 가능하다(상태 제한 없음). 작성은 보이는 참여자(작성자 / 받는 사람 /
// 참조 사용자) 누구나 할 수 있고, 수정 + 삭제는 댓글 작성자만 가능하다. 댓글은 완전히 비어 있으면
// 안 되고(글 또는 사진 1장 이상), 사진은 5장까지다. 쓰기는 service-role 클라이언트로 하므로
// (참여자 읽기 전용 RLS) 권한은 여기서 강제한다. 이 액션들은 리다이렉트하지 않고
// 결과 객체를 돌려준다(작성창이 상세 페이지에 남는다).

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
    .filter(Boolean);
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
  // 5장 상한은 잘라 버리지 않고 거절한다 · 우리 Storage 주소만(2026-10-26).
  if (imageUrls.length > STAFF_SUGGESTION_MAX_IMAGES) return { ok: false, error: "too_many_photos" };
  if (!areSuggestionImageUrls(imageUrls, session.organization.id)) return { ok: false, error: "save_failed" };

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

  // 댓글 작성자를 뺀 나머지 보이는 참여자(작성자 / 받는 사람 / 참조 사용자)에게 알린다.
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
    .select("id, suggestion_id, created_by_user_id, organization_id, image_urls")
    .eq("id", commentId)
    .maybeSingle();
  const comment = data as {
    id: string;
    suggestion_id: string;
    created_by_user_id: string;
    organization_id: string;
    image_urls: string[] | null;
  } | null;
  if (!comment || comment.organization_id !== session.organization.id) {
    return { ok: false, error: "not_found" };
  }
  // 수정은 제안 상태와 상관없이 댓글 작성자만 할 수 있다.
  if (comment.created_by_user_id !== session.user.id) return { ok: false, error: "forbidden" };
  if (imageUrls.length > STAFF_SUGGESTION_MAX_IMAGES) return { ok: false, error: "too_many_photos" };
  if (!areSuggestionImageUrls(imageUrls, session.organization.id, comment.image_urls ?? [])) {
    return { ok: false, error: "save_failed" };
  }

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
    .select("id, suggestion_id, created_by_user_id, organization_id, image_urls")
    .eq("id", commentId)
    .maybeSingle();
  const comment = data as {
    id: string;
    suggestion_id: string;
    created_by_user_id: string;
    organization_id: string;
    image_urls: string[] | null;
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

// ── 상태 (6단계) ───────────────────────────────────────────────────────────
//
// 상태는 받는 사람만 바꿀 수 있다. 네 가지 상태 사이의 전환은 자유롭게 되돌릴 수 있다.
// `on_hold` 는 보류 사유가, `completed` 는 완료 메모가 필요하다(DB CHECK 로도 강제).
// 상태는 자동으로 바뀌지 않는다. service-role 쓰기(참여자 읽기 전용 RLS).

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
  // 받는 사람만 — 작성자와 참조 사용자는 상태를 바꿀 수 없다. 플랫폼 개발자는 예외(2026-10-23).
  if (!isOwnerOrPlatformDeveloper(session.user, sug.recipient_user_id)) return { ok: false, error: "forbidden" };

  // 대상 상태가 요구하는 메모를 저장하고, 다른 메모는 그대로 둔다(그 상태가 활성이 아니면
  // 상세 화면에서 숨겨진다).
  const updatePayload: Database["public"]["Tables"]["staff_suggestions"]["Update"] = { status: targetStatus };
  if (targetStatus === "on_hold") updatePayload.hold_reason = holdReason;
  if (targetStatus === "completed") updatePayload.completion_note = completionNote;

  const { error } = await supabase
    .from("staff_suggestions")
    .update(updatePayload)
    .eq("id", suggestionId)
    .eq("organization_id", session.organization.id);
  if (error) return { ok: false, error: "save_failed" };

  // 변경을 스레드 이벤트로 기록해, 댓글 시트에서 인라인 상태 로그를 보여줄 수 있게 한다.
  await supabase.from("staff_suggestion_events").insert({
    organization_id: session.organization.id,
    suggestion_id: suggestionId,
    actor_user_id: session.user.id,
    status: targetStatus,
  });

  // 작성자와 참조 사용자에게 알린다(상태를 바꾼 받는 사람은 제외).
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
