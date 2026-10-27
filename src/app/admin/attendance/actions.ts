"use server";

// 출퇴근 — 관리자 정정 검토 액션 (Step 7).
//
// 정정 요청에 대한 권한 있는 검토: 담당(in_review), 승인(권위 있는 값을 세션에 적용 +
// 감사 기록), 반려(코멘트 필수). `owner` / `attendance_payroll_admin`(또는
// 플랫폼 관리자)만 호출할 수 있고 서버에서 `attendanceCan` 으로 강제한다. 사용자가 제출한
// 희망 값은 제안일 뿐이며, 승인할 때 관리자가 최종 값(기본값은
// 제안 값)을 확정해 세션에 기록한다. 검토 큐 UI 는 웹 대시보드에 있다
// (보류). 이 액션들은 그 UI 가 호출할 백엔드다. 본인 조회(근무자 이력 / 요청 상태)는
// 다음 로드 때 새 상태를 반영한다(동적 라우트이며 여기서도 revalidate 한다).
//
// 과거 Step 7 경계: 이 파일의 뒷부분 섹션은 이제 수동 세션, 급여,
// 마감, 대시보드 액션, 내보내기도 구현한다.

import { isPayrollMonthLocked } from "@/lib/payroll-approval-server";
import { revalidatePath } from "next/cache";
import { correctionMatchesFix } from "@/lib/attendance-correction-close";
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
  localizeStoredPlaceText,
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
import { canCloseMonth, isValidYm, resolveClockOutAfterClockIn } from "@/lib/attendance-clock";
import { tokyoToday } from "@/lib/tokyo-date";
import { hasOverlappingSession } from "@/lib/attendance-overlap";
import { isPlatformDeveloper } from "@/config/roles";

export type ReviewActionResult =
  | { ok: true }
  | {
      ok: false;
      /** `overlap` = 같은 사람의 다른 유효 세션과 근무 시간이 겹친다(이중 지급 방지). */
      /** `already_handled` = 그 사이 다른 관리자가 먼저 가져갔거나 직원이 취소했다(0행 갱신). */
      reason: "forbidden" | "not_found" | "invalid" | "comment_required" | "overlap" | "already_handled" | "error";
    };

