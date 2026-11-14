// 근태 검토 사유 판정 — 개요(즉시 검토)와 검토 목록이 같은 함수 하나를 쓴다(2026-11-13).
// 클라이언트에서도 import 하므로 server-only 모듈을 끌어오지 않는다(타입만).
import type { AttendanceCorrectionStatus, AttendanceSessionStatus } from "@/lib/attendance";

/** 인정 근무가 이 시간을 넘으면 「장시간」으로 따로 보인다. */
export const LONG_SHIFT_SEC = 12 * 3600;

export type ReviewReason =
  | "clockout_missing"
  | "correction_pending"
  | "long_shift"
  | "abnormal"
  | "incomplete"
  | "review";

export type ReviewReasonInput = {
  status: AttendanceSessionStatus;
  clockOutLabel: string | null;
  paidDurationSec: number | null;
  isAbnormal: boolean;
  correctionStatus: AttendanceCorrectionStatus | null;
};

const OPEN_STATUSES = new Set<string>(["open", "reopened", "abandoned"]);

export function reviewReason(item: ReviewReasonInput): ReviewReason {
  if (!item.clockOutLabel && OPEN_STATUSES.has(item.status)) return "clockout_missing";
  if (item.correctionStatus === "requested" || item.correctionStatus === "in_review") return "correction_pending";
  if ((item.paidDurationSec ?? 0) > LONG_SHIFT_SEC) return "long_shift";
  if (item.isAbnormal) return "abnormal";
  if (!item.clockOutLabel) return "incomplete";
  return "review";
}
