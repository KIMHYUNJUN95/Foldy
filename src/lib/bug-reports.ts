// 버그 리포트(Foldy 제품 이슈 보고) — 서버 전용 도메인 헬퍼.
//
// 읽기는 RLS 범위 서버 클라이언트를 쓴다(RLS 가 첫 방어선). 쓰기는 코드 수준의 조직 + 역할 게이트를
// 명시적으로 거친 뒤 service role 클라이언트를 쓰며, `src/lib/board.ts`/게시판 액션의 패턴을
// 따른다. 이미지 업로드는 정해진 저장 경로
// `{organization_id}/bug-reports/{report_id}/{filename}` 로 강제해서 악의적인 클라이언트가
// 다른 조직이나 다른 리포트 아래에 쓰지 못하게 한다.

import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppSession } from "@/lib/session";
import { getDictionary } from "@/lib/i18n";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isOwnStoragePublicUrl } from "@/lib/storage-url-guard";
import { displayRoleKey, fetchPlatformDeveloperIds } from "@/lib/platform-developers";
import {
  notifyBugReportCreated,
  notifyBugReportStatusChanged,
} from "@/lib/notifications/create";
import type { Database } from "@/types/database";
import { isPlatformDeveloper } from "@/config/roles";

export type BugStatus = "submitted" | "reviewing" | "fixed" | "closed";

const BUG_STATUSES: ReadonlySet<BugStatus> = new Set([
  "submitted",
  "reviewing",
  "fixed",
  "closed",
]);

const REQUEST_IMAGES_BUCKET = "request-images";
const MAX_IMAGES = 5;

export type BugReport = {
  id: string;
  organizationId: string;
  reportedByUserId: string;
  reporterName: string;
  reporterRole: string | null;
  title: string;
  description: string;
  imageUrls: string[];
  status: BugStatus;
  reviewedByUserId: string | null;
  closedByUserId: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type BugReportRow = {
  id: string;
  organization_id: string;
  reported_by_user_id: string;
  title: string;
  description: string;
  image_urls: string[] | null;
  status: BugStatus;
  reviewed_by_user_id: string | null;
  closed_by_user_id: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};

export function isBugReportReviewer(session: AppSession): boolean {
  return session.capabilities.includes("bug.review");
}

function requireOrg(session: AppSession): string {
  if (session.organization.id === "platform") {
    throw new Error("no_org");
  }
  return session.organization.id;
}

/**
 * 사진 주소 검사 — 5장 상한 + 우리 Storage 의 `{조직}/bug-reports/{신고 id}/{파일}` 아래 주소만(2026-10-26).
 * 예전엔 장수만 봐서 아무 외부 주소나 저장될 수 있었다.
 */
function validateImages(urls: string[], organizationId: string, reportId: string): void {
  if (!Array.isArray(urls) || urls.length > MAX_IMAGES) {
    throw new Error("too_many_photos");
  }
  const prefix = `${organizationId}/bug-reports/${reportId}/`;
  if (!urls.every((url) => typeof url === "string" && isOwnStoragePublicUrl(url, REQUEST_IMAGES_BUCKET, prefix))) {
    throw new Error("invalid_image");
  }
}

function validateTitle(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("title_required");
  return trimmed;
}

function validateDescription(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("description_required");
  return trimmed;
}

function safeExt(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]+$/.test(fromName) && fromName.length <= 5) return fromName;
  const fromType = file.type.split("/")[1];
  if (fromType && /^[a-z0-9]+$/.test(fromType)) return fromType;
  return "bin";
}

/**
 * 버그 리포트의 스크린샷 하나를 업로드한다. 저장 경로는 세션
 * 조직 id + 전달된 reportId 로 서버가 만들어서 호출자가 자기 조직 밖이나
 * 다른 report id 아래에 쓸 수 없다. 업로드 전에 MIME 이 image/* 인지 검증한다.
 */
