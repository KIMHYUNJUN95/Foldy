"use client";

import type { ReactNode } from "react";
import { Ban, Flag, Pencil, Pin, PinOff, Share2, Trash2 } from "lucide-react";
import { BottomSheet, useBottomSheetClose } from "@/components/shell/bottom-sheet";
import "./board-white.css";
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

/** 동작 줄 — 화이트 리디자인(2026-10-15): 상자 없는 아이콘 + 글, 가는 줄로만 나눈다. 고정은 보라, 신고 · 차단 · 삭제는 빨강. */
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
      className={variant === "primary" ? "is-violet" : variant === "danger" ? "is-red" : undefined}
      onClick={onClick}
      type="button"
    >
      {icon}
      <span>{label}</span>
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
    <div className="bdw-sheet">
      <div className="bdw-act">
        {showPostActions && isOwn && (
          <ActionRow
            icon={<Pencil strokeWidth={1.8} />}
            label={copy.actionEdit}
            onClick={onEdit ?? close}
          />
        )}
        {canPin && (
          <ActionRow
            icon={
              isPinned ? (
                <PinOff strokeWidth={1.8} />
              ) : (
                <Pin strokeWidth={1.8} />
              )
            }
            label={isPinned ? copy.actionUnpin : copy.actionPin}
            variant="primary"
            onClick={onPin ?? close}
          />
        )}
        {showPostActions && (
          <ActionRow
            icon={<Share2 strokeWidth={1.8} />}
            label={copy.actionShare}
            onClick={onShare ?? close}
          />
        )}
        {!isOwn && onReport && (
          <ActionRow
            icon={<Flag strokeWidth={1.8} />}
            label={copy.actionReport}
            variant="danger"
            onClick={onReport}
          />
        )}
        {!isOwn && onBlock && (
          <ActionRow
            icon={<Ban strokeWidth={1.8} />}
            label={copy.actionBlock}
            variant="danger"
            onClick={onBlock}
          />
        )}
        {canDelete && (
          <ActionRow
            icon={<Trash2 strokeWidth={1.8} />}
            label={copy.actionDelete}
            variant="danger"
            onClick={onDelete ?? close}
          />
        )}
      </div>
      <button className="bdw-btn is-gray" onClick={close} type="button">
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