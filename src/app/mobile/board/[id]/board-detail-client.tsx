"use client";
import { useEffect, useOptimistic, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { BoardAvatar } from "@/components/board/board-avatar";
import { BoardReactionBar } from "@/components/board/board-reaction-bar";
import { BoardComment } from "@/components/board/board-comment";
import { BoardComposer } from "@/components/board/board-composer";
import { BoardActionSheet } from "@/components/board/board-action-sheet";
import { BoardFileCard } from "@/components/board/board-file-card";
import { BoardImageGrid } from "@/components/board/board-image-grid";
import { BoardMentionSheet } from "@/components/board/board-mention-sheet";
import { BoardReportSheet, type BoardReportReasonCode } from "@/components/board/board-report-sheet";
import { BoardBlockConfirm } from "@/components/board/board-block-confirm";
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

function relativeTime(iso: string, locale: Locale): string {
  const diffSec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 7],
    ["week", 4.34524],
    ["month", 12],
    ["year", Infinity],
  ];
  let value = diffSec;
  for (const [unit, span] of units) {
    if (Math.abs(value) < span) return rtf.format(-Math.round(value), unit);
    value = value / span;
  }
  return rtf.format(-Math.round(value), "year");
}

export function BoardDetailClient({
  post,
  viewerId,
  viewerInitial,
  canManage,
  organizationId,
  locale,
  copy,
}: {
  post: BoardPostDetail;
  viewerId: string;
  viewerInitial: string;
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
      await toggleBoardReaction(post.id, emoji);
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
        // TODO: composer 에러 표시 경로 — 현재는 console에 기록하고 refresh는 생략
        console.error("[BoardDetailClient] addBoardComment error:", result.error);
        return;
      }

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
        flashToast(result.error === "already_reported" ? copy.reportAlready : copy.errSaveFailed);
        return;
      }
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

  // This page is its own scroll container (not the body), so a sheet's body-lock can't freeze it.
  // Freeze the inner scroller directly while any overlay is open so the background can't scroll behind
  // a sheet (most visible with the mention sheet's scrollable list + keyboard).
  const overlayOpen =
    showMentionSheet ||
    showActionSheet ||
    showDeleteConfirm ||
    commentMenu !== null ||
    reportTarget !== null ||
    blockTarget !== null;

  // outer wrapper: MobileShell body has its own padding (`px-5 pt-[84px] pb-8`) and is the
  // scroll container, so we cancel that padding with negative margins and stretch to its full
  // height with absolute insets. h-dvh would punch through the top chrome — using `inset-0`
  // inside the parent's `relative` keeps the detail flush with the MobileShell body.
  return (
    <div className="-mx-5 -mb-8 -mt-[84px] flex h-[100dvh] flex-col bg-background">
      {/* MobileShell chrome 84px 영역 확보.
          위 `-mt-[84px]` 은 셸의 `pt-[84px]` 을 취소하는데, **그 여백은 장식이 아니라 떠 있는
          (absolute, h-16) 상단 바를 피하는 자리**다. 취소만 하고 다시 확보하지 않으면 첫 84px 이
          상단 바 뒤로 들어간다 — 작성자 행(아바타 40 + 여백 12 ≈ 52px)이 통째로 가려져 「⋯」
          메뉴에 닿을 수 없었다(2026-08-07). 버그 신고 화면 두 곳은 처음부터 이 스페이서를 갖고
          있었고, 여기만 빠져 있었다. */}
      <div className="h-[84px] shrink-0" aria-hidden="true" />

      <div
        className={overlayOpen ? "flex-1 overflow-hidden" : "flex-1 overflow-y-auto"}
        style={overlayOpen ? { touchAction: "none", overscrollBehavior: "none" } : undefined}
      >
        <div className="px-[18px] py-[6px] pb-[18px] flex flex-col">
          {/* 작성자 헤더 */}
          <div className="flex items-center gap-[11px] py-[6px]">
            <BoardAvatar
              initial={post.authorName.charAt(0) || "·"}
              color={post.avatarColor}
              size={40}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-[6px]">
                <span className="text-[15px] font-extrabold tracking-[-0.01em]">
                  {post.authorName}
                </span>
                {post.authorRole && (
                  <span className="rounded-full bg-primary/[0.09] px-[7px] py-[1.5px] text-[11px] font-bold text-primary">
                    {post.authorRole}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[11.5px] font-semibold text-muted-foreground">
                {hydrated ? relativeTime(post.createdAt, locale) : ""}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowActionSheet(true)}
              aria-label={copy.postMore}
              className="inline-flex size-[30px] items-center justify-center rounded-[9px] text-[#9a97a6]"
            >
              <MoreHorizontal className="size-[18px]" aria-hidden="true" />
            </button>
          </div>

          {/* 제목 */}
          {post.title && (
            <h1 className="mt-4 text-[18px] font-black tracking-[-0.02em]">{post.title}</h1>
          )}

          {/* 본문 */}
          <p className="mt-[11px] whitespace-pre-line text-[14px] font-medium leading-[1.72] text-[#3a3746]">
            {post.content}
          </p>

          {/* 이미지 그리드 — 탭하면 풀스크린 라이트박스 */}
          {post.imageUrls.length > 0 && (
            <BoardImageGrid
              urls={post.imageUrls}
              viewPhotoLabel={copy.viewPhoto}
              closeLabel={copy.close}
            />
          )}

          {/* 첨부 파일 — 탭하면 서명 URL로 다운로드 (모바일·PC) */}
          {post.fileAttachments.length > 0 && (
            <div className="mt-[14px] flex flex-col gap-2">
              {post.fileAttachments.map((f) => (
                <BoardFileCard
                  key={f.url}
                  name={f.name}
                  sizeBytes={f.sizeBytes}
                  mimeType={f.mimeType}
                  downloadLabel={copy.downloadFile}
                  downloading={downloadingPath === f.url}
                  onDownload={() => onDownloadFile(f.url)}
                />
              ))}
            </div>
          )}

          {/* 태그 */}
          {post.tags.length > 0 && (
            <div className="mt-[14px] flex flex-wrap gap-[7px]">
              {post.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-primary/[0.09] px-3 py-[5px] text-[12.5px] font-bold text-primary"
                >
                  #{t}
                </span>
              ))}
            </div>
          )}

          {/* 반응 바 */}
          <BoardReactionBar reactions={reactions} onToggle={onToggleReaction} />

          {/* 반응자 얼굴 */}
          {reactionSummary && (
            <div className="mt-[13px] flex items-center">
              <div className="flex">
                {post.reactionFaces.map((face, i) => (
                  <BoardAvatar
                    key={i}
                    initial={face.initial}
                    color={face.color}
                    size={28}
                    className={i > 0 ? "-ml-2 ring-2 ring-surface" : undefined}
                  />
                ))}
              </div>
              <span className="ml-[9px] text-[11.5px] font-bold text-muted-foreground">
                {reactionSummary}
              </span>
            </div>
          )}

          {/* 구분선 */}
          <div className="my-[18px] h-px bg-border" />

          {/* 댓글 헤더 */}
          <div className="mb-1 flex items-center gap-[5px] text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
            {copy.commentLabel}{" "}
            <span className="text-primary">
              {copy.commentCountSuffix.replace("{count}", String(commentCount))}
            </span>
          </div>

          {/* 댓글 목록 */}
          {commentCount === 0 ? (
            <div className="py-[18px] text-center text-[12.5px] font-semibold text-muted-foreground">
              {copy.commentEmpty}
            </div>
          ) : (
            <div>
              {post.comments.map((c, i) => (
                <BoardComment
                  key={c.id}
                  comment={{
                    id: c.id,
                    authorName: c.authorName,
                    authorInitial: c.authorName.charAt(0) || "·",
                    avatarColor: c.avatarColor,
                    role: c.authorRole || undefined,
                    timeLabel: hydrated ? relativeTime(c.createdAt, locale) : "",
                    content: c.content,
                    imageUrls: c.imageUrls,
                    isOwn: c.isOwn,
                    canDelete: c.isOwn || canManage,
                    // 멘션 메타 — BoardCommentDetail 타입 확장 전까지는 빈 배열로 fallback
                    mentionedUsers: (c as { mentionedUsers?: { id: string; name: string }[] }).mentionedUsers ?? [],
                    mentionAll: (c as { mentionAll?: boolean }).mentionAll ?? false,
                  }}
                  isLast={i === post.comments.length - 1}
                  onDelete={onDeleteComment}
                  onMore={onOpenCommentMenu}
                  copy={copy}
                  allLabel={copy.mentionAll}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 댓글 입력바 */}
      <BoardComposer
        postId={post.id}
        organizationId={organizationId}
        myInitial={viewerInitial}
        disabled={!post.allowComments}
        copy={copy}
        mentionedUsers={mentionedUsers}
        mentionAll={mentionAll}
        onOpenMentionSheet={() => setShowMentionSheet(true)}
        onClearMentions={() => {
          setMentionedUsers([]);
          setMentionAll(false);
        }}
        onSubmit={onComposerSubmit}
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

      {/* 삭제 확인 모달 (center-aligned — 의도된 BottomSheet 예외) */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 px-8">
          <div className="w-full max-w-[320px] rounded-[22px] bg-surface p-[22px] text-center shadow-[0_24px_60px_-20px_rgba(15,23,42,0.5)]">
            <p className="text-[15.5px] font-black tracking-[-0.01em] text-foreground">
              {copy.deleteConfirmTitle}
            </p>
            <p className="mt-[7px] text-[12.5px] font-semibold leading-[1.5] text-muted-foreground">
              {copy.deleteConfirmBody}
            </p>
            <div className="mt-[18px] flex gap-[9px]">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="h-11 flex-1 rounded-[13px] border border-border bg-background text-[13.5px] font-extrabold text-[#3a3746]"
              >
                {copy.actionCancel}
              </button>
              <button
                type="button"
                onClick={onConfirmDelete}
                className="h-11 flex-1 rounded-[13px] bg-[hsl(4_72%_52%)] text-[13.5px] font-extrabold text-white"
              >
                {copy.deleteConfirmCta}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 토스트 */}
      {toast && (
        <div className="fixed inset-x-0 bottom-[88px] z-[70] flex justify-center px-6">
          <div className="rounded-full bg-foreground/92 px-[18px] py-[9px] text-[12.5px] font-bold text-white shadow-lg">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}