/** 승인 시 관리자가 확정한 최종 값 (생략하면 요청자의 제안 값이 기본값). */
export type ApproveCorrectionInput = {
  requestId: string;
  /** ISO 시각. null/undefined → 요청의 희망 값으로 대체 (그것도 없으면 변경하지 않음). */
  finalClockInAt?: string | null;
  finalClockOutAt?: string | null;
  finalClockInSiteId?: string | null;
  finalClockOutSiteId?: string | null;
  /** @deprecated 호출자가 둘을 구분할 수 있으면 finalClockInSiteId/finalClockOutSiteId 를 쓴다. */
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

/**
 * 다른 검토자가 잡은 in_review 요청을 플랫폼 개발자가 넘겨받는다(2026-10-23). 잡은 사람이 그대로일 때만
 * 바꾸는 비교-교체라, 그 사이 상대가 먼저 승인 · 반려했으면 0행 → false.
 */
async function takeOverCorrectionReview(
  service: ReturnType<typeof getSupabaseServiceClient>,
  organizationId: string,
  requestId: string,
  heldBy: string,
  actorId: string,
): Promise<boolean> {
  const res = await service
    .from("attendance_correction_requests")
    .update({ reviewed_by_user_id: actorId })
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .eq("status", "in_review")
    .eq("reviewed_by_user_id", heldBy)
    .select("id")
    .maybeSingle();
  return !res.error && !!res.data;
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

/**
 * 정정 요청을 승인하고, 관리자가 확정한 최종 값을 연결된 세션에 적용한다. 감사
 * 행도 남긴다. 세션이 없는(예외) 요청은 승인된 최종 출퇴근/근무지 값으로
 * 빠져 있던 완료 세션을 만든다. 승인 코멘트는 선택.
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
    // 다른 검토자가 잡은 요청 — 플랫폼 개발자는 넘겨받아 처리한다(2026-10-23 「개발자는 전부 가능」).
    if (!isPlatformDeveloper(session.user.role)) return { ok: false, reason: "invalid" };
    if (!(await takeOverCorrectionReview(service, organizationId, request.id, request.reviewed_by_user_id, actorId))) {
      return { ok: false, reason: "invalid" };
    }
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

  // 최종 권위 값: 관리자 지정 값, 없으면 요청자의 제안 값.
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
    // 이제 완결된 세션이 아직 열려 있었다면 completed 로 바뀐다.
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

    // 권위 있는 변경을 감사 기록한다.
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
 * 정정 요청을 반려한다. 반려 코멘트는 필수다. 세션은 그대로 둔다 (값과
 * 검토 상태가 유지된다 — 반려된 제안이 권위 있는 데이터를 몰래 바꾸면 안 된다).
 * 반려 자체는 요청 행(검토자 + 시각 + 코멘트)에 감사 가능하게 남는다.
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
    // 다른 검토자가 잡은 요청 — 플랫폼 개발자는 넘겨받아 반려한다(2026-10-23).
    if (!isPlatformDeveloper(session.user.role)) return { ok: false, reason: "invalid" };
    if (
      !(await takeOverCorrectionReview(
        service,
        organizationId,
        request.id,
        request.reviewed_by_user_id,
        session.user.id,
      ))
    ) {
      return { ok: false, reason: "invalid" };
    }
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

// ── 수동 세션 관리 (Step 8) ───────────────────────────────────────
// 권한 있는 수동 출퇴근: 근무자의 세션을 만들고, 권위 있게 수정하고, 잘못된 것은
// 무효 처리한다(삭제하지 않는다). owner / attendance_payroll_admin 만 (서버에서 강제). 모든
  // 액션은 관리자 사유를 요구하고 `attendance_session_audits` 행을 남긴다. 수동 세션은
  // manual_created 플래그를 갖고, 이후 급여/마감(출퇴근 + 휴게)과 호환된다.
  // 이 액션들은 관리자 웹 대시보드가 쓴다. 근무지 마스터 관리는 owner 전용으로
  // 그대로 둔다.

export type ManualSessionResult =
  | { ok: true; id: string; correctionsClosed?: ClosedCorrections }
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
  /** `updatedAt` = 갱신 뒤 세션의 `updated_at`(직접 수정만 돌려준다) — 다음 수정의 동시성 기준. */
  | { ok: true; updatedAt?: string; correctionsClosed?: ClosedCorrections }
  | {
      ok: false;
      reason:
        | "stale"
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
  operatingDate: string; // YYYY-MM-DD (도쿄)
  clockInTime: string; // "HH:mm"
  clockOutTime: string | null; // "HH:mm" → 완료; null → 열림
  clockInSiteId?: string | null; // 선택: 등록된 근무지
  clockOutSiteId?: string | null;
  manualLocation?: string | null; // 자유 입력 근무 장소 (현장 외 / 등록 근무지 없음)
  reason: string;
};

export type UpdateManualSessionInput = {
  sessionId: string;
  reason: string;
  // 필드별: 생략(undefined) = 그대로 둠; null = 비움; 값 = 설정.
  clockInTime?: string | null;
  clockOutTime?: string | null;
  clockInSiteId?: string | null;
  clockOutSiteId?: string | null;
  reviewState?: AttendanceReviewState;
  /**
   * 화면이 본 세션의 `updated_at`(낙관적 동시성, 2026-10-26). 주면 그 사이 바뀐 세션은 `stale` 로 거절한다 —
   * 정정 승인 · 다른 관리자의 수정을 모르고 옛 값으로 덮어쓰지 않게.
   */
  expectedUpdatedAt?: string;
};

/** 수동 정정 · 수기 입력이 함께 처리한 대기 중 정정 요청 수(화면 안내용). */
export type ClosedCorrections = { approved: number; rejected: number };

/**
 * 관리자가 수동 정정 · 수기 입력으로 기록을 직접 고치면, 그 기록에 걸린 대기 중 정정 요청도 같이 닫는다(2026-10-27).
 * 전에는 기록은 고쳐졌는데 요청이 「정정 대기」로 남아 근태 마감을 막고, 직원은 답을 못 받았다.
 * - 직원이 바란 시각과 고친 결과가 같으면 「승인」, 다르면 「반려」 — 상태는 기존 승인 · 반려를 그대로 쓴다
 *   (새 상태를 만들지 않음). 어느 쪽이든 관리자가 적은 정정 사유가 검토 코멘트로 남아 직원에게 보인다.
 * - 세션은 이미 고쳐졌으니 요청의 희망 값을 다시 적용하지 않는다. 직원에게 승인 · 반려 알림을 보낸다.
 * - 다른 검토자가 잡은 요청(in_review)도 닫는다 — 기록을 바꾼 쪽이 결과의 주인이다. 대기 상태일 때만 바꾸는
 *   조건부 갱신이라 그 사이 처리된 요청은 건드리지 않는다.
 */
async function closePendingCorrectionsAfterManualFix(
  service: ReturnType<typeof getSupabaseServiceClient>,
  input: {
    organizationId: string;
    actorId: string;
    userId: string;
    /** 세션에 걸린 요청 — 없으면(수기 입력) 그 사람 · 그 날짜의 세션 없는 요청. */
    sessionId: string | null;
    operatingDate: string;
    clockInAt: string | null;
    clockOutAt: string | null;
    reason: string;
  },
): Promise<ClosedCorrections> {
  const closed: ClosedCorrections = { approved: 0, rejected: 0 };
  let query = service
    .from("attendance_correction_requests")
    .select("id, requested_by_user_id, desired_clock_in_at, desired_clock_out_at, session_id")
    .eq("organization_id", input.organizationId)
    .eq("requested_by_user_id", input.userId)
    .in("status", ["requested", "in_review"]);
  query = input.sessionId
    ? query.eq("session_id", input.sessionId)
    : query.is("session_id", null).eq("target_date", input.operatingDate);
  const res = await query;
  if (res.error) {
    console.warn("[attendance] pending corrections read failed:", res.error.message);
    return closed;
  }
  const rows = (res.data ?? []) as {
    id: string;
    requested_by_user_id: string;
    desired_clock_in_at: string | null;
    desired_clock_out_at: string | null;
    session_id: string | null;
  }[];
  if (rows.length === 0) return closed;
  const subjectName = await getProfileName(service, input.userId);
  const nowIso = new Date().toISOString();
  for (const row of rows) {
    const status = correctionMatchesFix(row, input.clockInAt, input.clockOutAt) ? "approved" : "rejected";
    const upd = await service
      .from("attendance_correction_requests")
      .update({ status, review_comment: input.reason, reviewed_by_user_id: input.actorId, reviewed_at: nowIso })
      .eq("id", row.id)
      .eq("organization_id", input.organizationId)
      .in("status", ["requested", "in_review"])
      .select("id")
      .maybeSingle();
    if (upd.error || !upd.data) continue;
    closed[status] += 1;
    await createNotification(service, {
      organizationId: input.organizationId,
      recipientUserId: row.requested_by_user_id,
      type: "attendance_activity",
      href: `/mobile/attendance/correction/status?id=${row.id}`,
      sourceType: "attendance",
      sourceId: row.id,
      dedupeKey: `attendance_correction_${status}:${row.id}:${row.requested_by_user_id}`,
      payload: {
        event: status === "approved" ? "correction_approved" : "correction_rejected",
        subjectUserId: row.requested_by_user_id,
        subjectName,
        correctionId: row.id,
        sessionId: row.session_id,
      },
    });
  }
  return closed;
}

/** 같은 시각인가 — timestamptz 문자열은 표기(자릿수 · 오프셋)가 달라도 같은 순간일 수 있다. */
function sameInstant(a: string, b: string): boolean {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return a === b || (Number.isFinite(ta) && ta === tb);
}

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

/** 근무자의 출퇴근 세션을 수동으로 만든다 (권한 필요). */
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

  // 대상은 이 조직의 활성 멤버여야 한다.
  const member = await service
    .from("memberships")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", input.userId)
    .eq("status", "active")
    .maybeSingle();
  if (!member.data) return { ok: false, reason: "target_invalid" };

  // 장소: 등록 근무지 또는 자유 입력 수동 장소 중 하나는 필수.
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
  // 열린 수동 세션은 근무자의 기존 열린 세션과 충돌한다 (부분 유니크).
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

  // 그 날짜에 세션 없이 들어온 정정 요청(출근 기록 없음 등)이 있으면 같이 닫는다.
  const correctionsClosed = await closePendingCorrectionsAfterManualFix(service, {
    organizationId,
    actorId,
    userId: input.userId,
    sessionId: null,
    operatingDate: input.operatingDate,
    clockInAt,
    clockOutAt,
    reason: input.reason.trim(),
  });

  revalidateSelfView();
  return { ok: true, id: sessionId, correctionsClosed };
}

/** 출퇴근 세션을 권위 있게 수정한다 (권한 필요). 사유 필수 + 감사 기록. */
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
  if (input.expectedUpdatedAt !== undefined && !sameInstant(input.expectedUpdatedAt, s.updated_at)) {
    return { ok: false, reason: "stale" };
  }
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

  // 상태 정합성: 양쪽 끝이 있는 세션은 completed 가 되고, 한쪽을 비우면 다시 열린다. 이
  // 재계산은 이번 수정에 출퇴근이 실제로 포함될 때만 한다 — 예: review_state 만 바꾸는 수정
  // (검토 표시)이 기존의 (이미 어긋났을 수도 있는)
  // clock_out_at 으로 status 를 뒤집으면 안 된다. 세션을 다시 열면 사용자당 열린 세션 1개
  // 제약과, 무관하게 현재 열려 있는 다른 세션이 충돌할 수 있기 때문이다.
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

  // 읽은 행 그대로일 때만 쓴다 — 읽고 쓰는 사이 정정 승인 등이 끼어들면 0행 → `stale`.
  const updRes = await service
    .from("attendance_sessions")
    .update(update)
    .eq("id", s.id)
    .eq("organization_id", organizationId)
    .eq("updated_at", s.updated_at)
    .select("updated_at");
  if (updRes.error) return { ok: false, reason: "error" };
  const updatedRow = (updRes.data ?? [])[0] as { updated_at: string } | undefined;
  if (!updatedRow) return { ok: false, reason: "stale" };

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

  // 출퇴근 시각을 고쳤으면 이 근무에 걸린 대기 중 정정 요청도 같이 닫는다 — 검토 표시만 바꾼 수정은 그대로.
  let correctionsClosed: ClosedCorrections | undefined;
  if (s.status !== "invalid" && (clockInChanged || clockOutChanged)) {
    correctionsClosed = await closePendingCorrectionsAfterManualFix(service, {
      organizationId,
      actorId,
      userId: s.user_id,
      sessionId: s.id,
      operatingDate: s.operating_date,
      clockInAt: clockInChanged ? (update.clock_in_at as string | null) : s.clock_in_at,
      clockOutAt: clockOutChanged ? (update.clock_out_at as string | null) : s.clock_out_at,
      reason: input.reason.trim(),
    });
  }

  revalidateSelfView();
  return { ok: true, updatedAt: updatedRow.updated_at, correctionsClosed };
}

