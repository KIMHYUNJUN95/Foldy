// 고객 컴플레인(OTA 고객 컴플레인 기록) — 서버 전용 도메인 헬퍼.
//
// 읽기는 RLS 범위 서버 클라이언트를 쓴다(RLS 가 1차 방어선이며 조직 격리는
// has_active_membership 으로). 쓰기는 명시적인 코드 수준 조직 + 권한 게이트(`complaintRights`) 를 거친 뒤
// service-role 클라이언트를 쓴다. 이미지 업로드는 정식 스토리지 경로로 강제되며 세션 조직 id 로 만들어져
// 클라이언트가 다른 조직/기록 아래에 쓸 수 없다.
//
// 컴플레인 본체는 하드 삭제한다(MVP 정책 — 사진 파일은 Storage 에 남는다, 다른 기능과 같은 알려진 한계).
// 댓글은 `deleted_at` 으로 소프트 삭제하며 공지/게시판 댓글 규칙과 같다.
//
// 등록 · 댓글은 화면이 보낸 `submission_id`(작성 한 번당 uuid 하나)로 중복을 막는다(2026-11-10) — 같은 id 가
// 다시 오면 새 줄을 만들지 않고 먼저 만든 줄 id 를 돌려준다. DB 의 부분 유니크 인덱스가 경합까지 막는다.
//
// 표 타입은 `src/types/database.ts` 에 있지만 select 문자열 추론과 맞지 않아 타입 없는 뷰로 읽고 행 모양을
// 명시적으로 캐스팅한다.

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

// 스키마 제네릭을 떼어 select 문자열 추론 없이 표에 접근한다(행 모양은 명시 캐스팅).
function untyped(client: SupabaseClient<Database>): SupabaseClient {
  return client as unknown as SupabaseClient;
}

function requireOrg(session: AppSession): string {
  if (session.organization.id === "platform") {
    throw new Error("no_org");
  }
  return session.organization.id;
}

type Who = { user: { id: string }; capabilities: readonly string[] };

export type ComplaintRights = { edit: boolean; delete: boolean; changeStatus: boolean };

/**
 * 컴플레인 한 건에 대해 할 수 있는 일 — **서버 가드와 화면 노출이 함께 쓰는 단 하나의 판정**(2026-11-10).
 *
 * - 해결 · 다시 열기: `complaint.manage` 만. 예전엔 작성자 본인도 됐다(작성자 예외 없앰).
 * - 수정 · 삭제: 작성자 본인이 **지금도** `complaint.write` 를 가졌거나, `complaint.manage`.
 *   권한을 잃은 작성자가 자기 글을 계속 고치거나 지울 수 있던 구멍을 막는다.
 * 플랫폼 개발자는 권한 목록이 전부 켜져 있어(platformBypass) 따로 분기하지 않는다.
 */
export function complaintRights(who: Who, complaint: Pick<Complaint, "createdByUserId">): ComplaintRights {
  const manage = who.capabilities.includes("complaint.manage");
  const ownWithWrite = complaint.createdByUserId === who.user.id && who.capabilities.includes("complaint.write");
  return { edit: manage || ownWithWrite, delete: manage || ownWithWrite, changeStatus: manage };
}

export function canWriteComplaint(who: { capabilities: readonly string[] }): boolean {
  return who.capabilities.includes("complaint.write");
}

export function canWriteComment(who: { capabilities: readonly string[] }): boolean {
  return who.capabilities.includes("complaint.comment");
}

/** 상태 변경(resolve/reopen) — `complaintRights().changeStatus`. */
export function canChangeStatus(who: Who, complaint: Pick<Complaint, "createdByUserId">): boolean {
  return complaintRights(who, complaint).changeStatus;
}

/** 삭제 — `complaintRights().delete`. 화면의 휴지통 노출도 이것으로 정한다. */
export function canDeleteComplaint(who: Who, complaint: Pick<Complaint, "createdByUserId">): boolean {
  return complaintRights(who, complaint).delete;
}

/**
 * `complaint.manage` 여부(내보내기 · 남의 댓글 지우기). 컴플레인 한 건의 수정 · 삭제 · 상태 판정은
 * `complaintRights` 를 쓴다.
 */
