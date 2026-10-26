"use server";

// 휴가 승인 상세 조회를 감싼 클라이언트 호출용 래퍼 — 세션을 서버에서 확인한 뒤
// (클라이언트가 보낸 세션은 절대 믿지 않음) lib 헬퍼에 넘긴다.
// 승인/반려를 맡는 actions.ts(백엔드 소유)와 분리해 소유 경계를 깔끔하게 유지한다.
import { getCurrentAppSession } from "@/lib/session";
import {
  getAdminLeaveApprovalDetail,
  type LeaveApprovalDetail,
} from "@/lib/annual-leave-approvals-server";
import {
  getApplicantLeaveSummary,
  type ApplicantLeaveSummary,
} from "@/lib/annual-leave-admin-server";

export async function loadLeaveApprovalDetail(
  requestId: string,
): Promise<LeaveApprovalDetail | null> {
  const session = await getCurrentAppSession();
  if (!session) return null;
  return getAdminLeaveApprovalDetail(session, requestId);
}

/** 신청자를 고르면 신청 모달의 "잔여 영향" 미리보기에 쓰이는 실시간 잔여. */
export async function loadApplicantLeaveSummary(
  userId: string,
): Promise<ApplicantLeaveSummary | null> {
  const session = await getCurrentAppSession();
  if (!session) return null;
  return getApplicantLeaveSummary(session, userId);
}
