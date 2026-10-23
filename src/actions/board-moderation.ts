"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { canModerateBoard, isBoardReportReason } from "@/lib/board-moderation";

// 게시판 신고 · 차단 서버 액션 (2026-10-06, 앱 출시 준비 B4).
// 두 표는 service-role 전용이라 모든 권한 · 조직 검사를 여기서 한다.
// 문서: docs/product/23-board-workflow.md → 「신고 · 차단」.

type ActionResult = { ok: true } | { error: string };

type Target = { targetType: "post" | "comment"; postId: string; commentId?: string | null };

async function requireSession() {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return null;
  return session;
}

/** 대상이 내 조직의 살아 있는 글 · 댓글인지 확인하고 작성자를 돌려준다. */
async function loadTarget(target: Target, orgId: string): Promise<{ authorId: string } | null> {
  const service = getSupabaseServiceClient();
  const { data: post } = await service
    .from("board_posts")
    .select("organization_id, created_by_user_id, deleted_at")
    .eq("id", target.postId)
    .maybeSingle();
  if (!post || post.deleted_at || post.organization_id !== orgId) return null;
  if (target.targetType === "post") return { authorId: post.created_by_user_id };

  if (!target.commentId) return null;
  const { data: comment } = await service
    .from("board_comments")
    .select("post_id, organization_id, created_by_user_id, deleted_at")
    .eq("id", target.commentId)
    .maybeSingle();
  if (!comment || comment.deleted_at || comment.organization_id !== orgId || comment.post_id !== target.postId) {
    return null;
  }
  return { authorId: comment.created_by_user_id };
}

function revalidateBoard(postId: string) {
  revalidatePath("/mobile/board");
  revalidatePath(`/mobile/board/${postId}`);
  revalidatePath("/mobile/board/reports");
  revalidatePath("/admin/board-reports");
}

/** 글 · 댓글 신고. 내 글 · 댓글은 신고할 수 없다. 같은 대상을 다시 신고하면 `already_reported`. */
export async function reportBoardContent(
  input: Target & { reason: string; note?: string | null },
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session) return { error: "no_org" };
  if (input.targetType !== "post" && input.targetType !== "comment") return { error: "invalid" };
  if (!isBoardReportReason(input.reason)) return { error: "invalid" };

  const target = await loadTarget(input, session.organization.id);
  if (!target) return { error: "not_found" };
  if (target.authorId === session.user.id) return { error: "forbidden" };

  const note = (input.note ?? "").trim().slice(0, 500) || null;
  const service = getSupabaseServiceClient();
  const { error } = await service.from("board_reports").insert({
    organization_id: session.organization.id,
    reporter_user_id: session.user.id,
    target_type: input.targetType,
    post_id: input.postId,
    comment_id: input.targetType === "comment" ? (input.commentId ?? null) : null,
    target_author_user_id: target.authorId,
    reason: input.reason,
    note,
  });
  if (error) {
    if (error.code !== "23505") return { error: "save_failed" };
    // 같은 대상에 대한 내 신고가 이미 있다. 예전에 스스로 취소한 신고면 새 신고로 다시 연다.
    let existing = service
      .from("board_reports")
      .select("id, status")
      .eq("reporter_user_id", session.user.id)
      .eq("target_type", input.targetType)
      .eq("post_id", input.postId);
    if (input.targetType === "comment") existing = existing.eq("comment_id", input.commentId ?? "");
    const { data: prior } = await existing.maybeSingle();
    if (!prior || prior.status !== "withdrawn") return { error: "already_reported" };
    const { error: reopenError } = await service
      .from("board_reports")
      .update({
        status: "pending",
        reason: input.reason,
        note,
        target_author_user_id: target.authorId,
        resolved_by_user_id: null,
        resolved_at: null,
        created_at: new Date().toISOString(),
      })
      .eq("id", prior.id);
    if (reopenError) return { error: "save_failed" };
  }

  revalidateBoard(input.postId);
  return { ok: true };
}

/**
 * 신고 취소 — 신고한 본인만. 대기 중이거나 「문제없음」으로 닫힌 신고만 거둘 수 있다(삭제된 대상은 되돌릴 게 없다).
 * 행은 지우지 않고 `withdrawn` 으로 남겨 기록을 보존한다. 대기 중이었다면 관리자 목록에서도 빠진다.
 */
