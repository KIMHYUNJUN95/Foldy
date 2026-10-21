"use server";

// Attendance — admin correction-review actions (Step 7).
//
// Privileged review of correction requests: claim (in_review), approve (with AUTHORITATIVE application
// to the session + audit), reject (required comment). Only `owner` / `attendance_payroll_admin` (or
// platform admins) may call these — enforced server-side via `attendanceCan`. User-submitted
// desired values are only proposals; on approval the admin confirms the FINAL values (defaulting to the
// proposals) and those are written to the session. The review-queue UI lives in the web dashboard
// (deferred); these actions are the backend it will call. Self-view (worker history / request status)
// reflects the new state on next load (dynamic routes; revalidated here too).
//
// Historical Step 7 boundary: later sections in this file now implement manual sessions, payroll,
// finalization, dashboard actions, and exports too.

import { revalidatePath } from "next/cache";
import {
  createNotification,
} from "@/lib/notifications/create";
import { getCurrentAppSession, hasOrganizationContext, type AppSession } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { attendanceCan } from "@/lib/attendance-review";
import { runPayrollExport, type PayrollExportResult } from "@/lib/attendance-export";
import {
  getFinalizationEligibility,
  getCurrentFinalizedSnapshot,
  monthFirstDay,
  type FinalizationBlockers,
} from "@/lib/attendance-finalization";
import { getMonthlyPayView } from "@/lib/attendance-pay";
import {
  getTransportItems,
  getTransportReport,
  type TransportItemRow,
  type TransportReportRow,
  type TransportReportStatus,
} from "@/lib/transport-reimbursement";
import {
  ATTENDANCE_REVIEW_STATES,
  gapFillMinFrom,
  type AttendanceCorrectionRequestRow,
  type AttendanceMonthSnapshotRow,
  type AttendanceReviewState,
  type AttendanceSessionRow,
} from "@/lib/attendance";
import { getDictionary } from "@/lib/i18n";
import {
  localizeAttendanceSiteName,
  type AttendanceSiteDisplayRow,
} from "@/lib/attendance-site-display";
import {
  getAdminAttendancePayroll,
  getAdminAttendanceTransport,
  getAdminAttendanceWages,
  type AdminTransportRow,
  type AdminWageRow,
} from "@/lib/admin-attendance";
import { buildAdminExportMeta, type AdminExportMeta } from "@/lib/admin-export-meta";
import type { AdminReportExportResult, AdminWorkbookExportResult } from "@/lib/admin-export-result";
import { buildAdminTableReportHtml } from "@/lib/admin-table-report";
import {
  buildAdminTableWorkbookBase64,
  type AdminTableColumn,
  type AdminTableSheet,
} from "@/lib/admin-table-workbook";
import {
  buildPayrollWorkbookBase64,
  type PayrollWorkbookLabels,
  type PayrollWorkbookRow,
} from "@/lib/attendance-payroll-workbook";
import { buildPayrollReportHtml } from "@/lib/attendance-payroll-report";
import {
  buildUserPayrollReportHtml,
  buildUserPayrollWorkbookBase64,
  reconcileDailyPaysToTotal,
  summarizeCleaningRoomLabel,
  type UserPayrollExportData,
  type UserPayrollExportLabels,
  type UserPayrollExportRow,
} from "@/lib/attendance-user-payroll-export";
import {
  buildTransportWorkbookBase64,
  type TransportWorkbookItem,
  type TransportWorkbookLabels,
} from "@/lib/attendance-transport-workbook";
import {
  buildTransportReportHtml,
  type TransportReportItem,
  type TransportReportLabels,
} from "@/lib/attendance-transport-report";
import type { Database } from "@/types/database";
import { bestEffortWrite } from "@/lib/db-write-guard";
import { resolveClockOutAfterClockIn } from "@/lib/attendance-clock";
import { hasOverlappingSession } from "@/lib/attendance-overlap";

export type ReviewActionResult =
  | { ok: true }
  | {
      ok: false;
      /** `overlap` = 같은 사람의 다른 유효 세션과 근무 시간이 겹친다(이중 지급 방지). */
      reason: "forbidden" | "not_found" | "invalid" | "comment_required" | "overlap" | "error";
    };

/** Admin-confirmed final values on approval (default to the requester's proposals when omitted). */
export type ApproveCorrectionInput = {
  requestId: string;
  /** ISO instants; null/undefined → fall back to the request's desired value (then leave unchanged). */
  finalClockInAt?: string | null;
  finalClockOutAt?: string | null;
  finalClockInSiteId?: string | null;
  finalClockOutSiteId?: string | null;
  /** @deprecated Use finalClockInSiteId/finalClockOutSiteId when the caller can distinguish them. */
  finalSiteId?: string | null;
  comment?: string | null;
};

function revalidateSelfView() {
  revalidatePath("/mobile/attendance/history");
  revalidatePath("/mobile/attendance/correction/status");
  revalidatePath("/mobile/attendance");
}

async function getProfileName(
  service: ReturnType<typeof getSupabaseServiceClient>,
  userId: string,
): Promise<string | null> {
  const res = await service.from("profiles").select("name").eq("id", userId).maybeSingle();
  return ((res.data as { name: string } | null)?.name ?? null);
}

async function loadRequest(
  service: ReturnType<typeof getSupabaseServiceClient>,
  organizationId: string,
  requestId: string,
): Promise<AttendanceCorrectionRequestRow | null> {
  const res = await service
    .from("attendance_correction_requests")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", requestId)
    .maybeSingle();
  return (res.data as AttendanceCorrectionRequestRow | null) ?? null;
}

/** Move a `requested` correction to `in_review` (admin claims it). Request-only; no session change. */
export async function setCorrectionInReview(requestId: string): Promise<ReviewActionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  const organizationId = session.organization.id;
  const service = getSupabaseServiceClient();
  if (!(await attendanceCan(service, organizationId, session.user.id, "attendance.manage"))) {
    return { ok: false, reason: "forbidden" };
  }

  const request = await loadRequest(service, organizationId, requestId);
  if (!request) return { ok: false, reason: "not_found" };
  if (request.status !== "requested") return { ok: false, reason: "invalid" };

  const upd = await service
    .from("attendance_correction_requests")
    .update({ status: "in_review", reviewed_by_user_id: session.user.id })
    .eq("id", requestId)
    .eq("status", "requested");
  if (upd.error) return { ok: false, reason: "error" };

  revalidateSelfView();
  return { ok: true };
}

/**
 * Approve a correction request and APPLY the admin-confirmed final values to the linked session, with
 * an audit row. Session-less (exception) requests create the missing completed session from the approved
 * final clock/site values. Approve comment is optional.
 */
export async function approveCorrectionRequest(
  input: ApproveCorrectionInput,
): Promise<ReviewActionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  const organizationId = session.organization.id;
  const actorId = session.user.id;
  const service = getSupabaseServiceClient();
  if (!(await attendanceCan(service, organizationId, actorId, "attendance.manage"))) {
    return { ok: false, reason: "forbidden" };
  }

  const request = await loadRequest(service, organizationId, input.requestId);
  if (!request) return { ok: false, reason: "not_found" };
  if (request.status !== "requested" && request.status !== "in_review") {
    return { ok: false, reason: "invalid" };
  }
  if (
    request.status === "in_review" &&
    request.reviewed_by_user_id &&
    request.reviewed_by_user_id !== actorId
  ) {
    return { ok: false, reason: "invalid" };
  }

  if (request.status === "requested") {
    const claim = await service
      .from("attendance_correction_requests")
      .update({ status: "in_review", reviewed_by_user_id: actorId })
      .eq("id", request.id)
      .eq("organization_id", organizationId)
      .eq("status", "requested")
      .select("id")
      .maybeSingle();
    if (claim.error || !claim.data) return { ok: false, reason: "invalid" };
  }

  // Final authoritative values: admin override, else the requester's proposal.
  const finalInAt = input.finalClockInAt ?? request.desired_clock_in_at;
  const finalOutAt = input.finalClockOutAt ?? request.desired_clock_out_at;
  const finalClockInSiteId =
    input.finalClockInSiteId ?? input.finalSiteId ?? request.desired_clock_in_site_id;
  const finalClockOutSiteId =
    input.finalClockOutSiteId ?? input.finalSiteId ?? request.desired_clock_out_site_id;
  const nowIso = new Date().toISOString();
  let applySession: () => Promise<boolean> = async () => false;
  let auditApplied: () => Promise<void> = async () => {};

  if (request.session_id) {
    const siteIdsToValidate = Array.from(
      new Set(
        [finalClockInSiteId, finalClockOutSiteId].filter((siteId): siteId is string =>
          Boolean(siteId),
        ),
      ),
    );
    for (const siteId of siteIdsToValidate) {
      if (!(await isOrgSite(service, organizationId, siteId))) {
        return { ok: false, reason: "invalid" };
      }
    }

    const sRes = await service
      .from("attendance_sessions")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", request.session_id)
      .maybeSingle();
    const s = sRes.data as AttendanceSessionRow | null;
    if (!s) return { ok: false, reason: "not_found" };

    const update: Database["public"]["Tables"]["attendance_sessions"]["Update"] = { review_state: "approved_correction" };
    if (finalInAt != null) update.clock_in_at = finalInAt;
    if (finalOutAt != null) update.clock_out_at = finalOutAt;
    if (finalClockInSiteId != null) update.clock_in_site_id = finalClockInSiteId;
    if (finalClockOutSiteId != null) update.clock_out_site_id = finalClockOutSiteId;
    // A now-complete session that was still open becomes completed.
    const resultingOut = finalOutAt ?? s.clock_out_at;
    const resultingIn = finalInAt ?? s.clock_in_at;
    if (!validClockOrder(resultingIn, resultingOut)) {
      return { ok: false, reason: "invalid" };
    }
    // 출근 시각은 그 근무의 운영일 안이어야 한다 — 다른 날로 옮기면 급여 달 · 마감 확인이 옛 날짜 기준으로 남는다(2026-10-22 검토).
    if (resultingIn && tokyoDateKey(resultingIn) !== s.operating_date) {
      return { ok: false, reason: "invalid" };
    }
    if (await isFinalizedUserMonth(service, organizationId, s.user_id, ymdToYm(s.operating_date))) {
      return { ok: false, reason: "invalid" };
    }
    if (s.status !== "invalid" && resultingIn) {
      const overlap = await hasOverlappingSession(
        service,
        organizationId,
        s.user_id,
        { clockInAt: resultingIn, clockOutAt: resultingOut },
        s.id,
      );
      if (overlap === null) return { ok: false, reason: "error" };
      if (overlap) return { ok: false, reason: "overlap" };
    }
    // `abandoned`(퇴근 미기록 후 운영일 경과)도 여기서 닫힌다 — 관리자가 실제 퇴근 시각을 넣으면
    // completed 로 올라가고 급여에 포함된다. 이 전이를 빼면 방치 세션을 정리할 방법이 없다.
    if ((s.status === "open" || s.status === "abandoned") && resultingIn && resultingOut) {
      update.status = "completed";
      update.abandoned_at = null;
    }
    if (crossesTokyoMidnight(resultingIn, resultingOut)) update.review_state = "review_required";

    // 반영은 요청을 「승인」으로 확정한 뒤에 한다(아래). 0행이면 실패다 — 전에는 review_state 조건에 걸려
    // 세션이 그대로인데도 성공으로 보고, 요청만 「승인」이 됐다.
    applySession = async () => {
      const updRes = await service
        .from("attendance_sessions")
        .update(update)
        .eq("id", s.id)
        .eq("organization_id", organizationId)
        .in("review_state", ["normal", "review_required", "pending_correction", "approved_correction"])
        .select("id");
      return !updRes.error && (updRes.data ?? []).length > 0;
    };

    // Audit the authoritative change.
    const before = {
      clock_in_at: s.clock_in_at,
      clock_out_at: s.clock_out_at,
      clock_in_site_id: s.clock_in_site_id,
      clock_out_site_id: s.clock_out_site_id,
      status: s.status,
      review_state: s.review_state,
    };
    auditApplied = async () => {
      await bestEffortWrite(
        "attendance_session_audits: insert",
        service.from("attendance_session_audits").insert({
          organization_id: organizationId,
          session_id: s.id,
          actor_user_id: actorId,
          action_type: "correction_apply",
          reason: input.comment?.trim() ? input.comment.trim() : "Correction request approved",
          before_json: before,
          after_json: update,
        }),
      );
    };
  } else {
    if (!finalInAt || !finalOutAt || !finalClockInSiteId) {
      return { ok: false, reason: "invalid" };
    }
    if (!validClockOrder(finalInAt, finalOutAt)) {
      return { ok: false, reason: "invalid" };
    }
    const siteIdsToValidate = Array.from(
      new Set(
        [finalClockInSiteId, finalClockOutSiteId].filter((siteId): siteId is string =>
          Boolean(siteId),
        ),
      ),
    );
    for (const siteId of siteIdsToValidate) {
      if (!(await isOrgSite(service, organizationId, siteId))) {
        return { ok: false, reason: "invalid" };
      }
    }
    const operatingDate = tokyoDateKey(finalInAt);
    if (await isFinalizedUserMonth(service, organizationId, request.requested_by_user_id, ymdToYm(operatingDate))) {
      return { ok: false, reason: "invalid" };
    }
    const overlap = await hasOverlappingSession(service, organizationId, request.requested_by_user_id, {
      clockInAt: finalInAt,
      clockOutAt: finalOutAt,
    });
    if (overlap === null) return { ok: false, reason: "error" };
    if (overlap) return { ok: false, reason: "overlap" };
    const insertFields = {
      organization_id: organizationId,
      user_id: request.requested_by_user_id,
      operating_date: operatingDate,
      status: "completed",
      review_state: crossesTokyoMidnight(finalInAt, finalOutAt) ? "review_required" : "approved_correction",
      clock_in_at: finalInAt,
      clock_in_site_id: finalClockInSiteId,
      clock_in_method: "manual",
      clock_out_at: finalOutAt,
      clock_out_site_id: finalClockOutSiteId ?? finalClockInSiteId,
      clock_out_method: "manual",
      manual_created: true,
      manual_created_by_user_id: actorId,
      manual_created_reason: input.comment?.trim()
        ? input.comment.trim()
        : "Correction request approved",
    };
    let createdId: string | null = null;
    applySession = async () => {
      const ins = (await service
        .from("attendance_sessions")
        .insert(insertFields)
        .select("id")
        .single()) as { data: { id: string } | null; error: { message: string } | null };
      createdId = ins.data?.id ?? null;
      return !ins.error && Boolean(createdId);
    };
    auditApplied = async () => {
      if (!createdId) return;
      await bestEffortWrite(
        "attendance_session_audits: insert",
        service.from("attendance_session_audits").insert({
          organization_id: organizationId,
          session_id: createdId,
          actor_user_id: actorId,
          action_type: "manual_create",
          reason: input.comment?.trim()
            ? input.comment.trim()
            : "Session created from approved correction request",
          before_json: {},
          after_json: insertFields,
        }),
      );
    };
  }

  // 요청을 먼저 「승인」으로 확정한다(내가 잡은 in_review 일 때만 — 동시에 누른 두 번째 승인은 여기서 떨어진다).
  // 그다음 세션에 반영하고, 반영이 실패하면 요청을 in_review 로 되돌린다. 두 쓰기가 한 트랜잭션은 아니지만
  // 「세션은 그대로인데 요청만 승인」으로 끝나는 길은 없다.
  const upd = await service
    .from("attendance_correction_requests")
    .update({
      status: "approved",
      review_comment: input.comment?.trim() ? input.comment.trim() : null,
      reviewed_by_user_id: actorId,
      reviewed_at: nowIso,
    })
    .eq("id", request.id)
    .eq("organization_id", organizationId)
    .eq("status", "in_review")
    .eq("reviewed_by_user_id", actorId)
    .select("id")
    .maybeSingle();
  if (upd.error) return { ok: false, reason: "error" };
  if (!upd.data) return { ok: false, reason: "invalid" };

  if (!(await applySession())) {
    await bestEffortWrite(
      "attendance_correction_requests: rollback approval",
      service
        .from("attendance_correction_requests")
        .update({ status: "in_review", reviewed_at: null, review_comment: null })
        .eq("id", request.id)
        .eq("organization_id", organizationId)
        .eq("status", "approved")
        .eq("reviewed_by_user_id", actorId),
    );
    return { ok: false, reason: "invalid" };
  }
  await auditApplied();

  await createNotification(service, {
    organizationId,
    recipientUserId: request.requested_by_user_id,
    type: "attendance_activity",
    href: `/mobile/attendance/correction/status?id=${request.id}`,
    sourceType: "attendance",
    sourceId: request.id,
    dedupeKey: `attendance_correction_approved:${request.id}:${request.requested_by_user_id}`,
    payload: {
      event: "correction_approved",
      subjectUserId: request.requested_by_user_id,
      subjectName: await getProfileName(service, request.requested_by_user_id),
      correctionId: request.id,
      sessionId: request.session_id,
    },
  });

  revalidateSelfView();
  return { ok: true };
}