/** 세션을 삭제하지 않고 무효 처리한다 (권한 필요). 사유 필수 + 감사 기록. */
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
 * 이전에 무효 처리한 세션을 복원한다 (권한 필요) — 원래 출퇴근이 실제로 정당했음을
 * 관리자가 확인했을 때 쓰는 `invalidateAttendanceSession` 의 명시적이고 감사 가능한 역방향.
 * 복원은 항상 `completed` 세션을 만들므로 출퇴근 양쪽이 이미 있어야 한다.
 * 퇴근이 비어 있는 무효 세션은 `updateAttendanceSessionAdmin` 으로 고쳐야
 * (수동 정정) first (else `incomplete`) — restore must never resurrect an incomplete/open session.
 * 사유 필수 + 감사 기록.
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
  // 복원하면 완결된 세션이 되어야 한다. 출퇴근 한쪽이 아직 없으면 관리자가
  // 수동 정정(updateAttendanceSessionAdmin)으로 먼저 채워야 한다 — 그러지 않으면 "복구 및 완료" 가
  // 급여에 절대 반영되지 않는 불완전한 세션이 조용히 남지 않게 한다.
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

// ── 월 마감 / 재개 (Step 11) ──────────────────────────────────
// 사람별 · 월별, 수동, 권한 필요 (owner / attendance_payroll_admin). 미해결 항목이 남아 있으면
// 마감할 수 없다 (검토 필요 / 대기 중 정정 / 열린 세션 / 이미
// 마감됨). 최종 총액은 같은 예상 급여 헬퍼에서 나온다. 스냅샷은 이력을 보존한다
// (덮어쓰지 않음): 재개하면 마감 행이 `reopened` 로 바뀌고, 이후 마감이 이전
// 행을 대체하며 `supersedes_snapshot_id` 로 연결된다. 마감 + 재개는 `audit_logs` 에 감사 기록된다.
// 관리자 마감/재개 UI 는 보류된 웹 대시보드에 있으며 여기서는 만들지 않는다.

