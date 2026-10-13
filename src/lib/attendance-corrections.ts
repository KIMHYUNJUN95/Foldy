// Attendance — correction / exception request reads (Step 6).
//
// Server-only, self-scoped reads for the worker correction flow: the form's source-session context +
// active site list, the status screen's request view, and the per-session correction status used to
// surface request state in self-history. No admin/org-wide reads, no approve/reject (Step 7). Shapes
// carry review_comment / reviewer so the later admin-review step can render without a rewrite.

import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  localizeAttendanceSiteName,
  type AttendanceSiteDisplayRow,
} from "@/lib/attendance-site-display";
import { getDictionary } from "@/lib/i18n";
import { tokyoDayStart, tokyoToday } from "@/lib/tokyo-date";
import type {
  AttendanceCorrectionRequestRow,
  AttendanceCorrectionReason,
  AttendanceCorrectionStatus,
} from "@/lib/attendance";

const TZ = "Asia/Tokyo";

function tokyoTimeLabel(iso: string | null, locale = "ko-KR"): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat(locale, {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function dateLabelOf(operatingDate: string, locale = "ko-KR"): string {
  const d = new Date(`${operatingDate}T00:00:00+09:00`);
  return new Intl.DateTimeFormat(locale, {
    timeZone: TZ,
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(d);
}

export type CorrectionSiteOption = { id: string; name: string };

/** Active attendance sites in the org (for the desired-site picker). Read-only, member-readable. */
export async function listActiveAttendanceSites(
  organizationId: string,
  locale = "ko-KR",
): Promise<CorrectionSiteOption[]> {
  const res = await getSupabaseServiceClient()
    .from("attendance_sites")
    .select("id, name, properties(display_name_ko, display_name_ja, display_name_en)")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  return ((res.data ?? []) as (AttendanceSiteDisplayRow & { id: string })[]).map((site) => ({
    id: site.id,
    name: localizeAttendanceSiteName(site, locale),
  }));
}

export type CorrectionSessionContext = {
  sessionId: string;
  operatingDate: string;
  dateLabel: string;
  clockInTime: string | null; // "HH:mm"
  clockOutTime: string | null;
  siteName: string | null;
};

/** Source-session context for the correction form. Self-scoped (returns null if not the user's). */
export async function getSessionCorrectionContext(
  organizationId: string,
  userId: string,
  sessionId: string,
  locale = "ko-KR",
): Promise<CorrectionSessionContext | null> {
  const service = getSupabaseServiceClient();
  const res = await service
    .from("attendance_sessions")
    .select("id, user_id, operating_date, clock_in_at, clock_out_at, clock_in_site_id")
    .eq("organization_id", organizationId)
    .eq("id", sessionId)
    .maybeSingle();
  const s = res.data as {
    id: string;
    user_id: string;
    operating_date: string;
    clock_in_at: string | null;
    clock_out_at: string | null;
    clock_in_site_id: string | null;
  } | null;
  if (res.error || !s || s.user_id !== userId) return null;

  let siteName: string | null = null;
  if (s.clock_in_site_id) {
    const siteRes = await service
      .from("attendance_sites")
      .select("name, properties(display_name_ko, display_name_ja, display_name_en)")
      .eq("organization_id", organizationId)
      .eq("id", s.clock_in_site_id)
      .maybeSingle();
    const site = siteRes.data as AttendanceSiteDisplayRow | null;
    siteName = site ? localizeAttendanceSiteName(site, locale) : null;
  }

  return {
    sessionId: s.id,
    operatingDate: s.operating_date,
    dateLabel: dateLabelOf(s.operating_date, locale),
    clockInTime: tokyoTimeLabel(s.clock_in_at, locale),
    clockOutTime: tokyoTimeLabel(s.clock_out_at, locale),
    siteName,
  };
}

/** i18n key for each correction reason — maps to `copy.reasonMissingIn` etc. */
export const CORRECTION_REASON_I18N_KEYS: Record<AttendanceCorrectionReason, string> = {
  missing_clock_in: "reasonMissingIn",
  missing_clock_out: "reasonMissingOut",
  wrong_time: "reasonWrongTime",
  wrong_site: "reasonWrongSite",
  auth_failed: "reasonAuthFailed",
  other: "reasonOther",
};

/** i18n key for each correction status — maps to `copy.stepRequested` etc. */
export const CORRECTION_STATUS_I18N_KEYS: Record<AttendanceCorrectionStatus, string> = {
  requested: "stepRequested",
  in_review: "stepInReview",
  approved: "stepApproved",
  rejected: "stepRejected",
  cancelled: "stepCancelled",
};

function attendanceLabel(locale: string, key: string, fallback: string): string {
  const value = getDictionary(locale).attendance[
    key as keyof ReturnType<typeof getDictionary>["attendance"]
  ];
  return typeof value === "string" ? value : fallback;
}

export type CorrectionRequestView = {
  id: string;
  status: AttendanceCorrectionStatus;
  /** @deprecated Use `statusKey` + dictionary lookup for localised label. */
  statusLabel: string;
  statusKey: string; // e.g. "stepRequested"
  reasonType: AttendanceCorrectionReason;
  /** @deprecated Use `reasonKey` + dictionary lookup for localised label. */
  reasonLabel: string;
  reasonKey: string; // e.g. "reasonMissingIn"
  sessionId: string | null;
  targetDateLabel: string | null; // null = exception (session-less) request
  desiredClockInLabel: string | null;
  desiredClockOutLabel: string | null;
  desiredSiteName: string | null;
  memo: string | null;
  imageUrls: string[];
  photoCount: number;
  reviewComment: string | null;
  reviewerName: string | null;
  reviewedAtLabel: string | null;
  createdAtLabel: string;
};

async function toRequestView(
  service: ReturnType<typeof getSupabaseServiceClient>,
  organizationId: string,
  row: AttendanceCorrectionRequestRow,
  locale = "ko-KR",
): Promise<CorrectionRequestView> {
  // Step 1: session operating_date fetch (others may depend on nothing from here, but siteId is from `row`)
  const siteId = row.desired_clock_in_site_id ?? row.desired_clock_out_site_id;

  // Step 2: session + site + reviewer를 가능한 범위에서 병렬 실행
  // session 조회는 row.session_id가 있을 때만, site/reviewer는 row에서 직접 id를 얻으므로 모두 병렬 가능
  const [sessionRes, siteRes, reviewerRes] = await Promise.all([
    row.session_id
      ? service
          .from("attendance_sessions")
          .select("operating_date")
          .eq("organization_id", organizationId)
          .eq("id", row.session_id)
          .maybeSingle()
      : Promise.resolve(null),
    siteId
      ? service
          .from("attendance_sites")
          .select("name, properties(display_name_ko, display_name_ja, display_name_en)")
          .eq("organization_id", organizationId)
          .eq("id", siteId)
          .maybeSingle()
      : Promise.resolve(null),
    row.reviewed_by_user_id
      ? service
          .from("profiles")
          .select("name")
          .eq("id", row.reviewed_by_user_id)
          .maybeSingle()
      : Promise.resolve(null),
  ]);

  const od =
    sessionRes && "data" in sessionRes
      ? ((sessionRes.data as { operating_date: string } | null)?.operating_date ?? null)
      : null;
  // 세션 없는 예외 요청은 직원이 고른 근무 날짜(`target_date`, 2026-10-01)를 쓴다.
  const targetDate = od ?? row.target_date ?? null;
  const targetDateLabel = targetDate ? dateLabelOf(targetDate, locale) : null;

  const desiredSiteName =
    siteRes && "data" in siteRes
      ? siteRes.data
        ? localizeAttendanceSiteName(siteRes.data as AttendanceSiteDisplayRow, locale)
        : null
      : null;

  const reviewerName =
    reviewerRes && "data" in reviewerRes
      ? ((reviewerRes.data as { name: string } | null)?.name ?? null)
      : null;

  const status = row.status as AttendanceCorrectionStatus;
  const reasonType = row.reason_type as AttendanceCorrectionReason;
  const statusKey = CORRECTION_STATUS_I18N_KEYS[status] ?? status;
  const reasonKey = CORRECTION_REASON_I18N_KEYS[reasonType] ?? reasonType;

  return {
    id: row.id,
    status,
    statusLabel: attendanceLabel(locale, statusKey, status),
    statusKey,
    reasonType,
    reasonLabel: attendanceLabel(locale, reasonKey, reasonType),
    reasonKey,
    sessionId: row.session_id,
    targetDateLabel,
    desiredClockInLabel: tokyoTimeLabel(row.desired_clock_in_at, locale),
    desiredClockOutLabel: tokyoTimeLabel(row.desired_clock_out_at, locale),
    desiredSiteName,
    memo: row.memo,
    imageUrls: row.image_urls ?? [],
    photoCount: (row.image_urls ?? []).length,
    reviewComment: row.review_comment,
    reviewerName,
    reviewedAtLabel: tokyoTimeLabel(row.reviewed_at, locale),
    createdAtLabel: tokyoTimeLabel(row.created_at, locale) ?? "",
  };
}

/**
 * One of the user's OWN correction requests — by id, or the latest if `requestId` is null. Self-scoped
 * (returns null if the id is not the user's). Used by the status screen.
 */
export async function getCorrectionRequestView(
  organizationId: string,
  userId: string,
  requestId: string | null,
  locale = "ko-KR",
): Promise<CorrectionRequestView | null> {
  const service = getSupabaseServiceClient();
  let query = service
    .from("attendance_correction_requests")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("requested_by_user_id", userId);
  query = requestId
    ? query.eq("id", requestId)
    : query.order("created_at", { ascending: false }).limit(1);

  const res = await query.maybeSingle();
  const row = res.data as AttendanceCorrectionRequestRow | null;
  if (res.error || !row) return null;
  return toRequestView(service, organizationId, row, locale);
}

/**
 * Latest correction status per session for the given session ids (self-scoped). Used to surface
 * request state on the self-history cards/detail.
 */
export async function getCorrectionStatusBySession(
  organizationId: string,
  userId: string,
  sessionIds: string[],
): Promise<Map<string, { status: AttendanceCorrectionStatus; id: string }>> {
  const map = new Map<string, { status: AttendanceCorrectionStatus; id: string }>();
  if (sessionIds.length === 0) return map;
  const res = await getSupabaseServiceClient()
    .from("attendance_correction_requests")
    .select("id, session_id, status, created_at")
    .eq("organization_id", organizationId)
    .eq("requested_by_user_id", userId)
    .in("session_id", sessionIds)
    .order("created_at", { ascending: false });
  for (const row of (res.data ?? []) as {
    id: string;
    session_id: string | null;
    status: string;
    created_at: string;
  }[]) {
    if (row.session_id && !map.has(row.session_id)) {
      map.set(row.session_id, { status: row.status as AttendanceCorrectionStatus, id: row.id });
    }
  }
  return map;
}

export type MyCorrectionRow = {
  id: string;
  status: AttendanceCorrectionStatus;
  reasonKey: string;
  targetDateLabel: string | null;
  desiredClockInLabel: string | null;
  desiredClockOutLabel: string | null;
};

/**
 * 내 정정 요청 — 최근 `days`일(도쿄 기준, 기본 30). 본인 것만(requested_by_user_id = 나). 태블릿 정정 요청
 * 화면 오른쪽 목록(2026-10-13 리디자인)에 쓴다. 날짜는 세션 운영일 → 없으면 직원이 고른 target_date.
 */
export async function listMyCorrectionRequests(
  organizationId: string,
  userId: string,
  locale = "ko-KR",
  days = 30,
): Promise<MyCorrectionRow[]> {
  const service = getSupabaseServiceClient();
  const [y, m, d] = tokyoToday().split("-").map(Number);
  const since = new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
  const res = await service
    .from("attendance_correction_requests")
    .select("id, status, reason_type, session_id, target_date, desired_clock_in_at, desired_clock_out_at, created_at")
    .eq("organization_id", organizationId)
    .eq("requested_by_user_id", userId)
    .gte("created_at", tokyoDayStart(since))
    .order("created_at", { ascending: false })
    .limit(20);
  const rows = (res.data ?? []) as Pick<
    AttendanceCorrectionRequestRow,
    "id" | "status" | "reason_type" | "session_id" | "target_date" | "desired_clock_in_at" | "desired_clock_out_at" | "created_at"
  >[];
  const sessionIds = rows.map((r) => r.session_id).filter((v): v is string => !!v);
  const odBySession = new Map<string, string>();
  if (sessionIds.length > 0) {
    const sres = await service
      .from("attendance_sessions")
      .select("id, operating_date")
      .eq("organization_id", organizationId)
      .in("id", sessionIds);
    for (const r of (sres.data ?? []) as { id: string; operating_date: string }[]) odBySession.set(r.id, r.operating_date);
  }
  return rows.map((r) => {
    const date = (r.session_id ? odBySession.get(r.session_id) : null) ?? r.target_date ?? null;
    return {
      id: r.id,
      status: r.status as AttendanceCorrectionStatus,
      reasonKey: CORRECTION_REASON_I18N_KEYS[r.reason_type as AttendanceCorrectionReason] ?? r.reason_type,
      targetDateLabel: date ? dateLabelOf(date, locale) : null,
      desiredClockInLabel: tokyoTimeLabel(r.desired_clock_in_at, locale),
      desiredClockOutLabel: tokyoTimeLabel(r.desired_clock_out_at, locale),
    };
  });
}