/**
 * Reject a correction request. A reject comment is REQUIRED. The session is left UNCHANGED (its values
 * and review state are preserved — a rejected proposal must not silently alter authoritative data); the
 * rejection itself is auditable on the request row (reviewer + time + comment).
 */
export async function rejectCorrectionRequest(
  requestId: string,
  comment: string,
): Promise<ReviewActionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  const organizationId = session.organization.id;
  const service = getSupabaseServiceClient();
  if (!(await attendanceCan(service, organizationId, session.user.id, "attendance.manage"))) {
    return { ok: false, reason: "forbidden" };
  }
  if (!comment.trim()) return { ok: false, reason: "comment_required" };

  const request = await loadRequest(service, organizationId, requestId);
  if (!request) return { ok: false, reason: "not_found" };
  if (request.status !== "requested" && request.status !== "in_review") {
    return { ok: false, reason: "invalid" };
  }
  if (
    request.status === "in_review" &&
    request.reviewed_by_user_id &&
    request.reviewed_by_user_id !== session.user.id
  ) {
    return { ok: false, reason: "invalid" };
  }

  const updateQuery = service
    .from("attendance_correction_requests")
    .update({
      status: "rejected",
      review_comment: comment.trim(),
      reviewed_by_user_id: session.user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("organization_id", organizationId);
  const upd =
    request.status === "requested"
      ? await updateQuery.eq("status", "requested").select("id").maybeSingle()
      : await updateQuery
          .eq("status", "in_review")
          .eq("reviewed_by_user_id", session.user.id)
          .select("id")
          .maybeSingle();
  if (upd.error) return { ok: false, reason: "error" };
  if (!upd.data) return { ok: false, reason: "invalid" };

  await createNotification(service, {
    organizationId,
    recipientUserId: request.requested_by_user_id,
    type: "attendance_activity",
    href: `/mobile/attendance/correction/status?id=${request.id}`,
    sourceType: "attendance",
    sourceId: request.id,
    dedupeKey: `attendance_correction_rejected:${request.id}:${request.requested_by_user_id}`,
    payload: {
      event: "correction_rejected",
      subjectUserId: request.requested_by_user_id,
      subjectName: await getProfileName(service, request.requested_by_user_id),
      correctionId: request.id,
      sessionId: request.session_id,
    },
  });

  revalidateSelfView();
  return { ok: true };
}

// ── Manual session management (Step 8) ───────────────────────────────────────
// Privileged manual attendance: create a session for a worker, authoritatively update one, or
// invalidate (never delete) a bad one. owner / attendance_payroll_admin only (server-enforced). Every
  // action requires an admin reason and writes an `attendance_session_audits` row. Manual sessions carry
  // manual_created flags and stay compatible with later payroll/finalization (clock-in/out + breaks).
  // These actions are consumed by the admin web dashboard. Site-master management stays owner-only
  // (unchanged).

export type ManualSessionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      reason:
        | "forbidden"
        | "invalid"
        | "reason_required"
        | "target_invalid"
        | "open_conflict"
        | "overlap"
        | "not_found"
        | "finalized_locked"
        | "error";
    };

export type SimpleManualResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "forbidden"
        | "invalid"
        | "reason_required"
        | "not_found"
        | "open_conflict"
        | "overlap"
        | "incomplete"
        | "finalized_locked"
        | "error";
    };

export type CreateManualSessionInput = {
  userId: string;
  operatingDate: string; // YYYY-MM-DD (Tokyo)
  clockInTime: string; // "HH:mm"
  clockOutTime: string | null; // "HH:mm" → completed; null → open
  clockInSiteId?: string | null; // optional registered work-site
  clockOutSiteId?: string | null;
  manualLocation?: string | null; // free-text work location (off-site / no registered site)
  reason: string;
};

export type UpdateManualSessionInput = {
  sessionId: string;
  reason: string;
  // Each field: omit (undefined) = leave unchanged; null = clear; value = set.
  clockInTime?: string | null;
  clockOutTime?: string | null;
  clockInSiteId?: string | null;
  clockOutSiteId?: string | null;
  reviewState?: AttendanceReviewState;
};

