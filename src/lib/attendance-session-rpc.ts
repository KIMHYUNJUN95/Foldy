// 근무 넣기 · 바꾸기 · 마감 — 한 사람 · 한 달 잠금 안에서 확인하고 쓰는 DB 함수 호출(2026-11-11, 마이그레이션 202611110001).
//
// 앱이 「읽고 확인 → 쓰기」를 따로 하면 그 사이에 다른 요청이 끼어든다(마감 ↔ 수정, 세션 없는 정정 두 건 동시 승인).
// 이 함수들은 확인(마감 여부 · updated_at · 겹침 · 급여 입력 지문)과 쓰기를 한 트랜잭션에서 한다. 권한 확인은 부르는 서버
// 액션이 먼저 한다 — DB 함수는 service role 전용이다.
// 근무 행에는 트리거(`attendance_sessions_month_guard`)도 걸려 있어, 이 함수를 거치지 않는 쓰기도 마감된 달이면 거절된다.

import "server-only";

type RpcError = { message: string; code?: string } | null;
type RpcClient = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcError }>;
};

/** 마감 트리거가 던지는 예외 문구(마이그레이션 202611110001) — 근무 · 수당 트리거가 같이 쓴다. */
const MONTH_FINALIZED_MESSAGE = "attendance_month_finalized";

/** 쓰기 오류가 마감 트리거의 거절인지(수당 추가 · 취소처럼 RPC 를 거치지 않는 쓰기용). */
export function isMonthFinalizedWriteError(error: { message?: string } | null | undefined): boolean {
  return Boolean(error?.message?.includes(MONTH_FINALIZED_MESSAGE));
}

function resultOf(data: unknown): Record<string, unknown> | null {
  return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
}

function isFinalizedError(error: RpcError): boolean {
  return Boolean(error?.message?.includes(MONTH_FINALIZED_MESSAGE));
}

/**
 * 정정 승인 — 근무 반영과 같은 트랜잭션에서 요청을 `approved` 로 바꾼다(리뷰 6, 2026-11-11). 요청이 아직 `in_review` 이고
 * `actor_user_id` 가 잡고 있을 때만 — 아니면 아무것도 쓰지 않고 `request_changed`.
 */
export type ApproveRequestInTx = {
  id: string;
  actor_user_id: string;
  comment: string | null;
  reviewed_at: string;
};

export type InsertSessionCheckedResult =
  | { result: "ok"; id: string }
  | { result: "finalized" | "overlap" | "open_conflict" | "request_changed" | "error" };

/** 근무 넣기(관리자 수기 입력 · 세션 없는 정정 승인). `values` 는 attendance_sessions 열 이름 그대로. */
export async function insertAttendanceSessionChecked(
  service: unknown,
  values: Record<string, unknown>,
  approveRequest: ApproveRequestInTx | null = null,
): Promise<InsertSessionCheckedResult> {
  const { data, error } = await (service as RpcClient).rpc("attendance_insert_session_checked", {
    p_values: values,
    p_approve_request: approveRequest,
  });
  if (error) return { result: isFinalizedError(error) ? "finalized" : "error" };
  const r = resultOf(data);
  if (r?.result === "ok" && typeof r.id === "string") return { result: "ok", id: r.id };
  if (
    r?.result === "finalized" ||
    r?.result === "overlap" ||
    r?.result === "open_conflict" ||
    r?.result === "request_changed"
  ) {
    return { result: r.result };
  }
  return { result: "error" };
}

export type UpdateSessionCheckedResult =
  | { result: "ok"; updatedAt: string }
  | { result: "not_found" | "stale" | "finalized" | "overlap" | "request_changed" | "error" };

/**
 * 근무 바꾸기(직접 수정 · 무효 · 복구 · 정정 승인). `expectedUpdatedAt` 을 주면 읽은 뒤 바뀐 행은 `stale`.
 * 시각이 바뀌거나 무효에서 되살릴 때만 겹침을 본다(앱의 `findOverlappingSession` 과 같은 규칙).
 */
export async function updateAttendanceSessionChecked(
  service: unknown,
  organizationId: string,
  sessionId: string,
  expectedUpdatedAt: string | null,
  changes: Record<string, unknown>,
  approveRequest: ApproveRequestInTx | null = null,
): Promise<UpdateSessionCheckedResult> {
  const { data, error } = await (service as RpcClient).rpc("attendance_update_session_checked", {
    p_organization_id: organizationId,
    p_session_id: sessionId,
    p_expected_updated_at: expectedUpdatedAt,
    p_changes: changes,
    p_approve_request: approveRequest,
  });
  if (error) return { result: isFinalizedError(error) ? "finalized" : "error" };
  const r = resultOf(data);
  if (r?.result === "ok" && typeof r.updated_at === "string") return { result: "ok", updatedAt: r.updated_at };
  if (
    r?.result === "not_found" ||
    r?.result === "stale" ||
    r?.result === "finalized" ||
    r?.result === "overlap" ||
    r?.result === "request_changed"
  ) {
    return { result: r.result };
  }
  return { result: "error" };
}

/**
 * 그 사람 · 그 달의 급여 입력 지문. 마감은 **금액을 계산하기 전에** 이것을 받아 두고, 저장할 때 DB 가 잠금 안에서 다시 떠
 * 비교한다. 읽기 실패는 던진다 — 지문 없이 마감하지 않는다.
 */
export async function attendanceMonthFingerprint(
  service: unknown,
  organizationId: string,
  userId: string,
  ym: string,
): Promise<string> {
  const { data, error } = await (service as RpcClient).rpc("attendance_month_fingerprint", {
    p_organization_id: organizationId,
    p_user_id: userId,
    p_target_month: `${ym}-01`,
  });
  if (error || typeof data !== "string") {
    throw new Error(`[attendance] month fingerprint failed: ${error?.message ?? "no value"}`);
  }
  return data;
}

export type FinalizeCheckedResult =
  | { result: "ok"; id: string }
  | { result: "stale" | "already_finalized" | "error" };

/** 마감 저장 — 지문이 같을 때만 스냅샷 · 옛 행 대체 · 감사 기록을 한 트랜잭션으로. */
export async function finalizeAttendanceMonthChecked(
  service: unknown,
  input: {
    organizationId: string;
    userId: string;
    ym: string;
    actorId: string;
    fingerprint: string;
    totalPaidMinutes: number;
    grossAmount: number;
    rateBreakdown: unknown;
    allowanceBreakdown: unknown;
  },
): Promise<FinalizeCheckedResult> {
  const { data, error } = await (service as RpcClient).rpc("finalize_attendance_month_checked", {
    p_organization_id: input.organizationId,
    p_user_id: input.userId,
    p_target_month: `${input.ym}-01`,
    p_actor_user_id: input.actorId,
    p_expected_fingerprint: input.fingerprint,
    p_total_paid_minutes: input.totalPaidMinutes,
    p_gross_amount: input.grossAmount,
    p_rate_breakdown: input.rateBreakdown,
    p_allowance_breakdown: input.allowanceBreakdown,
  });
  if (error) {
    // 동시에 두 번 마감 — 사람 · 달마다 finalized 하나(유일 인덱스 202610050001).
    if (error.code === "23505") return { result: "already_finalized" };
    return { result: "error" };
  }
  const r = resultOf(data);
  if (r?.result === "ok" && typeof r.id === "string") return { result: "ok", id: r.id };
  if (r?.result === "stale" || r?.result === "already_finalized") return { result: r.result };
  return { result: "error" };
}
