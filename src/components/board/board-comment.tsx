"use client";
import Image from "next/image";
import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { BoardAvatar } from "@/components/board/board-avatar";
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
  reaction?: { emoji: string; count: number };
  isOwn?: boolean;
  // Whether the viewer may delete this comment (own comment OR a manager). Kept separate from `isOwn`
  // so `isOwn` stays a true "this is my comment" flag for future own-comment UI.
  canDelete?: boolean;
  // Mention metadata (optional — comments written before mention feature have none)
  mentionedUsers?: MentionUser[];
  mentionAll?: boolean;
};

export function BoardComment({
  comment,
  isLast = false,
  onDelete,
  onMore,
  copy,
  allLabel,
}: {
  comment: CommentData;
  isLast?: boolean;
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
      ? renderMentionContent(
          comment.content,
          comment.mentionedUsers ?? [],
          comment.mentionAll ?? false,
          allLabel,
        )
      : null;
  return (
    <div
      className={`flex gap-[10px] py-[13px] ${!isLast ? "border-b border-border/60" : ""}`}
    >
      <BoardAvatar
        initial={comment.authorInitial}
        color={comment.avatarColor}
        size={32}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-[7px]">
          <span className="text-[13px] font-extrabold tracking-[-0.01em]">
            {comment.authorName}
          </span>
          {comment.role && (
            <span className="rounded-full bg-primary/[0.09] px-[6px] py-[1px] text-[10px] font-bold text-primary">
              {comment.role}
            </span>
          )}
          <span className="text-[11px] font-semibold text-[#9a97a6]">
            {comment.timeLabel}
          </span>
          {comment.canDelete && onDelete && (
            <button
              type="button"
              onClick={() => onDelete(comment.id)}
              className="ml-auto text-[11px] font-extrabold text-[#c5282e] px-1 py-0.5"
            >
              {copy.commentDelete}
            </button>
          )}
          {!comment.isOwn && onMore && (
            <button
              type="button"
              onClick={() => onMore(comment.id)}
              aria-label={copy.commentMore}
              className={`${comment.canDelete && onDelete ? "" : "ml-auto "}inline-flex size-[24px] items-center justify-center rounded-[7px] text-[#9a97a6]`}
            >
              <MoreHorizontal className="size-[15px]" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="mt-[3px] text-[13px] font-medium leading-[1.6] text-[#3a3746]">
          {mentionSegments
            ? mentionSegments.map((seg, idx) =>
                seg.type === "text" ? (
                  <span key={idx}>{seg.text}</span>
                ) : seg.userId === "ALL" ? (
                  // @ALL — 더 강조된 배지 스타일
                  <span
                    key={idx}
                    className="inline-flex items-center rounded-[6px] bg-primary/[0.09] px-[6px] py-[1px] font-extrabold text-primary"
                  >
                    {seg.label}
                  </span>
                ) : (
                  // 일반 멘션 — 인라인 네이비 볼드
                  <span key={idx} className="font-bold text-primary">
                    {seg.label}
                  </span>
                ),
              )
            : comment.content}
        </div>
        {images.length > 0 && (
          <div className="mt-[9px] flex flex-wrap gap-[6px]">
            {images.map((url, index) => (
              <button
                key={url}
                type="button"
                onClick={() => setOpenIndex(index)}
                aria-label={`${copy.viewPhoto} ${index + 1}`}
                className="group relative size-[64px] overflow-hidden rounded-[9px] border border-border bg-[hsl(40_22%_92%)]"
              >
                <Image
                  src={url}
                  alt=""
                  fill
                  sizes="64px"
                  className="object-cover transition-transform duration-300 group-active:scale-[1.05]"
                />
              </button>
            ))}
            <ImageLightbox
              urls={images}
              openIndex={openIndex}
              onClose={() => setOpenIndex(null)}
              closeLabel={copy.close}
            />
          </div>
        )}
        {comment.reaction && (
          <span className="mt-[9px] inline-flex items-center gap-[5px] h-[26px] rounded-full border border-border bg-background px-[9px] text-[11.5px] font-extrabold text-[#3a3746]">
            <span className="text-[13px] leading-none">{comment.reaction.emoji}</span>
            {comment.reaction.count}
          </span>
        )}
      </div>
    </div>
  );
}