function isHhmm(v: string): boolean {
  return /^\d{2}:\d{2}$/.test(v);
}
function isYmd(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}
function tokyoInstant(baseDate: string, hhmm: string): string | null {
  const d = new Date(`${baseDate}T${hhmm}:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function tokyoDateKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
function ymdToYm(ymd: string): string {
  return ymd.slice(0, 7);
}
function validClockOrder(clockInAt: string | null, clockOutAt: string | null): boolean {
  if (!clockInAt || !clockOutAt) return true;
  return new Date(clockOutAt).getTime() > new Date(clockInAt).getTime();
}
function crossesTokyoMidnight(clockInAt: string | null, clockOutAt: string | null): boolean {
  if (!clockInAt || !clockOutAt) return false;
  return tokyoDateKey(clockInAt) !== tokyoDateKey(clockOutAt);
}
async function isFinalizedUserMonth(
  service: ReturnType<typeof getSupabaseServiceClient>,
  organizationId: string,
  userId: string,
  ym: string,
): Promise<boolean> {
  return (await getCurrentFinalizedSnapshot(service, organizationId, userId, ym)) != null;
}

async function isOrgSite(
  service: ReturnType<typeof getSupabaseServiceClient>,
  organizationId: string,
  siteId: string,
): Promise<boolean> {
  const res = await service
    .from("attendance_sites")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", siteId)
    .maybeSingle();
  return !!res.data;
}

/** Manually create an attendance session for a worker (privileged). */
export async function createManualAttendanceSession(
  input: CreateManualSessionInput,
): Promise<ManualSessionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  const organizationId = session.organization.id;
  const actorId = session.user.id;
  const service = getSupabaseServiceClient();
  if (!(await attendanceCan(service, organizationId, actorId, "attendance.manage"))) {
    return { ok: false, reason: "forbidden" };
  }

  if (!input.reason.trim()) return { ok: false, reason: "reason_required" };
  if (!isYmd(input.operatingDate) || !isHhmm(input.clockInTime)) return { ok: false, reason: "invalid" };
  if (input.clockOutTime && !isHhmm(input.clockOutTime)) return { ok: false, reason: "invalid" };

  // Target must be an active member of this org.
  const member = await service
    .from("memberships")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", input.userId)
    .eq("status", "active")
    .maybeSingle();
  if (!member.data) return { ok: false, reason: "target_invalid" };

  // Location: either a registered work-site or a free-text manual location; at least one is required.
  const manualLocation = input.manualLocation?.trim() ? input.manualLocation.trim() : null;
  if (input.clockInSiteId && !(await isOrgSite(service, organizationId, input.clockInSiteId))) {
    return { ok: false, reason: "invalid" };
  }
  if (input.clockOutSiteId && !(await isOrgSite(service, organizationId, input.clockOutSiteId))) {
    return { ok: false, reason: "invalid" };
  }
  if (!input.clockInSiteId && !manualLocation) {
    return { ok: false, reason: "invalid" };
  }

  if (await isFinalizedUserMonth(service, organizationId, input.userId, ymdToYm(input.operatingDate))) {
    return { ok: false, reason: "finalized_locked" };
  }

  const clockInAt = tokyoInstant(input.operatingDate, input.clockInTime);
  if (!clockInAt) return { ok: false, reason: "invalid" };
  const clockOutAt = input.clockOutTime
    ? resolveClockOutAfterClockIn(input.operatingDate, input.clockOutTime, clockInAt)
    : null;
  if (input.clockOutTime && !clockOutAt) return { ok: false, reason: "invalid" };
  if (!validClockOrder(clockInAt, clockOutAt)) return { ok: false, reason: "invalid" };
  const overlap = await hasOverlappingSession(service, organizationId, input.userId, {
    clockInAt,
    clockOutAt,
  });
  if (overlap === null) return { ok: false, reason: "error" };
  if (overlap) return { ok: false, reason: "overlap" };

  const status = clockOutAt ? "completed" : "open";
  // An open manual session would collide with the worker's existing open session (partial unique).
  if (status === "open") {
    const open = await service
      .from("attendance_sessions")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("user_id", input.userId)
      .eq("status", "open")
      .maybeSingle();
    if (open.data) return { ok: false, reason: "open_conflict" };
  }

  const insertFields = {
    organization_id: organizationId,
    user_id: input.userId,
    operating_date: input.operatingDate,
    status,
    review_state: crossesTokyoMidnight(clockInAt, clockOutAt) ? "review_required" : "normal",
    clock_in_at: clockInAt,
    clock_in_site_id: input.clockInSiteId ?? null,
    clock_in_method: "manual",
    clock_out_at: clockOutAt,
    clock_out_site_id: clockOutAt ? (input.clockOutSiteId ?? input.clockInSiteId ?? null) : null,
    clock_out_method: clockOutAt ? "manual" : null,
    manual_location: manualLocation,
    manual_created: true,
    manual_created_by_user_id: actorId,
    manual_created_reason: input.reason.trim(),
  };

  const ins = (await service
    .from("attendance_sessions")
    .insert(insertFields)
    .select("id")
    .single()) as { data: { id: string } | null; error: { message: string } | null };
  if (ins.error || !ins.data) return { ok: false, reason: "error" };
  const sessionId = ins.data.id;

  await bestEffortWrite(
    "attendance_session_audits: insert",
    service.from("attendance_session_audits").insert({
        organization_id: organizationId,
        session_id: sessionId,
        actor_user_id: actorId,
        action_type: "manual_create",
        reason: input.reason.trim(),
        before_json: {},
        after_json: insertFields,
      })
  );

  revalidateSelfView();
  return { ok: true, id: sessionId };
}

/** Authoritatively update an attendance session (privileged). Mandatory reason + audit. */
export async function updateAttendanceSessionAdmin(
  input: UpdateManualSessionInput,
): Promise<SimpleManualResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  const organizationId = session.organization.id;
  const actorId = session.user.id;
  const service = getSupabaseServiceClient();
  if (!(await attendanceCan(service, organizationId, actorId, "attendance.manage"))) {
    return { ok: false, reason: "forbidden" };
  }
  if (!input.reason.trim()) return { ok: false, reason: "reason_required" };

  const sRes = await service
    .from("attendance_sessions")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", input.sessionId)
    .maybeSingle();
  const s = sRes.data as AttendanceSessionRow | null;
  if (!s) return { ok: false, reason: "not_found" };
  if (await isFinalizedUserMonth(service, organizationId, s.user_id, ymdToYm(s.operating_date))) {
    return { ok: false, reason: "finalized_locked" };
  }

  const update: Database["public"]["Tables"]["attendance_sessions"]["Update"] = {};

  if (input.clockInTime !== undefined) {
    if (input.clockInTime === null) {
      // 출근 시각을 지우면 출근 없는 근무가 남는다 — 지울 거면 무효 처리(2026-10-22 검토).
      return { ok: false, reason: "invalid" };
    } else {
      if (!isHhmm(input.clockInTime)) return { ok: false, reason: "invalid" };
      const at = tokyoInstant(s.operating_date, input.clockInTime);
      if (!at) return { ok: false, reason: "invalid" };
      update.clock_in_at = at;
    }
  }
  if (input.clockOutTime !== undefined) {
    if (input.clockOutTime === null) {
      update.clock_out_at = null;
    } else {
      if (!isHhmm(input.clockOutTime)) return { ok: false, reason: "invalid" };
      const resultingIn =
        "clock_in_at" in update ? (update.clock_in_at as string | null) : s.clock_in_at;
      if (!resultingIn) return { ok: false, reason: "invalid" };
      const at = resolveClockOutAfterClockIn(s.operating_date, input.clockOutTime, resultingIn);
      if (!at) return { ok: false, reason: "invalid" };
      update.clock_out_at = at;
    }
  }
  if (input.clockInSiteId !== undefined) {
    if (input.clockInSiteId !== null && !(await isOrgSite(service, organizationId, input.clockInSiteId))) {
      return { ok: false, reason: "invalid" };
    }
    update.clock_in_site_id = input.clockInSiteId;
  }
  if (input.clockOutSiteId !== undefined) {
    if (input.clockOutSiteId !== null && !(await isOrgSite(service, organizationId, input.clockOutSiteId))) {
      return { ok: false, reason: "invalid" };
    }
    update.clock_out_site_id = input.clockOutSiteId;
  }
  if (input.reviewState !== undefined) {
    if (!ATTENDANCE_REVIEW_STATES.includes(input.reviewState)) return { ok: false, reason: "invalid" };
    update.review_state = input.reviewState;
  }

  if (Object.keys(update).length === 0) return { ok: false, reason: "invalid" };

  // Status coherence: a session with both ends becomes completed; clearing an end re-opens it. Only
  // recompute this when clock-in/out are actually part of THIS update — e.g. a review_state-only edit
  // (marking reviewed) must never flip status based on a pre-existing (possibly already-inconsistent)
  // clock_out_at, since re-opening a session can collide with the user's one-open-session-per-user
  // constraint for an unrelated, currently-open session.
  const clockInChanged = "clock_in_at" in update;
  const clockOutChanged = "clock_out_at" in update;
  if (s.status !== "invalid" && (clockInChanged || clockOutChanged)) {
    const resultingIn = clockInChanged ? (update.clock_in_at as string | null) : s.clock_in_at;
    const resultingOut = clockOutChanged ? (update.clock_out_at as string | null) : s.clock_out_at;
    if (!validClockOrder(resultingIn, resultingOut)) return { ok: false, reason: "invalid" };
    if (resultingIn) {
      const overlap = await hasOverlappingSession(
        service,
        organizationId,
        s.user_id,
        { clockInAt: resultingIn, clockOutAt: resultingOut },
        s.id,
      );
      if (overlap === null) return { ok: false, reason: "error" };
      if (overlap) return { ok: false, reason: "overlap" };
    }
    if (resultingIn && resultingOut) {
      update.status = "completed";
      // 방치(abandoned)였던 세션을 닫으면 방치 표시도 지운다 — 정정 승인 경로와 같다(2026-10-01).
      if (s.status === "abandoned") update.abandoned_at = null;
    } else if (s.status === "completed" && !resultingOut) update.status = "open";
    if (crossesTokyoMidnight(resultingIn, resultingOut)) update.review_state = "review_required";
  }

  const before = {
    clock_in_at: s.clock_in_at,
    clock_out_at: s.clock_out_at,
    clock_in_site_id: s.clock_in_site_id,
    clock_out_site_id: s.clock_out_site_id,
    status: s.status,
    review_state: s.review_state,
  };

  const updRes = await service
    .from("attendance_sessions")
    .update(update)
    .eq("id", s.id)
    .eq("organization_id", organizationId);
  if (updRes.error) return { ok: false, reason: "error" };

  await bestEffortWrite(
    "attendance_session_audits: insert",
    service.from("attendance_session_audits").insert({
        organization_id: organizationId,
        session_id: s.id,
        actor_user_id: actorId,
        action_type: "manual_update",
        reason: input.reason.trim(),
        before_json: before,
        after_json: update,
      })
  );

  revalidateSelfView();
  return { ok: true };
}

/** Invalidate a session instead of deleting it (privileged). Mandatory reason + audit. */
export async function invalidateAttendanceSession(
  sessionId: string,
  reason: string,
): Promise<SimpleManualResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  const organizationId = session.organization.id;
  const actorId = session.user.id;
  const service = getSupabaseServiceClient();
  if (!(await attendanceCan(service, organizationId, actorId, "attendance.manage"))) {
    return { ok: false, reason: "forbidden" };
  }
  if (!reason.trim()) return { ok: false, reason: "reason_required" };

  const sRes = await service
    .from("attendance_sessions")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", sessionId)
    .maybeSingle();
  const s = sRes.data as AttendanceSessionRow | null;
  if (!s) return { ok: false, reason: "not_found" };
  if (await isFinalizedUserMonth(service, organizationId, s.user_id, ymdToYm(s.operating_date))) {
    return { ok: false, reason: "finalized_locked" };
  }
  if (s.status === "invalid") return { ok: false, reason: "invalid" };

  const nowIso = new Date().toISOString();
  const before = { status: s.status, review_state: s.review_state };
  const after = {
    status: "invalid",
    invalidated_at: nowIso,
    invalidated_by_user_id: actorId,
    invalidated_reason: reason.trim(),
  };

  const updRes = await service
    .from("attendance_sessions")
    .update(after)
    .eq("id", s.id)
    .eq("organization_id", organizationId);
  if (updRes.error) return { ok: false, reason: "error" };

  await bestEffortWrite(
    "attendance_session_audits: insert",
    service.from("attendance_session_audits").insert({
        organization_id: organizationId,
        session_id: s.id,
        actor_user_id: actorId,
        action_type: "invalidate",
        reason: reason.trim(),
        before_json: before,
        after_json: after,
      })
  );

  revalidateSelfView();
  return { ok: true };
}

/**
 * Restore a previously invalidated session (privileged) — the explicit, auditable reverse of
 * `invalidateAttendanceSession` for when an admin confirms the original clock-in/out was actually
 * legitimate. Restore always yields a `completed` session, so BOTH clock ends must already be present;
 * an invalid session still missing a clock-out must be fixed with `updateAttendanceSessionAdmin`
 * (수동 정정) first (else `incomplete`) — restore must never resurrect an incomplete/open session.
 * Mandatory reason + audit.
 */
export async function restoreAttendanceSession(
  sessionId: string,
  reason: string,
): Promise<SimpleManualResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  const organizationId = session.organization.id;
  const actorId = session.user.id;
  const service = getSupabaseServiceClient();
  if (!(await attendanceCan(service, organizationId, actorId, "attendance.manage"))) {
    return { ok: false, reason: "forbidden" };
  }
  if (!reason.trim()) return { ok: false, reason: "reason_required" };

  const sRes = await service
    .from("attendance_sessions")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", sessionId)
    .maybeSingle();
  const s = sRes.data as AttendanceSessionRow | null;
  if (!s) return { ok: false, reason: "not_found" };
  if (await isFinalizedUserMonth(service, organizationId, s.user_id, ymdToYm(s.operating_date))) {
    return { ok: false, reason: "finalized_locked" };
  }
  if (s.status !== "invalid") return { ok: false, reason: "invalid" };
  // A restore must produce a COMPLETE session. If a clock end is still missing, the admin has to
  // fill it via 수동 정정 (updateAttendanceSessionAdmin) first — otherwise "복구 및 완료" would
  // silently leave an incomplete session that never counts toward pay.
  if (!s.clock_in_at || !s.clock_out_at) return { ok: false, reason: "incomplete" };
  if (!validClockOrder(s.clock_in_at, s.clock_out_at)) return { ok: false, reason: "invalid" };
  // 무효 처리 뒤 같은 시간대에 대신 넣은 세션이 있으면 복구하면 두 번 지급된다.
  const overlap = await hasOverlappingSession(
    service,
    organizationId,
    s.user_id,
    { clockInAt: s.clock_in_at, clockOutAt: s.clock_out_at },
    s.id,
  );
  if (overlap === null) return { ok: false, reason: "error" };
  if (overlap) return { ok: false, reason: "overlap" };

  const before = {
    status: s.status,
    review_state: s.review_state,
    invalidated_reason: s.invalidated_reason,
  };
  const after = {
    status: "completed",
    review_state: crossesTokyoMidnight(s.clock_in_at, s.clock_out_at) ? "review_required" : "normal",
    invalidated_at: null,
    invalidated_by_user_id: null,
    invalidated_reason: null,
  };

  const updRes = await service
    .from("attendance_sessions")
    .update(after)
    .eq("id", s.id)
    .eq("organization_id", organizationId);
  if (updRes.error) return { ok: false, reason: "error" };

  await bestEffortWrite(
    "attendance_session_audits: insert",
    service.from("attendance_session_audits").insert({
        organization_id: organizationId,
        session_id: s.id,
        actor_user_id: actorId,
        action_type: "restore",
        reason: reason.trim(),
        before_json: before,
        after_json: after,
      })
  );

  revalidateSelfView();
  return { ok: true };
}

// ── Monthly finalization / reopen (Step 11) ──────────────────────────────────
// Per-person per-month, MANUAL, privileged (owner / attendance_payroll_admin). Finalize is blocked
// while unresolved items remain (review-required / pending corrections / open sessions / already
// finalized). The final gross comes from the same expected-pay helpers. Snapshots are HISTORY-preserving
// (never overwritten): reopen flips the finalized row to `reopened`; a later finalize supersedes prior
// rows and links via `supersedes_snapshot_id`. Finalize + reopen are audited in `audit_logs`. The
// admin finalize/reopen UI is in the deferred web dashboard — none is built here.

export type FinalizeResult =
  | { ok: true; id: string }
  | {
      ok: false;
      reason: "forbidden" | "invalid" | "target_invalid" | "blocked" | "not_hourly" | "error";
      blockers?: FinalizationBlockers;
    };

export type ReopenResult =
  | { ok: true }
  | { ok: false; reason: "forbidden" | "reason_required" | "not_finalized" | "invalid" | "error" };

function revalidatePay() {
  revalidatePath("/mobile/attendance/pay");
}

/** Finalize one user-month for an hourly worker (privileged). Blocked while unresolved items remain. */
export async function finalizeAttendanceMonth(input: {
  userId: string;
  ym: string;
}): Promise<FinalizeResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  const organizationId = session.organization.id;
  const actorId = session.user.id;
  const service = getSupabaseServiceClient();
  if (!(await attendanceCan(service, organizationId, actorId, "payroll.manage"))) {
    return { ok: false, reason: "forbidden" };
  }
  if (!/^\d{4}-\d{2}$/.test(input.ym)) return { ok: false, reason: "invalid" };

  // 비활성(퇴사)이어도 이 조직 멤버면 된다 — 마지막 달 급여를 닫아야 한다(2026-10-22 검토).
  const member = await service
    .from("memberships")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (!member.data) return { ok: false, reason: "target_invalid" };

  const pay = await getMonthlyPayView(organizationId, input.userId, input.ym);
  const elig = await getFinalizationEligibility(organizationId, input.userId, input.ym, pay.unpricedCount);
  if (!elig.eligible) return { ok: false, reason: "blocked", blockers: elig.blockers };
  if (!pay.hourlyEligible) return { ok: false, reason: "not_hourly" };

  const firstDay = monthFirstDay(input.ym);

  // History preservation: read prior rows first to capture the supersedes link,
  // then INSERT the new snapshot before marking old rows superseded.
  // This order ensures the "current finalized copy" is never lost: if the insert
  // fails, the old snapshot stays intact; the supersede only runs after a
  // successful insert.
  const priorRes = await service
    .from("attendance_month_snapshots")
    .select("id, status")
    .eq("organization_id", organizationId)
    .eq("user_id", input.userId)
    .eq("target_month", firstDay)
    .neq("status", "superseded")
    .order("created_at", { ascending: false });
  const priorRows = (priorRes.data ?? []) as { id: string; status: string }[];
  const supersedesId = priorRows[0]?.id ?? null;

  const nowIso = new Date().toISOString();
  const ins = (await service
    .from("attendance_month_snapshots")
    .insert({
      organization_id: organizationId,
      user_id: input.userId,
      target_month: firstDay,
      status: "finalized",
      total_paid_minutes: pay.totalPaidMinutes,
      gross_amount: pay.expectedGross,
      rate_breakdown: pay.rateSegments,
      allowance_breakdown: pay.allowances,
      finalized_by_user_id: actorId,
      finalized_at: nowIso,
      supersedes_snapshot_id: supersedesId,
    })
    .select("id")
    .single()) as { data: { id: string } | null; error: { code?: string; message: string } | null };
  // 두 사람이 동시에 마감하면 두 번째 insert 는 DB 유일 인덱스(사람 · 달마다 finalized 하나 —
  // `202610050001`)에 걸린다 → 「이미 마감됨」으로 돌려준다. 전에는 둘 다 들어간 뒤 서로를 superseded 로 바꿔
  // 마감본이 하나도 안 남을 수 있었다.
  if (ins.error?.code === "23505") {
    return {
      ok: false,
      reason: "blocked",
      blockers: { alreadyFinalized: true, openSessions: 0, pendingCorrections: 0, reviewRequired: 0, missingPayInfo: 0 },
    };
  }
  if (ins.error || !ins.data) return { ok: false, reason: "error" };

  // Supersede old rows only after a confirmed successful insert — **읽어 둔 이전 행만**. 「내 것 빼고 전부」로
  // 바꾸면 동시에 들어온 다른 마감본까지 지운다.
  if (priorRows.length > 0) {
    const sup = await service
      .from("attendance_month_snapshots")
      .update({ status: "superseded" })
      .eq("organization_id", organizationId)
      .eq("user_id", input.userId)
      .eq("target_month", firstDay)
      .in(
        "id",
        priorRows.map((row) => row.id),
      )
      .neq("status", "superseded");
    if (sup.error) console.error("[attendance] supersede prior snapshots failed", sup.error.message);
  }

  await bestEffortWrite(
    "audit_logs: insert",
    service.from("audit_logs").insert({
        organization_id: organizationId,
        actor_user_id: actorId,
        action: "attendance_month_finalize",
        target_type: "attendance_month_snapshot",
        target_id: ins.data.id,
        metadata: {
          user_id: input.userId,
          target_month: firstDay,
          gross_amount: pay.expectedGross,
          total_paid_minutes: pay.totalPaidMinutes,
          supersedes_snapshot_id: supersedesId,
        },
      })
  );

  revalidatePay();
  return { ok: true, id: ins.data.id };
}

/** Reopen a finalized user-month (privileged). Reason required; prior history preserved. */
export async function reopenAttendanceMonth(input: {
  userId: string;
  ym: string;
  reason: string;
}): Promise<ReopenResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  const organizationId = session.organization.id;
  const actorId = session.user.id;
  const service = getSupabaseServiceClient();
  if (!(await attendanceCan(service, organizationId, actorId, "payroll.manage"))) {
    return { ok: false, reason: "forbidden" };
  }
  if (!/^\d{4}-\d{2}$/.test(input.ym)) return { ok: false, reason: "invalid" };
  if (!input.reason.trim()) return { ok: false, reason: "reason_required" };

  const snap = await getCurrentFinalizedSnapshot(service, organizationId, input.userId, input.ym);
  if (!snap) return { ok: false, reason: "not_finalized" };

  // Flip the finalized row to `reopened` (kept as history; no `finalized` row remains → expected pay
  // resumes). A later finalize will supersede it.
  const updRes = await service
    .from("attendance_month_snapshots")
    .update({ status: "reopened" })
    .eq("id", (snap as AttendanceMonthSnapshotRow).id)
    .eq("organization_id", organizationId)
    .eq("user_id", input.userId)
    .eq("target_month", monthFirstDay(input.ym))
    .eq("status", "finalized")
    .select("id")
    .maybeSingle();
  if (updRes.error) return { ok: false, reason: "error" };
  if (!updRes.data) return { ok: false, reason: "not_finalized" };

  await bestEffortWrite(
    "audit_logs: insert",
    service.from("audit_logs").insert({
        organization_id: organizationId,
        actor_user_id: actorId,
        action: "attendance_month_reopen",
        target_type: "attendance_month_snapshot",
        target_id: (snap as AttendanceMonthSnapshotRow).id,
        metadata: {
          user_id: input.userId,
          target_month: monthFirstDay(input.ym),
          reason: input.reason.trim(),
        },
      })
  );

  revalidatePay();
  return { ok: true };
}

// ── Finalized-only payroll export (Step 13) ──────────────────────────────────
// Privileged (owner / attendance_payroll_admin) export of FINALIZED data only — monthly bulk or
// per-person. Privilege + finalized-only filtering + the `attendance_export_logs` audit row all live in
// `runPayrollExport`; these thin actions resolve the session and return the CSV for the caller (the
// deferred web dashboard) to download. The interim format is a structured CSV until the operator's final
// Excel template is provided. No admin export UI is built here.

export async function exportMonthlyPayroll(ym: string): Promise<PayrollExportResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  const service = getSupabaseServiceClient();
  return runPayrollExport(service, session.organization.id, session.user.id, {
    scope: "monthly_bulk",
    ym,
  });
}

export async function exportUserPayroll(userId: string, ym: string): Promise<PayrollExportResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  const service = getSupabaseServiceClient();
  return runPayrollExport(service, session.organization.id, session.user.id, {
    scope: "single_user",
    ym,
    userId,
  });
}

// ── Localized styled payroll workbook (Excel-compatible .xlsx) ────────────────
// Exports the month's per-user hours + expected pay + approved transport as a clean, styled workbook that Excel
// and LibreOffice open with formatting. Localized to the caller's UI language (ko/ja/en). Unlike the
// finalized-only CSV export, this reflects the LIVE monthly payroll view (all active members) so the
// operator can hand off a tax/accounting-ready monthly summary at a glance.

export type PayrollWorkbookResult =
  | { ok: true; filename: string; base64: string; rowCount: number }
  | { ok: false; reason: "forbidden" | "empty" | "error" };

type PayrollExportOptions = {
  hourlyOnly?: boolean;
};

function isHourlyPayrollExportRow(row: { employment: string; primaryRate: number }): boolean {
  return (row.employment === "hourly" || row.employment === "mixed") && row.primaryRate > 0;
}

export async function exportMonthlyPayrollWorkbook(
  ym: string,
  options: PayrollExportOptions = {},
): Promise<PayrollWorkbookResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  if (!/^\d{4}-\d{2}$/.test(ym)) return { ok: false, reason: "error" };

  const locale = session.user.preferredLanguage;
  const localeTag = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
  const data = await getAdminAttendancePayroll(session, ym, localeTag);
  if (!data.isPrivileged) return { ok: false, reason: "forbidden" };
  const exportRows = options.hourlyOnly ? data.rows.filter(isHourlyPayrollExportRow) : data.rows;
  if (exportRows.length === 0) return { ok: false, reason: "empty" };

  // 승인된 교통비는 급여 행에 이미 있다(`transportApproved`) — 교통비 화면 권한(`transport.manage`)이 없는 급여 담당도
  // 총액이 맞게 나가야 한다(2026-10-22: 키를 나눈 뒤 교통비 칸이 0 으로 나가던 것).
  const transportByUser: Record<string, number> = {};
  for (const r of exportRows) transportByUser[r.userId] = r.transportApproved;
  const wbRows: PayrollWorkbookRow[] = exportRows.map((r) => {
    const transportTotal = transportByUser[r.userId] ?? 0;
    return { ...r, transportTotal, totalWithTransport: r.expectedGross + transportTotal };
  });

  const c = getDictionary(locale).admin.attendanceConsole;
  const generatedAt = new Intl.DateTimeFormat(localeTag, {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

  const labels: PayrollWorkbookLabels = {
    title: c.payExportTitle,
    monthLabel: data.monthLabel,
    orgName: session.organization.name ?? "",
    generatedLabel: `${c.payExportGeneratedLabel} · ${generatedAt}`,
    statusEstimated: c.payStatusEstimated,
    statusFinalized: c.payStatusFinalized,
    colNo: c.payExportNo,
    colName: c.payColStaff,
    colRate: c.payColRate,
    colHours: c.payColRecognized,
    colWorkDays: c.payExportWorkDays,
    colBaseWage: c.payExportBaseWage,
    colAllowance: c.payExportAllowance,
    colSpecialAllowance: c.payExportSpecialAllowance,
    colTransport: c.payExportTransport,
    colTotalWithTransport: c.payExportTotalWithTransport,
    totalLabel: c.payExportTotal,
  };

  const base64 = await buildPayrollWorkbookBase64(wbRows, labels);
  return { ok: true, filename: `${c.payExportFileName}-${ym}.xlsx`, base64, rowCount: wbRows.length };
}

export type UserPayrollWorkbookResult =
  | { ok: true; filename: string; base64: string; rowCount: number }
  | { ok: false; reason: "forbidden" | "empty" | "error" };

export type UserPayrollReportResult =
  | { ok: true; html: string; rowCount: number }
  | { ok: false; reason: "forbidden" | "empty" | "error" };

function compactFilePart(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_") || "staff";
}

function userPayrollLabels(c: ReturnType<typeof getDictionary>["admin"]["attendanceConsole"]): UserPayrollExportLabels {
  return {
    title: c.userExportTitle,
    printLabel: c.payExportPrint,
    colDate: c.userExportColDate,
    colClockIn: c.userExportColClockIn,
    colClockOut: c.userExportColClockOut,
    colLocation: c.userExportColLocation,
    colWorkHours: c.userExportColWorkHours,
    colDailyPay: c.userExportColDailyPay,
    colAllowance: c.payExportAllowance,
    colSpecialAllowance: c.payExportSpecialAllowance,
    colTransport: c.payExportTransport,
    colCleaningRooms: c.userExportColCleaningRooms,
    colCleaningNotes: c.userExportColCleaningNotes,
    totalLabel: c.payExportTotal,
    totalWorkDays: c.payExportWorkDays,
    totalPayout: c.userExportTotalPayout,
  };
}

async function buildUserPayrollExportData(
  userId: string,
  ym: string,
): Promise<
  | { ok: true; data: UserPayrollExportData; labels: UserPayrollExportLabels; localeTag: string }
  | { ok: false; reason: "forbidden" | "empty" | "error" }
> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  if (!/^\d{4}-\d{2}$/.test(ym)) return { ok: false, reason: "error" };
  const service = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  const actorId = session.user.id;
  if (!(await attendanceCan(service, organizationId, actorId, "payroll.view"))) {
    return { ok: false, reason: "forbidden" };
  }

  const memberRes = await service
    .from("memberships")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!memberRes.data) return { ok: false, reason: "forbidden" };

  const locale = session.user.preferredLanguage;
  const localeTag = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
  const c = getDictionary(locale).admin.attendanceConsole;
  const [yy, mm] = ym.split("-").map(Number);
  const firstDay = `${ym}-01`;
  const lastDay = `${ym}-${String(new Date(Date.UTC(yy, mm, 0)).getUTCDate()).padStart(2, "0")}`;

  const profileRes = await service.from("profiles").select("name").eq("id", userId).maybeSingle();
  const userName = (profileRes.data as { name: string } | null)?.name ?? "—";

  const payView = await getMonthlyPayView(organizationId, userId, ym, locale).catch(() => null);
  if (!payView) return { ok: false, reason: "error" };

  const transportByDate = new Map<string, number>();
  const report = await getTransportReport(service, organizationId, userId, firstDay).catch(() => null);
  if (report?.status === "approved") {
    const items = await getTransportItems(service, report.id).catch(() => []);
    for (const item of items) {
      transportByDate.set(item.usageDate, (transportByDate.get(item.usageDate) ?? 0) + item.amountYen);
    }
  }

  const cleaningByDate = new Map<string, Set<string>>();
  const cleaningNotesByDate = new Map<string, Set<string>>();
  const cleanRes = await service
    .from("cleaning_sessions")
    .select("cleaning_date, room_label, notes, completed_at")
    .eq("organization_id", organizationId)
    .eq("staff_user_id", userId)
    .eq("closed_without_cleaning", false)
    .gte("cleaning_date", firstDay)
    .lte("cleaning_date", lastDay)
    .not("completed_at", "is", null)
    .order("cleaning_date", { ascending: true })
    .order("completed_at", { ascending: true });
  for (const row of (cleanRes.data ?? []) as {
    cleaning_date: string;
    room_label: string;
    notes: string | null;
    completed_at: string | null;
  }[]) {
    const room = summarizeCleaningRoomLabel(row.room_label);
    const list = cleaningByDate.get(row.cleaning_date) ?? new Set<string>();
    list.add(room);
    cleaningByDate.set(row.cleaning_date, list);

    const note = row.notes?.trim();
    if (note) {
      const notes = cleaningNotesByDate.get(row.cleaning_date) ?? new Set<string>();
      notes.add(`${room}: ${note}`);
      cleaningNotesByDate.set(row.cleaning_date, notes);
    }
  }

  // Work location per date: the free-text manual_location (off-site / manual entry) takes priority, else
  // the registered site name. Feeds the "근무 위치" export column.
  const locationByDate = new Map<string, string>();
  const locSessRes = await service
    .from("attendance_sessions")
    .select("operating_date, clock_in_site_id, manual_location")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .gte("operating_date", firstDay)
    .lte("operating_date", lastDay)
    .order("operating_date", { ascending: true })
    .order("clock_in_at", { ascending: true });
  const locRows = (locSessRes.data ?? []) as {
    operating_date: string;
    clock_in_site_id: string | null;
    manual_location: string | null;
  }[];
  const locSiteIds = Array.from(
    new Set(locRows.map((r) => r.clock_in_site_id).filter((v): v is string => Boolean(v))),
  );
  const siteNameById = new Map<string, string>();
  if (locSiteIds.length > 0) {
    const siteRes = await service.from("attendance_sites").select("id, name").in("id", locSiteIds);
    for (const s of (siteRes.data ?? []) as { id: string; name: string }[]) {
      siteNameById.set(s.id, s.name);
    }
  }
  for (const r of locRows) {
    const label = r.manual_location?.trim()
      ? r.manual_location.trim()
      : r.clock_in_site_id
        ? (siteNameById.get(r.clock_in_site_id) ?? "")
        : "";
    if (!label) continue;
    const existing = locationByDate.get(r.operating_date);
    if (!existing) locationByDate.set(r.operating_date, label);
    else if (!existing.split(" / ").includes(label)) {
      locationByDate.set(r.operating_date, `${existing} / ${label}`);
    }
  }

  const dateKeys = new Set<string>();
  for (const d of payView.days) dateKeys.add(d.date);
  for (const d of transportByDate.keys()) dateKeys.add(d);
  for (const d of cleaningByDate.keys()) dateKeys.add(d);
  for (const d of cleaningNotesByDate.keys()) dateKeys.add(d);

  const rowsBeforeReconciliation: UserPayrollExportRow[] = Array.from(dateKeys)
    .sort()
    .map((date) => {
      const day = payView.days.find((d) => d.date === date) ?? null;
      const clockIn = day?.sessions.map((s) => s.clockInLabel).filter(Boolean).join(" / ") || "";
      const clockOut = day?.sessions.map((s) => s.clockOutLabel).filter(Boolean).join(" / ") || "";
      return {
        date,
        clockIn,
        clockOut,
        location: locationByDate.get(date) ?? "",
        workMinutes: day?.paidMinutes ?? 0,
        dailyPay: Math.round(day?.grossExact ?? 0),
        allowanceRegular: Math.round(day?.allowanceRegularExact ?? 0),
        allowanceSpecial: Math.round(day?.allowanceSpecialExact ?? 0),
        transport: transportByDate.get(date) ?? 0,
        cleaningRooms: Array.from(cleaningByDate.get(date) ?? []).join(", "),
        cleaningNotes: Array.from(cleaningNotesByDate.get(date) ?? []).join(" / "),
      };
    });
  // Reconcile the daily BASE wage column to the month's base total (grand total − allowance) so the
  // base column sums exactly; allowance and transport stay in their own columns.
  const grandTotal = payView.finalization?.gross ?? payView.expectedGross;
  const baseTotal = grandTotal - payView.allowanceTotal;
  const rows = reconcileDailyPaysToTotal(rowsBeforeReconciliation, baseTotal);

  if (rows.length === 0) return { ok: false, reason: "empty" };

  const generatedAt = new Intl.DateTimeFormat(localeTag, {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

  return {
    ok: true,
    data: {
      userName,
      monthLabel: payView.monthLabel,
      orgName: session.organization.name ?? "",
      generatedLabel: `${c.payExportGeneratedLabel} · ${generatedAt}`,
      rows,
    },
    labels: userPayrollLabels(c),
    localeTag,
  };
}

export async function exportUserPayrollWorkbook(
  userId: string,
  ym: string,
): Promise<UserPayrollWorkbookResult> {
  const result = await buildUserPayrollExportData(userId, ym);
  if (!result.ok) return result;
  const base64 = await buildUserPayrollWorkbookBase64(result.data, result.labels);
  return {
    ok: true,
    filename: `${result.labels.title}-${compactFilePart(result.data.userName)}-${ym}.xlsx`,
    base64,
    rowCount: result.data.rows.length,
  };
}

export async function exportUserPayrollReport(
  userId: string,
  ym: string,
): Promise<UserPayrollReportResult> {
  const result = await buildUserPayrollExportData(userId, ym);
  if (!result.ok) return result;
  const html = buildUserPayrollReportHtml(result.data, result.labels, result.localeTag);
  return { ok: true, html, rowCount: result.data.rows.length };
}

// ── Print-quality payroll PDF report (localized HTML → browser print) ─────────
// Returns a self-contained styled HTML document the client opens in a new window; the document
// auto-triggers the print dialog so the operator can "Save as PDF" for tax/accounting hand-off.

export type PayrollReportResult =
  | { ok: true; html: string; rowCount: number }
  | { ok: false; reason: "forbidden" | "empty" | "error" };

export async function exportMonthlyPayrollReport(
  ym: string,
  options: PayrollExportOptions = {},
): Promise<PayrollReportResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  if (!/^\d{4}-\d{2}$/.test(ym)) return { ok: false, reason: "error" };

  const locale = session.user.preferredLanguage;
  const localeTag = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
  const data = await getAdminAttendancePayroll(session, ym, localeTag);
  if (!data.isPrivileged) return { ok: false, reason: "forbidden" };
  const exportRows = options.hourlyOnly ? data.rows.filter(isHourlyPayrollExportRow) : data.rows;
  if (exportRows.length === 0) return { ok: false, reason: "empty" };

  // 승인된 교통비 = 급여 행의 `transportApproved`(교통비 화면 권한과 무관 — 위 Excel 과 같은 근거).
  const transportByUser: Record<string, number> = {};
  for (const r of exportRows) transportByUser[r.userId] = r.transportApproved;

  const c = getDictionary(locale).admin.attendanceConsole;
  const generatedAt = new Intl.DateTimeFormat(localeTag, {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

  const html = buildPayrollReportHtml(
    exportRows,
    transportByUser,
    {
      title: c.payExportTitle,
      orgName: session.organization.name ?? "",
      monthLabel: data.monthLabel,
      generatedLabel: `${c.payExportGeneratedLabel} · ${generatedAt}`,
      printLabel: c.payExportPrint,
      colNo: c.payExportNo,
      colName: c.payColStaff,
      colEmployment: c.payColEmployment,
      colRate: c.payColRate,
      colHours: c.payColRecognized,
      colWorkDays: c.payExportWorkDays,
      colBaseWage: c.payExportBaseWage,
      colAllowance: c.payExportAllowance,
      colSpecialAllowance: c.payExportSpecialAllowance,
      colTransport: c.payExportTransport,
      colTotalWithTransport: c.payExportTotalWithTransport,
      totalLabel: c.payExportTotal,
      employment: {
        hourly: c.payEmploymentHourly,
        salaried: c.payEmploymentSalaried,
        mixed: c.payEmploymentMixed,
        none: c.payEmploymentNone,
      },
    },
    localeTag,
  );
  return { ok: true, html, rowCount: exportRows.length };
}

// ── Transport reimbursement — admin review (Slice 5) ─────────────────────────
// Privileged (owner / attendance_payroll_admin) status transitions on a transport report:
//   submitted/reviewing → approved | rejected | changes_requested
//   changes_requested → worker resubmission only
//   approved/rejected → reopen (→ 'submitted')
// `changes_requested` (migration 202607030001) sends the report back to the worker to fix & resubmit
// (a softer middle path than reject). `reopen` un-decides an approved/rejected report so it can be
// re-reviewed — reopening an APPROVED report drops it out of the payroll total until re-approved,
// which is the practical reason it exists. Uses the report's own `status` / `reviewed_*` / `review_note`
// columns.

const TRANSPORT_IMAGE_BUCKET = "request-images";

export type TransportReviewResult =
  | { ok: true; status: TransportReportStatus }
  | {
      ok: false;
      reason:
        | "forbidden"
        | "not_found"
        | "invalid"
        | "comment_required"
        | "finalized"
        | "error";
    };

export type TransportReviewAction =
  | "reviewing"
  | "approved"
  | "rejected"
  | "changes_requested"
  | "reopen";

// Each admin action → the report status it results in. `reopen` is the odd one out: it doesn't have
// its own status, it sends an already-decided (approved/rejected) report back to `submitted` so it
// re-enters the review queue (and, if it was approved, drops out of the payroll total until re-approved).
const TRANSPORT_ACTION_TARGET: Record<TransportReviewAction, TransportReportStatus> = {
  reviewing: "reviewing",
  approved: "approved",
  rejected: "rejected",
  changes_requested: "changes_requested",
  reopen: "submitted",
};

// Which source statuses each action may run from. A `changes_requested` report is with the worker and
// must be resubmitted before an admin can approve/reject/request another fix.
const TRANSPORT_ACTION_VALID_FROM: Record<TransportReviewAction, string[]> = {
  reviewing: ["submitted"],
  approved: ["submitted", "reviewing"],
  rejected: ["submitted", "reviewing"],
  changes_requested: ["submitted", "reviewing"],
  reopen: ["approved", "rejected"],
};

/** Move a transport report through its review lifecycle. */
export async function setTransportReportReview(input: {
  reportId: string;
  action: TransportReviewAction;
  note?: string | null;
}): Promise<TransportReviewResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  const organizationId = session.organization.id;
  const actorId = session.user.id;
  const service = getSupabaseServiceClient();
  if (!(await attendanceCan(service, organizationId, actorId, "transport.manage"))) {
    return { ok: false, reason: "forbidden" };
  }

  // Reject and "request changes" both send the report back to the worker, so a reason is mandatory —
  // the worker needs to know what to fix.
  if (
    (input.action === "rejected" || input.action === "changes_requested") &&
    !(input.note ?? "").trim()
  ) {
    return { ok: false, reason: "comment_required" };
  }

  const rRes = await service
    .from("transport_reimbursement_reports")
    .select("status, organization_id, user_id, target_month")
    .eq("id", input.reportId)
    .maybeSingle();
  const row = rRes.data as { status: string; organization_id: string; user_id: string; target_month: string } | null;
  if (!row || row.organization_id !== organizationId) return { ok: false, reason: "not_found" };

  if (!TRANSPORT_ACTION_VALID_FROM[input.action].includes(row.status)) {
    return { ok: false, reason: "invalid" };
  }
  // 승인(총액에 더함) · 다시 열기(승인을 빼냄)는 급여 총액을 바꾼다 — 그 달이 마감됐으면 마감 취소가 먼저(2026-10-22 검토).
  if (
    (input.action === "approved" || input.action === "reopen") &&
    (await isUserMonthFinalized(service, organizationId, row.user_id, row.target_month.slice(0, 10)))
  ) {
    return { ok: false, reason: "finalized" };
  }

  const targetStatus = TRANSPORT_ACTION_TARGET[input.action];
  const nowIso = new Date().toISOString();
  const update: Database["public"]["Tables"]["transport_reimbursement_reports"]["Update"] = { status: targetStatus };
  if (input.action === "reopen") {
    // Back in the queue: clear the prior decision so it reads as freshly pending.
    update.reviewed_by_user_id = null;
    update.reviewed_at = null;
    if (input.note != null) update.review_note = input.note.trim() || null;
  } else {
    update.reviewed_by_user_id = actorId;
    update.reviewed_at = nowIso;
    if (input.note != null) update.review_note = input.note.trim() || null;
  }

  const upd = await service
    .from("transport_reimbursement_reports")
    .update(update)
    .eq("id", input.reportId)
    .eq("organization_id", organizationId)
    .in("status", TRANSPORT_ACTION_VALID_FROM[input.action])
    .select("id")
    .maybeSingle();
  if (upd.error) return { ok: false, reason: "error" };
  if (!upd.data) return { ok: false, reason: "invalid" };

  revalidatePath("/mobile/attendance/transport");
  return { ok: true, status: targetStatus };
}

export type AdminTransportItemView = {
  id: string;
  usageDate: string;
  amountYen: number;
  entryMode: "linked" | "manual";
  attendanceSessionId: string | null;
  contextSummary: string;
  buildingLabel: string | null;
  imageCount: number;
  imageUrls: string[];
};

export type AdminTransportDetailResult =
  | {
      ok: true;
      report: TransportReportRow;
      items: AdminTransportItemView[];
      missingCount: number;
      linkedCount: number;
    }
  | { ok: false; reason: "forbidden" | "not_found" | "error" };

// ── Hourly wage management (Slice 7) ─────────────────────────────────────────
// Privileged (owner / attendance_payroll_admin) hourly-rate edits using the existing
// `hourly_rate_history` table (no schema change). Closes the current open period
// (effective_to=null) at `effective_from - 1 day` and inserts the new period.
// The change-reason note is preserved via `audit_logs.metadata`.

export type SetHourlyRateResult =
  | { ok: true; id: string }
  | {
      ok: false;
      reason:
        | "forbidden"
        | "invalid"
        | "rate_required"
        | "future_required"
        | "month_finalized"
        | "salaried_member"
        | "target_invalid"
        | "error";
    };

/**
 * 지난 날짜로 시급 · 고용형태를 넣는 요청 = **빈 날 채우기**만 허용(2026-10-21, 사용자 결정).
 *
 * 그 사람의 가장 이른 이력보다 **앞쪽 빈 구간**만 채운다 — 새 행은 [effectiveFrom, 가장 이른 이력 전날] 로 닫혀 들어가고
 * (이력이 아예 없으면 열린 행), 기존 행은 하나도 건드리지 않는다. 그래서 이미 계산되던 날의 금액은 바뀌지 않고 0원이던
 * 근무만 계산된다. 지난달 1일보다 이른 날(`gapFillMinFrom`), 이미 값이 있는 날, 마감된 달에 걸리는 날은 거절한다.
 */
async function planPastGapFill(
  service: ReturnType<typeof getSupabaseServiceClient>,
  table: "hourly_rate_history" | "employment_type_history",
  organizationId: string,
  userId: string,
  effectiveFrom: string,
  todayTokyo: string,
): Promise<{ ok: true; effectiveTo: string | null } | { ok: false; reason: "future_required" | "month_finalized" | "error" }> {
  if (effectiveFrom < gapFillMinFrom(todayTokyo)) return { ok: false, reason: "future_required" };
  const earliestRes = await service
    .from(table)
    .select("effective_from")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .order("effective_from", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (earliestRes.error) return { ok: false, reason: "error" };
  const earliest = (earliestRes.data as { effective_from: string } | null)?.effective_from ?? null;
  // 그날 이미 값이 있다 — 지난 금액을 바꾸는 소급이라 막는다.
  if (earliest && earliest <= effectiveFrom) return { ok: false, reason: "future_required" };
  const effectiveTo = earliest
    ? new Date(new Date(`${earliest}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10)
    : null;

  // 채우는 구간(오늘 전까지)에 마감된 달이 있으면 거절 — 스냅샷과 이력이 어긋난다.
  const lastFilled = effectiveTo && effectiveTo < todayTokyo ? effectiveTo : todayTokyo;
  const finalizedRes = await service
    .from("attendance_month_snapshots")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "finalized")
    .gte("target_month", `${effectiveFrom.slice(0, 7)}-01`)
    .lte("target_month", `${lastFilled.slice(0, 7)}-01`)
    .limit(1);
  if (finalizedRes.error) return { ok: false, reason: "error" };
  if ((finalizedRes.data ?? []).length > 0) return { ok: false, reason: "month_finalized" };
  return { ok: true, effectiveTo };
}

