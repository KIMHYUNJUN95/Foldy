// 근태 / 출퇴근 / 급여 — 공용 타입 + 상수 (1단계, 스키마 인접 부분만).
//
// 이 모듈은 의도적으로 쿼리, 서버 액션, UI 연결을 담지 않는다. 이후
// 단계들(출퇴근, 휴게, 기록, 정정, 관리자 검토, 급여, 확정, 내보내기)이
// 행 타입, 상태/방식/사유 유니온, 스키마를 반영한 상수를 다시 도출하지 않고
// 공유할 수 있게 하려는 것이다. 참고: docs/engineering/11-attendance-payroll-technical-design.md.
//
// 중요: 아래 모든 유니온은 DB CHECK 제약을 반영한다:
// supabase/migrations/202606170001_attendance_payroll.sql. 동기화를 유지할 것.

import type { Database } from "@/types/database";

// ── 행 타입 별칭 ──────────────────────────────────────────────────────
export type AttendanceSiteRow = Database["public"]["Tables"]["attendance_sites"]["Row"];
export type AttendanceQrTokenRow = Database["public"]["Tables"]["attendance_qr_tokens"]["Row"];
export type AttendanceSessionRow = Database["public"]["Tables"]["attendance_sessions"]["Row"];
export type AttendanceBreakRow = Database["public"]["Tables"]["attendance_breaks"]["Row"];
export type AttendanceAttemptLogRow =
  Database["public"]["Tables"]["attendance_attempt_logs"]["Row"];
export type AttendanceCorrectionRequestRow =
  Database["public"]["Tables"]["attendance_correction_requests"]["Row"];
export type AttendanceSessionAuditRow =
  Database["public"]["Tables"]["attendance_session_audits"]["Row"];
export type EmploymentTypeHistoryRow =
  Database["public"]["Tables"]["employment_type_history"]["Row"];
export type HourlyRateHistoryRow = Database["public"]["Tables"]["hourly_rate_history"]["Row"];
export type AttendanceMonthSnapshotRow =
  Database["public"]["Tables"]["attendance_month_snapshots"]["Row"];
export type AttendanceExportLogRow =
  Database["public"]["Tables"]["attendance_export_logs"]["Row"];

// ── 세션 생명주기 ─────────────────────────────────────────────────────
/** 세션 상태. 사용자당 한 번에 `open` 세션 하나만 허용된다 (DB 부분 유니크 인덱스). */
/**
 * `abandoned` = 퇴근을 찍지 않은 채 운영일이 넘어간 세션(2026-08-04).
 *
 * 유니크 인덱스와 출근 액션이 사용자당 `open` 을 하나로 제한하는데 **날짜를 보지 않아서**,
 * 어제 미퇴근 하나가 오늘 출근을 막고 있었다. 지난 운영일의 `open` 은 다음 출근 시점에 이 상태로
 * 옮겨 새 출근을 통과시킨다. `clock_out_at` 은 **비운 채로** 둔다 — 시각을 추측해 채우면 그 값이
 * 그대로 급여가 되기 때문이다. 대신 월 마감 판정이 미해소 건으로 세어 반드시 정리하게 만든다.
 */
export type AttendanceSessionStatus =
  | "open"
  | "completed"
  | "reopened"
  | "invalid"
  | "abandoned";

export const ATTENDANCE_SESSION_STATUSES: readonly AttendanceSessionStatus[] = [
  "open",
  "completed",
  "reopened",
  "invalid",
  "abandoned",
];

/** 검토 상태. 비정상 세션(예: 자정 넘김, 퇴근 누락)은 `review_required` 이다. */
export type AttendanceReviewState =
  | "normal"
  | "review_required"
  | "pending_correction"
  | "approved_correction"
  | "rejected_correction";

export const ATTENDANCE_REVIEW_STATES: readonly AttendanceReviewState[] = [
  "normal",
  "review_required",
  "pending_correction",
  "approved_correction",
  "rejected_correction",
];

// ── 인증 방식 ──────────────────────────────────────────────────────
/**
 * 근태 인증 방식. PWA 첫 출시는 `gps_qr` 만 쓴다 (관리자가 만든
 * 세션은 `manual`). `gps_wifi` 는 이후 비PWA / 확장 출시를 위해 모델링만 해 두었고 현재 PWA 에서는
 * 비활성이어야 한다 — UI 는 Wi-Fi 출근을 `준비중` 으로 보여준다.
 */
export type AttendanceMethod = "gps_qr" | "gps_wifi" | "manual";

export const ATTENDANCE_METHODS: readonly AttendanceMethod[] = ["gps_qr", "gps_wifi", "manual"];

/** 이번 출시에서 일반(비관리자) PWA 출퇴근이 만들 수 있는 방식. */
export const ATTENDANCE_ACTIVE_PWA_METHODS: readonly AttendanceMethod[] = ["gps_qr"];

/** Wi-Fi 는 설계만 되어 있고 현재 PWA 에서는 비활성이다. */
export const ATTENDANCE_WIFI_ACTIVE = false;

// ── 시도 로그 ────────────────────────────────────────────────────────
export type AttendanceActionType = "clock_in" | "clock_out" | "break_start" | "break_end";

export const ATTENDANCE_ACTION_TYPES: readonly AttendanceActionType[] = [
  "clock_in",
  "clock_out",
  "break_start",
  "break_end",
];

export type AttendanceFailureReason =
  | "gps_denied"
  | "gps_unavailable"
  | "outside_radius"
  | "qr_invalid"
  | "qr_scan_failed"
  | "wifi_not_supported"
  | "wifi_not_matched"
  | "open_break_blocks_clock_out"
  | "midnight_crossing"
  | "open_session_exists";