export async function uploadBugReportImage(input: {
  session: AppSession;
  reportId: string;
  file: File;
}): Promise<string> {
  const { session, reportId, file } = input;
  const organizationId = requireOrg(session);

  if (!file.type.startsWith("image/")) throw new Error("invalid_image_type");
  if (file.size > 10 * 1024 * 1024) throw new Error("image_too_large");
  if (!/^[a-f0-9-]{8,}$/i.test(reportId)) throw new Error("invalid_report_id");

  // 이 신고가 정말 부른 사람 것이고 아직 고칠 수 있는 상태인지(2026-10-26) — 예전엔 id 모양만 봐서 남의 신고 폴더에도
  // 올릴 수 있었다. 수정 · 삭제와 같은 규칙(작성자 + 접수 상태, 플랫폼 개발자는 예외).
  const existing = await loadReportForWrite(reportId, organizationId);
  if (!existing) throw new Error("not_found");
  const developer = isPlatformDeveloper(session.user.role);
  if (existing.reported_by_user_id !== session.user.id && !developer) throw new Error("forbidden");
  if (existing.status !== "submitted" && !developer) throw new Error("not_editable");

  const service = getSupabaseServiceClient();
  const folder = `${organizationId}/bug-reports/${reportId}`;
  // 5장 상한 — 이미 이 신고 폴더에 올라간 파일 수로 센다(주소를 붙이기 전 단계라 image_urls 로는 못 센다).
  const { data: listed, error: listError } = await service.storage
    .from(REQUEST_IMAGES_BUCKET)
    .list(folder, { limit: MAX_IMAGES + 1 });
  if (listError) throw new Error("upload_failed");
  if ((listed ?? []).length >= MAX_IMAGES) throw new Error("too_many_photos");

  const ext = safeExt(file);
  const path = `${folder}/${randomUUID()}.${ext}`;

  const { error } = await service.storage
    .from(REQUEST_IMAGES_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error("upload_failed");

  const { data } = service.storage.from(REQUEST_IMAGES_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

function mapRow(row: BugReportRow, reporterName: string, reporterRole: string | null): BugReport {
  return {
    id: row.id,
    organizationId: row.organization_id,
    reportedByUserId: row.reported_by_user_id,
    reporterName,
    reporterRole,
    title: row.title,
    description: row.description,
    imageUrls: row.image_urls ?? [],
    status: row.status,
    reviewedByUserId: row.reviewed_by_user_id,
    closedByUserId: row.closed_by_user_id,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type ReporterInfo = { name: string; roleLabel: string | null };

async function fetchReporterInfo(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  userIds: string[],
  locale: AppSession["user"]["preferredLanguage"],
): Promise<Map<string, ReporterInfo>> {
  const map = new Map<string, ReporterInfo>();
  const ids = Array.from(new Set(userIds)).filter(Boolean);
  if (ids.length === 0) return map;

  const roles = getDictionary(locale).roles as Record<string, string>;
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id, role, profiles(name)")
    .eq("organization_id", organizationId)
    .in("user_id", ids);
  if (error) return map;

  const devIds = await fetchPlatformDeveloperIds(ids);
  for (const m of (data ?? []) as Array<{
    user_id: string;
    role: string;
    profiles: { name: string } | { name: string }[] | null;
  }>) {
    const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    const role = displayRoleKey(m.role, m.user_id, devIds);
    map.set(m.user_id, {
      name: profile?.name ?? "",
      roleLabel: roles[role] ?? role ?? null,
    });
  }
  return map;
}

async function hydrateReports(
  session: AppSession,
  rows: BugReportRow[],
): Promise<BugReport[]> {
  if (rows.length === 0) return [];
  const supabase = await getSupabaseServerClient();
  const info = await fetchReporterInfo(
    supabase,
    session.organization.id,
    rows.map((r) => r.reported_by_user_id),
    session.user.preferredLanguage,
  );
  return rows.map((row) => {
    const meta = info.get(row.reported_by_user_id);
    return mapRow(row, meta?.name ?? "", meta?.roleLabel ?? null);
  });
}

/**
 * 새 버그 리포트를 만든다. 항상 `submitted` 로 시작한다. id 는 서버에서 생성되므로
 * 호출자가 다른 리포트의 id 를 재사용할 수 없다(그리고 클라이언트가 업로드한 저장 경로가
 * 이 새 행에 실제로 묶이도록 — 클라이언트는 이 id 를 받은 뒤에 업로드를 요청해야 하며,
 * 그렇지 않아도 업로드 헬퍼가 id 형태를 검증하고 경로는 어차피 서버에서 다시 만든다).
 *
 * 새 리포트 id 를 돌려주고 조직의 모든 검토자(owner/office_admin)에게 `bug_report_activity:created` 알림을
 * 보낸다. 작성자 본인은 제외한다.
 */
export async function createBugReport(input: {
  session: AppSession;
  title: string;
  description: string;
  imageUrls: string[];
}): Promise<{ id: string }> {
  const { session } = input;
  const organizationId = requireOrg(session);

  const title = validateTitle(input.title);
  const description = validateDescription(input.description);

  const service = getSupabaseServiceClient();
  const id = randomUUID();
  // 사진은 신고를 만든 뒤 그 id 폴더에 올리고 `updateBugReport` 로 붙인다 — 새 id 폴더의 주소만 통과한다.
  validateImages(input.imageUrls, organizationId, id);
  const insert = {
    id,
    organization_id: organizationId,
    reported_by_user_id: session.user.id,
    title,
    description,
    image_urls: input.imageUrls,
    status: "submitted" satisfies BugStatus,
  };

  const { error } = await service.from("bug_reports").insert(insert);
  if (error) throw new Error("save_failed");

  await notifyBugReportCreated({
    reportId: id,
    reportTitle: title,
    organizationId,
    actorUserId: session.user.id,
  });

  return { id };
}

async function loadReportForWrite(reportId: string, organizationId: string): Promise<BugReportRow | null> {
  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from("bug_reports")
    .select(
      "id, organization_id, reported_by_user_id, title, description, image_urls, status, reviewed_by_user_id, closed_by_user_id, closed_at, created_at, updated_at",
    )
    .eq("id", reportId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as BugReportRow;
}

/**
 * 본인 리포트 수정. 호출자가 작성자이고 리포트가 아직
 * `submitted` 일 때만 허용한다. 두 조건 모두 RLS 에만 기대지 않고 코드에서 강제한다.
 * 플랫폼 개발자는 둘 다 우회한다(2026-10-23 「개발자는 전부 가능」).
 */
export async function updateBugReport(input: {
  session: AppSession;
  id: string;
  title: string;
  description: string;
  imageUrls: string[];
}): Promise<void> {
  const { session } = input;
  const organizationId = requireOrg(session);
  const title = validateTitle(input.title);
  const description = validateDescription(input.description);
  validateImages(input.imageUrls, organizationId, input.id);

  const existing = await loadReportForWrite(input.id, organizationId);
  if (!existing) throw new Error("not_found");
  const developer = isPlatformDeveloper(session.user.role);
  if (existing.reported_by_user_id !== session.user.id && !developer) throw new Error("forbidden");
  if (existing.status !== "submitted" && !developer) throw new Error("not_editable");

  const service = getSupabaseServiceClient();
  const { error } = await service
    .from("bug_reports")
    .update({
      title,
      description,
      image_urls: input.imageUrls,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .eq("organization_id", organizationId);
  if (error) throw new Error("save_failed");
}

/**
 * 본인 리포트 하드 삭제. 수정과 같은 게이트: 작성자 + status='submitted' 만. 하드 삭제는
 * MVP 정책(CLAUDE.md)이다; 저장소 객체는 여기서 연쇄 삭제되지 않는다 — 마이그레이션의 RLS 가
 * 행이 사라진 뒤에는 이미 접근을 막고, 고아는 주기적 정리로 지울 수 있다.
 */
export async function deleteBugReport(input: {
  session: AppSession;
  id: string;
}): Promise<void> {
  const { session } = input;
  const organizationId = requireOrg(session);

  const existing = await loadReportForWrite(input.id, organizationId);
  if (!existing) throw new Error("not_found");
  const developer = isPlatformDeveloper(session.user.role);
  if (existing.reported_by_user_id !== session.user.id && !developer) throw new Error("forbidden");
  if (existing.status !== "submitted" && !developer) throw new Error("not_editable");

  const service = getSupabaseServiceClient();
  const { error } = await service
    .from("bug_reports")
    .delete()
    .eq("id", input.id)
    .eq("organization_id", organizationId);
  if (error) throw new Error("save_failed");
}

/**
 * 검토자 전용 상태 변경. `submitted` 를 처음 벗어날 때 reviewed_by_user_id 를 설정하고,
 * 새 상태가 `closed` 면 closed_by_user_id + closed_at 을 찍는다. 원래
 * 작성자에게 알린다(검토자가 작성자이기도 하면 자기 알림은 제외 — 예외적이지만 처리됨).
 */
export async function updateBugReportStatus(input: {
  session: AppSession;
  id: string;
  status: BugStatus;
}): Promise<void> {
  const { session, id, status } = input;
  const organizationId = requireOrg(session);

  if (!BUG_STATUSES.has(status)) throw new Error("invalid_status");
  if (!isBugReportReviewer(session)) throw new Error("forbidden");

  const existing = await loadReportForWrite(id, organizationId);
  if (!existing) throw new Error("not_found");
  if (existing.status === status) return;

  const now = new Date().toISOString();
  const patch: Database["public"]["Tables"]["bug_reports"]["Update"] = {
    status,
    updated_at: now,
  };
  if (status !== "submitted" && !existing.reviewed_by_user_id) {
    patch.reviewed_by_user_id = session.user.id;
  }
  if (status === "closed") {
    patch.closed_by_user_id = session.user.id;
    patch.closed_at = now;
  } else if (existing.closed_at) {
    // 이미 닫힌 리포트를 다시 열면 거짓이 되지 않도록 닫힘 도장을 지운다.
    patch.closed_by_user_id = null;
    patch.closed_at = null;
  }

  const service = getSupabaseServiceClient();
  const { error } = await service
    .from("bug_reports")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", organizationId);
  if (error) throw new Error("save_failed");

  await notifyBugReportStatusChanged({
    reportId: id,
    reportTitle: existing.title,
    reporterUserId: existing.reported_by_user_id,
    status,
    actorUserId: session.user.id,
  });
}

const SELECT_COLS =
  "id, organization_id, reported_by_user_id, title, description, image_urls, status, reviewed_by_user_id, closed_by_user_id, closed_at, created_at, updated_at";

/** 현재 사용자가 소유한 리포트. RLS 가 (조직, 작성자)로 제한하고 코드가 둘 다 다시 적용한다. */
export async function getMyBugReports(session: AppSession): Promise<BugReport[]> {
  const organizationId = requireOrg(session);
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("bug_reports")
    .select(SELECT_COLS)
    .eq("organization_id", organizationId)
    .eq("reported_by_user_id", session.user.id)
    .order("created_at", { ascending: false });
  if (error) return [];
  return hydrateReports(session, (data ?? []) as unknown as BugReportRow[]);
}

/**
 * id 로 상세. 작성자 또는 같은 조직의 모든 검토자에게 보인다. 조직 간
 * 접근이거나 행이 없으면 null (RLS 가 첫째 방어선이고 이 확인이 둘째).
 */
export async function getBugReportDetail(
  session: AppSession,
  id: string,
): Promise<BugReport | null> {
  const organizationId = requireOrg(session);
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("bug_reports")
    .select(SELECT_COLS)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as unknown as BugReportRow;
  const isOwn = row.reported_by_user_id === session.user.id;
  if (!isOwn && !isBugReportReviewer(session) && !isPlatformDeveloper(session.user.role)) return null;

  const hydrated = await hydrateReports(session, [row]);
  return hydrated[0] ?? null;
}

/** 검토자 전용: 조직의 모든 리포트, 최신순. 선택적 상태 필터. */
export async function getOrgBugReports(
  session: AppSession,
  filters?: { status?: BugStatus },
): Promise<BugReport[]> {
  requireOrg(session);
  if (!isBugReportReviewer(session)) throw new Error("forbidden");

  const supabase = await getSupabaseServerClient();
  let query = supabase
    .from("bug_reports")
    .select(SELECT_COLS)
    .eq("organization_id", session.organization.id)
    .order("created_at", { ascending: false });
  if (filters?.status && BUG_STATUSES.has(filters.status)) {
    query = query.eq("status", filters.status);
  }

  const { data, error } = await query;
  if (error) return [];
  return hydrateReports(session, (data ?? []) as unknown as BugReportRow[]);
}