export function canModerateComplaints(who: { capabilities: readonly string[] }): boolean {
  return who.capabilities.includes("complaint.manage");
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

/** 플랫폼별 만점 — 화면 `cx-platform.tsx` 의 `maxRating` 과 같다. 0 = 점수 없는 플랫폼. */
const RATING_MAX: Record<ComplaintPlatform, number> = {
  airbnb: 5,
  booking: 10,
  google: 5,
  tripadvisor: 5,
  jalan: 5,
  rakuten: 5,
  direct: 0,
  other: 0,
};

/** 평점 — 없으면 null. 있으면 0 초과 · 플랫폼 만점 이하만(2026-11-10, 예전엔 범위를 안 봤다). 점수 없는 플랫폼은 null. */
function normalizeRating(value: number | null | undefined, platform: ComplaintPlatform): number | null {
  if (value == null || Number.isNaN(value)) return null;
  const max = RATING_MAX[platform];
  // 점수 없는 플랫폼(직접 · 기타)은 남은 값을 버린다 — 화면에서 플랫폼을 바꾸면 고른 별이 남아 따라올 수 있다.
  if (max === 0) return null;
  if (!Number.isFinite(value) || value <= 0 || value > max) throw new Error("invalid_rating");
  return value;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 화면이 보낸 중복 막기 id — 없으면 null, 있으면 uuid 여야 한다. */
function normalizeSubmissionId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!UUID_RE.test(trimmed)) throw new Error("invalid_submission");
  return trimmed.toLowerCase();
}

/**
 * 연결 id(건물 · 객실 · 예약)가 세션 조직 것인지 확인한다(2026-11-10). 예전엔 화면이 보낸 id 를 그대로 저장해
 * 다른 조직의 객실 · 예약 id 를 걸 수 있었다. 형식이 틀리거나 우리 조직에 없으면 `invalid_link`.
 */
async function assertLinksInOrg(
  organizationId: string,
  links: { propertyId: string | null; roomId: string | null; reservationId: string | null },
): Promise<void> {
  const checks: Array<[string, string]> = [];
  if (links.propertyId) checks.push(["properties", links.propertyId]);
  if (links.roomId) checks.push(["rooms", links.roomId]);
  if (links.reservationId) checks.push(["reservations", links.reservationId]);
  if (checks.length === 0) return;
  if (checks.some(([, id]) => !UUID_RE.test(id))) throw new Error("invalid_link");
  const service = untyped(getSupabaseServiceClient());
  const results = await Promise.all(
    checks.map(([table, id]) =>
      service.from(table).select("id").eq("id", id).eq("organization_id", organizationId).maybeSingle(),
    ),
  );
  if (results.some((r) => r.error || !r.data)) throw new Error("invalid_link");
}

function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}

/** `submission_id` 칸이 아직 없는 DB(마이그레이션 전) — 그때는 칸 없이 다시 넣는다. */
function isMissingColumn(error: { code?: string } | null | undefined): boolean {
  return error?.code === "PGRST204" || error?.code === "42703";
}

/**
 * 같은 submission_id 로 이미 들어간 줄. `scope` 가 있으면(댓글 — `complaint_id`) 그 칸도 맞아야 한다 —
 * 다른 컴플레인에 달린 줄을 «이미 저장됨»으로 돌려주면 안 되므로, 칸이 다르면 `invalid_submission`.
 */
async function findBySubmission(
  table: string,
  organizationId: string,
  submissionId: string,
  scope?: { column: string; value: string },
): Promise<string | null> {
  const { data, error } = await untyped(getSupabaseServiceClient())
    .from(table)
    .select(scope ? `id, ${scope.column}` : "id")
    .eq("organization_id", organizationId)
    .eq("submission_id", submissionId)
    .maybeSingle();
  if (error && !isMissingColumn(error)) throw new Error("save_failed");
  const found = data as Record<string, unknown> | null;
  if (!found) return null;
  if (scope && found[scope.column] !== scope.value) throw new Error("invalid_submission");
  return found.id as string;
}

/**
 * 중복 막기 insert — 같은 submission_id 가 이미 있으면 그 id, 경합으로 유니크 위반이 나면 먼저 들어간 줄 id.
 * submission_id 칸이 없는 DB 면 칸을 빼고 한 번 더 넣는다(배포 순서가 어긋나도 등록이 멈추지 않게).
 */
