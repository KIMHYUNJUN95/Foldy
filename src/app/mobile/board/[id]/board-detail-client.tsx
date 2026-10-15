"use client";
import { useEffect, useOptimistic, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { BoardReactionBar } from "@/components/board/board-reaction-bar";
import { BoardComment } from "@/components/board/board-comment";
import { BoardComposer } from "@/components/board/board-composer";
import { BoardActionSheet } from "@/components/board/board-action-sheet";
import { BoardFileCard } from "@/components/board/board-file-card";
import { BoardImageGrid } from "@/components/board/board-image-grid";
import { BoardMentionSheet } from "@/components/board/board-mention-sheet";
import { BoardReportSheet, type BoardReportReasonCode } from "@/components/board/board-report-sheet";
import { BoardBlockConfirm } from "@/components/board/board-block-confirm";
import { BoardConfirm } from "@/components/board/board-confirm";
import { boardMetaLine, boardRelativeTime } from "@/components/board/board-time";
import { haptic } from "@/lib/haptics";
import "@/components/board/board-white.css";
import { blockBoardUser, reportBoardContent } from "../moderation-actions";
import type { ComposerSubmitPayload } from "@/components/board/board-composer";
import type { MentionableMember } from "@/app/mobile/board/[id]/actions";
import { ALL_TOKEN } from "@/lib/board-mention-utils";
import { shareLink } from "@/lib/share-link";
import type { BoardPostDetail } from "@/components/board/board-types";
import type { Dictionary, Locale } from "@/lib/i18n";
import {
  toggleBoardReaction,
  deleteBoardComment,
  pinBoardPost,
  unpinBoardPost,
  deleteBoardPost,
  addBoardComment,
  searchMentions,
  getBoardAttachmentDownloadUrl,
} from "./actions";

export function BoardDetailClient({
  post,
  viewerId,
  canManage,
  organizationId,
  locale,
  copy,
}: {
  post: BoardPostDetail;
  viewerId: string;
  canManage: boolean;
  organizationId: string;
  locale: Locale;
  copy: Dictionary["board"];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);

  // 신고 · 차단(2026-10-06). 대상은 글 자체 또는 남의 댓글 하나.
  type ModTarget = { type: "post" | "comment"; commentId: string | null; authorId: string; authorName: string };
  const [commentMenu, setCommentMenu] = useState<ModTarget | null>(null);
  const [reportTarget, setReportTarget] = useState<ModTarget | null>(null);
  const [blockTarget, setBlockTarget] = useState<ModTarget | null>(null);
  const [modPending, setModPending] = useState(false);
  const toastTimer = useRef<number | null>(null);

  // 멘션 상태 (composer → 시트 → 여기서 통합 관리)
  const [showMentionSheet, setShowMentionSheet] = useState(false);
  const [mentionedUsers, setMentionedUsers] = useState<MentionableMember[]>([]);
  const [mentionAll, setMentionAll] = useState(false);

  // 낙관적 반응은 **새 props 가 도착할 때** `post.reactions` 를 기준으로 다시 잡힌다. 서버 액션이
  // `revalidateBoard()` 로 이 경로를 재검증하므로 그 props 가 응답과 함께 온다 — 예전에는 여기에
  // `router.refresh()` 를 더해 두고 그걸 근거로 삼았는데, 같은 데이터를 한 번 더 받는 두 번째
  // 왕복이었을 뿐이다(2026-08-11 제거). `useState` 로 거울을 두던 옛 버그로 돌아가지 않게 하는
  // 것은 이 재기준화이지 새로고침이 아니다.
  const [reactions, applyOptimisticToggle] = useOptimistic(
    post.reactions,
    (state, emoji: string) =>
      state.map((r) =>
        r.emoji === emoji
          ? { ...r, isMine: !r.isMine, count: r.isMine ? r.count - 1 : r.count + 1 }
          : r,
      ),
  );

  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  const isOwn = viewerId === post.authorId;
  const reactionTotal = post.reactionTotal;
  const commentCount = post.comments.length;

  function flashToast(message: string) {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  }

  function onToggleReaction(emoji: string) {
    startTransition(async () => {
      applyOptimisticToggle(emoji);
      const result = await toggleBoardReaction(post.id, emoji);
      if ("error" in result) haptic("error");
    });
  }

  function onDeleteComment(commentId: string) {
    startTransition(async () => {
      await deleteBoardComment(commentId);
    });
  }

  async function onDownloadFile(path: string) {
    if (downloadingPath) return;
    setDownloadingPath(path);
    try {
      const result = await getBoardAttachmentDownloadUrl(post.id, path);
      if ("url" in result) {
        // The signed URL carries Content-Disposition: attachment, so this downloads (not navigates)
        // on both mobile and desktop without ejecting the PWA.
        const a = document.createElement("a");
        a.href = result.url;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        flashToast(copy.downloadFailed);
      }
    } catch {
      flashToast(copy.downloadFailed);
    } finally {
      setDownloadingPath(null);
    }
  }

  function onMentionConfirm(selection: { users: MentionableMember[]; mentionAll: boolean }) {
    setMentionedUsers(selection.users);
    setMentionAll(selection.mentionAll);
    setShowMentionSheet(false);
  }

  function onComposerSubmit(payload: ComposerSubmitPayload) {
    startTransition(async () => {
      // 본문에 멘션 토큰 삽입: @이름 형식으로 content 앞에 붙여 DB에 저장.
      // 렌더 시 mentionedUsers와 매칭해 강조 표시함.
      let content = payload.content;

      // @ALL은 고정 토큰(@ALL)으로 본문에 삽입 — 렌더에서 locale별 변환
      if (payload.mentionAll) {
        content = `${ALL_TOKEN} ${content}`;
      } else if (payload.mentionedUsers.length > 0) {
        const names = payload.mentionedUsers.map((u) => `@${u.name}`).join(" ");
        content = `${names} ${content}`;
      }

      const mentionedUserIds = payload.mentionedUsers.map((u) => u.id);

      const result = await addBoardComment(post.id, content, payload.imageUrls, {
        mentionedUserIds,
        mentionAll: payload.mentionAll,
      });

      if ("error" in result) {
        haptic("error");
        flashToast(copy.errSaveFailed);
        return;
      }
      haptic("success");

      // 멘션 상태 초기화
      setMentionedUsers([]);
      setMentionAll(false);
    });
  }

  const postTarget: ModTarget = {
    type: "post",
    commentId: null,
    authorId: post.authorId,
    authorName: post.authorName,
  };

  function onOpenCommentMenu(commentId: string) {
    const c = post.comments.find((x) => x.id === commentId);
    if (!c) return;
    setCommentMenu({ type: "comment", commentId: c.id, authorId: c.authorId, authorName: c.authorName });
  }

  async function onSubmitReport(reason: BoardReportReasonCode, note: string) {
    if (!reportTarget || modPending) return;
    setModPending(true);
    try {
      const result = await reportBoardContent({
        targetType: reportTarget.type,
        postId: post.id,
        commentId: reportTarget.commentId,
        reason,
        note,
      });
      setReportTarget(null);
      if ("error" in result) {
        haptic("error");
        flashToast(result.error === "already_reported" ? copy.reportAlready : copy.errSaveFailed);
        return;
      }
      haptic("success");
      flashToast(copy.reportDone);
      // 신고한 글은 나에게 더 이상 보이지 않는다 — 목록으로. 댓글은 재검증된 props 에서 빠진다.
      if (reportTarget.type === "post") router.replace("/mobile/board");
    } finally {
      setModPending(false);
    }
  }

  async function onConfirmBlock() {
    if (!blockTarget || modPending) return;
    setModPending(true);
    try {
      const result = await blockBoardUser(blockTarget.authorId);
      const blockedPostAuthor = blockTarget.authorId === post.authorId;
      setBlockTarget(null);
      if ("error" in result) {
        flashToast(copy.errSaveFailed);
        return;
      }
      flashToast(copy.blockDone);
      if (blockedPostAuthor) router.replace("/mobile/board");
      else router.refresh();
    } finally {
      setModPending(false);
    }
  }

  function onPinToggle() {
    setShowActionSheet(false);
    startTransition(async () => {
      if (post.isPinned) await unpinBoardPost(post.id);
      else await pinBoardPost(post.id);
    });
  }

  async function onShare() {
    setShowActionSheet(false);
    const url = `${window.location.origin}/mobile/board/${post.id}`;
    const title = post.title ?? post.content.slice(0, 40);
    const result = await shareLink({ title, url });
    if (result === "copied") flashToast(copy.shareCopied);
    else if (result === "failed") flashToast(copy.shareFailed);
  }

  function onConfirmDelete() {
    setShowDeleteConfirm(false);
    startTransition(async () => {
      const result = await deleteBoardPost(post.id);
      if ("error" in result) {
        flashToast(copy.errSaveFailed);
        return;
      }
      router.replace("/mobile/board");
    });
  }

  const reactionSummary =
    reactionTotal <= 0 || !post.firstReactorName
      ? null
      : reactionTotal === 1
        ? copy.reactionSummaryOne.replace("{name}", post.firstReactorName)
        : copy.reactionSummaryMany
            .replace("{name}", post.firstReactorName)
            .replace("{count}", String(reactionTotal - 1));

  const reactionTrailing = reactionSummary ? <span className="bdw-d__rxsum">{reactionSummary}</span> : null;

  // 셸 스크롤 안에서 그린다 — 댓글 입력은 `.bdw-cmp`(sticky)로 화면 바닥에 붙고, `.bdw-dwrap` 이 셸의 아래 여백을 지운다.
  // (예전에는 이 화면이 100dvh 짜리 자기 스크롤러를 가지려고 셸 여백을 음수로 지웠는데, 폴드 · 태블릿의 다른 여백과 맞지 않았다.)
  return (
    <div className="bdw bdw-dwrap">
      <article className="bdw-d">
        <div className="bdw-who">
          <span aria-hidden="true" className="bdw-av is-lg">
            {post.authorName.charAt(0) || "·"}
          </span>
          <span className="bdw-who__b">
            <span className="bdw-who__n">{post.authorName}</span>
            <span className="bdw-who__m">
              {boardMetaLine(post.authorRole, hydrated ? boardRelativeTime(post.createdAt, locale) : "")}
            </span>
          </span>
          <button aria-label={copy.postMore} className="bdw-icon" onClick={() => setShowActionSheet(true)} type="button">
            <MoreHorizontal aria-hidden="true" />
          </button>
        </div>

        <div className="bdw-d__main">
          {post.title ? <h1>{post.title}</h1> : null}
          <p className="bdw-d__body">{post.content}</p>

          {/* 사진 — 누르면 전체 화면 라이트박스 */}
          {post.imageUrls.length > 0 ? (
            <BoardImageGrid closeLabel={copy.close} urls={post.imageUrls} viewPhotoLabel={copy.viewPhoto} />
          ) : null}

          {post.tags.length > 0 ? (
            <div className="bdw-d__tags">
              {post.tags.map((t) => (
                <span key={t}>#{t}</span>
              ))}
            </div>
          ) : null}

          {/* 첨부 파일 — 누르면 서명 URL 로 내려받기(모바일 · PC) */}
          {post.fileAttachments.length > 0 ? (
            <div className="bdw-d__files">
              {post.fileAttachments.map((f) => (
                <BoardFileCard
                  downloadLabel={copy.downloadFile}
                  downloading={downloadingPath === f.url}
                  hint={copy.fileTapToDownload}
                  key={f.url}
                  mimeType={f.mimeType}
                  name={f.name}
                  onDownload={() => onDownloadFile(f.url)}
                  sizeBytes={f.sizeBytes}
                />
              ))}
            </div>
          ) : null}
        </div>

        <BoardReactionBar
          addLabel={copy.reactionAdd}
          className="bdw-d__rx"
          onToggle={onToggleReaction}
          reactions={reactions}
          trailing={reactionTrailing}
        />

        <section aria-label={copy.commentLabel} className="bdw-cm">
          <b className="num">{copy.commentsN.replace("{n}", String(commentCount))}</b>
          {commentCount === 0 ? (
            <p className="bdw-cm__empty">{copy.commentEmpty}</p>
          ) : (
            post.comments.map((c) => (
              <BoardComment
                allLabel={copy.mentionAll}
                comment={{
                  id: c.id,
                  authorName: c.authorName,
                  authorInitial: c.authorName.charAt(0) || "·",
                  avatarColor: c.avatarColor,
                  role: c.authorRole || undefined,
                  timeLabel: hydrated ? boardRelativeTime(c.createdAt, locale) : "",
                  content: c.content,
                  imageUrls: c.imageUrls,
                  isOwn: c.isOwn,
                  canDelete: c.isOwn || canManage,
                  // 멘션 메타 — BoardCommentDetail 타입 확장 전까지는 빈 배열로 fallback
                  mentionedUsers: (c as { mentionedUsers?: { id: string; name: string }[] }).mentionedUsers ?? [],
                  mentionAll: (c as { mentionAll?: boolean }).mentionAll ?? false,
                }}
                copy={copy}
                key={c.id}
                onDelete={onDeleteComment}
                onMore={onOpenCommentMenu}
              />
            ))
          )}
        </section>
      </article>

      <BoardComposer
        copy={copy}
        disabled={!post.allowComments}
        mentionAll={mentionAll}
        mentionedUsers={mentionedUsers}
        onClearMentions={() => {
          setMentionedUsers([]);
          setMentionAll(false);
        }}
        onOpenMentionSheet={() => setShowMentionSheet(true)}
        onSubmit={onComposerSubmit}
        organizationId={organizationId}
        postId={post.id}
      />

      {/* 멘션 선택 시트 — full-screen scrim은 BottomSheet의 fixed inset-0이 상단 헤더까지 자동으로 덮음 */}
      {showMentionSheet && (
        <BoardMentionSheet
          onClose={() => setShowMentionSheet(false)}
          onConfirm={onMentionConfirm}
          initialSelection={{
            userIds: mentionedUsers.map((u) => u.id),
            mentionAll,
          }}
          copy={{
            mentionSearchPlaceholder: copy.mentionSearchPlaceholder,
            mentionAll: copy.mentionAll,
            mentionAllSubtitle: copy.mentionAllSubtitle,
            // {n} 플레이스홀더를 런타임 값으로 치환해 함수로 래핑
            mentionDone: (n: number) => copy.mentionDone.replace("{n}", String(n)),
            mentionEmpty: copy.mentionEmpty,
          }}
          searchFn={searchMentions}
        />
      )}

      {/* 더보기 액션 시트 */}
      {showActionSheet && (
        <BoardActionSheet
          onClose={() => setShowActionSheet(false)}
          isOwn={isOwn}
          canManage={canManage}
          isPinned={post.isPinned}
          copy={copy}
          onEdit={() => {
            setShowActionSheet(false);
            router.push(`/mobile/board/${post.id}/edit`);
          }}
          onPin={onPinToggle}
          onShare={onShare}
          onDelete={() => {
            setShowActionSheet(false);
            setShowDeleteConfirm(true);
          }}
          onReport={() => {
            setShowActionSheet(false);
            setReportTarget(postTarget);
          }}
          onBlock={() => {
            setShowActionSheet(false);
            setBlockTarget(postTarget);
          }}
        />
      )}

      {/* 남의 댓글 「⋯」 — 신고 · 차단만 */}
      {commentMenu && (
        <BoardActionSheet
          onClose={() => setCommentMenu(null)}
          isOwn={false}
          canManage={false}
          isPinned={false}
          showPostActions={false}
          copy={copy}
          onReport={() => {
            setReportTarget(commentMenu);
            setCommentMenu(null);
          }}
          onBlock={() => {
            setBlockTarget(commentMenu);
            setCommentMenu(null);
          }}
        />
      )}

      {reportTarget && (
        <BoardReportSheet
          targetType={reportTarget.type}
          copy={copy}
          pending={modPending}
          onClose={() => setReportTarget(null)}
          onSubmit={onSubmitReport}
        />
      )}

      {blockTarget && (
        <BoardBlockConfirm
          name={blockTarget.authorName}
          copy={copy}
          pending={modPending}
          onCancel={() => setBlockTarget(null)}
          onConfirm={onConfirmBlock}
        />
      )}

      {/* 삭제 확인 — 가운데 확인 창(의도된 BottomSheet 예외) */}
      {showDeleteConfirm ? (
        <BoardConfirm
          body={copy.deleteConfirmBody}
          cancelLabel={copy.actionCancel}
          confirmLabel={copy.deleteConfirmCta}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={onConfirmDelete}
          title={copy.deleteConfirmTitle}
        />
      ) : null}

      {toast ? (
        <div aria-live="polite" className="bdw-toast" role="status">
          <span>{toast}</span>
        </div>
      ) : null}
    </div>
  );
}