export async function setHourlyRate(input: {
  userId: string;
  hourlyRate: number;
  effectiveFrom: string; // YYYY-MM-DD
  note?: string | null;
}): Promise<SetHourlyRateResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  const organizationId = session.organization.id;
  const actorId = session.user.id;
  const service = getSupabaseServiceClient();
  if (!(await attendanceCan(service, organizationId, actorId, "wages.manage"))) {
    return { ok: false, reason: "forbidden" };
  }

  if (!Number.isFinite(input.hourlyRate) || input.hourlyRate <= 0) {
    return { ok: false, reason: "rate_required" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) {
    return { ok: false, reason: "invalid" };
  }
  // Disallow retroactive changes: effective_from must be today or later (Tokyo). Past dates would
  // reinterpret a day that's already happened; today itself is fine since the day isn't over yet.
  // 예외: 아직 시급이 없는 앞쪽 빈 날 채우기(`planPastGapFill`, 2026-10-21).
  const todayTokyo = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  let gapFill: { effectiveTo: string | null } | null = null;
  if (input.effectiveFrom < todayTokyo) {
    const plan = await planPastGapFill(
      service,
      "hourly_rate_history",
      organizationId,
      input.userId,
      input.effectiveFrom,
      todayTokyo,
    );
    if (!plan.ok) return { ok: false, reason: plan.reason };
    gapFill = { effectiveTo: plan.effectiveTo };
  }

  // Target must be an active member of this org.
  const member = await service
    .from("memberships")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", input.userId)
    .eq("status", "active")
    .maybeSingle();
  if (!member.data) return { ok: false, reason: "target_invalid" };

  // Current employment type — block on salaried.
  const emp = await service
    .from("employment_type_history")
    .select("employment_type, effective_from, effective_to")
    .eq("organization_id", organizationId)
    .eq("user_id", input.userId)
    .lte("effective_from", todayTokyo)
    .or(`effective_to.is.null,effective_to.gte.${todayTokyo}`)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  const empType = (emp.data as { employment_type: string } | null)?.employment_type ?? null;
  if (empType === "salaried") return { ok: false, reason: "salaried_member" };

  // Compute close date = effective_from - 1 day
  const fromDate = new Date(`${input.effectiveFrom}T00:00:00Z`);
  const closeDate = new Date(fromDate.getTime() - 86400000);
  const closeIso = closeDate.toISOString().slice(0, 10);

  // The existing open period (effective_to = null) is either:
  // - already active (its effective_from is before the new change) → close it the day
  //   before the new period starts, as before, or
  // - a still-future scheduled change being revised before it ever took effect → its
  //   effective_from would be >= the new effective_from, which would make closeIso fall
  //   BEFORE that row's own effective_from and violate the `effective_to >= effective_from`
  //   check constraint. In that case the pending row is superseded outright (deleted)
  //   rather than "closed" with an invalid date.
  const openRes = await service
    .from("hourly_rate_history")
    .select("id, effective_from")
    .eq("organization_id", organizationId)
    .eq("user_id", input.userId)
    .is("effective_to", null);
  if (openRes.error) return { ok: false, reason: "error" };
  // 빈 날 채우기는 기존 행을 닫거나 지우지 않는다 — 앞쪽 빈 구간에 닫힌 행 하나만 넣는다.
  const openRows = gapFill ? [] : ((openRes.data ?? []) as { id: string; effective_from: string }[]);

  const pendingIds = openRows
    .filter((r) => r.effective_from >= input.effectiveFrom)
    .map((r) => r.id);
  const activeIds = openRows
    .filter((r) => r.effective_from < input.effectiveFrom)
    .map((r) => r.id);

  if (pendingIds.length > 0) {
    const delRes = await service
      .from("hourly_rate_history")
      .delete()
      .in("id", pendingIds);
    if (delRes.error) return { ok: false, reason: "error" };
  }
  if (activeIds.length > 0) {
    const closeRes = await service
      .from("hourly_rate_history")
      .update({ effective_to: closeIso })
      .in("id", activeIds);
    if (closeRes.error) return { ok: false, reason: "error" };
  }

  const ins = (await service
    .from("hourly_rate_history")
    .insert({
      organization_id: organizationId,
      user_id: input.userId,
      hourly_rate: input.hourlyRate,
      effective_from: input.effectiveFrom,
      effective_to: gapFill?.effectiveTo ?? null,
      created_by_user_id: actorId,
    })
    .select("id")
    .single()) as { data: { id: string } | null; error: { message: string } | null };
  if (ins.error || !ins.data) return { ok: false, reason: "error" };

  await bestEffortWrite(
    "audit_logs: insert",
    service.from("audit_logs").insert({
        organization_id: organizationId,
        actor_user_id: actorId,
        action: "hourly_rate_set",
        target_type: "hourly_rate_history",
        target_id: ins.data.id,
        metadata: {
          user_id: input.userId,
          hourly_rate: input.hourlyRate,
          effective_from: input.effectiveFrom,
          note: input.note?.trim() ? input.note.trim() : null,
        },
      })
  );

  revalidatePath("/mobile/attendance/pay");
  return { ok: true, id: ins.data.id };
}

