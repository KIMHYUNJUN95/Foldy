// 근태 — 정정 / 예외 요청 읽기(Step 6).
//
// 서버 전용, 본인 범위 읽기: 작업자 정정 흐름용 — 폼의 원본 세션 컨텍스트 +
// 활성 현장 목록, 상태 화면의 요청 뷰, 그리고 본인 이력에서 요청 상태를
// 보여 주는 세션별 정정 상태. 관리자/조직 전체 읽기나 승인/반려는 없다(Step 7). 형태는
// review_comment / reviewer 를 담아 두어서 나중의 관리자 검토 단계가 재작성 없이 렌더할 수 있다.

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

/** 조직의 활성 근태 현장(희망 현장 선택기용). 읽기 전용, 멤버가 읽을 수 있음. */
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

/** 정정 폼의 원본 세션 컨텍스트. 본인 범위(본인 것이 아니면 null). */
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

/** 정정 사유별 i18n 키 — `copy.reasonMissingIn` 등에 대응한다. */
export const CORRECTION_REASON_I18N_KEYS: Record<AttendanceCorrectionReason, string> = {
  missing_clock_in: "reasonMissingIn",
  missing_clock_out: "reasonMissingOut",
  wrong_time: "reasonWrongTime",
  wrong_site: "reasonWrongSite",
  auth_failed: "reasonAuthFailed",
  other: "reasonOther",
};

/** 정정 상태별 i18n 키 — `copy.stepRequested` 등에 대응한다. */
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
  /** @deprecated `statusKey` + 사전 조회를 써서 현지화된 라벨을 쓸 것. */
  statusLabel: string;
  statusKey: string; // 예: "stepRequested"
  reasonType: AttendanceCorrectionReason;
  /** @deprecated `reasonKey` + 사전 조회를 써서 현지화된 라벨을 쓸 것. */
  reasonLabel: string;
  reasonKey: string; // 예: "reasonMissingIn"
  sessionId: string | null;
  targetDateLabel: string | null; // null = 예외(세션 없는) 요청
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
  // Step 1: 세션 operating_date 조회(나머지는 여기에 의존하지 않을 수 있지만 siteId 는 `row` 에서 온다)
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
 * 사용자 본인의 정정 요청 하나 — id 로, 또는 `requestId` 가 null 이면 최신. 본인 범위
 * (id 가 본인 것이 아니면 null). 상태 화면에서 사용한다.
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
 * 주어진 세션 id 들의 세션별 최신 정정 상태(본인 범위). 본인 이력 카드/상세에서
 * 요청 상태를 보여 주는 데 쓴다.
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
