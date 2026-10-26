// Customer Complaint (OTA 고객 컴플레인 기록) — server-only domain helpers.
//
// Reads use the RLS-scoped server client (RLS is the first defense line, org-isolated by
// has_active_membership). Writes use the service-role client AFTER an explicit code-level org +
// role gate, mirroring `src/lib/bug-reports.ts`. Image uploads are forced into a canonical storage
// path built from the session organization id so a client cannot write under another org/record.
//
// Top-level complaints are hard-deleted (MVP policy). Comments carry a `deleted_at` column and are
// soft-deleted, matching announcement/board comment convention.
//
// NOTE: `customer_complaints` / `complaint_comments` are not yet in the generated Database types, so
// table access goes through an untyped client view and row shapes are cast explicitly.

import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppSession } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isOwnStoragePublicUrl } from "@/lib/storage-url-guard";
import type { Database } from "@/types/database";
import { isPlatformDeveloper } from "@/config/roles";

export type ComplaintPlatform =
  | "airbnb"
  | "booking"
  | "google"
  | "tripadvisor"
  | "jalan"
  | "rakuten"
  | "direct"
  | "other";

export type ComplaintStatus = "open" | "resolved";

const COMPLAINT_PLATFORMS: ReadonlySet<ComplaintPlatform> = new Set([
  "airbnb",
  "booking",
  "google",
  "tripadvisor",
  "jalan",
  "rakuten",
  "direct",
  "other",
]);