async function insertOnce(
  table: string,
  organizationId: string,
  row: Record<string, unknown> & { id: string },
  submissionId: string | null,
  scope?: { column: string; value: string },
): Promise<string> {
  if (submissionId) {
    const existing = await findBySubmission(table, organizationId, submissionId, scope);
    if (existing) return existing;
  }
  const service = untyped(getSupabaseServiceClient());
  const { error } = await service.from(table).insert(submissionId ? { ...row, submission_id: submissionId } : row);
  if (!error) return row.id;
  if (submissionId && isUniqueViolation(error)) {
    const existing = await findBySubmission(table, organizationId, submissionId, scope);
    if (existing) return existing;
  }
  if (submissionId && isMissingColumn(error)) {
    const retry = await service.from(table).insert(row);
    if (!retry.error) return row.id;
  }
  throw new Error("save_failed");
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
 * 불만 스크린샷 하나를 업로드한다. 스토리지 경로는 세션 조직 id +
 * 전달받은 complaintId 로 서버가 만들기 때문에 호출자가 자기 조직 밖이나 다른 id 아래에 쓸 수 없다.
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
 * 불만 댓글 이미지 하나를 업로드한다.
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

/**
 * 조직 컴플레인 목록 (최신순). 선택적 status / platform 필터.
 * 1,000건 쪽으로 나눠 끝까지 읽는다(2026-11-10) — PostgREST 는 `range()` 없는 읽기를 1,000행에서 자르고,
 * 이 목록은 화면 · 내보내기가 함께 쓴다.
 */
export async function listComplaints(input: {
  session: AppSession;
  status?: ComplaintStatus;
  platform?: ComplaintPlatform;
}): Promise<Complaint[]> {
  const { session } = input;
  const organizationId = requireOrg(session);

  const supabase = await getSupabaseServerClient();
  const PAGE = 1000;
  const rows: ComplaintRow[] = [];
  const seen = new Set<string>();
  for (let start = 0; ; start += PAGE) {
    let query = untyped(supabase)
      .from("customer_complaints")
      .select(COMPLAINT_COLS)
      .eq("organization_id", organizationId);
    if (input.status) query = query.eq("status", input.status);
    if (input.platform) query = query.eq("platform", input.platform);
    const { data, error } = await query
      .order("created_at", { ascending: false })
      // 같은 시각이 여럿이면 쪽 경계에서 순서가 흔들린다 — id 로 고정한다.
      .order("id", { ascending: false })
      .range(start, start + PAGE - 1);
    // 읽기 실패는 첫 쪽이든 중간 쪽이든 오류 — 빈 목록이나 앞 1,000건만 돌려주면 화면 · 내보내기가 «없음» · «전부»로 착각한다.
    // 화면(PC · 모바일 페이지)은 받아서 안내를 보이고, 내보내기는 실패한다.
    if (error) throw new Error("list_failed");
    const page = (data ?? []) as unknown as ComplaintRow[];
    for (const row of page) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
    if (page.length < PAGE) break;
  }
  return hydrateComplaints(organizationId, rows);
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
  /** 작성 한 번당 화면이 만든 uuid — 같은 값이 다시 오면 새로 만들지 않는다(선택). */
  submissionId?: string | null;
};

/** 컴플레인 생성. 작성 권한 게이트 포함. id는 서버에서 생성. 같은 submissionId 면 먼저 만든 id. */
export async function createComplaint(input: {
  session: AppSession;
  input: ComplaintInput;
}): Promise<{ id: string }> {
  const { session } = input;
  const organizationId = requireOrg(session);
  if (!canWriteComplaint(session)) throw new Error("forbidden");

  const platform = validatePlatform(input.input.platform);
  const title = validateTitle(input.input.title);
  const rating = normalizeRating(input.input.rating, platform);
  const submissionId = normalizeSubmissionId(input.input.submissionId);
  validateImages(input.input.imageUrls, `${organizationId}/complaint-images/`);
  const propertyId = normalizeOptional(input.input.propertyId);
  const roomId = normalizeOptional(input.input.roomId);
  const reservationId = normalizeOptional(input.input.reservationId);
  await assertLinksInOrg(organizationId, { propertyId, roomId, reservationId });

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
    rating,
    property_id: propertyId,
    property_name: normalizeOptional(input.input.propertyName),
    room_id: roomId,
    room_label: normalizeOptional(input.input.roomLabel),
    reservation_id: reservationId,
    guest_name: normalizeOptional(input.input.guestName),
    created_at: now,
    updated_at: now,
  };

  return { id: await insertOnce("customer_complaints", organizationId, insert, submissionId) };
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

/**
 * 수정. `complaintRights().edit`(작성자 + complaint.write, 또는 complaint.manage) + open 상태일 때만.
 * 플랫폼 개발자는 open 조건만 예외(2026-10-23).
 */
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
  if (!complaintRights(session, { createdByUserId: existing.created_by_user_id }).edit) throw new Error("forbidden");
  if (existing.status !== "open" && !developer) throw new Error("not_editable");

  const update: Database["public"]["Tables"]["customer_complaints"]["Update"] = { updated_at: new Date().toISOString() };
  if (patch.platform !== undefined) update.platform = validatePlatform(patch.platform);
  const effectivePlatform = (update.platform ?? existing.platform) as ComplaintPlatform;
  if (patch.title !== undefined) update.title = validateTitle(patch.title);
  if (patch.description !== undefined) update.description = normalizeOptional(patch.description);
  if (patch.platformRef !== undefined) update.platform_ref = normalizeOptional(patch.platformRef);
  if (patch.rating !== undefined) update.rating = normalizeRating(patch.rating, effectivePlatform);
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
  // 바뀐 연결 id 만 조직 확인(그대로 다시 온 기존 값은 이미 저장된 것).
  await assertLinksInOrg(organizationId, {
    propertyId: update.property_id && update.property_id !== existing.property_id ? update.property_id : null,
    roomId: update.room_id && update.room_id !== existing.room_id ? update.room_id : null,
    reservationId:
      update.reservation_id && update.reservation_id !== existing.reservation_id ? update.reservation_id : null,
  });

  const service = getSupabaseServiceClient();
  const { error } = await untyped(service)
    .from("customer_complaints")
    .update(update)
    .eq("id", id)
    .eq("organization_id", organizationId);
  if (error) throw new Error("save_failed");
}

