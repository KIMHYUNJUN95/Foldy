import "server-only";

import type { AppSession } from "@/lib/session";
import {
  getAttendanceReviewQueue,
  isAttendancePayrollAdmin,
  type ReviewQueueItem,
} from "@/lib/attendance-review";
import { getMonthlyPayView } from "@/lib/attendance-pay";
import {
  getCurrentFinalizedSnapshot,
  getFinalizationEligibility,
  type FinalizationBlockers,
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
import type {
  AttendanceCorrectionReason,
  AttendanceCorrectionRequestRow,
  AttendanceCorrectionStatus,
  AttendanceSessionRow,
} from "@/lib/attendance";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { breakSecondsBySession, type BreakInterval } from "@/lib/attendance-pay-calculation";

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
    queueUrgent: reviewRows.filter((row) => row.status === "invalid" || !row.clock_out_at).length,
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
  let payrollKpi = EMPTY_PAYROLL_KPI;
  let transportKpi = EMPTY_TRANSPORT_KPI;
  // Scope the review queue to the selected month so the overview reflects that month's data.
  const monthFrom = `${ym}-01`;
  const monthTo = lastDayOfYm(ym);

  const [reviewResult, correctionsResult, payrollResult, transportResult] =
    await Promise.allSettled([
      getAttendanceReviewQueue(
        session.organization.id,
        {
          limit: 5000,
          from: monthFrom,
          to: monthTo,
        },
        localeTag,
      ),
      getAdminAttendanceCorrections(session, localeTag),
      getAdminAttendancePayroll(session, ym, localeTag),
      getAdminAttendanceTransport(session, ym, localeTag),
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
  if (payrollResult.status === "fulfilled") {
    payrollKpi = payrollResult.value.kpi;
  } else {
    console.warn("[admin-attendance] payroll overview failed", payrollResult.reason);
  }
  if (transportResult.status === "fulfilled") {
    transportKpi = transportResult.value.kpi;
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
      corrOpen: correctionOpenRows.length,
      payEstimated: payrollKpi.hourlyTarget,
      payTotal: payrollKpi.expectedTotal,
      payExcluded: payrollKpi.excludedTotal,
      trPending: transportKpi.pendingReview,
      trTotal: transportKpi.submittedTotal,
      trMissing: transportKpi.missingEvidence,
    },
    reviewSample: reviewRequiredRows.slice(0, 5),
    correctionSample: correctionOpenRows.slice(0, 5),
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

function pickPrimaryField(row: AttendanceCorrectionRequestRow): AdminCorrectionField {
  if (row.desired_clock_in_at != null) return "clock_in";
  if (row.desired_clock_out_at != null) return "clock_out";
  if (row.desired_clock_in_site_id != null || row.desired_clock_out_site_id != null) return "site";
  return "other";
}

export async function getAdminAttendanceCorrections(
  session: AppSession,
  localeTag: string,
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
    .limit(200);
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
 * Fans out the existing `getMonthlyPayView` + `getFinalizationEligibility` per
 * active org member, then aggregates KPI totals. Honest empty defaults when the
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

export async function getAdminAttendancePayroll(
  session: AppSession,
  ym: string,
  localeTag: string,
): Promise<AdminAttendancePayrollData> {
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
      kpi: EMPTY_PAYROLL_KPI,
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
      kpi: EMPTY_PAYROLL_KPI,
      rows: [],
    };
  }

  const membersRes = await service
    .from("memberships")
    .select("user_id, role, status")
    .eq("organization_id", session.organization.id);
  const membershipRows = (membersRes.data ?? []) as {
    user_id: string;
    role: string;
    status: string;
  }[];
  const firstDay = `${ym}-01`;
  const lastDay = lastDayOfYm(ym);
  const [sessionUsersRes, snapshotUsersRes] = await Promise.all([
    service
      .from("attendance_sessions")
      .select("user_id")
      .eq("organization_id", session.organization.id)
      .gte("operating_date", firstDay)
      .lte("operating_date", lastDay),
    service
      .from("attendance_month_snapshots")
      .select("user_id")
      .eq("organization_id", session.organization.id)
      .eq("target_month", firstDay),
  ]);
  const candidateUserIds = new Set<string>();
  for (const m of membershipRows) {
    if (m.status === "active") candidateUserIds.add(m.user_id);
  }
  const sessionUserIds = new Set<string>();
  for (const row of (sessionUsersRes.data ?? []) as { user_id: string }[]) {
    candidateUserIds.add(row.user_id);
    sessionUserIds.add(row.user_id);
  }
  for (const row of (snapshotUsersRes.data ?? []) as { user_id: string }[]) {
    candidateUserIds.add(row.user_id);
  }
  const members = Array.from(candidateUserIds).map((userId) => {
    const membership = membershipRows.find((m) => m.user_id === userId);
    return { user_id: userId, role: membership?.role ?? null };
  });
  if (members.length === 0) {
    return {
      isPrivileged: true,
      ym,
      monthLabel,
      prevYm,
      nextYm,
      kpi: EMPTY_PAYROLL_KPI,
      rows: [],
    };
  }

  const userIds = members.map((m) => m.user_id);
  const [profilesRes, transportRes] = await Promise.all([
    service.from("profiles").select("id, name").in("id", userIds),
    // Approved transport reimbursement total per user for the month — same source/filter the payroll
    // export uses (approved status, target_month = 'YYYY-MM-01', total_amount_cached), so the panel
    // summary cannot drift from the exported PDF/Excel totals.
    service
      .from("transport_reimbursement_reports")
      .select("user_id, total_amount_cached, status")
      .eq("organization_id", session.organization.id)
      .eq("target_month", firstDay)
      .eq("status", "approved"),
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

  const rows: AdminPayrollRow[] = await Promise.all(
    members.map(async (m) => {
      const [pay, elig, snapshot] = await Promise.all([
        getMonthlyPayView(session.organization.id, m.user_id, ym, localeTag).catch(() => null),
        getFinalizationEligibility(session.organization.id, m.user_id, ym).catch(() => null),
        getCurrentFinalizedSnapshot(service, session.organization.id, m.user_id, ym).catch(
          () => null,
        ),
      ]);

      const employment: AdminPayrollEmployment = !pay
        ? "none"
        : pay.salariedOnly
          ? "salaried"
          : pay.hourlyEligible
            ? pay.days.some((d) => d.employmentType === "salaried")
              ? "mixed"
              : "hourly"
            : "none";

      const primaryRate = pay && pay.rateSegments.length > 0 ? pay.rateSegments[0].rate : 0;
      const finalized = Boolean(snapshot);
      const finalizedAtLabel = pay?.finalization?.finalizedAtLabel ?? null;
      const effectivePaidMinutes = pay?.finalization?.paidMinutes ?? pay?.totalPaidMinutes ?? 0;
      const effectiveGross = pay?.finalization?.gross ?? pay?.expectedGross ?? 0;
      const workDays = pay ? pay.days.filter((d) => d.paidMinutes > 0).length : 0;

      return {
        userId: m.user_id,
        userName: nameById.get(m.user_id) ?? "—",
        role: m.role,
        employment,
        employmentMissing: employment === "none" && sessionUserIds.has(m.user_id),
        totalPaidMinutes: effectivePaidMinutes,
        recognizedLabel: fmtPaidMinutes(effectivePaidMinutes),
        workDays,
        primaryRate,
        expectedGross: effectiveGross,
        allowanceTotal: pay?.allowanceTotal ?? 0,
        allowanceRegularTotal: pay?.allowanceRegularTotal ?? 0,
        allowanceSpecialTotal: pay?.allowanceSpecialTotal ?? 0,
        baseGross: effectiveGross - (pay?.allowanceTotal ?? 0),
        transportApproved: transportByUser.get(m.user_id) ?? 0,
        excludedCount: pay?.excludedCount ?? 0,
        finalized,
        finalizedAtLabel,
        finalizationEligible: elig?.eligible ?? false,
        blockers: elig?.blockers ?? {
          reviewRequired: 0,
          pendingCorrections: 0,
          openSessions: 0,
          alreadyFinalized: finalized,
        },
      };
    }),
  );

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

  const kpi = {
    pendingReview: rows.filter((r) => r.status === "submitted" || r.status === "reviewing").length,
    submittedTotal: rows
      .filter((r) => r.status === "submitted" || r.status === "reviewing" || r.status === "approved")
      .reduce((s, r) => s + r.totalAmount, 0),
    approvedTotal: rows.filter((r) => r.status === "approved").length,
    missingEvidence: rows.reduce((s, r) => s + r.missingCount, 0),
  };

  return { isPrivileged: true, ym, monthLabel, prevYm, nextYm, kpi, rows };
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
  const service = getSupabaseServiceClient();
  const privileged = await isAttendancePayrollAdmin(
    service,
    session.organization.id,
    session.user.id,
  );
  if (!privileged) return baseEmpty;

  // Verify membership
  const memberRes = await service
    .from("memberships")
    .select("role")
    .eq("organization_id", session.organization.id)
    .eq("user_id", userId)
    .maybeSingle();
  const member = (memberRes.data as { role: string } | null) ?? null;
  if (!member) return { ...baseEmpty, isPrivileged: true };

  const profileRes = await service
    .from("profiles")
    .select("name")
    .eq("id", userId)
    .maybeSingle();
  const userName = (profileRes.data as { name: string } | null)?.name ?? "—";

  const firstDay = `${ym}-01`;
  const [y, m] = ym.split("-").map(Number);
  const lastDayNum = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lastDay = `${ym}-${String(lastDayNum).padStart(2, "0")}`;

  // Pay + finalized
  const [payView, finalized] = await Promise.all([
    getMonthlyPayView(session.organization.id, userId, ym, localeTag).catch(() => null),
    getCurrentFinalizedSnapshot(service, session.organization.id, userId, ym).catch(() => null),
  ]);

  // Sessions raw + sites (for the day ledger). NOTE: breaks live in `attendance_breaks`
  // (there is no `break_total_sec` column on the session) — totals are summed separately below.
  const sessRes = await service
    .from("attendance_sessions")
    .select(
      "id, operating_date, status, review_state, clock_in_at, clock_out_at, clock_in_site_id, clock_out_site_id",
    )
    .eq("organization_id", session.organization.id)
    .eq("user_id", userId)
    .gte("operating_date", firstDay)
    .lte("operating_date", lastDay)
    .order("operating_date", { ascending: false })
    .order("clock_in_at", { ascending: false });
  type SessRow = {
    id: string;
    operating_date: string;
    status: string;
    review_state: string;
    clock_in_at: string | null;
    clock_out_at: string | null;
    clock_in_site_id: string | null;
    clock_out_site_id: string | null;
  };
  const sessRows = (sessRes.data ?? []) as SessRow[];

  // Correction status per session
  const sessionIds = sessRows.map((r) => r.id);

  // 세션별 급여 차감 휴게 초 — 근무 시간 안으로 자르고, 닫힌 세션의 열린 휴게는 퇴근까지(`breakSecondsBySession`).
  let breakBySession = new Map<string, number>();
  if (sessionIds.length > 0) {
    const bRes = await service
      .from("attendance_breaks")
      .select("session_id, started_at, ended_at")
      .in("session_id", sessionIds);
    breakBySession = breakSecondsBySession((bRes.data ?? []) as BreakInterval[], sessRows);
  }
  const corrBySession = new Map<string, string>();
  if (sessionIds.length > 0) {
    const cRes = await service
      .from("attendance_correction_requests")
      .select("session_id, status, created_at")
      .eq("organization_id", session.organization.id)
      .in("session_id", sessionIds)
      .order("created_at", { ascending: false });
    for (const r of (cRes.data ?? []) as {
      session_id: string;
      status: string;
      created_at: string;
    }[]) {
      if (r.session_id && !corrBySession.has(r.session_id)) {
        corrBySession.set(r.session_id, r.status);
      }
    }
  }

  // Site names
  const siteIds = Array.from(
    new Set(
      sessRows
        .flatMap((r) => [r.clock_in_site_id, r.clock_out_site_id])
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const siteNameById = new Map<string, string>();
  if (siteIds.length > 0) {
    const sRes = await service
      .from("attendance_sites")
      .select(
        "id, name, properties(display_name_ko, display_name_ja, display_name_en)",
      )
      .eq("organization_id", session.organization.id)
      .in("id", siteIds);
    for (const row of (sRes.data ?? []) as (AttendanceSiteDisplayRow & { id: string })[]) {
      siteNameById.set(row.id, localizeAttendanceSiteName(row, localeTag));
    }
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
      r.review_state === "review_required" || (!r.clock_out_at && r.status !== "invalid");
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

  // Pay derived
  const employment: AdminPayrollEmployment = !payView
    ? "none"
    : payView.salariedOnly
      ? "salaried"
      : payView.hourlyEligible
        ? payView.days.some((d) => d.employmentType === "salaried")
          ? "mixed"
          : "hourly"
        : "none";
  const primaryRate = payView && payView.rateSegments.length > 0 ? payView.rateSegments[0].rate : 0;

  // Transport summary
  const targetMonthDate = `${ym}-01`;
  const trReport = await getTransportReport(
    service,
    session.organization.id,
    userId,
    targetMonthDate,
  ).catch(() => null);
  let trItemCount = 0;
  let trLinkedCount = 0;
  let trMissingCount = 0;
  let trTotal = 0;
  let trStatus: TransportReportStatus | "none" = "none";
  if (trReport) {
    trStatus = trReport.status;
    trTotal = trReport.totalAmountCached;
    const items = await getTransportItems(service, trReport.id).catch(() => []);
    trItemCount = items.length;
    trLinkedCount = items.filter((i) => i.entryMode === "linked").length;
    trMissingCount = items.filter((i) => i.imageCount === 0).length;
  }

  return {
    isPrivileged: true,
    ym,
    monthLabel,
    prevYm,
    nextYm,
    user: { id: userId, name: userName, role: member.role },
    pay: {
      employment,
      recognizedLabel: fmtPaidMinutes(payView?.finalization?.paidMinutes ?? payView?.totalPaidMinutes ?? 0),
      expectedGross: payView?.finalization?.gross ?? payView?.expectedGross ?? 0,
      excludedCount: payView?.excludedCount ?? 0,
      primaryRate,
      finalized: Boolean(finalized),
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
  if (session.organization.id === "platform") {
    return { isPrivileged: false, defaultEffectiveFrom, minEffectiveFrom, rows: [] };
  }
  const service = getSupabaseServiceClient();
  const privileged = await isAttendancePayrollAdmin(
    service,
    session.organization.id,
    session.user.id,
  );
  if (!privileged) {
    return { isPrivileged: false, defaultEffectiveFrom, minEffectiveFrom, rows: [] };
  }

  const membersRes = await service
    .from("memberships")
    .select("user_id, role")
    .eq("organization_id", session.organization.id)
    .eq("status", "active");
  const members = (membersRes.data ?? []) as { user_id: string; role: string }[];
  if (members.length === 0) {
    return { isPrivileged: true, defaultEffectiveFrom, minEffectiveFrom, rows: [] };
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

  return { isPrivileged: true, defaultEffectiveFrom, minEffectiveFrom, rows };
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