// ── Employment-type management (시급 ↔ 정규직) ────────────────────────────────
// Privileged (owner / attendance_payroll_admin) employment-type changes using the existing
// `employment_type_history` table (no schema change), mirroring setHourlyRate's interval logic:
// closes the current open period at effective_from-1 (or deletes a still-future pending row) and
// inserts the new open period. No retroactive dates. Hourly rate history is left untouched — pay
// branches on the active employment type, so an existing rate simply stops applying once salaried,
// and resumes if switched back to hourly (the admin sets/updates the rate separately).

export type SetEmploymentTypeResult =
  | { ok: true; id: string }
  | {
      ok: false;
      reason:
        | "forbidden"
        | "invalid"
        | "future_required"
        | "month_finalized"
        | "target_invalid"
        | "no_change"
        | "error";
    };

export async function setEmploymentType(input: {
  userId: string;
  employmentType: "hourly" | "salaried";
  effectiveFrom: string; // YYYY-MM-DD
  note?: string | null;
}): Promise<SetEmploymentTypeResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  const organizationId = session.organization.id;
  const actorId = session.user.id;
  const service = getSupabaseServiceClient();
  if (!(await attendanceCan(service, organizationId, actorId, "wages.manage"))) {
    return { ok: false, reason: "forbidden" };
  }

  if (input.employmentType !== "hourly" && input.employmentType !== "salaried") {
    return { ok: false, reason: "invalid" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) {
    return { ok: false, reason: "invalid" };
  }
  const todayTokyo = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  // 지난 날짜는 앞쪽 빈 날 채우기만(`planPastGapFill`, 2026-10-21).
  let gapFill: { effectiveTo: string | null } | null = null;
  if (input.effectiveFrom < todayTokyo) {
    const plan = await planPastGapFill(
      service,
      "employment_type_history",
      organizationId,
      input.userId,
      input.effectiveFrom,
      todayTokyo,
    );
    if (!plan.ok) return { ok: false, reason: plan.reason };
    gapFill = { effectiveTo: plan.effectiveTo };
  }

  const member = await service
    .from("memberships")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", input.userId)
    .eq("status", "active")
    .maybeSingle();
  if (!member.data) return { ok: false, reason: "target_invalid" };

  // Current active type — block a redundant same-type change (null = never set, so any type is a change).
  // 빈 날 채우기는 오늘 유형과 같아도 된다(10/5 부터 시급제인 사람의 10/1~10/4 를 시급제로 채우는 경우).
  const cur = await service
    .from("employment_type_history")
    .select("employment_type")
    .eq("organization_id", organizationId)
    .eq("user_id", input.userId)
    .lte("effective_from", todayTokyo)
    .or(`effective_to.is.null,effective_to.gte.${todayTokyo}`)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  const curType = (cur.data as { employment_type: string } | null)?.employment_type ?? null;
  if (!gapFill && curType === input.employmentType) return { ok: false, reason: "no_change" };

  const fromDate = new Date(`${input.effectiveFrom}T00:00:00Z`);
  const closeIso = new Date(fromDate.getTime() - 86400000).toISOString().slice(0, 10);

  const openRes = await service
    .from("employment_type_history")
    .select("id, effective_from")
    .eq("organization_id", organizationId)
    .eq("user_id", input.userId)
    .is("effective_to", null);
  if (openRes.error) return { ok: false, reason: "error" };
  const openRows = gapFill ? [] : ((openRes.data ?? []) as { id: string; effective_from: string }[]);
  const pendingIds = openRows.filter((r) => r.effective_from >= input.effectiveFrom).map((r) => r.id);
  const activeIds = openRows.filter((r) => r.effective_from < input.effectiveFrom).map((r) => r.id);

  if (pendingIds.length > 0) {
    const del = await service.from("employment_type_history").delete().in("id", pendingIds);
    if (del.error) return { ok: false, reason: "error" };
  }
  if (activeIds.length > 0) {
    const close = await service
      .from("employment_type_history")
      .update({ effective_to: closeIso })
      .in("id", activeIds);
    if (close.error) return { ok: false, reason: "error" };
  }

  const ins = (await service
    .from("employment_type_history")
    .insert({
      organization_id: organizationId,
      user_id: input.userId,
      employment_type: input.employmentType,
      effective_from: input.effectiveFrom,
      effective_to: gapFill?.effectiveTo ?? null,
      created_by_user_id: actorId,
    })
    .select("id")
    .single()) as { data: { id: string } | null; error: { message: string } | null };
  if (ins.error || !ins.data) return { ok: false, reason: "error" };

  await bestEffortWrite(
    "audit_logs: insert",
    service.from("audit_logs").insert({
        organization_id: organizationId,
        actor_user_id: actorId,
        action: "employment_type_set",
        target_type: "employment_type_history",
        target_id: ins.data.id,
        metadata: {
          user_id: input.userId,
          employment_type: input.employmentType,
          effective_from: input.effectiveFrom,
          note: input.note?.trim() ? input.note.trim() : null,
        },
      })
  );

  revalidatePath("/mobile/attendance/pay");
  revalidatePath("/admin/attendance/wages");
  return { ok: true, id: ins.data.id };
}