export async function withdrawBoardReport(reportId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!session) return { error: "no_org" };

  const service = getSupabaseServiceClient();
  const { data: report } = await service
    .from("board_reports")
    .select("id, post_id, status, reporter_user_id, organization_id")
    .eq("id", reportId)
    .maybeSingle();
  if (!report || report.organization_id !== session.organization.id || report.reporter_user_id !== session.user.id) {
    return { error: "not_found" };
  }
  if (report.status !== "pending" && report.status !== "dismissed") return { error: "invalid" };

  const { error } = await service
    .from("board_reports")
    .update({ status: "withdrawn", resolved_at: new Date().toISOString(), resolved_by_user_id: session.user.id })
    .eq("id", reportId);
  if (error) return { error: "save_failed" };

  revalidateBoard(report.post_id);
  revalidatePath("/account");
  revalidatePath("/admin/board-reports");
  return { ok: true };
}

/** 같은 조직의 다른 구성원을 차단한다(이미 차단했으면 그대로 성공). */
export async function blockBoardUser(userId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!session) return { error: "no_org" };
  if (!userId || userId === session.user.id) return { error: "invalid" };

  const service = getSupabaseServiceClient();
  const { data: member } = await service
    .from("memberships")
    .select("user_id")
    .eq("organization_id", session.organization.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) return { error: "not_found" };

  const { error } = await service.from("user_blocks").upsert(
    {
      organization_id: session.organization.id,
      blocker_user_id: session.user.id,
      blocked_user_id: userId,
    },
    { onConflict: "organization_id,blocker_user_id,blocked_user_id", ignoreDuplicates: true },
  );
  if (error) return { error: "save_failed" };

  revalidatePath("/mobile/board", "layout");
  revalidatePath("/account");
  return { ok: true };
}

export async function unblockBoardUser(userId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!session) return { error: "no_org" };

  const service = getSupabaseServiceClient();
  const { error } = await service
    .from("user_blocks")
    .delete()
    .eq("organization_id", session.organization.id)
    .eq("blocker_user_id", session.user.id)
    .eq("blocked_user_id", userId);
  if (error) return { error: "save_failed" };

  revalidatePath("/mobile/board", "layout");
  revalidatePath("/account");
  return { ok: true };
}

/**
 * 신고 처리 — owner · office_admin 만. `remove` 는 대상을 소프트 삭제(작성자 · 관리자 삭제와 같은 방식)하고,
 * `dismiss` 는 대상은 두고 신고만 닫는다. 같은 대상의 대기 신고는 한 번에 모두 닫힌다.
 */
export async function resolveBoardReport(
  input: Target & { action: "remove" | "dismiss" },
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session) return { error: "no_org" };
  if (!canModerateBoard(session)) return { error: "forbidden" };
  if (input.action !== "remove" && input.action !== "dismiss") return { error: "invalid" };

  const service = getSupabaseServiceClient();
  const orgId = session.organization.id;
  const now = new Date().toISOString();

  if (input.action === "remove") {
    const target = await loadTarget(input, orgId);
    if (target) {
      const write =
        input.targetType === "post"
          ? service.from("board_posts").update({ deleted_at: now }).eq("id", input.postId).eq("organization_id", orgId)
          : service
              .from("board_comments")
              .update({ deleted_at: now })
              .eq("id", input.commentId ?? "")
              .eq("organization_id", orgId);
      const { error } = await write;
      if (error) return { error: "save_failed" };
    }
  }

  let close = service
    .from("board_reports")
    .update({
      status: input.action === "remove" ? "removed" : "dismissed",
      resolved_by_user_id: session.user.id,
      resolved_at: now,
    })
    .eq("organization_id", orgId)
    .eq("status", "pending")
    .eq("target_type", input.targetType)
    .eq("post_id", input.postId);
  if (input.targetType === "comment") close = close.eq("comment_id", input.commentId ?? "");
  const { error } = await close;
  if (error) return { error: "save_failed" };

  revalidateBoard(input.postId);
  return { ok: true };
}