export type FinalizeResult =
  | { ok: true; id: string }
  | {
      ok: false;
      reason: "forbidden" | "invalid" | "not_ended" | "target_invalid" | "blocked" | "not_hourly" | "error";
      blockers?: FinalizationBlockers;
    };

export type ReopenResult =
  | { ok: true }
  | { ok: false; reason: "forbidden" | "reason_required" | "not_finalized" | "payroll_locked" | "invalid" | "error" };

function revalidatePay() {
  revalidatePath("/mobile/attendance/pay");
}

/** 시급 근무자의 한 사용자-월을 마감한다 (권한 필요). 미해결 항목이 남아 있으면 막힌다. */
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
  if (!isValidYm(input.ym)) return { ok: false, reason: "invalid" };
  // 끝나지 않은 달(이번 달 · 미래)은 마감하지 않는다 — 마감 뒤 출근이 생기면 금액이 어긋난다(2026-10-26).
  // 개발 서버 테스트 스위치만 예외(운영에선 무시, 2026-10-27).
  if (!canCloseMonth(input.ym, tokyoToday())) return { ok: false, reason: "not_ended" };

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

  // 이력 보존: 대체 연결을 잡으려고 이전 행을 먼저 읽고,
  // 새 스냅샷을 INSERT 한 뒤에 옛 행을 대체됨으로 표시한다.
  // 이 순서면 "현재 마감본"이 사라지지 않는다. insert 가
  // 실패해도 옛 스냅샷은 그대로 남고, 대체 처리는 insert 가
  // 성공한 뒤에만 실행된다.
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

  // 확인된 insert 성공 뒤에만 옛 행을 대체 처리한다 — **읽어 둔 이전 행만**. 「내 것 빼고 전부」로
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

