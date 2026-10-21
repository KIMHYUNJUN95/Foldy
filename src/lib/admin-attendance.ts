import "server-only";

import type { AppSession } from "@/lib/session";
import {
  getAttendanceReviewQueue,
  isAttendancePayrollAdmin,
  type ReviewQueueItem,
} from "@/lib/attendance-review";
import {
  countBlockingSessions,
  type FinalizationBlockers,
  type FinalizationEligibility,
} from "@/lib/attendance-finalization";
import {
  getTransportReport,
  getTransportItems,
  getTransportReportSummaryForAdmin,
  type TransportReportAdminSummary,
  type TransportReportStatus,
} from "@/lib/transport-reimbursement";
import {
  localizeAttendanceSiteName,
  type AttendanceSiteDisplayRow,
} from "@/lib/attendance-site-display";
import {
  gapFillMinFrom,
  type AttendanceCorrectionReason,
  type AttendanceCorrectionRequestRow,
  type AttendanceCorrectionStatus,
  type AttendanceSessionRow,
} from "@/lib/attendance";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  breakSecondsBySession,
  calculateMonthlyPay,
  type BreakInterval,
} from "@/lib/attendance-pay-calculation";
import { resolveLocale } from "@/lib/i18n";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import { chunk } from "@/lib/utils";

type Service = ReturnType<typeof getSupabaseServiceClient>;

const TZ = "Asia/Tokyo";