export const ATTENDANCE_FAILURE_REASONS: readonly AttendanceFailureReason[] = [
  "gps_denied",
  "gps_unavailable",
  "outside_radius",
  "qr_invalid",
  "qr_scan_failed",
  "wifi_not_supported",
  "wifi_not_matched",
  "open_break_blocks_clock_out",
  "midnight_crossing",
  "open_session_exists",
];

// ── 정정 / 예외 요청 ─────────────────────────────────────────────────
// `cancelled` = 요청자가 스스로 철회(2026-08-03, 마이그레이션 202608030001).
// 대기 큐와 마감 판정은 `requested|in_review` 만 세므로 취소된 요청은 두 곳 모두에서 빠진다.
export type AttendanceCorrectionStatus =
  | "requested"
  | "in_review"
  | "approved"
  | "rejected"
  | "cancelled";

export const ATTENDANCE_CORRECTION_STATUSES: readonly AttendanceCorrectionStatus[] = [
  "requested",
  "in_review",
  "approved",
  "rejected",
  "cancelled",
];

/** 아직 관리자가 처리하지 않은 상태 — 이 상태에서만 요청자가 철회할 수 있다. */
export const ATTENDANCE_CORRECTION_PENDING_STATUSES: readonly AttendanceCorrectionStatus[] = [
  "requested",
  "in_review",
];

export type AttendanceCorrectionReason =
  | "missing_clock_in"
  | "missing_clock_out"
  | "wrong_time"
  | "wrong_site"
  | "auth_failed"
  | "other";

export const ATTENDANCE_CORRECTION_REASONS: readonly AttendanceCorrectionReason[] = [
  "missing_clock_in",
  "missing_clock_out",
  "wrong_time",
  "wrong_site",
  "auth_failed",
  "other",
];

// ── 세션 감사 액션 ───────────────────────────────────────────────────
export type AttendanceAuditAction =
  | "manual_create"
  | "manual_update"
  | "invalidate"
  | "correction_apply"
  | "reopen"
  | "finalize";

export const ATTENDANCE_AUDIT_ACTIONS: readonly AttendanceAuditAction[] = [
  "manual_create",
  "manual_update",
  "invalidate",
  "correction_apply",
  "reopen",
  "finalize",
];

// ── 고용 / 급여 ─────────────────────────────────────────────────────
export type EmploymentType = "hourly" | "salaried";

export const EMPLOYMENT_TYPES: readonly EmploymentType[] = ["hourly", "salaried"];

export type AttendanceSnapshotStatus = "draft" | "finalized" | "superseded" | "reopened";

export const ATTENDANCE_SNAPSHOT_STATUSES: readonly AttendanceSnapshotStatus[] = [
  "draft",
  "finalized",
  "superseded",
  "reopened",
];

export type AttendanceExportScope = "monthly_bulk" | "single_user";

export const ATTENDANCE_EXPORT_SCOPES: readonly AttendanceExportScope[] = [
  "monthly_bulk",
  "single_user",
];

// ── 스키마를 반영한 상수 ─────────────────────────────────────────────
/** 현장의 기본 허용 GPS 반경 (미터, 현장별 덮어쓰기 가능). DB 기본값과 같다. */
export const ATTENDANCE_DEFAULT_RADIUS_METERS = 100;

/** 정정 요청의 최대 사진 수 — DB CHECK 제약과 같다. */
export const ATTENDANCE_CORRECTION_MAX_IMAGES = 5;

/** 시급제 월 총액은 계산 시점에 이 엔 단위로 가장 가깝게 반올림한다. */
export const ATTENDANCE_GROSS_ROUNDING_YEN = 10;

/** 하루 한 번 열린 세션 알림을 보내는 도쿄 시각 (18:30). */
export const ATTENDANCE_OPEN_SESSION_REMINDER_HOUR = 18;
export const ATTENDANCE_OPEN_SESSION_REMINDER_MINUTE = 30;

/**
 * 퇴근을 잊은 열린 근무인가(2026-10-21) — 운영일이 오늘(도쿄)보다 앞이면 그렇다.
 *
 * 현장 근무는 자정을 넘기지 않는다(가장 늦은 퇴근이 23:30 정도). 그래서 날짜가 바뀐 뒤에도 `open` 인
 * 근무는 일하는 중이 아니라 퇴근을 안 찍은 것이다. 예전에는 홈이 이런 근무를 며칠이고 「근무 중」으로
 * 띄우고 퇴근 버튼만 보여 줘서, 그 버튼을 누르면 866시간짜리 근무가 저장됐다. 출근 · 퇴근 · 휴게 · 홈이
 * 모두 이 하나로 판정한다.
 */
export function isStaleOpenSession(operatingDate: string, today: string): boolean {
  return operatingDate < today;
}

/**
 * 시급 · 고용형태를 「빈 날 채우기」로 넣을 수 있는 가장 이른 날 — 지난달 1일(도쿄, 2026-10-21).
 *
 * 시급 · 고용형태는 원래 오늘 이후로만 넣는다(이미 지난 날의 금액을 바꾸지 않는다). 그런데 등록이 첫 출근보다 늦으면
 * 그 사이 근무가 0원으로 남고 마감도 막힌다. 그래서 **아직 값이 없는 날만** 지난 날짜로 채울 수 있게 했다 — 정정 요청이
 * 받는 범위(이번 달 · 지난달)와 같다. 이미 값이 있는 날을 바꾸는 소급은 여전히 막는다.
 */
export function gapFillMinFrom(todayTokyo: string): string {
  const [y, m] = todayTokyo.split("-").map(Number);
  return m <= 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
}
