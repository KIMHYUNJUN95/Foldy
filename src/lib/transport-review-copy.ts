// 관리자 교통비 처리(승인 · 반려 · 수정 요청 · 다시 열기) 실패 이유 → 화면 문구. 클라이언트에서 쓴다(server-only 아님).
export function transportReviewErrorText(
  reason: string,
  copy: { trFinalizedLocked: string; trSelfReviewBlocked: string; actionFailed: string },
): string {
  if (reason === "finalized") return copy.trFinalizedLocked;
  // 자기 정산서는 처리할 수 없다(2026-11-11, `setTransportReportReview`).
  if (reason === "self_review") return copy.trSelfReviewBlocked;
  return copy.actionFailed;
}
