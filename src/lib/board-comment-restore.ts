/**
 * 댓글 지우기 되돌리기 판정(게시판 unslop 2026-11-20). 지우기는 그대로 `deleted_at` 소프트 삭제이고,
 * `restoreBoardComment` 가 이 판정을 통과할 때만 `deleted_at` · `deleted_by_user_id` 를 비운다.
 * - **지운 사람만**: `deleted_by_user_id === 보는 사람`. 비어 있으면(이 칸이 생기기 전 삭제) 되돌리지 않는다.
 *   쓴 사람이 관리자가 지운 댓글을, 관리자가 쓴 사람이 지운 댓글을 되살리지 못한다.
 * - 신고 처리(`board_reports.status='removed'`)로 지운 댓글은 아무도 되돌리지 않는다(호출하는 곳이 `removedByReport`).
 * - 같은 조직 · 지운 지 60초 안 · 글이 지워지지 않았을 것(`postAlive`).
 */
export const BOARD_COMMENT_UNDO_MS = 60_000;

export type BoardCommentRestoreCheck = { ok: true } | { error: "not_found" | "forbidden" | "expired" };

export function checkBoardCommentRestore(input: {
  comment: { organization_id: string; deleted_by_user_id: string | null; deleted_at: string | null } | null;
  postAlive: boolean;
  removedByReport: boolean;
  viewer: { organizationId: string; userId: string };
  nowMs: number;
}): BoardCommentRestoreCheck {
  const { comment, postAlive, removedByReport, viewer, nowMs } = input;
  if (!comment || !comment.deleted_at) return { error: "not_found" };
  if (comment.organization_id !== viewer.organizationId) return { error: "forbidden" };
  if (removedByReport) return { error: "forbidden" };
  if (!comment.deleted_by_user_id || comment.deleted_by_user_id !== viewer.userId) return { error: "forbidden" };
  if (!postAlive) return { error: "not_found" };
  const deletedAt = Date.parse(comment.deleted_at);
  if (!Number.isFinite(deletedAt)) return { error: "expired" };
  const age = nowMs - deletedAt;
  if (age < 0 || age > BOARD_COMMENT_UNDO_MS) return { error: "expired" };
  return { ok: true };
}

/**
 * 신고함 목록에서 대상이 없어진 신고를 어떻게 할지. 글 대상(또는 글이 지워짐)은 지금처럼 바로 `removed` 로 닫는다.
 * 댓글이 지워진 지 60초(`BOARD_COMMENT_UNDO_MS`) 안이면 목록에서 숨기기만 — 닫으면 `removed` 신고 때문에
 * 쓴 사람의 「되돌리기」가 막힌다(2026-11-20). 그보다 오래됐거나 댓글 줄이 없으면 닫는다.
 */
export function goneReportAction(input: {
  postGone: boolean;
  commentDeletedAt: string | null | undefined;
  commentMissing: boolean;
  nowMs: number;
}): "close" | "hide" {
  if (input.postGone || input.commentMissing || !input.commentDeletedAt) return "close";
  const at = Date.parse(input.commentDeletedAt);
  if (!Number.isFinite(at)) return "close";
  return input.nowMs - at > BOARD_COMMENT_UNDO_MS ? "close" : "hide";
}