/** 마감된 사용자-월을 재개한다 (권한 필요). 사유 필수; 이전 이력은 보존된다. */
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
  if (!isValidYm(input.ym)) return { ok: false, reason: "invalid" };
  if (!input.reason.trim()) return { ok: false, reason: "reason_required" };
  // 알바 급여 P5 — 그 달 급여 결재가 시작됐으면 근태 마감을 풀 수 없다(먼저 돌려보내기 · 결재 되돌리기, 문서 40 §4-1).
  if (await isPayrollMonthLocked(service, organizationId, input.ym)) return { ok: false, reason: "payroll_locked" };

  const snap = await getCurrentFinalizedSnapshot(service, organizationId, input.userId, input.ym);
  if (!snap) return { ok: false, reason: "not_finalized" };

  // 마감 행을 `reopened` 로 바꾼다 (이력으로 남음; `finalized` 행이 없어지므로 예상 급여가
  // 다시 계산된다). 이후 마감이 이것을 대체한다.
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

// ── 마감분 전용 급여 내보내기 (Step 13) ──────────────────────────────────
// 마감된 데이터만 내보내는 권한 있는(owner / attendance_payroll_admin) 기능 — 월 일괄 또는
// 사람별. 권한 + 마감분 필터링 + `attendance_export_logs` 감사 행은 모두
// `runPayrollExport` 에 있고, 이 얇은 액션들은 세션을 확인해 호출자(보류된
// 웹 대시보드)가 내려받을 CSV 를 돌려준다. 최종 엑셀 양식이 정해질 때까지
// 임시 형식은 구조화된 CSV 다. 관리자 내보내기 UI 는 여기서 만들지 않는다.

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

// ── 현지화된 서식 급여 통합 문서 (Excel 호환 .xlsx) ────────────────
// 월별 사용자 근무시간 + 예상 급여 + 승인된 교통비를 Excel 과 LibreOffice 가 서식 그대로 여는
// 깔끔한 통합 문서로 내보낸다. 호출자의 UI 언어(ko/ja/en)로 현지화된다. 마감분 전용
// CSV 내보내기와 달리 이것은 실시간 월 급여 뷰(모든 활성 멤버)를 반영하므로
// 운영자가 세무/회계용 월 요약을 한눈에 넘길 수 있다.

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
  if (!isValidYm(ym)) return { ok: false, reason: "error" };

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
  if (!isValidYm(ym)) return { ok: false, reason: "error" };
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

  // 날짜별 근무 장소: 자유 입력 manual_location (현장 외 / 수동 입력)이 우선이고, 아니면
  // 등록된 근무지 이름을 쓴다. "근무 위치" 내보내기 열에 들어간다.
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
  // 일별 기본급 열을 월 기본급 합계(총합 − 수당)에 맞춰
  // 기본급 열 합이 정확히 맞게 한다. 수당과 교통비는 각자의 열에 둔다.
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