// ── Attendance allowance (추가수당) management ──────────────────────────────────
// Privileged (owner / attendance_payroll_admin) create/cancel of busy-day / short-staffed-day extra pay
// applied to a specific Tokyo operating date. Base rates in hourly_rate_history are never touched.
// Create/cancel is blocked for a user-month that already has a finalized snapshot (reopen first). All
// writes go through this service-role action; there is no direct client/RLS write path.

const ALLOWANCE_TYPES = ["daily_fixed", "hourly_extra"] as const;
const ALLOWANCE_CATEGORIES = ["regular", "special"] as const;

export type AllowanceMutationResult =
  | { ok: true; id: string }
  | {
      ok: false;
      reason: "error" | "forbidden" | "invalid" | "amount_required" | "target_invalid" | "finalized";
    };

/** True when that user-month has a finalized snapshot. */
async function isUserMonthFinalized(
  service: ReturnType<typeof getSupabaseServiceClient>,
  organizationId: string,
  userId: string,
  monthFirstDayStr: string,
): Promise<boolean> {
  const r = await service
    .from("attendance_month_snapshots")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("target_month", monthFirstDayStr)
    .eq("status", "finalized")
    .maybeSingle();
  return Boolean(r.data);
}

/** True when ANY user in the org has a finalized snapshot for that month (org-wide allowance guard). */
async function anyUserMonthFinalized(
  service: ReturnType<typeof getSupabaseServiceClient>,
  organizationId: string,
  monthFirstDayStr: string,
): Promise<boolean> {
  const r = await service
    .from("attendance_month_snapshots")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("target_month", monthFirstDayStr)
    .eq("status", "finalized")
    .limit(1)
    .maybeSingle();
  return Boolean(r.data);
}