/** 삭제 (hard delete). `complaintRights().delete` — 작성자 + complaint.write, 또는 complaint.manage. */
export async function deleteComplaint(input: {
  session: AppSession;
  id: string;
}): Promise<void> {
  const { session, id } = input;
  const organizationId = requireOrg(session);

  const existing = await loadComplaintForWrite(id, organizationId);
  if (!existing) throw new Error("not_found");
  if (!complaintRights(session, { createdByUserId: existing.created_by_user_id }).delete) {
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

  // **읽은 상태일 때만 바꾼다**(2026-11-10). 두 사람이 거의 동시에 해결 / 다시 열기를 누르면 늦은 쪽이 먼저
  // 쪽의 처리자 · 처리 시각을 덮어썼다. 그 사이 바뀌었으면 `stale` — 화면이 「다른 사람이 먼저 바꿨어요」를 띄운다.
  const service = getSupabaseServiceClient();
  const { data, error } = await untyped(service)
    .from("customer_complaints")
    .update(update)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .eq("status", existing.status)
    .select("id");
  if (error) throw new Error("save_failed");
  if (!Array.isArray(data) || data.length === 0) throw new Error("stale");
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

export type ComplaintCommentDigest = { count: number; lastContent: string | null };

/**
 * 컴플레인 여러 건의 처리 기록 요약(개수 + 마지막 한 줄) — Excel · PDF 내보내기용.
 * 본문 전체가 아니라 요약만 담는 것은 2026-10-28 결정(docs/product/25-complaint-workflow.md → 내보내기).
 */
export async function listComplaintCommentDigests(input: {
  session: AppSession;
  complaintIds: string[];
}): Promise<Map<string, ComplaintCommentDigest>> {
  const organizationId = requireOrg(input.session);
  const out = new Map<string, ComplaintCommentDigest>();
  if (input.complaintIds.length === 0) return out;

  const supabase = await getSupabaseServerClient();
  // `in` 목록이 너무 길면 주소가 넘친다 — 200개씩 나눠 읽는다.
  for (let i = 0; i < input.complaintIds.length; i += 200) {
    const ids = input.complaintIds.slice(i, i + 200);
    const { data, error } = await untyped(supabase)
      .from("complaint_comments")
      .select("complaint_id, content, created_at")
      .eq("organization_id", organizationId)
      .in("complaint_id", ids)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });
    if (error) throw error;
    for (const row of (data ?? []) as { complaint_id: string; content: string | null }[]) {
      const digest = out.get(row.complaint_id) ?? { count: 0, lastContent: null };
      digest.count += 1;
      digest.lastContent = row.content;
      out.set(row.complaint_id, digest);
    }
  }
  return out;
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
  /** 남기기 한 번당 화면이 만든 uuid — 같은 값이 다시 오면 새로 만들지 않는다(선택). */
  submissionId?: string | null;
}): Promise<{ id: string }> {
  const { session, complaintId } = input;
  const organizationId = requireOrg(session);
  if (!canWriteComment(session)) throw new Error("forbidden");
  const submissionId = normalizeSubmissionId(input.submissionId);

  const content = input.content.trim();
  if (!content) throw new Error("content_required");
  validateImages(input.imageUrls, `${organizationId}/complaint-comment-images/${complaintId}/`);

  const complaint = await loadComplaintForWrite(complaintId, organizationId);
  if (!complaint) throw new Error("not_found");

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

  return {
    id: await insertOnce("complaint_comments", organizationId, insert, submissionId, { column: "complaint_id", value: complaintId }),
  };
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

/** 댓글 삭제 (soft delete). 작성자 본인 또는 complaint.manage. */
export async function deleteComplaintComment(input: {
  session: AppSession;
  commentId: string;
}): Promise<void> {
  const { session, commentId } = input;
  const organizationId = requireOrg(session);

  const existing = await loadCommentForWrite(commentId, organizationId);
  if (!existing || existing.deleted_at) throw new Error("not_found");
  if (existing.created_by_user_id !== session.user.id && !canModerateComplaints(session)) {
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
