"use client";

import type { ReactNode } from "react";
import { Ban, Flag, Pencil, Pin, PinOff, Share2, Trash2 } from "lucide-react";
import { BottomSheet, useBottomSheetClose } from "@/components/shell/bottom-sheet";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n";

export type BoardActionSheetCopy = Pick<
  Dictionary["board"],
  | "actionEdit"
  | "actionPin"
  | "actionUnpin"
  | "actionShare"
  | "actionDelete"
  | "actionCancel"
  | "actionReport"
  | "actionBlock"
>;

type ActionVariant = "default" | "primary" | "danger";

function ActionRow({
  icon,
  label,
  variant = "default",
  onClick,
}: {
  icon: ReactNode;
  label: string;
  variant?: ActionVariant;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[54px] w-full items-center gap-[14px] border-b border-border/60 px-1 text-left last:border-0"
    >
      <span
        className={cn(
          "inline-flex size-[38px] shrink-0 items-center justify-center rounded-[11px]",
          variant === "primary" && "bg-primary/[0.12] text-primary",
          variant === "danger" &&
            "bg-[#fdecec] text-[#c5282e]",
          variant === "default" &&
            "bg-[#f4f4f7] text-[#3a3746]",
        )}
      >
        {icon}
      </span>
      <span
        className={cn(
          "text-[14.5px] font-bold",
          variant === "primary" && "text-primary",
          variant === "danger" && "text-[#c5282e]",
          variant === "default" && "text-foreground",
        )}
      >
        {label}
      </span>
    </button>
  );
}

type ActionSheetProps = {
  isOwn: boolean;
  canManage: boolean;
  isPinned: boolean;
  copy: BoardActionSheetCopy;
  /** false 면 글 전용 동작(수정 · 고정 · 공유 · 삭제)을 숨긴다 — 댓글 「⋯」 메뉴는 신고 · 차단만. */
  showPostActions?: boolean;
  onEdit?: () => void;
  onPin?: () => void;
  onShare?: () => void;
  onDelete?: () => void;
  /** 남의 글 · 댓글에만 — 앱 스토어 UGC 요건(신고 · 차단, 2026-10-06). */
  onReport?: () => void;
  onBlock?: () => void;
};

function ActionSheetContent({
  isOwn,
  canManage,
  isPinned,
  copy,
  showPostActions = true,
  onEdit,
  onPin,
  onShare,
  onDelete,
  onReport,
  onBlock,
}: ActionSheetProps) {
  const close = useBottomSheetClose();
  const canPin = showPostActions && (isOwn || canManage);
  const canDelete = showPostActions && (isOwn || canManage);

  return (
    <div className="pt-1">
      <div className="flex flex-col">
        {showPostActions && isOwn && (
          <ActionRow
            icon={<Pencil className="size-[19px]" />}
            label={copy.actionEdit}
            onClick={onEdit ?? close}
          />
        )}
        {canPin && (
          <ActionRow
            icon={
              isPinned ? (
                <PinOff className="size-[19px]" />
              ) : (
                <Pin className="size-[19px]" />
              )
            }
            label={isPinned ? copy.actionUnpin : copy.actionPin}
            variant="primary"
            onClick={onPin ?? close}
          />
        )}
        {showPostActions && (
          <ActionRow
            icon={<Share2 className="size-[19px]" />}
            label={copy.actionShare}
            onClick={onShare ?? close}
          />
        )}
        {!isOwn && onReport && (
          <ActionRow
            icon={<Flag className="size-[19px]" />}
            label={copy.actionReport}
            variant="danger"
            onClick={onReport}
          />
        )}
        {!isOwn && onBlock && (
          <ActionRow
            icon={<Ban className="size-[19px]" />}
            label={copy.actionBlock}
            variant="danger"
            onClick={onBlock}
          />
        )}
        {canDelete && (
          <ActionRow
            icon={<Trash2 className="size-[19px]" />}
            label={copy.actionDelete}
            variant="danger"
            onClick={onDelete ?? close}
          />
        )}
      </div>
      <button
        type="button"
        onClick={close}
        className="mt-[10px] h-[52px] w-full rounded-[14px] border border-border bg-background text-[14.5px] font-extrabold text-[#3a3746]"
      >
        {copy.actionCancel}
      </button>
    </div>
  );
}

export function BoardActionSheet({ onClose, ...props }: ActionSheetProps & { onClose: () => void }) {
  return (
    <BottomSheet onClose={onClose}>
      <ActionSheetContent {...props} />
    </BottomSheet>
  );
}