const REQUEST_IMAGES_BUCKET = "request-images";
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type Complaint = {
  id: string;
  organizationId: string;
  createdByUserId: string;
  authorName: string;
  authorRole: string | null;
  title: string;
  platform: ComplaintPlatform;
  platformRef: string | null;
  status: ComplaintStatus;
  description: string | null;
  imageUrls: string[];
  rating: number | null;
  propertyId: string | null;
  propertyName: string | null;
  roomId: string | null;
  roomLabel: string | null;
  reservationId: string | null;
  guestName: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ComplaintComment = {
  id: string;
  complaintId: string;
  organizationId: string;
  createdByUserId: string;
  authorName: string;
  authorRole: string | null;
  content: string;
  imageUrls: string[];
  createdAt: string;
  updatedAt: string;
};

type ComplaintRow = {
  id: string;
  organization_id: string;
  created_by_user_id: string;
  title: string;
  platform: ComplaintPlatform;
  platform_ref: string | null;
  status: ComplaintStatus;
  description: string | null;
  image_urls: string[] | null;
  rating: number | null;
  property_id: string | null;
  property_name: string | null;
  room_id: string | null;
  room_label: string | null;
  reservation_id: string | null;
  guest_name: string | null;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

type ComplaintCommentRow = {
  id: string;
  complaint_id: string;
  organization_id: string;
  created_by_user_id: string;
  content: string;
  image_urls: string[] | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

const COMPLAINT_COLS =
  "id, organization_id, created_by_user_id, title, platform, platform_ref, status, description, image_urls, rating, property_id, property_name, room_id, room_label, reservation_id, guest_name, resolved_at, resolved_by_user_id, created_at, updated_at";

const COMMENT_COLS =
  "id, complaint_id, organization_id, created_by_user_id, content, image_urls, created_at, updated_at, deleted_at";

// `customer_complaints` / `complaint_comments` are not in the generated Database types yet; this view
// drops the schema generic so table access type-checks until types are regenerated.
function untyped(client: SupabaseClient<Database>): SupabaseClient {
  return client as unknown as SupabaseClient;
}

function requireOrg(session: AppSession): string {
  if (session.organization.id === "platform") {
    throw new Error("no_org");
  }
  return session.organization.id;
}

export function canWriteComplaint(who: { capabilities: readonly string[] }): boolean {
  return who.capabilities.includes("complaint.write");
}

export function canWriteComment(who: { capabilities: readonly string[] }): boolean {
  return who.capabilities.includes("complaint.comment");
}

/** 상태 변경(resolve/reopen): 작성자 본인 또는 owner/office_admin/super-admin. */
export function canChangeStatus(
  session: AppSession,
  complaint: Pick<Complaint, "createdByUserId">,
): boolean {
  return (
    complaint.createdByUserId === session.user.id ||
    session.capabilities.includes("complaint.manage")
  );
}

/**
 * 컴플레인 조정 권한(owner/office_admin/super-admin) 여부. UI에서 "작성자 본인 외에도 삭제/상태
 * 변경 버튼을 보여줄지" 판단하는 용도다. 실제 삭제 권한은 `deleteComplaint`가 서버에서 다시 검증한다.
 */
export function canModerateComplaints(who: { capabilities: readonly string[] }): boolean {
  return who.capabilities.includes("complaint.manage");
}

function isComplaintAdmin(session: AppSession): boolean {
  return session.capabilities.includes("complaint.manage");
}

function validateTitle(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("title_required");
  return trimmed;
}

function validatePlatform(value: string): ComplaintPlatform {
  if (!COMPLAINT_PLATFORMS.has(value as ComplaintPlatform)) {
    throw new Error("invalid_platform");
  }
  return value as ComplaintPlatform;
}

/**
 * 사진 주소 검사 — 5장 상한 + 우리 Storage 주소만(2026-10-26, 예전엔 장수만 봤다).
 * `prefix` 아래 무작위 폴더 한 칸 + 파일이어야 한다:
 *   컴플레인 = `{조직}/complaint-images/{작성 중 id}/{파일}` (작성 화면이 만든 draft id 폴더),
 *   댓글    = `{조직}/complaint-comment-images/{컴플레인 id}/{댓글 id}/{파일}`.
 * `keep` 은 이미 이 글에 저장된 주소(수정 때 그대로 다시 오는 것)라 그대로 통과.
 */
function validateImages(urls: string[], prefix: string, keep: readonly string[] = []): void {
  if (!Array.isArray(urls) || urls.length > MAX_IMAGES) throw new Error("too_many_photos");
  const ok = urls.every(
    (url) =>
      typeof url === "string" &&
      (keep.includes(url) || isOwnStoragePublicUrl(url, REQUEST_IMAGES_BUCKET, prefix, { subfolders: 1 })),
  );
  if (!ok) throw new Error("invalid_image");
}

function normalizeOptional(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeRating(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return value;
}

// 허용 이미지 형식 — SVG 는 스크립트를 품을 수 있어 막는다. 확장자는 파일명이 아니라 MIME 에서 정한다.
const COMPLAINT_IMAGE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
};

function safeExt(file: File): string {
  return COMPLAINT_IMAGE_EXT[file.type.toLowerCase()] ?? "bin";
}

function assertImageFile(file: File): void {
  if (!(file.type.toLowerCase() in COMPLAINT_IMAGE_EXT)) throw new Error("invalid_image_type");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("image_too_large");
}

function assertRecordId(id: string, message: string): void {
  if (!/^[a-f0-9-]{8,}$/i.test(id)) throw new Error(message);
}

/**
 * Upload one complaint screenshot. The storage path is server-constructed from the session org id +
 * the supplied complaintId, so the caller cannot write outside their org or under a different id.
 * Path: `{org_id}/complaint-images/{complaint_id}/{uuid}.{ext}`.
 */
export async function uploadComplaintImage(input: {
  session: AppSession;
  complaintId: string;
  file: File;
}): Promise<string> {
  const { session, complaintId, file } = input;
  const organizationId = requireOrg(session);
  if (!canWriteComplaint(session)) throw new Error("forbidden");
  assertImageFile(file);
  assertRecordId(complaintId, "invalid_complaint_id");

  const service = getSupabaseServiceClient();
  const path = `${organizationId}/complaint-images/${complaintId}/${randomUUID()}.${safeExt(file)}`;
  const { error } = await service.storage
    .from(REQUEST_IMAGES_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error("upload_failed");

  const { data } = service.storage.from(REQUEST_IMAGES_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Upload one complaint-comment image.
 * Path: `{org_id}/complaint-comment-images/{complaint_id}/{comment_id}/{uuid}.{ext}`.
 */
export async function uploadComplaintCommentImage(input: {
  session: AppSession;
  complaintId: string;
  commentId: string;
  file: File;
}): Promise<string> {
  const { session, complaintId, commentId, file } = input;
  const organizationId = requireOrg(session);
  if (!canWriteComment(session)) throw new Error("forbidden");
  assertImageFile(file);
  assertRecordId(complaintId, "invalid_complaint_id");
  assertRecordId(commentId, "invalid_comment_id");

  const service = getSupabaseServiceClient();
  const path = `${organizationId}/complaint-comment-images/${complaintId}/${commentId}/${randomUUID()}.${safeExt(file)}`;
  const { error } = await service.storage
    .from(REQUEST_IMAGES_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error("upload_failed");

  const { data } = service.storage.from(REQUEST_IMAGES_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

type AuthorInfo = { name: string; role: string | null };

async function fetchAuthorInfo(
  organizationId: string,
  userIds: string[],
): Promise<Map<string, AuthorInfo>> {
  const map = new Map<string, AuthorInfo>();
  const ids = Array.from(new Set(userIds)).filter(Boolean);
  if (ids.length === 0) return map;

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id, role, profiles(name)")
    .eq("organization_id", organizationId)
    .in("user_id", ids);
  if (error) return map;

  for (const m of (data ?? []) as Array<{
    user_id: string;
    role: string;
    profiles: { name: string } | { name: string }[] | null;
  }>) {
    const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    map.set(m.user_id, { name: profile?.name ?? "", role: m.role ?? null });
  }
  return map;
}

function mapComplaint(row: ComplaintRow, author: AuthorInfo | undefined): Complaint {
  return {
    id: row.id,
    organizationId: row.organization_id,
    createdByUserId: row.created_by_user_id,
    authorName: author?.name ?? "",
    authorRole: author?.role ?? null,
    title: row.title,
    platform: row.platform,
    platformRef: row.platform_ref,
    status: row.status,
    description: row.description,
    imageUrls: row.image_urls ?? [],
    rating: row.rating,
    propertyId: row.property_id,
    propertyName: row.property_name,
    roomId: row.room_id,
    roomLabel: row.room_label,
    reservationId: row.reservation_id,
    guestName: row.guest_name,
    resolvedAt: row.resolved_at,
    resolvedByUserId: row.resolved_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function hydrateComplaints(
  organizationId: string,
  rows: ComplaintRow[],
): Promise<Complaint[]> {
  if (rows.length === 0) return [];
  const info = await fetchAuthorInfo(organizationId, rows.map((r) => r.created_by_user_id));
  return rows.map((row) => mapComplaint(row, info.get(row.created_by_user_id)));
}

/** 조직 컴플레인 목록 (최신순). 선택적 status / platform 필터. */
export async function listComplaints(input: {
  session: AppSession;
  status?: ComplaintStatus;
  platform?: ComplaintPlatform;
}): Promise<Complaint[]> {
  const { session } = input;
  const organizationId = requireOrg(session);

  const supabase = await getSupabaseServerClient();
  let query = untyped(supabase)
    .from("customer_complaints")
    .select(COMPLAINT_COLS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (input.status) query = query.eq("status", input.status);
  if (input.platform) query = query.eq("platform", input.platform);

  const { data, error } = await query;
  if (error) return [];
  return hydrateComplaints(organizationId, (data ?? []) as unknown as ComplaintRow[]);
}

/** 단건 조회. 조직 격리 확인. 없으면 null. */
export async function getComplaint(input: {
  session: AppSession;
  id: string;
}): Promise<Complaint | null> {
  const { session, id } = input;
  const organizationId = requireOrg(session);

  const supabase = await getSupabaseServerClient();
  const { data, error } = await untyped(supabase)
    .from("customer_complaints")
    .select(COMPLAINT_COLS)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) return null;

  const hydrated = await hydrateComplaints(organizationId, [data as unknown as ComplaintRow]);
  return hydrated[0] ?? null;
}

export type ComplaintInput = {
  platform: string;
  title: string;
  description?: string | null;
  platformRef?: string | null;
  rating?: number | null;
  propertyId?: string | null;
  propertyName?: string | null;
  roomId?: string | null;
  roomLabel?: string | null;
  reservationId?: string | null;
  guestName?: string | null;
  imageUrls: string[];
};

/** 컴플레인 생성. 작성 권한 게이트 포함. id는 서버에서 생성. */
export async function createComplaint(input: {
  session: AppSession;
  input: ComplaintInput;
}): Promise<{ id: string }> {
  const { session } = input;
  const organizationId = requireOrg(session);
  if (!canWriteComplaint(session)) throw new Error("forbidden");

  const platform = validatePlatform(input.input.platform);
  const title = validateTitle(input.input.title);
  validateImages(input.input.imageUrls, `${organizationId}/complaint-images/`);

  const service = getSupabaseServiceClient();
  const id = randomUUID();
  const now = new Date().toISOString();
  const insert = {
    id,
    organization_id: organizationId,
    created_by_user_id: session.user.id,
    title,
    platform,
    platform_ref: normalizeOptional(input.input.platformRef),
    status: "open" satisfies ComplaintStatus,
    description: normalizeOptional(input.input.description),
    image_urls: input.input.imageUrls,
    rating: normalizeRating(input.input.rating),
    property_id: normalizeOptional(input.input.propertyId),
    property_name: normalizeOptional(input.input.propertyName),
    room_id: normalizeOptional(input.input.roomId),
    room_label: normalizeOptional(input.input.roomLabel),
    reservation_id: normalizeOptional(input.input.reservationId),
    guest_name: normalizeOptional(input.input.guestName),
    created_at: now,
    updated_at: now,
  };

  const { error } = await untyped(service).from("customer_complaints").insert(insert);
  if (error) throw new Error("save_failed");
  return { id };
}

async function loadComplaintForWrite(
  id: string,
  organizationId: string,
): Promise<ComplaintRow | null> {
  const service = getSupabaseServiceClient();
  const { data, error } = await untyped(service)
    .from("customer_complaints")
    .select(COMPLAINT_COLS)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as ComplaintRow;
}

export type ComplaintPatch = Partial<ComplaintInput>;

/** 수정. 작성자 본인 + open 상태일 때만. 플랫폼 개발자는 둘 다 예외(2026-10-23). */
export async function updateComplaint(input: {
  session: AppSession;
  id: string;
  patch: ComplaintPatch;
}): Promise<void> {
  const { session, id, patch } = input;
  const organizationId = requireOrg(session);

  const existing = await loadComplaintForWrite(id, organizationId);
  if (!existing) throw new Error("not_found");
  const developer = isPlatformDeveloper(session.user.role);
  if (existing.created_by_user_id !== session.user.id && !developer) throw new Error("forbidden");
  if (existing.status !== "open" && !developer) throw new Error("not_editable");

  const update: Database["public"]["Tables"]["customer_complaints"]["Update"] = { updated_at: new Date().toISOString() };
  if (patch.platform !== undefined) update.platform = validatePlatform(patch.platform);
  if (patch.title !== undefined) update.title = validateTitle(patch.title);
  if (patch.description !== undefined) update.description = normalizeOptional(patch.description);
  if (patch.platformRef !== undefined) update.platform_ref = normalizeOptional(patch.platformRef);
  if (patch.rating !== undefined) update.rating = normalizeRating(patch.rating);
  if (patch.propertyId !== undefined) update.property_id = normalizeOptional(patch.propertyId);
  if (patch.propertyName !== undefined) update.property_name = normalizeOptional(patch.propertyName);
  if (patch.roomId !== undefined) update.room_id = normalizeOptional(patch.roomId);
  if (patch.roomLabel !== undefined) update.room_label = normalizeOptional(patch.roomLabel);
  if (patch.reservationId !== undefined) {
    update.reservation_id = normalizeOptional(patch.reservationId);
  }
  if (patch.guestName !== undefined) update.guest_name = normalizeOptional(patch.guestName);
  if (patch.imageUrls !== undefined) {
    validateImages(patch.imageUrls, `${organizationId}/complaint-images/`, existing.image_urls ?? []);
    update.image_urls = patch.imageUrls;
  }

  const service = getSupabaseServiceClient();
  const { error } = await untyped(service)
    .from("customer_complaints")
    .update(update)
    .eq("id", id)
    .eq("organization_id", organizationId);
  if (error) throw new Error("save_failed");
}

/** 삭제 (hard delete). 작성자 본인 또는 owner/office_admin/super-admin. */
export async function deleteComplaint(input: {
  session: AppSession;
  id: string;
}): Promise<void> {
  const { session, id } = input;
  const organizationId = requireOrg(session);

  const existing = await loadComplaintForWrite(id, organizationId);
  if (!existing) throw new Error("not_found");
  if (existing.created_by_user_id !== session.user.id && !isComplaintAdmin(session)) {
    throw new Error("forbidden");
  }

  const service = getSupabaseServiceClient();
  const { error } = await untyped(service)
    .from("customer_complaints")
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId);
  if (error) throw new Error("save_failed");
}

async function setComplaintStatus(
  session: AppSession,
  id: string,
  status: ComplaintStatus,
): Promise<void> {
  const organizationId = requireOrg(session);
  const existing = await loadComplaintForWrite(id, organizationId);
  if (!existing) throw new Error("not_found");
  if (!canChangeStatus(session, { createdByUserId: existing.created_by_user_id })) {
    throw new Error("forbidden");
  }
  if (existing.status === status) return;

  const now = new Date().toISOString();
  const update: Database["public"]["Tables"]["customer_complaints"]["Update"] = { status, updated_at: now };
  if (status === "resolved") {
    update.resolved_at = now;
    update.resolved_by_user_id = session.user.id;
  } else {
    update.resolved_at = null;
    update.resolved_by_user_id = null;
  }

  const service = getSupabaseServiceClient();
  const { error } = await untyped(service)
    .from("customer_complaints")
    .update(update)
    .eq("id", id)
    .eq("organization_id", organizationId);
  if (error) throw new Error("save_failed");
}

/** 상태 → resolved. */
export async function resolveComplaint(input: { session: AppSession; id: string }): Promise<void> {
  await setComplaintStatus(input.session, input.id, "resolved");
}

/** 상태 → open. */
export async function reopenComplaint(input: { session: AppSession; id: string }): Promise<void> {
  await setComplaintStatus(input.session, input.id, "open");
}

function mapComment(row: ComplaintCommentRow, author: AuthorInfo | undefined): ComplaintComment {
  return {
    id: row.id,
    complaintId: row.complaint_id,
    organizationId: row.organization_id,
    createdByUserId: row.created_by_user_id,
    authorName: author?.name ?? "",
    authorRole: author?.role ?? null,
    content: row.content,
    imageUrls: row.image_urls ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 댓글 목록 (오래된 순). soft-deleted 제외. */
export async function listComplaintComments(input: {
  session: AppSession;
  complaintId: string;
}): Promise<ComplaintComment[]> {
  const { session, complaintId } = input;
  const organizationId = requireOrg(session);

  const supabase = await getSupabaseServerClient();
  const { data, error } = await untyped(supabase)
    .from("complaint_comments")
    .select(COMMENT_COLS)
    .eq("organization_id", organizationId)
    .eq("complaint_id", complaintId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) return [];

  const rows = (data ?? []) as unknown as ComplaintCommentRow[];
  if (rows.length === 0) return [];
  const info = await fetchAuthorInfo(organizationId, rows.map((r) => r.created_by_user_id));
  return rows.map((row) => mapComment(row, info.get(row.created_by_user_id)));
}

async function loadCommentForWrite(
  id: string,
  organizationId: string,
): Promise<ComplaintCommentRow | null> {
  const service = getSupabaseServiceClient();
  const { data, error } = await untyped(service)
    .from("complaint_comments")
    .select(COMMENT_COLS)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as ComplaintCommentRow;
}

/** 댓글 생성. 권한 키 `complaint.comment`(역할 기본: 알바 빼고 전원, 사람마다 켜고 끔). 대상 컴플레인이 같은 조직에 존재해야 함. */
export async function createComplaintComment(input: {
  session: AppSession;
  complaintId: string;
  content: string;
  imageUrls: string[];
}): Promise<{ id: string }> {
  const { session, complaintId } = input;
  const organizationId = requireOrg(session);
  if (!canWriteComment(session)) throw new Error("forbidden");

  const content = input.content.trim();
  if (!content) throw new Error("content_required");
  validateImages(input.imageUrls, `${organizationId}/complaint-comment-images/${complaintId}/`);

  const complaint = await loadComplaintForWrite(complaintId, organizationId);
  if (!complaint) throw new Error("not_found");

  const service = getSupabaseServiceClient();
  const id = randomUUID();
  const now = new Date().toISOString();
  const insert = {
    id,
    complaint_id: complaintId,
    organization_id: organizationId,
    created_by_user_id: session.user.id,
    content,
    image_urls: input.imageUrls,
    created_at: now,
    updated_at: now,
  };

  const { error } = await untyped(service).from("complaint_comments").insert(insert);
  if (error) throw new Error("save_failed");
  return { id };
}

/** 댓글 수정. 작성자 본인만(플랫폼 개발자 예외, 2026-10-23). */
export async function updateComplaintComment(input: {
  session: AppSession;
  commentId: string;
  content: string;
}): Promise<void> {
  const { session, commentId } = input;
  const organizationId = requireOrg(session);

  const content = input.content.trim();
  if (!content) throw new Error("content_required");

  const existing = await loadCommentForWrite(commentId, organizationId);
  if (!existing || existing.deleted_at) throw new Error("not_found");
  if (existing.created_by_user_id !== session.user.id && !isPlatformDeveloper(session.user.role)) {
    throw new Error("forbidden");
  }

  const service = getSupabaseServiceClient();
  const { error } = await untyped(service)
    .from("complaint_comments")
    .update({ content, updated_at: new Date().toISOString() })
    .eq("id", commentId)
    .eq("organization_id", organizationId);
  if (error) throw new Error("save_failed");
}

/** 댓글 삭제 (soft delete). 작성자 본인 또는 owner/office_admin/super-admin. */
export async function deleteComplaintComment(input: {
  session: AppSession;
  commentId: string;
}): Promise<void> {
  const { session, commentId } = input;
  const organizationId = requireOrg(session);

  const existing = await loadCommentForWrite(commentId, organizationId);
  if (!existing || existing.deleted_at) throw new Error("not_found");
  if (existing.created_by_user_id !== session.user.id && !isComplaintAdmin(session)) {
    throw new Error("forbidden");
  }

  const service = getSupabaseServiceClient();
  const { error } = await untyped(service)
    .from("complaint_comments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", commentId)
    .eq("organization_id", organizationId);
  if (error) throw new Error("save_failed");
}
