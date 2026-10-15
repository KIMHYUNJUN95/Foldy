"use client";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { haptic } from "@/lib/haptics";
import { toggleBoardReaction } from "@/app/mobile/board/[id]/actions";
import { BoardReactionBar, toggleReactionIn } from "./board-reaction-bar";
import type { BoardPost, BoardReaction } from "./board-types";

export type BoardFeedRowCopy = {
  pinnedBadge: string;
  unreadAria: string;
  reactionAdd: string;
  feedFiles: string;
  commentsN: string;
};

/**
 * 피드 글 한 줄 — 화이트 리디자인(2026-10-15, 시안 Board-Phone). 카드 없이 가는 줄로만 나눈다.
 * 위쪽(작성자 · 제목 · 본문 두 줄 · 사진 띠)은 상세로 가는 링크, 아래 반응 칩은 그 자리에서 누른다(링크 안에 버튼을 넣지
 * 않으려고 둘을 나눴다). 태블릿 2분할의 고른 줄 표시는 링크의 `data-split-active` 를 `:has()` 로 줄 전체 바탕에 옮긴다.
 *
 * 반응은 낙관적으로 바로 바꾸고 서버 액션을 부른다. 액션이 `/mobile/board` 를 재검증하므로 새 props 가 오면 그 값이
 * 기준이 된다(`base` 가 바뀌면 덮어쓴 값은 버린다). 「더 보기」로 붙인 글은 props 가 다시 오지 않아 덮어쓴 값이 남는다 — 그게 맞는 값이다.
 */
export function BoardListRow({
  post,
  metaLine,
  isUnread,
  copy,
  onOpen,
}: {
  post: BoardPost;
  metaLine: string;
  isUnread: boolean;
  copy: BoardFeedRowCopy;
  onOpen: () => void;
}) {
  const href = `/mobile/board/${post.id}`;
  const [override, setOverride] = useState<{ base: BoardReaction[]; value: BoardReaction[] } | null>(null);
  const reactions = override && override.base === post.reactions ? override.value : post.reactions;

  async function onToggle(emoji: string) {
    const base = post.reactions;
    setOverride({ base, value: toggleReactionIn(reactions, emoji) });
    try {
      const result = await toggleBoardReaction(post.id, emoji);
      if ("error" in result) {
        setOverride(null);
        haptic("error");
      }
    } catch {
      setOverride(null);
      haptic("error");
    }
  }

  const photos = post.imageUrls.slice(0, 3);
  const hiddenPhotos = post.imageUrls.length - photos.length;
  const metaParts = [
    post.category ? `#${post.category}` : null,
    post.fileAttachments.length > 0 ? copy.feedFiles.replace("{n}", String(post.fileAttachments.length)) : null,
    copy.commentsN.replace("{n}", String(post.commentCount)),
  ].filter(Boolean);

  return (
    <article className={`bdw-row${isUnread ? " is-unread" : ""}`} data-post-id={post.id}>
      <Link className="bdw-row__link" href={href} onClick={onOpen}>
        <span className="bdw-who">
          <span aria-hidden="true" className="bdw-av">
            {post.authorName.charAt(0) || "·"}
          </span>
          <span className="bdw-who__b">
            <span className="bdw-who__n">{post.authorName}</span>
            <span className="bdw-who__m">{metaLine}</span>
          </span>
          <span aria-label={isUnread ? copy.unreadAria : undefined} className="bdw-dot" role={isUnread ? "img" : undefined} />
        </span>
        {post.isPinned ? <span className="bdw-pin">{copy.pinnedBadge}</span> : null}
        {post.title ? (
          <>
            <span className="bdw-title">{post.title}</span>
            {post.content ? <p className="bdw-body">{post.content}</p> : null}
          </>
        ) : (
          <span className="bdw-title is-solo">{post.content}</span>
        )}
        {photos.length > 0 ? (
          <span className="bdw-strip">
            {photos.map((url, i) => (
              <span className="bdw-ph" key={url}>
                <Image alt="" fill sizes="(min-width: 1000px) 120px, 30vw" src={url} />
                {i === photos.length - 1 && hiddenPhotos > 0 ? <b className="bdw-ph__more">+{hiddenPhotos}</b> : null}
              </span>
            ))}
          </span>
        ) : null}
      </Link>
      <BoardReactionBar
        addLabel={copy.reactionAdd}
        onToggle={onToggle}
        reactions={reactions}
        trailing={
          <Link aria-hidden="true" className="bdw-foot__meta" href={href} onClick={onOpen} tabIndex={-1}>
            {metaParts.join(" · ")}
          </Link>
        }
      />
    </article>
  );
}