// ── 인쇄용 급여 PDF 보고서 (현지화된 HTML → 브라우저 인쇄) ─────────
// 클라이언트가 새 창에서 여는 독립형 서식 HTML 문서를 돌려준다. 문서가
// 인쇄 대화상자를 자동으로 띄워 운영자가 세무/회계 전달용으로 "PDF로 저장"할 수 있다.

export type PayrollReportResult =
  | { ok: true; html: string; rowCount: number }
  | { ok: false; reason: "forbidden" | "empty" | "error" };

export async function exportMonthlyPayrollReport(
  ym: string,
  options: PayrollExportOptions = {},
): Promise<PayrollReportResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  if (!isValidYm(ym)) return { ok: false, reason: "error" };

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

// ── 교통비 정산 — 관리자 검토 (Slice 5) ─────────────────────────
// 교통비 보고서에 대한 권한 있는(owner / attendance_payroll_admin) 상태 전이:
//   submitted/reviewing → approved | rejected | changes_requested
//   (「검토 시작」(→ reviewing) 액션은 2026-10-27 버튼과 함께 뺐다 — 예전 reviewing 행은 그대로 처리된다)
//   changes_requested → 근무자 재제출만 가능
//   approved/rejected → 재개 (→ 'submitted')
// `changes_requested` (마이그레이션 202607030001)는 보고서를 근무자에게 돌려보내 고쳐 다시 제출하게 한다
// (반려보다 부드러운 중간 경로). `reopen` 은 승인/반려된 보고서의 결정을 풀어 다시
// 검토할 수 있게 한다 — 승인된 보고서를 재개하면 다시 승인될 때까지 급여 합계에서 빠지며,
// 이것이 존재하는 실질적인 이유다. 보고서 자체의 `status` / `reviewed_*` / `review_note`
// 열을 쓴다.

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
  | "approved"
  | "rejected"
  | "changes_requested"
  | "reopen";

// 각 관리자 액션 → 그 결과가 되는 보고서 상태. `reopen` 은 예외다: 자체 상태가 없고,
// 이미 결정된(승인/반려) 보고서를 `submitted` 로 돌려 검토 큐에
// 다시 들어가게 한다 (승인됐던 것이라면 다시 승인될 때까지 급여 합계에서 빠진다).
const TRANSPORT_ACTION_TARGET: Record<TransportReviewAction, TransportReportStatus> = {
  approved: "approved",
  rejected: "rejected",
  changes_requested: "changes_requested",
  reopen: "submitted",
};

// 각 액션이 실행될 수 있는 원래 상태. `changes_requested` 보고서는 근무자에게 있으며
// 관리자가 승인/반려/다른 수정 요청을 하기 전에 다시 제출되어야 한다.
const TRANSPORT_ACTION_VALID_FROM: Record<TransportReviewAction, string[]> = {
  approved: ["submitted", "reviewing"],
  rejected: ["submitted", "reviewing"],
  changes_requested: ["submitted", "reviewing"],
  reopen: ["approved", "rejected"],
};

/** 교통비 보고서를 검토 수명주기에 따라 옮긴다. */
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

  // 반려와 "수정 요청" 모두 보고서를 근무자에게 돌려보내므로 사유가 필수다 —
  // 근무자가 무엇을 고쳐야 하는지 알아야 한다.
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
    // 큐로 복귀: 이전 결정을 지워 새로 대기 중인 것처럼 보이게 한다.
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