export async function createAttendanceAllowance(input: {
  targetDate: string; // YYYY-MM-DD (Tokyo operating date)
  targetUserId: string | null; // null = all hourly workers with paid work that date
  allowanceType: "daily_fixed" | "hourly_extra";
  amountYen: number;
  category: string; // 'regular' (추가수당) | 'special' (특별수당)
  memo?: string | null;
}): Promise<AllowanceMutationResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  const organizationId = session.organization.id;
  const actorId = session.user.id;
  const service = getSupabaseServiceClient();
  if (!(await attendanceCan(service, organizationId, actorId, "payroll.manage"))) {
    return { ok: false, reason: "forbidden" };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.targetDate)) return { ok: false, reason: "invalid" };
  if (!ALLOWANCE_TYPES.includes(input.allowanceType)) return { ok: false, reason: "invalid" };
  if (!ALLOWANCE_CATEGORIES.includes(input.category as (typeof ALLOWANCE_CATEGORIES)[number])) {
    return { ok: false, reason: "invalid" };
  }
  if (!Number.isFinite(input.amountYen) || input.amountYen <= 0) {
    return { ok: false, reason: "amount_required" };
  }
  const amountYen = Math.round(input.amountYen);

  // A specific target must be a member of this org — 비활성(퇴사)도 마지막 달 수당은 줄 수 있다(2026-10-22).
  if (input.targetUserId) {
    const member = await service
      .from("memberships")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("user_id", input.targetUserId)
      .maybeSingle();
    if (!member.data) return { ok: false, reason: "target_invalid" };
  }

  // Block changes to an already-finalized user-month (reopen first). For an org-wide allowance, any
  // finalized snapshot for that month blocks it (it would retroactively change a closed month).
  const monthFirstDayStr = monthFirstDay(input.targetDate.slice(0, 7));
  const finalized = input.targetUserId
    ? await isUserMonthFinalized(service, organizationId, input.targetUserId, monthFirstDayStr)
    : await anyUserMonthFinalized(service, organizationId, monthFirstDayStr);
  if (finalized) return { ok: false, reason: "finalized" };

  const ins = (await service
    .from("attendance_pay_allowances")
    .insert({
      organization_id: organizationId,
      target_date: input.targetDate,
      target_user_id: input.targetUserId,
      allowance_type: input.allowanceType,
      amount_yen: amountYen,
      category: input.category,
      memo: input.memo?.trim() ? input.memo.trim() : null,
      status: "active",
      created_by_user_id: actorId,
    })
    .select("id")
    .single()) as { data: { id: string } | null; error: { message: string } | null };
  if (ins.error || !ins.data) return { ok: false, reason: "error" };

  await bestEffortWrite(
    "audit_logs: insert",
    service.from("audit_logs").insert({
        organization_id: organizationId,
        actor_user_id: actorId,
        action: "attendance_allowance_created",
        target_type: "attendance_pay_allowances",
        target_id: ins.data.id,
        metadata: {
          target_date: input.targetDate,
          target_user_id: input.targetUserId,
          allowance_type: input.allowanceType,
          amount_yen: amountYen,
          category: input.category,
        },
      })
  );

  revalidatePath("/admin/attendance/wages");
  revalidatePath("/admin/attendance/payroll");
  revalidatePath("/mobile/attendance/pay");
  return { ok: true, id: ins.data.id };
}

export async function cancelAttendanceAllowance(input: {
  id: string;
  reason?: string | null;
}): Promise<AllowanceMutationResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  const organizationId = session.organization.id;
  const actorId = session.user.id;
  const service = getSupabaseServiceClient();
  if (!(await attendanceCan(service, organizationId, actorId, "payroll.manage"))) {
    return { ok: false, reason: "forbidden" };
  }

  const rowRes = await service
    .from("attendance_pay_allowances")
    .select("id, target_date, target_user_id, status")
    .eq("organization_id", organizationId)
    .eq("id", input.id)
    .maybeSingle();
  const row = rowRes.data as {
    id: string;
    target_date: string;
    target_user_id: string | null;
    status: string;
  } | null;
  if (!row) return { ok: false, reason: "target_invalid" };
  if (row.status !== "active") return { ok: false, reason: "invalid" };

  const monthFirstDayStr = monthFirstDay(row.target_date.slice(0, 7));
  const finalized = row.target_user_id
    ? await isUserMonthFinalized(service, organizationId, row.target_user_id, monthFirstDayStr)
    : await anyUserMonthFinalized(service, organizationId, monthFirstDayStr);
  if (finalized) return { ok: false, reason: "finalized" };

  const upd = await service
    .from("attendance_pay_allowances")
    .update({
      status: "cancelled",
      cancelled_by_user_id: actorId,
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("id", input.id)
    .eq("status", "active");
  if (upd.error) return { ok: false, reason: "error" };

  await bestEffortWrite(
    "audit_logs: insert",
    service.from("audit_logs").insert({
        organization_id: organizationId,
        actor_user_id: actorId,
        action: "attendance_allowance_cancelled",
        target_type: "attendance_pay_allowances",
        target_id: input.id,
        metadata: {
          target_date: row.target_date,
          target_user_id: row.target_user_id,
          reason: input.reason?.trim() ? input.reason.trim() : null,
        },
      })
  );

  revalidatePath("/admin/attendance/wages");
  revalidatePath("/admin/attendance/payroll");
  revalidatePath("/mobile/attendance/pay");
  return { ok: true, id: input.id };
}

/** Load full report + items + signed image urls for the admin transport panel. */
export async function loadAdminTransportDetail(
  userId: string,
  ym: string,
): Promise<AdminTransportDetailResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  const organizationId = session.organization.id;
  const service = getSupabaseServiceClient();
  if (!(await attendanceCan(service, organizationId, session.user.id, "transport.manage"))) {
    return { ok: false, reason: "forbidden" };
  }

  const targetMonthDate = `${ym}-01`;
  const report = await getTransportReport(service, organizationId, userId, targetMonthDate);
  if (!report) return { ok: false, reason: "not_found" };
  const items = await getTransportItems(service, report.id);

  const allPaths = items.flatMap((it) => it.images.map((img) => img.storagePath));
  const urlByPath = new Map<string, string>();
  if (allPaths.length > 0) {
    const signed = await service.storage
      .from(TRANSPORT_IMAGE_BUCKET)
      .createSignedUrls(allPaths, 600);
    for (const r of signed.data ?? []) {
      if (r.path && r.signedUrl) urlByPath.set(r.path, r.signedUrl);
    }
  }

  const views: AdminTransportItemView[] = items.map((it: TransportItemRow) => {
    const wc = it.workContext ?? {};
    const ctx = wc.contextSummary ?? wc.taskLabel ?? wc.roomLabel ?? "—";
    return {
      id: it.id,
      usageDate: it.usageDate,
      amountYen: it.amountYen,
      entryMode: it.entryMode,
      attendanceSessionId: it.attendanceSessionId,
      contextSummary: ctx,
      buildingLabel: wc.buildingLabel ?? null,
      imageCount: it.imageCount,
      imageUrls: it.images
        .map((img) => urlByPath.get(img.storagePath))
        .filter((u): u is string => typeof u === "string"),
    };
  });

  const missingCount = items.filter((it) => it.imageCount === 0).length;
  const linkedCount = items.filter((it) => it.entryMode === "linked").length;

  return { ok: true, report, items: views, missingCount, linkedCount };
}

// ── Transport reimbursement — monthly export (Excel + PDF) ───────────────────
// Exports every reimbursement ITEM (not per-staff summary) for the month, across all staff with
// entered items, as a PLAIN accounting ledger (No / staff / date / usage / building / status / amount)
// — mirrors the payroll export pattern (localized Excel via exceljs + self-contained print-quality
// PDF/HTML). No receipt images or links live in the exported file: receipts are reviewed in the
// dedicated web receipt page (`/admin/attendance/transport/receipt`) reached from the transport panel.

type TransportExportItem = {
  userName: string;
  usageDate: string;
  buildingLabel: string;
  /** 「기타」는 건물이 아니라 사유가 유일한 근거다 — 대장에 함께 나가야 한다. */
  memo: string;
  statusLabel: string;
  amountYen: number;
};

function transportStatusLabel(
  status: TransportReportStatus | "none",
  c: ReturnType<typeof getDictionary>["admin"]["attendanceConsole"],
): string {
  switch (status) {
    case "draft":
      return c.trStatusDraft;
    case "submitted":
      return c.trStatusSubmitted;
    case "reviewing":
      return c.trStatusReviewing;
    case "approved":
      return c.trStatusApproved;
    case "rejected":
      return c.trStatusRejected;
    case "changes_requested":
      return c.trStatusChangesRequested;
    default:
      return c.trStatusNone;
  }
}

async function buildTransportExportItems(
  session: AppSession,
  ym: string,
  localeTag: string,
): Promise<
  | { ok: true; items: TransportExportItem[]; monthLabel: string }
  | { ok: false; reason: "forbidden" | "empty" | "error" }
> {
  const transport = await getAdminAttendanceTransport(session, ym, localeTag);
  if (!transport.isPrivileged) return { ok: false, reason: "forbidden" };

  const candidateRows = transport.rows.filter(
    (r): r is AdminTransportRow & { reportId: string } => Boolean(r.reportId) && r.itemCount > 0,
  );
  if (candidateRows.length === 0) return { ok: false, reason: "empty" };

  try {
    const service = getSupabaseServiceClient();
    const c = getDictionary(session.user.preferredLanguage).admin.attendanceConsole;

    const perRowItems = await Promise.all(
      candidateRows.map((r) => getTransportItems(service, r.reportId)),
    );

    const items: TransportExportItem[] = [];
    candidateRows.forEach((row, idx) => {
      for (const item of perRowItems[idx]) {
        const wc = item.workContext ?? {};
        items.push({
          userName: row.userName,
          usageDate: item.usageDate,
          buildingLabel: wc.buildingLabel ?? "",
          memo: item.memo ?? "",
          statusLabel: transportStatusLabel(row.status, c),
          amountYen: item.amountYen,
        });
      }
    });

    items.sort((a, b) =>
      a.userName !== b.userName
        ? a.userName.localeCompare(b.userName)
        : a.usageDate.localeCompare(b.usageDate),
    );

    return { ok: true, items, monthLabel: transport.monthLabel };
  } catch (error) {
    console.warn("[admin-attendance] transport export failed", error);
    return { ok: false, reason: "error" };
  }
}

