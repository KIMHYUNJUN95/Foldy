// Bug Report (Foldy product issue report) — server-only domain helpers.
//
// Reads use the RLS-scoped server client (RLS is the first defense line). Writes use the service
// role client AFTER an explicit code-level org + role gate, mirroring the pattern in
// `src/lib/board.ts`/board actions. Image uploads are forced into the canonical storage path
// `{organization_id}/bug-reports/{report_id}/{filename}` so a malicious client can't write under
// another org or another report.

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
 * Upload one screenshot for a bug report. The storage path is server-constructed from the session
 * organization id + the supplied reportId, so the caller cannot write outside their org or under a
 * different report id. MIME is validated to image/* before upload.
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
 * Create a new bug report. Always begins as `submitted`. The id is generated server-side so the
 * caller can't reuse another report's id (and so the storage path the client uploaded into is
 * actually tied to this new row — the client must request the upload AFTER receiving this id, or
 * the upload helper validates the id shape and the path is rebuilt server-side anyway).
 *
 * Returns the new report id and fans out a `bug_report_activity:created` notification to every
 * reviewer (owner/office_admin) in the org. The reporter is suppressed.
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
 * Edit own report. Allowed ONLY when the caller is the reporter AND the report is still
 * `submitted`. Both conditions are enforced in code (not relying on RLS alone).
 * Platform developer bypasses both (2026-10-23 「개발자는 전부 가능」).
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
 * Hard-delete own report. Same gate as update: reporter + status='submitted' only. Hard delete is
 * the MVP policy (CLAUDE.md); the storage objects are NOT cascaded here — the migration's RLS
 * already keeps them inaccessible once the row is gone, and a periodic sweep can prune orphans.
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
 * Reviewer-only status update. Sets reviewed_by_user_id on first transition out of `submitted`, and
 * stamps closed_by_user_id + closed_at when the new status is `closed`. Notifies the original
 * reporter (self-suppressed when the reviewer is also the reporter — edge case but handled).
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
    // Re-opening a previously closed report clears the closure stamp so it doesn't lie.
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

/** Reports owned by the current user. RLS scopes to (org, reporter), the code re-applies both. */
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
 * Detail by id. Visible to the reporter, or to any reviewer in the same org. Returns null on cross-
 * org access or missing row (RLS is the first line; this check is the second).
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

/** Reviewer-only: every report in the org, newest first. Optional status filter. */
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