// ── 시급 관리 (Slice 7) ─────────────────────────────────────────
// 기존 `hourly_rate_history` 테이블을 쓰는 권한 있는(owner / attendance_payroll_admin)
// 시급 수정 (스키마 변경 없음). 현재 열린 기간(effective_to=null)을
// `effective_from - 1 day` 로 닫고 새 기간을 삽입한다.
// 변경 사유 메모는 `audit_logs.metadata` 에 보존된다.

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
  // 소급 변경 금지: effective_from 은 오늘(도쿄) 이후여야 한다. 과거 날짜는
  // 이미 지난 날을 재해석하게 된다. 오늘은 아직 하루가 끝나지 않았으므로 괜찮다.
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

  // 대상은 이 조직의 활성 멤버여야 한다.
  const member = await service
    .from("memberships")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", input.userId)
    .eq("status", "active")
    .maybeSingle();
  if (!member.data) return { ok: false, reason: "target_invalid" };

  // 현재 고용 형태 — 월급제면 막는다.
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

  // 종료일 계산 = effective_from - 1 day
  const fromDate = new Date(`${input.effectiveFrom}T00:00:00Z`);
  const closeDate = new Date(fromDate.getTime() - 86400000);
  const closeIso = closeDate.toISOString().slice(0, 10);

  // 기존 열린 기간(effective_to = null)은 다음 둘 중 하나다:
  // - 이미 적용 중 (effective_from 이 새 변경보다 앞) → 이전처럼
  //   새 기간이 시작되기 전날 닫는다, 또는
  // - 효력이 생기기 전에 수정되는, 아직 미래인 예약 변경 →
  //   effective_from 이 새 effective_from 이상이라 closeIso 가
  //   그 행 자신의 effective_from 보다 앞서게 되어 `effective_to >= effective_from`
  //   체크 제약을 어긴다. 이 경우 대기 행은 잘못된 날짜로 "닫는" 대신
  //   아예 대체(삭제)된다.
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

  // 새 행을 **먼저** 넣는다 — 넣기가 실패하면 옛 행은 그대로라 시급이 비는 날이 생기지 않는다(2026-10-26).
  // 닫기 · 지우기가 실패하면 방금 넣은 행을 지워 원래대로 돌린다.
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
  const insertedId = ins.data.id;

  if (pendingIds.length > 0) {
    const delRes = await service
      .from("hourly_rate_history")
      .delete()
      .in("id", pendingIds);
    if (delRes.error) {
      await service.from("hourly_rate_history").delete().eq("id", insertedId);
      return { ok: false, reason: "error" };
    }
  }
  if (activeIds.length > 0) {
    const closeRes = await service
      .from("hourly_rate_history")
      .update({ effective_to: closeIso })
      .in("id", activeIds);
    if (closeRes.error) {
      await service.from("hourly_rate_history").delete().eq("id", insertedId);
      return { ok: false, reason: "error" };
    }
  }


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
// 기존 `employment_type_history` 테이블을 쓰는 권한 있는(owner / attendance_payroll_admin)
// 고용 형태 변경 (스키마 변경 없음), setHourlyRate 의 구간 로직과 같다:
// 현재 열린 기간을 effective_from-1 에 닫고 (또는 아직 미래인 대기 행을 삭제하고)
// 새 열린 기간을 삽입한다. 소급 날짜 금지. 시급 이력은 건드리지 않는다 — 급여는
// 현재 고용 형태에 따라 갈리므로, 기존 시급은 월급제가 되면 적용이 멈추고
// 시급제로 돌아가면 다시 적용된다 (시급은 관리자가 따로 설정/수정한다).

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

  // 현재 활성 형태 — 중복된 같은 형태 변경은 막는다 (null = 설정된 적 없음이므로 어떤 형태든 변경이다).
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

  // 새 행을 먼저 넣고 옛 행을 닫는다 — 넣기가 실패해도 옛 고용형태가 그대로 남는다(2026-10-26).
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
  const insertedId = ins.data.id;

  if (pendingIds.length > 0) {
    const del = await service.from("employment_type_history").delete().in("id", pendingIds);
    if (del.error) {
      await service.from("employment_type_history").delete().eq("id", insertedId);
      return { ok: false, reason: "error" };
    }
  }
  if (activeIds.length > 0) {
    const close = await service
      .from("employment_type_history")
      .update({ effective_to: closeIso })
      .in("id", activeIds);
    if (close.error) {
      await service.from("employment_type_history").delete().eq("id", insertedId);
      return { ok: false, reason: "error" };
    }
  }


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
// 특정 도쿄 영업일에 적용되는 바쁜 날 / 인력 부족일 추가 수당의
// 권한 있는(owner / attendance_payroll_admin) 생성/취소. hourly_rate_history 의 기본 시급은 건드리지 않는다.
// 이미 마감 스냅샷이 있는 사용자-월은 생성/취소가 막힌다 (먼저 재개). 모든
// 쓰기는 이 service-role 액션을 거치며, 클라이언트/RLS 직접 쓰기 경로는 없다.