function transportGeneratedLabel(localeTag: string, c: ReturnType<typeof getDictionary>["admin"]["attendanceConsole"]): string {
  const generatedAt = new Intl.DateTimeFormat(localeTag, {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  return `${c.payExportGeneratedLabel} · ${generatedAt}`;
}

export type TransportWorkbookResult =
  | { ok: true; filename: string; base64: string; rowCount: number }
  | { ok: false; reason: "forbidden" | "empty" | "error" };

export async function exportMonthlyTransportWorkbook(ym: string): Promise<TransportWorkbookResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  if (!/^\d{4}-\d{2}$/.test(ym)) return { ok: false, reason: "error" };

  const locale = session.user.preferredLanguage;
  const localeTag = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
  const result = await buildTransportExportItems(session, ym, localeTag);
  if (!result.ok) return result;

  const c = getDictionary(locale).admin.attendanceConsole;
  const labels: TransportWorkbookLabels = {
    title: c.trExportTitle,
    monthLabel: result.monthLabel,
    orgName: session.organization.name ?? "",
    generatedLabel: transportGeneratedLabel(localeTag, c),
    colNo: c.payExportNo,
    colStaff: c.payColStaff,
    colDate: c.trExportColDate,
    colBuilding: c.trExportColBuilding,
    colMemo: c.trExportColMemo,
    colStatus: c.trColStatus,
    colAmount: c.trExportColAmount,
    totalLabel: c.payExportTotal,
  };
  const wbItems: TransportWorkbookItem[] = result.items.map((it) => ({
    userName: it.userName,
    usageDate: it.usageDate,
    buildingLabel: it.buildingLabel,
    memo: it.memo,
    statusLabel: it.statusLabel,
    amountYen: it.amountYen,
  }));

  const base64 = await buildTransportWorkbookBase64(wbItems, labels);
  return {
    ok: true,
    filename: `${c.trExportFileName}-${ym}.xlsx`,
    base64,
    rowCount: result.items.length,
  };
}

export type TransportReportResult =
  | { ok: true; html: string; rowCount: number }
  | { ok: false; reason: "forbidden" | "empty" | "error" };

export async function exportMonthlyTransportReport(ym: string): Promise<TransportReportResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  if (!/^\d{4}-\d{2}$/.test(ym)) return { ok: false, reason: "error" };

  const locale = session.user.preferredLanguage;
  const localeTag = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
  const result = await buildTransportExportItems(session, ym, localeTag);
  if (!result.ok) return result;

  const c = getDictionary(locale).admin.attendanceConsole;
  const labels: TransportReportLabels = {
    title: c.trExportTitle,
    orgName: session.organization.name ?? "",
    monthLabel: result.monthLabel,
    generatedLabel: transportGeneratedLabel(localeTag, c),
    printLabel: c.payExportPrint,
    colNo: c.payExportNo,
    colStaff: c.payColStaff,
    colDate: c.trExportColDate,
    colBuilding: c.trExportColBuilding,
    colMemo: c.trExportColMemo,
    colStatus: c.trColStatus,
    colAmount: c.trExportColAmount,
    totalLabel: c.payExportTotal,
  };
  const reportItems: TransportReportItem[] = result.items.map((it) => ({
    userName: it.userName,
    usageDate: it.usageDate,
    buildingLabel: it.buildingLabel,
    memo: it.memo,
    statusLabel: it.statusLabel,
    amountYen: it.amountYen,
  }));

  const html = buildTransportReportHtml(reportItems, labels, localeTag);
  return { ok: true, html, rowCount: result.items.length };
}

// ── Session change history (audit trail viewer) ──────────────────────────────
// Read-only, privileged (owner / attendance_payroll_admin) view of the
// `attendance_session_audits` rows for one session — every manual edit / invalidate / restore /
// correction-apply, with actor + reason + a human-readable before→after diff. Localized server-side
// (ko/ja/en) so the client just renders. This surfaces the audit trail that was already being written
// but had no viewing UI. Loaded on-demand when the queue's session detail panel opens.

const TZ_AUDIT = "Asia/Tokyo";

export type SessionAuditChange = { label: string; from: string; to: string };
export type SessionAuditEntry = {
  id: string;
  actionLabel: string;
  actorName: string;
  reason: string;
  atLabel: string;
  changes: SessionAuditChange[];
};
export type SessionAuditResult =
  | { ok: true; entries: SessionAuditEntry[] }
  | { ok: false; reason: "forbidden" | "error" };

export async function loadSessionAuditTrail(sessionId: string): Promise<SessionAuditResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  const organizationId = session.organization.id;
  const service = getSupabaseServiceClient();
  if (!(await attendanceCan(service, organizationId, session.user.id, "attendance.manage"))) {
    return { ok: false, reason: "forbidden" };
  }

  const locale = session.user.preferredLanguage;
  const localeTag = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
  const c = getDictionary(locale).admin.attendanceConsole;

  const res = await service
    .from("attendance_session_audits")
    .select("id, action_type, reason, actor_user_id, before_json, after_json, created_at")
    .eq("organization_id", organizationId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false });
  if (res.error) return { ok: false, reason: "error" };
  type AuditRow = {
    id: string;
    action_type: string;
    reason: string;
    actor_user_id: string;
    before_json: Record<string, unknown> | null;
    after_json: Record<string, unknown> | null;
    created_at: string;
  };
  const rows = (res.data ?? []) as AuditRow[];
  if (rows.length === 0) return { ok: true, entries: [] };

  // Resolve actor names + site names referenced anywhere in the diffs.
  const actorIds = Array.from(new Set(rows.map((r) => r.actor_user_id)));
  const siteIds = new Set<string>();
  for (const r of rows) {
    for (const src of [r.before_json, r.after_json]) {
      if (!src) continue;
      for (const key of ["clock_in_site_id", "clock_out_site_id"]) {
        const v = src[key];
        if (typeof v === "string") siteIds.add(v);
      }
    }
  }

  const [profilesRes, sitesRes] = await Promise.all([
    service.from("profiles").select("id, name").in("id", actorIds),
    siteIds.size > 0
      ? service
          .from("attendance_sites")
          .select("id, name, properties(display_name_ko, display_name_ja, display_name_en)")
          .eq("organization_id", organizationId)
          .in("id", Array.from(siteIds))
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ]);

  const actorName = new Map<string, string>();
  for (const p of (profilesRes.data ?? []) as { id: string; name: string }[]) {
    actorName.set(p.id, p.name);
  }
  const siteName = new Map<string, string>();
  for (const s of (sitesRes.data ?? []) as (AttendanceSiteDisplayRow & { id: string })[]) {
    siteName.set(s.id, localizeAttendanceSiteName(s, localeTag));
  }

  const actionLabelOf = (t: string): string => {
    switch (t) {
      case "manual_create":
        return c.auditActionManualCreate;
      case "manual_update":
        return c.auditActionManualUpdate;
      case "invalidate":
        return c.auditActionInvalidate;
      case "restore":
        return c.auditActionRestore;
      case "correction_apply":
        return c.auditActionCorrectionApply;
      case "reopen":
        return c.auditActionReopen;
      case "finalize":
        return c.auditActionFinalize;
      default:
        return t;
    }
  };

  const timeLabel = (iso: unknown): string => {
    if (typeof iso !== "string" || !iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat(localeTag, {
      timeZone: TZ_AUDIT,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  };
  const statusLabel = (v: unknown): string => {
    switch (v) {
      case "open":
        return c.statusOpen;
      case "completed":
        return c.statusCompleted;
      case "invalid":
        return c.statusInvalid;
      case "abandoned":
        return c.statusAbandoned;
      case null:
      case undefined:
        return "—";
      default:
        return String(v);
    }
  };
  const reviewLabel = (v: unknown): string => {
    switch (v) {
      case "normal":
        return c.statusNormal;
      case "review_required":
        return c.statusReview;
      case "pending_correction":
        return c.statusPending;
      case "approved_correction":
        return c.auditReviewApproved;
      case "rejected_correction":
        return c.auditReviewRejected;
      case null:
      case undefined:
        return "—";
      default:
        return String(v);
    }
  };
  const siteLabel = (v: unknown): string =>
    typeof v === "string" ? (siteName.get(v) ?? "—") : "—";
  const clockOutLabel = (v: unknown): string =>
    v == null ? c.missingOut : timeLabel(v);

  type FieldSpec = { key: string; label: string; fmt: (v: unknown) => string };
  const FIELDS: FieldSpec[] = [
    { key: "clock_in_at", label: c.panelKvIn, fmt: timeLabel },
    { key: "clock_out_at", label: c.panelKvOut, fmt: clockOutLabel },
    { key: "clock_in_site_id", label: c.auditFieldClockInSite, fmt: siteLabel },
    { key: "clock_out_site_id", label: c.auditFieldClockOutSite, fmt: siteLabel },
    { key: "status", label: c.auditFieldStatus, fmt: statusLabel },
    { key: "review_state", label: c.auditFieldReviewState, fmt: reviewLabel },
  ];

  const entries: SessionAuditEntry[] = rows.map((r) => {
    const before = r.before_json ?? {};
    const after = r.after_json ?? {};
    const changes: SessionAuditChange[] = [];
    for (const f of FIELDS) {
      if (!(f.key in after)) continue;
      const from = f.key in before ? f.fmt(before[f.key]) : "—";
      const to = f.fmt(after[f.key]);
      if (from === to) continue;
      changes.push({ label: f.label, from, to });
    }
    return {
      id: r.id,
      actionLabel: actionLabelOf(r.action_type),
      actorName: actorName.get(r.actor_user_id) ?? "—",
      reason: r.reason,
      atLabel: new Intl.DateTimeFormat(localeTag, {
        timeZone: TZ_AUDIT,
        year: "2-digit",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(r.created_at)),
      changes,
    };
  });

  return { ok: true, entries };
}

// ── 수당(시급·고용형태) Excel / PDF 내보내기 ─────────────────────────────────
// Implemented 2026-07-14, replacing the disabled placeholder button in the wage side panel. Two
// sheets: a per-staff summary plus the full rate-change history (the placeholder was labelled
// "이력 내보내기", so the history is what it actually has to carry). Same 급여관리자 gate as the
// payroll export, and rendered through the canonical admin table exporters.

function wageEmploymentLabel(
  employment: AdminWageRow["employment"],
  c: ReturnType<typeof getDictionary>["admin"]["attendanceConsole"],
): string {
  if (employment === "hourly") return c.wageFilterHourly;
  if (employment === "salaried") return c.wageFilterSalaried;
  return "—";
}

function wageSheets(rows: AdminWageRow[], meta: AdminExportMeta): AdminTableSheet[] {
  const dictionary = getDictionary(meta.locale);
  const c = dictionary.admin.attendanceConsole;
  const yen = (n: number | null) =>
    n == null ? "" : `¥${new Intl.NumberFormat(meta.localeTag).format(n)}`;

  const summaryColumns: AdminTableColumn[] = [
    { key: "staff", label: c.wageColStaff, width: 18, printWidth: 22 },
    { key: "employment", label: c.wageColEmployment, width: 14, printWidth: 16 },
    { key: "rate", label: c.wageColCurrent, width: 14, printWidth: 16, bold: true },
    { key: "from", label: c.wageColFrom, width: 14, printWidth: 16 },
    { key: "tiers", label: c.wageColTiers, width: 10, printWidth: 12 },
  ];

  const historyColumns: AdminTableColumn[] = [
    { key: "staff", label: c.wageColStaff, width: 18, printWidth: 18 },
    { key: "rate", label: c.wageColCurrent, width: 14, printWidth: 14, bold: true },
    { key: "from", label: c.wageColFrom, width: 14, printWidth: 14 },
    { key: "to", label: c.wageColTo, width: 14, printWidth: 14 },
    { key: "note", label: c.wagePanelReasonLabel, width: 34, printWidth: 36, wrap: true },
  ];

  const historyRows = rows.flatMap((row) =>
    row.history.map((h) => ({
      staff: row.userName,
      rate: yen(h.rate),
      from: h.from,
      to: h.to ?? "—",
      note: h.note ?? "",
    })),
  );

  return [
    {
      sheetName: c.headerWages,
      title: c.headerWages,
      colNoLabel: meta.shared.colNo,
      totalLabel: meta.shared.exportTotalLabel,
      columns: summaryColumns,
      rows: rows.map((row) => ({
        staff: row.userName,
        employment: wageEmploymentLabel(row.employment, c),
        rate: yen(row.currentRate),
        from: row.currentFrom ?? "",
        tiers: String(row.history.length),
      })),
    },
    {
      sheetName: c.wagePanelHistoryTitle(historyRows.length),
      title: c.wagePanelHistoryTitle(historyRows.length),
      colNoLabel: meta.shared.colNo,
      totalLabel: meta.shared.exportTotalLabel,
      columns: historyColumns,
      rows: historyRows,
    },
  ];
}

export async function exportAttendanceWagesWorkbook(): Promise<AdminWorkbookExportResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };

  try {
    const data = await getAdminAttendanceWages(session);
    if (!data.isPrivileged) return { ok: false, reason: "forbidden" };
    if (data.rows.length === 0) return { ok: false, reason: "empty" };

    const meta = buildAdminExportMeta(session);
    const sheets = wageSheets(data.rows, meta);
    const base64 = await buildAdminTableWorkbookBase64({
      orgName: meta.orgName,
      generatedLabel: meta.generatedLabel,
      sheets,
    });
    return { ok: true, filename: "attendance-wages.xlsx", base64, rowCount: data.rows.length };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function exportAttendanceWagesReport(): Promise<AdminReportExportResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };

  try {
    const data = await getAdminAttendanceWages(session);
    if (!data.isPrivileged) return { ok: false, reason: "forbidden" };
    if (data.rows.length === 0) return { ok: false, reason: "empty" };

    const meta = buildAdminExportMeta(session);
    const html = buildAdminTableReportHtml({
      orgName: meta.orgName,
      generatedLabel: meta.generatedLabel,
      printLabel: meta.shared.exportPrint,
      localeTag: meta.localeTag,
      sheets: wageSheets(data.rows, meta),
    });
    return { ok: true, html, rowCount: data.rows.length };
  } catch {
    return { ok: false, reason: "error" };
  }
}
