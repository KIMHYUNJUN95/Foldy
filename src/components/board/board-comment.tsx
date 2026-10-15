"use client";
import Image from "next/image";
import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { ImageLightbox } from "@/components/shell/image-lightbox";
import { renderMentionContent } from "@/lib/board-mention-utils";
import type { MentionUser } from "@/lib/board-mention-utils";
import type { AvatarColor } from "@/components/board/board-types";
import type { Dictionary } from "@/lib/i18n";

export type CommentData = {
  id: string;
  authorName: string;
  authorInitial: string;
  avatarColor: AvatarColor;
  role?: string;
  timeLabel: string;
  content: string;
  imageUrls?: string[];
  isOwn?: boolean;
  // 지울 수 있는가(내 댓글 · 관리자). `isOwn` 은 «내 댓글» 표시로만 따로 둔다.
  canDelete?: boolean;
  // 멘션 메타(멘션 기능 이전 댓글에는 없다)
  mentionedUsers?: MentionUser[];
  mentionAll?: boolean;
};

/**
 * 댓글 한 줄 — 화이트 리디자인(2026-10-15, 시안 BoardPost-Phone): 회색 이니셜 · 「이름 시각」 · 본문 · 오른쪽 「⋯」(남의 댓글 —
 * 신고 · 차단). 내 댓글 · 관리자는 빨간 「삭제」 글자.
 */
export function BoardComment({
  comment,
  onDelete,
  onMore,
  copy,
  allLabel,
}: {
  comment: CommentData;
  onDelete?: (id: string) => void;
  /** 남의 댓글 「⋯」 — 신고 · 차단 메뉴를 연다(2026-10-06). */
  onMore?: (id: string) => void;
  copy: Pick<Dictionary["board"], "commentDelete" | "viewPhoto" | "close" | "commentMore">;
  allLabel: string;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const images = comment.imageUrls ?? [];

  const mentionSegments =
    comment.mentionedUsers || comment.mentionAll
      ? renderMentionContent(comment.content, comment.mentionedUsers ?? [], comment.mentionAll ?? false, allLabel)
      : null;

  return (
    <div className="bdw-c">
      <span aria-hidden="true" className="bdw-av is-sm">
        {comment.authorInitial}
      </span>
      <div className="bdw-c__b">
        <div className="bdw-c__h">
          <b>{comment.authorName}</b>
          <span>{comment.timeLabel}</span>
          {comment.canDelete && onDelete ? (
            <button className="bdw-c__del" onClick={() => onDelete(comment.id)} type="button">
              {copy.commentDelete}
            </button>
          ) : null}
        </div>
        <div className="bdw-c__t">
          {mentionSegments
            ? mentionSegments.map((seg, idx) =>
                seg.type === "text" ? (
                  <span key={idx}>{seg.text}</span>
                ) : (
                  <span className="is-at" key={idx}>
                    {seg.label}
                  </span>
                ),
              )
            : comment.content}
        </div>
        {images.length > 0 ? (
          <div className="bdw-c__pics">
            {images.map((url, index) => (
              <button
                aria-label={`${copy.viewPhoto} ${index + 1}`}
                className="bdw-c__pic"
                key={url}
                onClick={() => setOpenIndex(index)}
                type="button"
              >
                <Image alt="" fill sizes="64px" src={url} />
              </button>
            ))}
            <ImageLightbox closeLabel={copy.close} onClose={() => setOpenIndex(null)} openIndex={openIndex} urls={images} />
          </div>
        ) : null}
      </div>
      {!comment.isOwn && onMore ? (
        <button aria-label={copy.commentMore} className="bdw-icon" onClick={() => onMore(comment.id)} type="button">
          <MoreHorizontal aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