const ALLOWANCE_TYPES = ["daily_fixed", "hourly_extra"] as const;
const ALLOWANCE_CATEGORIES = ["regular", "special"] as const;

export type AllowanceMutationResult =
  | { ok: true; id: string }
  | {
      ok: false;
      reason: "error" | "forbidden" | "invalid" | "amount_required" | "target_invalid" | "finalized";
    };

/** 마감 스냅샷이 있는 사용자-월이면 true. */
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

/** 조직 내 어떤 사용자라도 그 달의 마감 스냅샷이 있으면 true (조직 전체 수당 가드). */
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
  targetDate: string; // YYYY-MM-DD (도쿄 영업일)
  targetUserId: string | null; // null = 그날 유급 근무가 있는 모든 시급 근무자
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

  // 특정 대상은 이 조직의 멤버여야 한다 — 비활성(퇴사)도 마지막 달 수당은 줄 수 있다(2026-10-22).
  if (input.targetUserId) {
    const member = await service
      .from("memberships")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("user_id", input.targetUserId)
      .maybeSingle();
    if (!member.data) return { ok: false, reason: "target_invalid" };
  }

  // 이미 마감된 사용자-월의 변경은 막는다 (먼저 재개). 조직 전체 수당이면, 그 달의
  // 마감 스냅샷이 하나라도 있으면 막힌다 (닫힌 달을 소급해서 바꾸게 되므로).
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

/** 관리자 교통비 패널용으로 전체 보고서 + 항목 + 서명된 이미지 URL 을 불러온다. */
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
      contextSummary: ctx ? localizeStoredPlaceText(ctx, session.user.preferredLanguage) : ctx,
      buildingLabel: wc.buildingLabel ? localizeStoredPlaceText(wc.buildingLabel, session.user.preferredLanguage) : null,
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

// ── 교통비 정산 — 월별 내보내기 (Excel + PDF) ───────────────────
// 월의 모든 정산 항목(근무자별 요약이 아님)을, 입력된 항목이 있는 전 직원에 대해
// 단순 회계 장부(번호 / 직원 / 날짜 / 용도 / 건물 / 상태 / 금액)로 내보낸다
// — 급여 내보내기 패턴을 따른다 (exceljs 로 현지화한 Excel + 독립형 인쇄용
// PDF/HTML). 내보낸 파일에는 영수증 이미지나 링크가 없다: 영수증은 교통비 패널에서 들어가는
// 전용 웹 영수증 페이지(`/admin/attendance/transport/receipt`)에서 검토한다.

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
    // 승인된 청구만 내보낸다 — 합계가 급여에 들어가는 금액과 같아야 한다(2026-10-26).
    (r): r is AdminTransportRow & { reportId: string } =>
      Boolean(r.reportId) && r.itemCount > 0 && r.status === "approved",
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
          buildingLabel: wc.buildingLabel ? localizeStoredPlaceText(wc.buildingLabel, localeTag) : "",
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
  if (!isValidYm(ym)) return { ok: false, reason: "error" };

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
  if (!isValidYm(ym)) return { ok: false, reason: "error" };

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

// ── 세션 변경 이력 (감사 추적 뷰어) ──────────────────────────────
// 읽기 전용, 권한 있는(owner / attendance_payroll_admin) 사용자용으로
// 한 세션의 `attendance_session_audits` 행을 보여준다 — 모든 수동 수정 / 무효 / 복원 /
// 정정 적용을 행위자 + 사유 + 사람이 읽을 수 있는 전→후 diff 와 함께. 서버에서 현지화(ko/ja/en)해
// 클라이언트는 그대로 그리기만 한다. 이미 기록되고 있었지만 볼 UI 가 없던
// 감사 추적을 드러낸다. 큐의 세션 상세 패널이 열릴 때 필요에 따라 불러온다.

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

  // diff 안에서 참조되는 행위자 이름과 근무지 이름을 해석한다.
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
// 2026-07-14 구현, 시급 사이드 패널의 비활성 자리표시 버튼을 대체했다. 시트 두 개:
// 시트 두 개: 직원별 요약과 전체 시급 변경 이력 (자리표시 버튼의 라벨이
// "이력 내보내기" 였으므로, 실제로 담아야 하는 것이 이력이다). 급여관리자 게이트는
// 급여 내보내기와 같고, 공용 관리자 표 내보내기로 그린다.

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