function tokyoTimeLabel(iso: string | null, localeTag: string): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat(localeTag, {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function tokyoDateLabel(iso: string | null, localeTag: string): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat(localeTag, {
    timeZone: TZ,
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(iso));
}

function tokyoSubmittedLabel(iso: string, localeTag: string): string {
  return new Intl.DateTimeFormat(localeTag, {
    timeZone: TZ,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/**
 * Admin attendance/payroll/transport console aggregation (overview slice).
 *
 * Aggregates the same server-side slices used by the dedicated queue, payroll,
 * and transport pages so the overview KPI bar cannot drift from the detail pages.
 * No new data model is introduced here.
 *
 * See docs/product/05-admin-web-ia.md → "Attendance / Payroll / Transportation".
 */

export type AdminAttendanceOverviewData = {
  isPrivileged: boolean;
  ym: string;
  prevYm: string;
  nextYm: string;
  monthLabel: string;
  kpi: {
    reviewSessions: number;
    urgent: number;
    corrOpen: number;
    payEstimated: number;
    payTotal: number;
    payExcluded: number;
    trPending: number;
    trTotal: number;
    trMissing: number;
  };
  reviewSample: ReviewQueueItem[];
  correctionSample: AdminCorrectionRow[];
};

export type AdminAttendanceBadgeStats = {
  isPrivileged: boolean;
  ym: string;
  queueOpen: number;
  queueUrgent: number;
  payrollTargets: number;
  transportPending: number;
};

const EMPTY_KPI = {
  reviewSessions: 0,
  urgent: 0,
  corrOpen: 0,
  payEstimated: 0,
  payTotal: 0,
  payExcluded: 0,
  trPending: 0,
  trTotal: 0,
  trMissing: 0,
};

const EMPTY_BADGE_STATS = {
  queueOpen: 0,
  queueUrgent: 0,
  payrollTargets: 0,
  transportPending: 0,
};

function lastDayOfYm(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

function tokyoMonthLabel(locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
  }).format(new Date());
}

export async function getAdminAttendanceBadgeStats(
  session: AppSession,
  ym: string = currentTokyoYm(),
): Promise<AdminAttendanceBadgeStats> {
  if (session.organization.id === "platform") {
    return { isPrivileged: false, ym, ...EMPTY_BADGE_STATS };
  }

  const service = getSupabaseServiceClient();
  const privileged = await isAttendancePayrollAdmin(
    service,
    session.organization.id,
    session.user.id,
  );
  if (!privileged) {
    return { isPrivileged: false, ym, ...EMPTY_BADGE_STATS };
  }

  const monthFrom = `${ym}-01`;
  const monthTo = lastDayOfYm(ym);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const [reviewRes, correctionsRes, transportRes, membersRes, empRes, rateRes] =
    await Promise.all([
      service
        .from("attendance_sessions")
        .select("id, clock_out_at, status")
        .eq("organization_id", session.organization.id)
        .eq("review_state", "review_required")
        // 무효 처리한 세션은 해소된 것으로 본다 — 검토 큐 · 마감 판정과 같다(2026-10-19).
        .neq("status", "invalid")
        .gte("operating_date", monthFrom)
        .lte("operating_date", monthTo)
        .limit(5000),
      service
        .from("attendance_correction_requests")
        .select("session_id", { count: "exact" })
        .eq("organization_id", session.organization.id)
        .in("status", ["requested", "in_review"]),
      service
        .from("transport_reimbursement_reports")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", session.organization.id)
        .eq("target_month", monthFrom)
        .in("status", ["submitted", "reviewing"]),
      service
        .from("memberships")
        .select("user_id")
        .eq("organization_id", session.organization.id)
        .eq("status", "active"),
      service
        .from("employment_type_history")
        .select("user_id, employment_type, effective_from, effective_to")
        .eq("organization_id", session.organization.id)
        .lte("effective_from", today)
        .or(`effective_to.is.null,effective_to.gte.${today}`)
        .order("effective_from", { ascending: false }),
      service
        .from("hourly_rate_history")
        .select("user_id, hourly_rate, effective_from, effective_to")
        .eq("organization_id", session.organization.id)
        .lte("effective_from", today)
        .or(`effective_to.is.null,effective_to.gte.${today}`),
    ]);

  const openCorrectionSessionIds = new Set(
    ((correctionsRes.data ?? []) as { session_id: string | null }[])
      .map((row) => row.session_id)
      .filter((id): id is string => Boolean(id)),
  );
  const reviewRows = ((reviewRes.data ?? []) as {
    id: string;
    clock_out_at: string | null;
    status: string;
  }[]).filter((row) => !openCorrectionSessionIds.has(row.id));
  const activeUserIds = new Set(
    ((membersRes.data ?? []) as { user_id: string }[]).map((row) => row.user_id),
  );
  const currentEmploymentByUser = new Map<string, string>();
  for (const row of (empRes.data ?? []) as {
    user_id: string;
    employment_type: string;
    effective_from: string;
    effective_to: string | null;
  }[]) {
    if (!currentEmploymentByUser.has(row.user_id)) {
      currentEmploymentByUser.set(row.user_id, row.employment_type);
    }
  }
  const currentHourlyRateUsers = new Set(
    ((rateRes.data ?? []) as { user_id: string; hourly_rate: number }[])
      .filter((row) => Number(row.hourly_rate) > 0)
      .map((row) => row.user_id),
  );
  let payrollTargets = 0;
  for (const userId of activeUserIds) {
    if (currentEmploymentByUser.get(userId) === "salaried") continue;
    if (currentHourlyRateUsers.has(userId)) payrollTargets += 1;
  }

  return {
    isPrivileged: true,
    ym,
    queueOpen: reviewRows.length + (correctionsRes.count ?? 0),
    queueUrgent: reviewRows.filter((row) => !row.clock_out_at).length,
    payrollTargets,
    transportPending: transportRes.count ?? 0,
  };
}

export async function getAdminAttendanceOverview(
  session: AppSession,
  localeTag: string,
  ym: string = currentTokyoYm(),
): Promise<AdminAttendanceOverviewData> {
  const monthLabel = monthLabelForYm(ym, localeTag);
  const prevYm = shiftYm(ym, -1);
  const nextYm = shiftYm(ym, 1);
  if (session.organization.id === "platform") {
    return {
      isPrivileged: false,
      ym,
      prevYm,
      nextYm,
      monthLabel,
      kpi: EMPTY_KPI,
      reviewSample: [],
      correctionSample: [],
    };
  }

  const service = getSupabaseServiceClient();
  const privileged = await isAttendancePayrollAdmin(
    service,
    session.organization.id,
    session.user.id,
  );
  if (!privileged) {
    return {
      isPrivileged: false,
      ym,
      prevYm,
      nextYm,
      monthLabel,
      kpi: EMPTY_KPI,
      reviewSample: [],
      correctionSample: [],
    };
  }

  let review: ReviewQueueItem[] = [];
  let corrections: AdminCorrectionRow[] = [];
  let corrOpenCount = 0;
  let payrollKpi = EMPTY_PAYROLL_KPI;
  let transportKpi = EMPTY_TRANSPORT_KPI;
  // Scope the review queue to the selected month so the overview reflects that month's data.
  const monthFrom = `${ym}-01`;
  const monthTo = lastDayOfYm(ym);
  const organizationId = session.organization.id;

  // 요약 숫자에 필요한 것만 읽는다(2026-10-19): 검토 큐는 review_required 세션만, 정정은 건수 + 앞 5건,
  // 교통비는 신청서 요약만. 전에는 그 달 세션 전부 · 정정 200건 상세 · 교통비 표 전체를 만들었다.
  const [reviewResult, correctionsResult, corrCountResult, payrollResult, transportResult] =
    await Promise.allSettled([
      getAttendanceReviewQueue(
        organizationId,
        {
          filter: "review_required",
          limit: 5000,
          from: monthFrom,
          to: monthTo,
        },
        localeTag,
      ),
      getAdminAttendanceCorrections(session, localeTag, OVERVIEW_SAMPLE_SIZE),
      service
        .from("attendance_correction_requests")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .in("status", ["requested", "in_review"]),
      getAdminAttendancePayroll(session, ym, localeTag),
      getTransportReportSummaryForAdmin(service, organizationId, monthFrom),
    ]);

  if (reviewResult.status === "fulfilled") {
    review = reviewResult.value;
  } else {
    console.warn("[admin-attendance] review queue failed", reviewResult.reason);
  }
  if (correctionsResult.status === "fulfilled") {
    corrections = correctionsResult.value.items;
  } else {
    console.warn("[admin-attendance] corrections overview failed", correctionsResult.reason);
  }
  if (corrCountResult.status === "fulfilled") {
    // 정정 탭(`getAdminAttendanceCorrections`)이 최대 200건을 보여 주므로 같은 상한을 둔다.
    corrOpenCount = Math.min(corrCountResult.value.count ?? 0, CORRECTION_LIST_LIMIT);
  } else {
    console.warn("[admin-attendance] corrections count failed", corrCountResult.reason);
  }
  if (payrollResult.status === "fulfilled") {
    payrollKpi = payrollResult.value.kpi;
  } else {
    console.warn("[admin-attendance] payroll overview failed", payrollResult.reason);
  }
  if (transportResult.status === "fulfilled") {
    transportKpi = transportKpiOf(transportResult.value);
  } else {
    console.warn("[admin-attendance] transport overview failed", transportResult.reason);
  }

  const isPendingCorrection = (r: ReviewQueueItem) =>
    r.correctionStatus === "requested" || r.correctionStatus === "in_review";
  const isOpenCorrection = (r: AdminCorrectionRow) =>
    r.status === "requested" || r.status === "in_review";
  // "Needs review" = the same rows the queue page's default `review` tab shows: flagged
  // review_required and not already routed to the pending-correction bucket. `getAttendanceReviewQueue`
  // with no filter returns ALL recent sessions (any status), so counting `review.length` here previously
  // reported every fetched session — not just the ones actually requiring review.
  const reviewRequiredRows = review.filter(
    (r) => r.reviewState === "review_required" && !isPendingCorrection(r),
  );
  const urgent = reviewRequiredRows.filter((r) => r.isAbnormal || !r.clockOutLabel).length;
  const correctionOpenRows = corrections.filter(isOpenCorrection);

  return {
    isPrivileged: true,
    ym,
    prevYm,
    nextYm,
    monthLabel,
    kpi: {
      reviewSessions: reviewRequiredRows.length,
      urgent,
      corrOpen: corrOpenCount,
      payEstimated: payrollKpi.hourlyTarget,
      payTotal: payrollKpi.expectedTotal,
      payExcluded: payrollKpi.excludedTotal,
      trPending: transportKpi.pendingReview,
      trTotal: transportKpi.submittedTotal,
      trMissing: transportKpi.missingEvidence,
    },
    reviewSample: reviewRequiredRows.slice(0, OVERVIEW_SAMPLE_SIZE),
    correctionSample: correctionOpenRows.slice(0, OVERVIEW_SAMPLE_SIZE),
  };
}

/**
 * Slice 2 — full review queue for the dashboard queue page.
 *
 * Returns the same `ReviewQueueItem[]` (gated by `isAttendancePayrollAdmin`) with no row limit,
 * so the queue page can render the full review/pending/all tables client-side.
 */
export type AdminAttendanceQueueData = {
  isPrivileged: boolean;
  monthLabel: string;
  items: ReviewQueueItem[];
};

/**
 * Slice 3 — admin-scoped correction requests for the queue page's `corr` tab.
 *
 * Wraps the existing `attendance_correction_requests` table (gated by
 * `isAttendancePayrollAdmin`). Derives a single primary "field" per request
 * (clock-in / clock-out / site) from the desired_* columns, and pairs it with
 * the current session value as the "before" side of the diff. Session-less
 * (exception) requests render with `sessionId: null` and `beforeLabel: "—"`.
 */

export type AdminCorrectionField = "clock_in" | "clock_out" | "site" | "other";

export type AdminCorrectionRow = {
  id: string;
  status: AttendanceCorrectionStatus;
  reasonType: AttendanceCorrectionReason;
  field: AdminCorrectionField;
  /** All field-level diffs for this request (for the panel detail). */
  diffs: { field: AdminCorrectionField; beforeLabel: string; afterLabel: string }[];
  requesterUserId: string;
  requesterName: string;
  requesterRole: string | null;
  sessionId: string | null;
  operatingDate: string | null;
  dateLabel: string | null;
  beforeLabel: string;
  afterLabel: string;
  memo: string | null;
  /**
   * Evidence photos attached by the requester. Stored as ready-to-render public URLs in
   * `attendance_correction_requests.image_urls` (same shape as maintenance / lost-found photos), so
   * the reviewer never has to approve or reject a correction blind.
   */
  imageUrls: string[];
  reviewComment: string | null;
  reviewerName: string | null;
  submittedLabel: string;
  submittedIso: string;
};

export type AdminAttendanceCorrectionsData = {
  isPrivileged: boolean;
  monthLabel: string;
  items: AdminCorrectionRow[];
};

const CORRECTION_LIST_LIMIT = 200;
const OVERVIEW_SAMPLE_SIZE = 5;

function pickPrimaryField(row: AttendanceCorrectionRequestRow): AdminCorrectionField {
  if (row.desired_clock_in_at != null) return "clock_in";
  if (row.desired_clock_out_at != null) return "clock_out";
  if (row.desired_clock_in_site_id != null || row.desired_clock_out_site_id != null) return "site";
  return "other";
}

export async function getAdminAttendanceCorrections(
  session: AppSession,
  localeTag: string,
  limit: number = CORRECTION_LIST_LIMIT,
): Promise<AdminAttendanceCorrectionsData> {
  const monthLabel = tokyoMonthLabel(localeTag);
  if (session.organization.id === "platform") {
    return { isPrivileged: false, monthLabel, items: [] };
  }
  const service = getSupabaseServiceClient();
  const privileged = await isAttendancePayrollAdmin(
    service,
    session.organization.id,
    session.user.id,
  );
  if (!privileged) {
    return { isPrivileged: false, monthLabel, items: [] };
  }

  const requestsRes = await service
    .from("attendance_correction_requests")
    .select("*")
    .eq("organization_id", session.organization.id)
    .in("status", ["requested", "in_review"])
    .order("created_at", { ascending: false })
    .limit(limit);
  const requests = (requestsRes.data ?? []) as AttendanceCorrectionRequestRow[];
  if (requests.length === 0) {
    return { isPrivileged: true, monthLabel, items: [] };
  }

  const requesterIds = Array.from(new Set(requests.map((r) => r.requested_by_user_id)));
  const reviewerIds = Array.from(
    new Set(requests.map((r) => r.reviewed_by_user_id).filter(Boolean) as string[]),
  );
  const sessionIds = Array.from(
    new Set(requests.map((r) => r.session_id).filter(Boolean) as string[]),
  );

  const [profilesRes, membershipsRes, sessionsRes] = await Promise.all([
    service
      .from("profiles")
      .select("id, name")
      .in("id", Array.from(new Set([...requesterIds, ...reviewerIds]))),
    service
      .from("memberships")
      .select("user_id, role")
      .eq("organization_id", session.organization.id)
      .in("user_id", requesterIds),
    sessionIds.length > 0
      ? service
          .from("attendance_sessions")
          .select("*")
          .eq("organization_id", session.organization.id)
          .in("id", sessionIds)
      : Promise.resolve({ data: [] as AttendanceSessionRow[], error: null }),
  ]);

  const nameById = new Map<string, string>();
  for (const row of (profilesRes.data ?? []) as { id: string; name: string }[]) {
    nameById.set(row.id, row.name);
  }
  const roleById = new Map<string, string>();
  for (const row of (membershipsRes.data ?? []) as { user_id: string; role: string }[]) {
    roleById.set(row.user_id, row.role);
  }
  const sessionById = new Map<string, AttendanceSessionRow>();
  for (const row of (sessionsRes.data ?? []) as AttendanceSessionRow[]) {
    sessionById.set(row.id, row);
  }

  const siteIds = Array.from(
    new Set(
      requests
        .flatMap((r) => {
          const linkedSession = r.session_id ? sessionById.get(r.session_id) ?? null : null;
          return [
            linkedSession?.clock_in_site_id ?? null,
            linkedSession?.clock_out_site_id ?? null,
            r.desired_clock_in_site_id,
            r.desired_clock_out_site_id,
          ];
        })
        .filter((siteId): siteId is string => Boolean(siteId)),
    ),
  );
  const siteNameById = new Map<string, string>();
  if (siteIds.length > 0) {
    const sitesRes = await service
      .from("attendance_sites")
      .select("id, name, properties(display_name_ko, display_name_ja, display_name_en)")
      .eq("organization_id", session.organization.id)
      .in("id", siteIds);
    for (const row of (sitesRes.data ?? []) as (AttendanceSiteDisplayRow & { id: string })[]) {
      siteNameById.set(row.id, localizeAttendanceSiteName(row, localeTag));
    }
  }

  const items: AdminCorrectionRow[] = requests.map((r) => {
      const linkedSession = r.session_id ? sessionById.get(r.session_id) ?? null : null;
      // 세션 없는 예외 요청은 직원이 고른 근무 날짜(`target_date`, 2026-10-01).
      const operatingDate = linkedSession?.operating_date ?? r.target_date ?? null;
      const dateLabel = operatingDate
        ? tokyoDateLabel(`${operatingDate}T00:00:00+09:00`, localeTag)
        : null;
      const field = pickPrimaryField(r);

      const diffs: AdminCorrectionRow["diffs"] = [];
      if (r.desired_clock_in_at != null) {
        const before = linkedSession?.clock_in_at
          ? tokyoTimeLabel(linkedSession.clock_in_at, localeTag) ?? "—"
          : "—";
        const after = tokyoTimeLabel(r.desired_clock_in_at, localeTag) ?? "—";
        diffs.push({ field: "clock_in", beforeLabel: before, afterLabel: after });
      }
      if (r.desired_clock_out_at != null) {
        const before = linkedSession?.clock_out_at
          ? tokyoTimeLabel(linkedSession.clock_out_at, localeTag) ?? "—"
          : "—";
        const after = tokyoTimeLabel(r.desired_clock_out_at, localeTag) ?? "—";
        diffs.push({ field: "clock_out", beforeLabel: before, afterLabel: after });
      }
      const desiredSiteId = r.desired_clock_in_site_id ?? r.desired_clock_out_site_id ?? null;
      if (desiredSiteId) {
        const beforeName = linkedSession?.clock_in_site_id
          ? siteNameById.get(linkedSession.clock_in_site_id) ?? null
          : null;
        const afterName = siteNameById.get(desiredSiteId) ?? null;
        diffs.push({
          field: "site",
          beforeLabel: beforeName ?? "—",
          afterLabel: afterName ?? "—",
        });
      }
      if (diffs.length === 0) {
        diffs.push({ field: "other", beforeLabel: "—", afterLabel: "—" });
      }

      const primary = diffs.find((d) => d.field === field) ?? diffs[0];

      return {
        id: r.id,
        status: r.status as AttendanceCorrectionStatus,
        reasonType: r.reason_type as AttendanceCorrectionReason,
        field: primary.field,
        diffs,
        requesterUserId: r.requested_by_user_id,
        requesterName: nameById.get(r.requested_by_user_id) ?? "—",
        requesterRole: roleById.get(r.requested_by_user_id) ?? null,
        sessionId: r.session_id,
        operatingDate,
        dateLabel,
        beforeLabel: primary.beforeLabel,
        afterLabel: primary.afterLabel,
        memo: r.memo,
        imageUrls: r.image_urls ?? [],
        reviewComment: r.review_comment,
        reviewerName: r.reviewed_by_user_id
          ? nameById.get(r.reviewed_by_user_id) ?? null
          : null,
        submittedLabel: tokyoSubmittedLabel(r.created_at, localeTag),
        submittedIso: r.created_at,
      };
    });

  return { isPrivileged: true, monthLabel, items };
}

/**
 * Slice 4 — admin payroll review for the `/admin/attendance/payroll` page.
 *
 * Reads the month's sessions · breaks · rates · snapshots once per org and computes each member with
 * `computePayrollMonth` (same rules as `getMonthlyPayView` + `getFinalizationEligibility`), then
 * aggregates KPI totals. Honest empty defaults when the
 * caller is not an attendance-payroll admin or the org has no members. No new
 * schema, no new server actions.
 */

export type AdminPayrollEmployment = "hourly" | "salaried" | "mixed" | "none";

export type AdminPayrollRow = {
  userId: string;
  userName: string;
  role: string | null;
  employment: AdminPayrollEmployment;
  /**
   * 이 달 근무 기록이 있는데 고용형태 이력이 없다 — 급여가 0 으로 계산된다. 전에는 「—」로만 보여 조용히 빠졌다
   * (2026-10-05). 화면이 「고용형태 미설정」 경고를 띄운다.
   */
  employmentMissing: boolean;
  totalPaidMinutes: number;
  recognizedLabel: string; // HHH:MM
  workDays: number; // count of Tokyo operating days with paid minutes
  primaryRate: number; // 0 when salaried-only / no rate
  expectedGross: number; // base wage + attendance allowance (transport excluded)
  baseGross: number; // base wage only (= expectedGross − allowanceTotal)
  allowanceTotal: number; // applied attendance allowance total (regular + special) for the month (¥)
  allowanceRegularTotal: number; // 추가수당 bucket total for the month (¥)
  allowanceSpecialTotal: number; // 특별수당 bucket total for the month (¥)
  transportApproved: number; // approved transport reimbursement total for the month (¥)
  excludedCount: number;
  finalized: boolean;
  finalizedAtLabel: string | null;
  finalizationEligible: boolean;
  blockers: FinalizationBlockers;
};

export type AdminAttendancePayrollData = {
  isPrivileged: boolean;
  ym: string; // YYYY-MM
  monthLabel: string;
  prevYm: string;
  nextYm: string;
  kpi: {
    hourlyTarget: number;
    expectedTotal: number;
    excludedTotal: number;
    finalizedCount: number;
  };
  rows: AdminPayrollRow[];
};

const EMPTY_PAYROLL_KPI = {
  hourlyTarget: 0,
  expectedTotal: 0,
  excludedTotal: 0,
  finalizedCount: 0,
};

function shiftYm(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

function fmtPaidMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const mm = min % 60;
  return `${h}:${String(mm).padStart(2, "0")}`;
}

function monthLabelForYm(ym: string, localeTag: string): string {
  return new Intl.DateTimeFormat(localeTag, {
    timeZone: TZ,
    year: "numeric",
    month: "long",
  }).format(new Date(`${ym}-01T00:00:00+09:00`));
}

export function currentTokyoYm(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${y}-${m}`;
}

// ── 급여 한 달치 — 조직 단위로 한 번에 읽고 사람별로 계산 ──────────────────────────
// 급여 화면은 직원마다 `getMonthlyPayView` · `getFinalizationEligibility` · `getCurrentFinalizedSnapshot` 를 불러
// 직원 11명이면 약 140쿼리였다(2026-10-19). 같은 행을 조직 단위로 한 번 읽고 아래에서 사람별로 나눠 계산한다.
// **계산 규칙은 `getMonthlyPayView`(src/lib/attendance-pay.ts) · `getFinalizationEligibility` 와 같아야 한다** —
// 한쪽을 바꾸면 다른 쪽도 바꾼다. `src/lib/__tests__/admin-payroll-batch.test.ts` 가 같은 입력으로 두 길의 결과를
// 1엔 단위까지 비교한다.

const PAYROLL_SESSION_SELECT =
  "id, user_id, operating_date, clock_in_at, clock_out_at, status, review_state, clock_in_site_id, clock_out_site_id" as const;

type PayrollSessionRow = {
  id: string;
  user_id: string;
  operating_date: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  status: string;
  review_state: string;
  clock_in_site_id: string | null;
  clock_out_site_id: string | null;
};

type PayrollRateRow = {
  user_id: string;
  hourly_rate: number;
  effective_from: string;
  effective_to: string | null;
};

type PayrollEmploymentRow = {
  user_id: string;
  employment_type: string;
  effective_from: string;
  effective_to: string | null;
};

type PayrollAllowanceRow = {
  id: string;
  target_date: string;
  target_user_id: string | null;
  allowance_type: string;
  amount_yen: number;
  category: string;
  memo: string | null;
};

type PayrollSnapshotRow = {
  user_id: string;
  status: string;
  gross_amount: number;
  total_paid_minutes: number;
  finalized_at: string | null;
};

type PayrollCorrectionRow = {
  session_id: string | null;
  requested_by_user_id: string;
  status: string;
  created_at: string;
};

/** 세션과 무관한 한 달치 행 — 1단계(모두 동시에). */
type PayrollMonthBase = {
  /** operating_date ↑, clock_in_at ↑(NULL 마지막) — `getMonthlyPayView` 와 같은 순서. */
  sessions: PayrollSessionRow[];
  rates: PayrollRateRow[];
  employment: PayrollEmploymentRow[];
  allowances: PayrollAllowanceRow[];
  /** 그 달 스냅샷, 상태 무관. */
  snapshots: PayrollSnapshotRow[];
  /** 세션 없는 예외 정정 중 처리 대기(requested · in_review), 그 달 대상. */
  sessionlessPending: { requested_by_user_id: string }[];
};

/** 세션 id 로 읽는 행 — 2단계. */
type PayrollMonthLinks = {
  breaks: BreakInterval[];
  /** 그 달 세션에 걸린 정정 요청 전부(요청자 · 상태 무관), created_at ↓. */
  corrections: PayrollCorrectionRow[];
};

export type PayrollMonthInputs = PayrollMonthBase & PayrollMonthLinks;

const PAYROLL_SESSION_ID_CHUNK = 200;

async function loadPayrollMonthBase(
  service: Service,
  organizationId: string,
  ym: string,
  userId?: string,
): Promise<PayrollMonthBase> {
  const firstDay = `${ym}-01`;
  const lastDay = lastDayOfYm(ym);
  const sessionsPage = (from: number, to: number) => {
    let query = service
      .from("attendance_sessions")
      .select(PAYROLL_SESSION_SELECT)
      .eq("organization_id", organizationId)
      .gte("operating_date", firstDay)
      .lte("operating_date", lastDay);
    if (userId) query = query.eq("user_id", userId);
    return query
      .order("operating_date", { ascending: true })
      .order("clock_in_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
  };
  let rateQuery = service
    .from("hourly_rate_history")
    .select("user_id, hourly_rate, effective_from, effective_to")
    .eq("organization_id", organizationId);
  let empQuery = service
    .from("employment_type_history")
    .select("user_id, employment_type, effective_from, effective_to")
    .eq("organization_id", organizationId);
  let snapQuery = service
    .from("attendance_month_snapshots")
    .select("user_id, status, gross_amount, total_paid_minutes, finalized_at")
    .eq("organization_id", organizationId)
    .eq("target_month", firstDay);
  let sessionlessQuery = service
    .from("attendance_correction_requests")
    .select("requested_by_user_id")
    .eq("organization_id", organizationId)
    .in("status", ["requested", "in_review"])
    .is("session_id", null)
    .eq("target_month", firstDay);
  if (userId) {
    rateQuery = rateQuery.eq("user_id", userId);
    empQuery = empQuery.eq("user_id", userId);
    snapQuery = snapQuery.eq("user_id", userId);
    sessionlessQuery = sessionlessQuery.eq("requested_by_user_id", userId);
  }

  const [sessRes, rateRes, empRes, allowRes, snapRes, sessionlessRes] = await Promise.all([
    readAllPages<PayrollSessionRow>(sessionsPage),
    rateQuery,
    empQuery,
    service
      .from("attendance_pay_allowances")
      .select("id, target_date, target_user_id, allowance_type, amount_yen, category, memo")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .gte("target_date", firstDay)
      .lte("target_date", lastDay),
    snapQuery,
    sessionlessQuery,
  ]);

  return {
    sessions: sessRes.data,
    rates: (rateRes.data ?? []) as PayrollRateRow[],
    employment: (empRes.data ?? []) as PayrollEmploymentRow[],
    allowances: (allowRes.data ?? []) as PayrollAllowanceRow[],
    snapshots: (snapRes.data ?? []) as PayrollSnapshotRow[],
    sessionlessPending: (sessionlessRes.data ?? []) as { requested_by_user_id: string }[],
  };
}

async function loadPayrollMonthLinks(
  service: Service,
  organizationId: string,
  sessions: readonly { id: string }[],
): Promise<PayrollMonthLinks> {
  if (sessions.length === 0) return { breaks: [], corrections: [] };
  const idChunks = chunk(
    sessions.map((s) => s.id),
    PAYROLL_SESSION_ID_CHUNK,
  );
  const [breakPages, correctionPages] = await Promise.all([
    Promise.all(
      idChunks.map((ids) =>
        service.from("attendance_breaks").select("session_id, started_at, ended_at").in("session_id", ids),
      ),
    ),
    Promise.all(
      idChunks.map((ids) =>
        service
          .from("attendance_correction_requests")
          .select("session_id, requested_by_user_id, status, created_at")
          .eq("organization_id", organizationId)
          .in("session_id", ids),
      ),
    ),
  ]);
  const corrections = correctionPages
    .flatMap((res) => (res.data ?? []) as PayrollCorrectionRow[])
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return {
    breaks: breakPages.flatMap((res) => (res.data ?? []) as BreakInterval[]),
    corrections,
  };
}

/** 한 사람의 그 달 급여 — 급여 화면 · 직원 상세가 쓰는 값만. 값은 `getMonthlyPayView` 와 같다. */
export type PayrollPaySummary = {
  hourlyEligible: boolean;
  salariedOnly: boolean;
  /** 근무한 날 중 월급제인 날이 있다(`days.some(employmentType === "salaried")`). */
  hasSalariedDay: boolean;
  totalPaidMinutes: number;
  expectedGross: number;
  allowanceTotal: number;
  allowanceRegularTotal: number;
  allowanceSpecialTotal: number;
  excludedCount: number;
  /** `rateSegments[0].rate` — 급여가 잡힌 시급 중 가장 낮은 것. 없으면 null. */
  primaryRate: number | null;
  /** 인정 분이 있는 날 수. */
  workDays: number;
  finalization: { gross: number; paidMinutes: number; finalizedAtLabel: string | null } | null;
};

export type PayrollUserMonth = {
  pay: PayrollPaySummary;
  eligibility: FinalizationEligibility;
  finalized: boolean;
};

function payLocaleTag(locale: string): string {
  const resolved = resolveLocale(locale);
  if (resolved === "ko") return "ko-KR";
  if (resolved === "ja") return "ja-JP";
  return "en-US";
}

function groupByUser<T extends { user_id: string }>(rows: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.user_id);
    if (list) list.push(row);
    else map.set(row.user_id, [row]);
  }
  return map;
}

/**
 * 한 달치 입력에서 사람별 급여 · 마감 가능 여부 · 마감 여부를 계산한다(DB 를 읽지 않는다).
 * `userIds` 에 든 사람마다 하나씩 돌려준다 — 그 달 기록이 없는 사람도 0 으로 채운다.
 */
export function computePayrollMonth(
  inputs: PayrollMonthInputs,
  ym: string,
  locale: string,
  userIds: readonly string[],
): Map<string, PayrollUserMonth> {
  const firstDay = `${ym}-01`;
  const lastDay = lastDayOfYm(ym);
  const sessionsByUser = groupByUser(inputs.sessions);
  const ratesByUser = groupByUser(inputs.rates);
  const employmentByUser = groupByUser(inputs.employment);
  const sessionOwner = new Map(inputs.sessions.map((s) => [s.id, s.user_id]));
  const breakSecs = breakSecondsBySession(inputs.breaks, inputs.sessions);

  // 급여 쪽 정정 상태 — 세션 주인이 낸 요청 중 가장 최근 것(`getMonthlyPayView` 의 requested_by 필터).
  const ownCorrectionStatus = new Map<string, string>();
  // 마감 차단 — 세션 주인이 낸 처리 대기 요청 수(행 단위).
  const pendingLinkedByUser = new Map<string, number>();
  for (const c of inputs.corrections) {
    if (!c.session_id) continue;
    const owner = sessionOwner.get(c.session_id);
    if (!owner || owner !== c.requested_by_user_id) continue;
    if (!ownCorrectionStatus.has(c.session_id)) ownCorrectionStatus.set(c.session_id, c.status);
    if (c.status === "requested" || c.status === "in_review") {
      pendingLinkedByUser.set(owner, (pendingLinkedByUser.get(owner) ?? 0) + 1);
    }
  }
  const pendingSessionlessByUser = new Map<string, number>();
  for (const c of inputs.sessionlessPending) {
    pendingSessionlessByUser.set(
      c.requested_by_user_id,
      (pendingSessionlessByUser.get(c.requested_by_user_id) ?? 0) + 1,
    );
  }
  const finalizedByUser = new Map<string, PayrollSnapshotRow>();
  for (const snap of inputs.snapshots) {
    if (snap.status === "finalized" && !finalizedByUser.has(snap.user_id)) {
      finalizedByUser.set(snap.user_id, snap);
    }
  }

  const out = new Map<string, PayrollUserMonth>();
  for (const userId of userIds) {
    const sessions = sessionsByUser.get(userId) ?? [];
    const rateRows = ratesByUser.get(userId) ?? [];
    const empRows = employmentByUser.get(userId) ?? [];

    const calc = calculateMonthlyPay({
      userId,
      firstDay,
      lastDay,
      sessions,
      rates: rateRows,
      employment: empRows,
      allowances: inputs.allowances,
      breakSecondsBySession: breakSecs,
      correctionStatusOf: (sessionId) => ownCorrectionStatus.get(sessionId) ?? null,
    });

    const snap = finalizedByUser.get(userId) ?? null;
    const pay: PayrollPaySummary = {
      hourlyEligible: calc.hourlyEligible,
      salariedOnly: calc.salariedOnly,
      hasSalariedDay: calc.days.some((d) => d.employmentType === "salaried"),
      totalPaidMinutes: calc.totalPaidMinutes,
      expectedGross: calc.expectedGross,
      allowanceRegularTotal: calc.allowanceRegularTotal,
      allowanceSpecialTotal: calc.allowanceSpecialTotal,
      allowanceTotal: calc.allowanceTotal,
      excludedCount: calc.excludedCount,
      primaryRate: calc.rateSegments[0]?.rate ?? null,
      workDays: calc.days.filter((d) => d.paidMinutes > 0).length,
      finalization: snap
        ? {
            gross: snap.gross_amount,
            paidMinutes: snap.total_paid_minutes,
            finalizedAtLabel: snap.finalized_at
              ? new Intl.DateTimeFormat(payLocaleTag(locale), {
                  timeZone: TZ,
                  month: "long",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                }).format(new Date(snap.finalized_at))
              : null,
          }
        : null,
    };

    const { reviewRequired, openSessions } = countBlockingSessions(sessions);
    const pendingCorrections =
      (sessions.length > 0 ? (pendingLinkedByUser.get(userId) ?? 0) : 0) +
      (pendingSessionlessByUser.get(userId) ?? 0);
    const alreadyFinalized = snap != null;
    out.set(userId, {
      pay,
      eligibility: {
        eligible:
          reviewRequired === 0 &&
          pendingCorrections === 0 &&
          openSessions === 0 &&
          calc.unpricedCount === 0 &&
          !alreadyFinalized,
        blockers: { reviewRequired, pendingCorrections, openSessions, missingPayInfo: calc.unpricedCount, alreadyFinalized },
      },
      finalized: alreadyFinalized,
    });
  }
  return out;
}

function payrollEmploymentOf(pay: PayrollPaySummary): AdminPayrollEmployment {
  if (pay.salariedOnly) return "salaried";
  if (pay.hourlyEligible) return pay.hasSalariedDay ? "mixed" : "hourly";
  return "none";
}

export async function getAdminAttendancePayroll(
  session: AppSession,
  ym: string,
  localeTag: string,
): Promise<AdminAttendancePayrollData> {
  const monthLabel = monthLabelForYm(ym, localeTag);
  const prevYm = shiftYm(ym, -1);
  const nextYm = shiftYm(ym, 1);
  const empty: AdminAttendancePayrollData = {
    isPrivileged: false,
    ym,
    monthLabel,
    prevYm,
    nextYm,
    kpi: EMPTY_PAYROLL_KPI,
    rows: [],
  };
  if (session.organization.id === "platform") return empty;
  const organizationId = session.organization.id;
  const service = getSupabaseServiceClient();
  const privileged = await isAttendancePayrollAdmin(service, organizationId, session.user.id);
  if (!privileged) return empty;

  const firstDay = `${ym}-01`;
  const [membersRes, base, transportRes] = await Promise.all([
    service.from("memberships").select("user_id, role, status").eq("organization_id", organizationId),
    loadPayrollMonthBase(service, organizationId, ym),
    // Approved transport reimbursement total per user for the month — same source/filter the payroll
    // export uses (approved status, target_month = 'YYYY-MM-01', total_amount_cached), so the panel
    // summary cannot drift from the exported PDF/Excel totals.
    service
      .from("transport_reimbursement_reports")
      .select("user_id, total_amount_cached, status")
      .eq("organization_id", organizationId)
      .eq("target_month", firstDay)
      .eq("status", "approved"),
  ]);
  const membershipRows = (membersRes.data ?? []) as {
    user_id: string;
    role: string;
    status: string;
  }[];
  const roleByUser = new Map<string, string>();
  const candidateUserIds = new Set<string>();
  for (const m of membershipRows) {
    if (!roleByUser.has(m.user_id)) roleByUser.set(m.user_id, m.role);
    if (m.status === "active") candidateUserIds.add(m.user_id);
  }
  const sessionUserIds = new Set<string>();
  for (const row of base.sessions) {
    candidateUserIds.add(row.user_id);
    sessionUserIds.add(row.user_id);
  }
  for (const row of base.snapshots) candidateUserIds.add(row.user_id);
  const userIds = Array.from(candidateUserIds);
  if (userIds.length === 0) return { ...empty, isPrivileged: true };

  const [links, profilesRes] = await Promise.all([
    loadPayrollMonthLinks(service, organizationId, base.sessions),
    service.from("profiles").select("id, name").in("id", userIds),
  ]);
  const nameById = new Map<string, string>();
  for (const row of (profilesRes.data ?? []) as { id: string; name: string }[]) {
    nameById.set(row.id, row.name);
  }
  const transportByUser = new Map<string, number>();
  for (const row of (transportRes.data ?? []) as {
    user_id: string;
    total_amount_cached: number | null;
  }[]) {
    transportByUser.set(row.user_id, (transportByUser.get(row.user_id) ?? 0) + (row.total_amount_cached ?? 0));
  }

  const computed = computePayrollMonth({ ...base, ...links }, ym, localeTag, userIds);
  const rows: AdminPayrollRow[] = userIds.map((userId) => {
    const { pay, eligibility, finalized } = computed.get(userId)!;
    const employment = payrollEmploymentOf(pay);
    const effectivePaidMinutes = pay.finalization?.paidMinutes ?? pay.totalPaidMinutes;
    const effectiveGross = pay.finalization?.gross ?? pay.expectedGross;
    return {
      userId,
      userName: nameById.get(userId) ?? "—",
      role: roleByUser.get(userId) ?? null,
      employment,
      employmentMissing: employment === "none" && sessionUserIds.has(userId),
      totalPaidMinutes: effectivePaidMinutes,
      recognizedLabel: fmtPaidMinutes(effectivePaidMinutes),
      workDays: pay.workDays,
      primaryRate: pay.primaryRate ?? 0,
      expectedGross: effectiveGross,
      allowanceTotal: pay.allowanceTotal,
      allowanceRegularTotal: pay.allowanceRegularTotal,
      allowanceSpecialTotal: pay.allowanceSpecialTotal,
      baseGross: effectiveGross - pay.allowanceTotal,
      transportApproved: transportByUser.get(userId) ?? 0,
      excludedCount: pay.excludedCount,
      finalized,
      finalizedAtLabel: pay.finalization?.finalizedAtLabel ?? null,
      finalizationEligible: eligibility.eligible,
      blockers: eligibility.blockers,
    };
  });

  rows.sort((a, b) => a.userName.localeCompare(b.userName));

  const hourlyRows = rows.filter((r) => r.employment === "hourly" || r.employment === "mixed");
  const kpi = {
    hourlyTarget: hourlyRows.length,
    expectedTotal: hourlyRows.reduce((s, r) => s + r.expectedGross, 0),
    excludedTotal: rows.reduce((s, r) => s + r.excludedCount, 0),
    finalizedCount: rows.filter((r) => r.finalized).length,
  };

  return { isPrivileged: true, ym, monthLabel, prevYm, nextYm, kpi, rows };
}

/**
 * Active org members (id + name) for admin pickers such as manual attendance entry. Privileged
 * (owner / attendance_payroll_admin) only. Sorted by name.
 */
export async function listActiveAttendanceStaff(
  session: AppSession,
): Promise<{ userId: string; userName: string }[]> {
  if (session.organization.id === "platform") return [];
  const service = getSupabaseServiceClient();
  if (!(await isAttendancePayrollAdmin(service, session.organization.id, session.user.id))) {
    return [];
  }
  const membersRes = await service
    .from("memberships")
    .select("user_id")
    .eq("organization_id", session.organization.id)
    .eq("status", "active");
  const userIds = Array.from(
    new Set(((membersRes.data ?? []) as { user_id: string }[]).map((m) => m.user_id)),
  );
  if (userIds.length === 0) return [];
  const profRes = await service.from("profiles").select("id, name").in("id", userIds);
  const rows = ((profRes.data ?? []) as { id: string; name: string }[]).map((p) => ({
    userId: p.id,
    userName: p.name,
  }));
  rows.sort((a, b) => a.userName.localeCompare(b.userName));
  return rows;
}

// ── Attendance allowance (추가수당) admin list ─────────────────────────────────

export type AdminAllowanceRow = {
  id: string;
  targetDate: string; // YYYY-MM-DD (Tokyo)
  targetDateLabel: string;
  targetUserId: string | null; // null = all hourly workers
  targetUserName: string | null;
  allowanceType: "daily_fixed" | "hourly_extra";
  amountYen: number;
  category: "regular" | "special";
  memo: string | null;
  status: "active" | "cancelled";
  createdAtLabel: string;
};

export type AdminAllowanceListData = {
  isPrivileged: boolean;
  rows: AdminAllowanceRow[];
};

/**
 * Org-wide attendance allowance list for the wage-management surface. Privileged (owner /
 * attendance_payroll_admin) only. Active rows first, newest target date first. Cancelled rows are kept
 * for a short audit tail so operators can see what was recently removed.
 */
export async function listAttendanceAllowances(
  session: AppSession,
  localeTag: string,
  limit = 80,
): Promise<AdminAllowanceListData> {
  if (session.organization.id === "platform") return { isPrivileged: false, rows: [] };
  const service = getSupabaseServiceClient();
  const privileged = await isAttendancePayrollAdmin(
    service,
    session.organization.id,
    session.user.id,
  );
  if (!privileged) return { isPrivileged: false, rows: [] };

  const res = await service
    .from("attendance_pay_allowances")
    .select(
      "id, target_date, target_user_id, allowance_type, amount_yen, category, memo, status, created_at",
    )
    .eq("organization_id", session.organization.id)
    .order("status", { ascending: true }) // 'active' < 'cancelled'
    .order("target_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  const rawRows = (res.data ?? []) as {
    id: string;
    target_date: string;
    target_user_id: string | null;
    allowance_type: string;
    amount_yen: number;
    category: string;
    memo: string | null;
    status: string;
    created_at: string;
  }[];

  const userIds = Array.from(
    new Set(rawRows.map((r) => r.target_user_id).filter((v): v is string => Boolean(v))),
  );
  const nameById = new Map<string, string>();
  if (userIds.length > 0) {
    const profRes = await service.from("profiles").select("id, name").in("id", userIds);
    for (const p of (profRes.data ?? []) as { id: string; name: string }[]) {
      nameById.set(p.id, p.name);
    }
  }

  const dateFmt = new Intl.DateTimeFormat(localeTag, {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    weekday: "short",
  });
  const createdFmt = new Intl.DateTimeFormat(localeTag, {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const rows: AdminAllowanceRow[] = rawRows.map((r) => ({
    id: r.id,
    targetDate: r.target_date,
    targetDateLabel: dateFmt.format(new Date(`${r.target_date}T00:00:00+09:00`)),
    targetUserId: r.target_user_id,
    targetUserName: r.target_user_id ? (nameById.get(r.target_user_id) ?? "—") : null,
    allowanceType: r.allowance_type as "daily_fixed" | "hourly_extra",
    amountYen: r.amount_yen,
    category: r.category === "special" ? "special" : "regular",
    memo: r.memo,
    status: r.status as "active" | "cancelled",
    createdAtLabel: createdFmt.format(new Date(r.created_at)),
  }));

  return { isPrivileged: true, rows };
}

/**
 * Slice 5 — admin transport reimbursement review for `/admin/attendance/transport`.
 *
 * Wraps `getTransportReportSummaryForAdmin` (gated by `isAttendancePayrollAdmin`)
 * and derives KPI totals + month pager. Per-user item details + receipt thumbnails
 * load on demand via the `loadAdminTransportDetail` server action when a panel opens.
 */

export type AdminTransportRow = {
  reportId: string; // synthesized when report row exists; empty string when none
  userId: string;
  userName: string;
  status: TransportReportStatus | "none";
  itemCount: number;
  totalAmount: number;
  missingCount: number;
  /** 제출 시각(ISO) — 표의 제출일 열(2026-10-13 리디자인). 미제출 · 작성 중이면 null. */
  submittedAt: string | null;
};

export type AdminAttendanceTransportData = {
  isPrivileged: boolean;
  ym: string;
  monthLabel: string;
  prevYm: string;
  nextYm: string;
  kpi: {
    pendingReview: number;
    submittedTotal: number;
    approvedTotal: number;
    missingEvidence: number;
  };
  rows: AdminTransportRow[];
};

const EMPTY_TRANSPORT_KPI = {
  pendingReview: 0,
  submittedTotal: 0,
  approvedTotal: 0,
  missingEvidence: 0,
};

/**
 * 교통비 KPI — 표의 사람별 행에서 셈한 값과 같다(신청서가 없는 사람은 상태 none · 0엔이라 더해지지 않는다).
 * 한 사람에게 요약이 둘 이상이면 표처럼 마지막 것을 쓴다.
 */
function transportKpiOf(
  summaries: readonly TransportReportAdminSummary[],
): AdminAttendanceTransportData["kpi"] {
  const byUser = new Map<string, TransportReportAdminSummary>();
  for (const s of summaries) byUser.set(s.userId, s);
  const rows = Array.from(byUser.values());
  return {
    pendingReview: rows.filter((r) => r.status === "submitted" || r.status === "reviewing").length,
    submittedTotal: rows
      .filter((r) => r.status === "submitted" || r.status === "reviewing" || r.status === "approved")
      .reduce((s, r) => s + r.totalAmount, 0),
    approvedTotal: rows.filter((r) => r.status === "approved").length,
    missingEvidence: rows.reduce((s, r) => s + r.missingCount, 0),
  };
}

export async function getAdminAttendanceTransport(
  session: AppSession,
  ym: string,
  localeTag: string,
): Promise<AdminAttendanceTransportData> {
  const monthLabel = monthLabelForYm(ym, localeTag);
  const prevYm = shiftYm(ym, -1);
  const nextYm = shiftYm(ym, 1);
  if (session.organization.id === "platform") {
    return {
      isPrivileged: false,
      ym,
      monthLabel,
      prevYm,
      nextYm,
      kpi: EMPTY_TRANSPORT_KPI,
      rows: [],
    };
  }
  const service = getSupabaseServiceClient();
  const privileged = await isAttendancePayrollAdmin(
    service,
    session.organization.id,
    session.user.id,
  );
  if (!privileged) {
    return {
      isPrivileged: false,
      ym,
      monthLabel,
      prevYm,
      nextYm,
      kpi: EMPTY_TRANSPORT_KPI,
      rows: [],
    };
  }

  const targetMonthDate = `${ym}-01`;
  let summaries: TransportReportAdminSummary[] = [];
  try {
    summaries = await getTransportReportSummaryForAdmin(
      service,
      session.organization.id,
      targetMonthDate,
    );
  } catch (error) {
    console.warn("[admin-attendance] transport summary failed", error);
  }

  // Include active members with no report, plus any inactive member who has a report in this month.
  const membersRes = await service
    .from("memberships")
    .select("user_id, role, status")
    .eq("organization_id", session.organization.id);
  const membershipRows = (membersRes.data ?? []) as {
    user_id: string;
    role: string;
    status: string;
  }[];
  const byUser = new Map<string, TransportReportAdminSummary>();
  for (const s of summaries) byUser.set(s.userId, s);

  // Need report ids — fetch directly.
  const reportIdsRes = await service
    .from("transport_reimbursement_reports")
    .select("id, user_id")
    .eq("organization_id", session.organization.id)
    .eq("target_month", targetMonthDate);
  const reportIdByUser = new Map<string, string>();
  for (const r of (reportIdsRes.data ?? []) as { id: string; user_id: string }[]) {
    reportIdByUser.set(r.user_id, r.id);
  }

  const candidateUserIds = new Set<string>();
  for (const m of membershipRows) {
    if (m.status === "active") candidateUserIds.add(m.user_id);
  }
  for (const s of summaries) candidateUserIds.add(s.userId);
  for (const userId of reportIdByUser.keys()) candidateUserIds.add(userId);
  const members = Array.from(candidateUserIds).map((userId) => {
    const membership = membershipRows.find((m) => m.user_id === userId);
    return { user_id: userId, role: membership?.role ?? null };
  });
  const profilesRes =
    members.length > 0
      ? await service
          .from("profiles")
          .select("id, name")
          .in(
            "id",
            members.map((m) => m.user_id),
          )
      : { data: [] };
  const nameById = new Map<string, string>();
  for (const row of (profilesRes.data ?? []) as { id: string; name: string }[]) {
    nameById.set(row.id, row.name);
  }

  const rows: AdminTransportRow[] = members.map((m) => {
    const s = byUser.get(m.user_id);
    return {
      reportId: reportIdByUser.get(m.user_id) ?? "",
      userId: m.user_id,
      userName: nameById.get(m.user_id) ?? "—",
      status: (s?.status as TransportReportStatus | undefined) ?? "none",
      itemCount: s?.itemCount ?? 0,
      totalAmount: s?.totalAmount ?? 0,
      missingCount: s?.missingCount ?? 0,
      submittedAt: s?.submittedAt ?? null,
    };
  });
  rows.sort((a, b) => a.userName.localeCompare(b.userName));

  return { isPrivileged: true, ym, monthLabel, prevYm, nextYm, kpi: transportKpiOf(summaries), rows };
}

// ── Per-staff monthly receipt review (desktop master-detail viewer) ──────────
// Privileged (owner / attendance_payroll_admin), organization-scoped: resolves ALL of one staff
// member's reimbursement items for a month, each with its receipt photos as short-lived signed URLs.
// Backs `/admin/attendance/transport/receipt?ym=&user=` — a desktop master-detail page (item list +
// large receipt pane) entered from the transport panel, so a reviewer can flip through a whole
// month's receipts in one screen instead of opening one per item.

const TRANSPORT_RECEIPT_BUCKET = "request-images";

export type AdminReceiptItem = {
  itemId: string;
  usageDate: string; // 'YYYY-MM-DD'
  amountYen: number;
  buildingLabel: string | null;
  contextLabel: string | null;
  imageUrls: string[];
};

export type AdminTransportReceiptsView = {
  ym: string;
  monthLabel: string;
  userId: string;
  staffName: string;
  reportStatus: TransportReportStatus | "none";
  totalAmount: number;
  items: AdminReceiptItem[];
};

export async function getAdminTransportReceiptsForUser(
  session: AppSession,
  ym: string,
  userId: string,
  localeTag: string,
): Promise<AdminTransportReceiptsView | null> {
  if (session.organization.id === "platform") return null;
  if (!/^\d{4}-\d{2}$/.test(ym)) return null;
  const service = getSupabaseServiceClient();
  const privileged = await isAttendancePayrollAdmin(
    service,
    session.organization.id,
    session.user.id,
  );
  if (!privileged) return null;

  const monthLabel = monthLabelForYm(ym, localeTag);
  const memberRes = await service
    .from("memberships")
    .select("user_id")
    .eq("organization_id", session.organization.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!memberRes.data) return null;

  const profileRes = await service
    .from("profiles")
    .select("name")
    .eq("id", userId)
    .maybeSingle();
  const staffName = (profileRes.data as { name: string } | null)?.name ?? "—";

  // Report is (org, user, month) scoped inside getTransportReport → org isolation is enforced there.
  const report = await getTransportReport(service, session.organization.id, userId, `${ym}-01`);
  if (!report) {
    return {
      ym,
      monthLabel,
      userId,
      staffName,
      reportStatus: "none",
      totalAmount: 0,
      items: [],
    };
  }

  const rawItems = await getTransportItems(service, report.id);

  // Sign every image path once, then map back per item.
  const allPaths = rawItems.flatMap((it) => it.images.map((img) => img.storagePath));
  const urlByPath = new Map<string, string>();
  if (allPaths.length > 0) {
    const signed = await service.storage
      .from(TRANSPORT_RECEIPT_BUCKET)
      .createSignedUrls(allPaths, 600);
    for (const r of (signed.data ?? []) as { path: string | null; signedUrl: string | null }[]) {
      if (r.path && r.signedUrl) urlByPath.set(r.path, r.signedUrl);
    }
  }

  const items: AdminReceiptItem[] = rawItems.map((it) => {
    const wc = it.workContext ?? {};
    return {
      itemId: it.id,
      usageDate: it.usageDate,
      amountYen: it.amountYen,
      buildingLabel: wc.buildingLabel ?? null,
      contextLabel: wc.contextSummary ?? wc.taskLabel ?? wc.roomLabel ?? null,
      imageUrls: it.images
        .map((img) => urlByPath.get(img.storagePath))
        .filter((u): u is string => typeof u === "string"),
    };
  });

  return {
    ym,
    monthLabel,
    userId,
    staffName,
    reportStatus: report.status,
    totalAmount: items.reduce((s, it) => s + it.amountYen, 0),
    items,
  };
}

/**
 * Slice 6 — per-user monthly detail for `/admin/attendance/staff/[userId]`.
 *
 * User header (avatar + name + role + KPI stats), day-by-day session ledger,
 * payroll summary, and transport summary — all wired to existing helpers
 * (`getMonthlyPayView`, attendance_sessions read with site join, transport
 * report+items). Honest empties when caller is not privileged or no data exists.
 */

export type AdminStaffDaySession = {
  sessionId: string;
  clockInLabel: string | null;
  clockOutLabel: string | null;
  paidDurationLabel: string; // HH:MM or "—"
  breakLabel: string; // HH:MM
  siteName: string | null;
  status: "open" | "completed" | "invalid";
  reviewState: string;
  isAbnormal: boolean;
  correctionPending: boolean;
  issueKey: "clockout_missing" | "correction_pending" | "abnormal" | "incomplete" | "none";
};

export type AdminStaffDay = {
  date: string; // YYYY-MM-DD
  day: string; // "30"
  weekdayShort: string; // "화"
  sessions: AdminStaffDaySession[];
};

export type AdminStaffDetailData = {
  isPrivileged: boolean;
  ym: string;
  monthLabel: string;
  prevYm: string;
  nextYm: string;
  user: {
    id: string;
    name: string;
    role: string | null;
  };
  pay: {
    employment: AdminPayrollEmployment;
    recognizedLabel: string;
    expectedGross: number;
    excludedCount: number;
    primaryRate: number;
    finalized: boolean;
  };
  transport: {
    status: TransportReportStatus | "none";
    itemCount: number;
    linkedCount: number;
    missingCount: number;
    totalAmount: number;
  };
  days: AdminStaffDay[];
  stats: {
    totalDays: number;
    doneSessions: number;
    issueSessions: number;
  };
};

function fmtDayKey(operatingDate: string, localeTag: string): { day: string; wd: string } {
  // operatingDate format YYYY-MM-DD
  const day = String(parseInt(operatingDate.slice(8), 10));
  const d = new Date(`${operatingDate}T00:00:00+09:00`);
  const wd = new Intl.DateTimeFormat(localeTag, {
    timeZone: TZ,
    weekday: "short",
  }).format(d);
  return { day, wd };
}

function timeLabelOf(iso: string | null, localeTag: string): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat(localeTag, {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function fmtDurationMin(min: number): string {
  if (min <= 0) return "—";
  const h = Math.floor(min / 60);
  const mm = min % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function fmtBreakSec(sec: number): string {
  if (sec <= 0) return "00:00";
  const total = Math.floor(sec / 60);
  const h = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function classifyDayIssue(s: {
  status: string;
  clockOutLabel: string | null;
  reviewState: string;
  correctionStatus: string | null;
  isAbnormal: boolean;
}): AdminStaffDaySession["issueKey"] {
  // `abandoned` 도 "퇴근 미기록"으로 묶는다 — 관리자 입장에서 해야 할 일이 같기 때문이다
  // (퇴근 시각 입력 또는 무효 처리). 2026-08-04.
  if ((s.status === "open" || s.status === "abandoned") && !s.clockOutLabel) return "clockout_missing";
  if (s.correctionStatus === "requested" || s.correctionStatus === "in_review")
    return "correction_pending";
  if (s.isAbnormal) return "abnormal";
  if (!s.clockOutLabel && s.status !== "invalid") return "incomplete";
  return "none";
}

export async function getAdminStaffDetail(
  session: AppSession,
  userId: string,
  ym: string,
  localeTag: string,
): Promise<AdminStaffDetailData> {
  const monthLabel = monthLabelForYm(ym, localeTag);
  const prevYm = shiftYm(ym, -1);
  const nextYm = shiftYm(ym, 1);
  const baseEmpty: AdminStaffDetailData = {
    isPrivileged: false,
    ym,
    monthLabel,
    prevYm,
    nextYm,
    user: { id: userId, name: "—", role: null },
    pay: {
      employment: "none",
      recognizedLabel: "0:00",
      expectedGross: 0,
      excludedCount: 0,
      primaryRate: 0,
      finalized: false,
    },
    transport: {
      status: "none",
      itemCount: 0,
      linkedCount: 0,
      missingCount: 0,
      totalAmount: 0,
    },
    days: [],
    stats: { totalDays: 0, doneSessions: 0, issueSessions: 0 },
  };
  if (session.organization.id === "platform") return baseEmpty;
  const organizationId = session.organization.id;
  const service = getSupabaseServiceClient();
  const targetMonthDate = `${ym}-01`;

  // 권한 · 멤버 · 이름 · 그 달 급여 입력 · 교통비 신청서를 한 번에 시작한다. 결과는 권한 확인 뒤에만 쓴다.
  const [privileged, memberRes, profileRes, base, trReport] = await Promise.all([
    isAttendancePayrollAdmin(service, organizationId, session.user.id),
    service
      .from("memberships")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle(),
    service.from("profiles").select("name").eq("id", userId).maybeSingle(),
    loadPayrollMonthBase(service, organizationId, ym, userId),
    getTransportReport(service, organizationId, userId, targetMonthDate).catch(() => null),
  ]);
  if (!privileged) return baseEmpty;
  const member = (memberRes.data as { role: string } | null) ?? null;
  if (!member) return { ...baseEmpty, isPrivileged: true };
  const userName = (profileRes.data as { name: string } | null)?.name ?? "—";

  // NOTE: breaks live in `attendance_breaks` (there is no `break_total_sec` column on the session).
  const sessionsAsc = base.sessions;
  const siteIds = Array.from(
    new Set(
      sessionsAsc
        .flatMap((r) => [r.clock_in_site_id, r.clock_out_site_id])
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const [links, sitesRes, trItems] = await Promise.all([
    loadPayrollMonthLinks(service, organizationId, sessionsAsc),
    siteIds.length > 0
      ? service
          .from("attendance_sites")
          .select("id, name, properties(display_name_ko, display_name_ja, display_name_en)")
          .eq("organization_id", organizationId)
          .in("id", siteIds)
      : Promise.resolve({ data: [] as (AttendanceSiteDisplayRow & { id: string })[] }),
    trReport ? getTransportItems(service, trReport.id).catch(() => []) : Promise.resolve([]),
  ]);

  const { pay: payView, finalized } = computePayrollMonth(
    { ...base, ...links },
    ym,
    localeTag,
    [userId],
  ).get(userId)!;

  // 원장은 최근 날짜 먼저 — 급여 계산용 오름차순을 뒤집는다.
  const sessRows = [...sessionsAsc].reverse();
  const breakBySession = breakSecondsBySession(links.breaks, sessionsAsc);
  // 원장의 정정 표시는 요청자와 관계없이 세션마다 가장 최근 요청.
  const corrBySession = new Map<string, string>();
  for (const r of links.corrections) {
    if (r.session_id && !corrBySession.has(r.session_id)) corrBySession.set(r.session_id, r.status);
  }
  const siteNameById = new Map<string, string>();
  for (const row of (sitesRes.data ?? []) as (AttendanceSiteDisplayRow & { id: string })[]) {
    siteNameById.set(row.id, localizeAttendanceSiteName(row, localeTag));
  }

  // Compose day groups (most recent first)
  const daysMap = new Map<string, AdminStaffDay>();
  let doneSessions = 0;
  let issueSessions = 0;
  for (const r of sessRows) {
    const key = r.operating_date;
    if (!daysMap.has(key)) {
      const { day, wd } = fmtDayKey(key, localeTag);
      daysMap.set(key, { date: key, day, weekdayShort: wd, sessions: [] });
    }
    const day = daysMap.get(key)!;
    const clockInLabel = timeLabelOf(r.clock_in_at, localeTag);
    const clockOutLabel = timeLabelOf(r.clock_out_at, localeTag);
    const corrStatus = corrBySession.get(r.id) ?? null;
    const isAbnormal =
      r.status !== "invalid" && (r.review_state === "review_required" || !r.clock_out_at);
    const issueKey = classifyDayIssue({
      status: r.status,
      clockOutLabel,
      reviewState: r.review_state,
      correctionStatus: corrStatus,
      isAbnormal,
    });
    const breakSec = breakBySession.get(r.id) ?? 0;
    let paidMin = 0;
    if (r.clock_in_at && r.clock_out_at) {
      const sec = (new Date(r.clock_out_at).getTime() - new Date(r.clock_in_at).getTime()) / 1000;
      paidMin = Math.max(0, Math.floor((sec - breakSec) / 60));
    }
    day.sessions.push({
      sessionId: r.id,
      clockInLabel,
      clockOutLabel,
      paidDurationLabel: fmtDurationMin(paidMin),
      breakLabel: fmtBreakSec(breakSec),
      siteName: r.clock_in_site_id ? siteNameById.get(r.clock_in_site_id) ?? null : null,
      // `abandoned` 는 목록에서 `open` 으로 접는다. 뷰 타입에 상태를 늘리면 필터·배지·엑셀까지
      // 전부 갈라지는데, 관리자가 할 일은 "퇴근 시각을 채우거나 무효 처리"로 동일하다. 구분이
      // 필요한 자리는 위 issueKey(`clockout_missing`)가 이미 담당한다.
      status:
        r.status === "completed" || r.status === "invalid"
          ? (r.status as "completed" | "invalid")
          : r.status === "open" || r.status === "abandoned"
            ? "open"
            : "completed",
      reviewState: r.review_state,
      isAbnormal,
      correctionPending: corrStatus === "requested" || corrStatus === "in_review",
      issueKey,
    });
    if (r.status === "completed" && !isAbnormal) doneSessions += 1;
    if (issueKey !== "none" || r.status === "invalid") issueSessions += 1;
  }
  // Day order: most recent first (already sorted by query)
  const days = Array.from(daysMap.values());

  let trItemCount = 0;
  let trLinkedCount = 0;
  let trMissingCount = 0;
  let trTotal = 0;
  let trStatus: TransportReportStatus | "none" = "none";
  if (trReport) {
    trStatus = trReport.status;
    trTotal = trReport.totalAmountCached;
    trItemCount = trItems.length;
    trLinkedCount = trItems.filter((i) => i.entryMode === "linked").length;
    trMissingCount = trItems.filter((i) => i.imageCount === 0).length;
  }

  return {
    isPrivileged: true,
    ym,
    monthLabel,
    prevYm,
    nextYm,
    user: { id: userId, name: userName, role: member.role },
    pay: {
      employment: payrollEmploymentOf(payView),
      recognizedLabel: fmtPaidMinutes(payView.finalization?.paidMinutes ?? payView.totalPaidMinutes),
      expectedGross: payView.finalization?.gross ?? payView.expectedGross,
      excludedCount: payView.excludedCount,
      primaryRate: payView.primaryRate ?? 0,
      finalized,
    },
    transport: {
      status: trStatus,
      itemCount: trItemCount,
      linkedCount: trLinkedCount,
      missingCount: trMissingCount,
      totalAmount: trTotal,
    },
    days,
    stats: {
      totalDays: days.length,
      doneSessions,
      issueSessions,
    },
  };
}

/**
 * Slice 7 — admin hourly wage management for `/admin/attendance/wages`.
 *
 * Reads `hourly_rate_history` + `employment_type_history` per active member,
 * derives the current rate and the chronological tier list. No new schema;
 * `setHourlyRate` server action handles edits with audit logging.
 */

export type WageEmployment = "hourly" | "salaried" | "unknown";

export type WageHistoryEntry = {
  id: string;
  rate: number | null;
  from: string; // YYYY-MM-DD
  to: string | null; // null = current
  /** True when this period has closed (effective_to set). Past closed periods are non-editable. */
  locked: boolean;
  /** Change reason from the audit log (null when unavailable, e.g. dev-seeded rows). */
  note: string | null;
};

export type EmploymentHistoryEntry = {
  id: string;
  type: "hourly" | "salaried";
  from: string; // YYYY-MM-DD
  to: string | null; // null = current
  note: string | null;
};

export type AdminWageRow = {
  userId: string;
  userName: string;
  role: string | null;
  employment: WageEmployment;
  currentRate: number | null;
  currentFrom: string | null;
  history: WageHistoryEntry[];
  employmentHistory: EmploymentHistoryEntry[];
};

export type AdminAttendanceWagesData = {
  isPrivileged: boolean;
  /** Suggested default effective-from for the next change (1st of next Tokyo month). */
  defaultEffectiveFrom: string;
  /** Earliest selectable effective-from (today, Tokyo) — matches the server's no-past-dates rule. */
  minEffectiveFrom: string;
  /** 앞쪽 빈 날 채우기의 가장 이른 날(지난달 1일, `gapFillMinFrom`) — 그 사람의 이력이 이 날보다 늦게 시작할 때만 쓴다. */
  gapFillMinFrom: string;
  rows: AdminWageRow[];
};

function firstOfNextTokyoMonth(): string {
  const tz = "Asia/Tokyo";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year")?.value ?? "1970");
  const m = Number(parts.find((p) => p.type === "month")?.value ?? "1");
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

/** Today's date (Tokyo) — the earliest effective-from the server's no-past-dates rule allows. */
function todayTokyo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function getAdminAttendanceWages(
  session: AppSession,
): Promise<AdminAttendanceWagesData> {
  const defaultEffectiveFrom = firstOfNextTokyoMonth();
  const minEffectiveFrom = todayTokyo();
  const gapMin = gapFillMinFrom(minEffectiveFrom);
  if (session.organization.id === "platform") {
    return { isPrivileged: false, defaultEffectiveFrom, minEffectiveFrom, gapFillMinFrom: gapMin, rows: [] };
  }
  const service = getSupabaseServiceClient();
  const privileged = await isAttendancePayrollAdmin(
    service,
    session.organization.id,
    session.user.id,
  );
  if (!privileged) {
    return { isPrivileged: false, defaultEffectiveFrom, minEffectiveFrom, gapFillMinFrom: gapMin, rows: [] };
  }

  const membersRes = await service
    .from("memberships")
    .select("user_id, role")
    .eq("organization_id", session.organization.id)
    .eq("status", "active");
  const members = (membersRes.data ?? []) as { user_id: string; role: string }[];
  if (members.length === 0) {
    return { isPrivileged: true, defaultEffectiveFrom, minEffectiveFrom, gapFillMinFrom: gapMin, rows: [] };
  }

  const userIds = members.map((m) => m.user_id);
  const [profilesRes, ratesRes, empRes] = await Promise.all([
    service.from("profiles").select("id, name").in("id", userIds),
    service
      .from("hourly_rate_history")
      .select("id, user_id, hourly_rate, effective_from, effective_to")
      .eq("organization_id", session.organization.id)
      .in("user_id", userIds)
      .order("effective_from", { ascending: false }),
    service
      .from("employment_type_history")
      .select("id, user_id, employment_type, effective_from, effective_to")
      .eq("organization_id", session.organization.id)
      .in("user_id", userIds)
      .order("effective_from", { ascending: false }),
  ]);

  // Change reasons are stored on `audit_logs.metadata.note`, keyed by the history row id (`target_id`).
  // Join them back so each rate/employment period can show why it was changed (dev-seeded rows have none).
  const historyIds = [
    ...((ratesRes.data ?? []) as { id: string }[]).map((r) => r.id),
    ...((empRes.data ?? []) as { id: string }[]).map((e) => e.id),
  ];
  const noteByTargetId = new Map<string, string>();
  if (historyIds.length > 0) {
    const notesRes = await service
      .from("audit_logs")
      .select("target_id, metadata")
      .eq("organization_id", session.organization.id)
      .in("target_type", ["hourly_rate_history", "employment_type_history"])
      .in("target_id", historyIds);
    for (const a of (notesRes.data ?? []) as { target_id: string | null; metadata: unknown }[]) {
      const note = (a.metadata as { note?: unknown } | null)?.note;
      if (a.target_id && typeof note === "string" && note.trim()) {
        noteByTargetId.set(a.target_id, note.trim());
      }
    }
  }

  const nameById = new Map<string, string>();
  for (const row of (profilesRes.data ?? []) as { id: string; name: string }[]) {
    nameById.set(row.id, row.name);
  }

  type RateRow = {
    id: string;
    user_id: string;
    hourly_rate: number;
    effective_from: string;
    effective_to: string | null;
  };
  const ratesByUser = new Map<string, RateRow[]>();
  for (const r of (ratesRes.data ?? []) as RateRow[]) {
    const arr = ratesByUser.get(r.user_id) ?? [];
    arr.push(r);
    ratesByUser.set(r.user_id, arr);
  }

  type EmpRow = {
    id: string;
    user_id: string;
    employment_type: string;
    effective_from: string;
    effective_to: string | null;
  };
  const today = todayTokyo();
  const empLatestByUser = new Map<string, EmpRow>();
  const empByUser = new Map<string, EmpRow[]>();
  for (const e of (empRes.data ?? []) as EmpRow[]) {
    const arr = empByUser.get(e.user_id) ?? [];
    arr.push(e);
    empByUser.set(e.user_id, arr);
    const activeNow = e.effective_from <= today && (e.effective_to == null || e.effective_to >= today);
    if (activeNow && !empLatestByUser.has(e.user_id)) empLatestByUser.set(e.user_id, e);
  }

  const rows: AdminWageRow[] = members.map((m) => {
    const userRates = ratesByUser.get(m.user_id) ?? [];
    const current =
      userRates.find((r) => r.effective_from <= today && (r.effective_to == null || r.effective_to >= today)) ??
      null;
    const empRow = empLatestByUser.get(m.user_id);
    const employment: WageEmployment = empRow
      ? empRow.employment_type === "salaried"
        ? "salaried"
        : "hourly"
      : userRates.length > 0
        ? "hourly"
        : "unknown";
    const history: WageHistoryEntry[] = userRates.map((r) => ({
      id: r.id,
      rate: r.hourly_rate,
      from: r.effective_from,
      to: r.effective_to,
      locked: r.effective_to != null,
      note: noteByTargetId.get(r.id) ?? null,
    }));
    const employmentHistory: EmploymentHistoryEntry[] = (empByUser.get(m.user_id) ?? []).map((e) => ({
      id: e.id,
      type: e.employment_type === "salaried" ? "salaried" : "hourly",
      from: e.effective_from,
      to: e.effective_to,
      note: noteByTargetId.get(e.id) ?? null,
    }));
    return {
      userId: m.user_id,
      userName: nameById.get(m.user_id) ?? "—",
      role: m.role,
      employment,
      currentRate: current?.hourly_rate ?? null,
      currentFrom: current?.effective_from ?? null,
      history,
      employmentHistory,
    };
  });
  rows.sort((a, b) => a.userName.localeCompare(b.userName));

  return { isPrivileged: true, defaultEffectiveFrom, minEffectiveFrom, gapFillMinFrom: gapMin, rows };
}

export async function getAdminAttendanceQueue(
  session: AppSession,
  localeTag: string,
  ym: string = currentTokyoYm(),
): Promise<AdminAttendanceQueueData> {
  const monthLabel = monthLabelForYm(ym, localeTag);
  if (session.organization.id === "platform") {
    return { isPrivileged: false, monthLabel, items: [] };
  }
  const service = getSupabaseServiceClient();
  const privileged = await isAttendancePayrollAdmin(
    service,
    session.organization.id,
    session.user.id,
  );
  if (!privileged) {
    return { isPrivileged: false, monthLabel, items: [] };
  }
  // Scope the queue (incl. the "전체 세션" tab) to the selected Tokyo month.
  const from = `${ym}-01`;
  const to = lastDayOfYm(ym);
  let items: ReviewQueueItem[] = [];
  try {
    items = await getAttendanceReviewQueue(
      session.organization.id,
      { limit: 5000, from, to },
      localeTag,
    );
  } catch (error) {
    console.warn("[admin-attendance] queue fetch failed", error);
  }
  return { isPrivileged: true, monthLabel, items };
}
