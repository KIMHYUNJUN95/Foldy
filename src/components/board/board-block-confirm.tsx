"use client";

import type { Dictionary } from "@/lib/i18n";
import { BoardConfirm } from "./board-confirm";

/** 사용자 차단 확인 — 게시판 가운데 확인 창(의도된 BottomSheet 예외). */
export function BoardBlockConfirm({
  name,
  copy,
  pending,
  onCancel,
  onConfirm,
}: {
  name: string;
  copy: Pick<Dictionary["board"], "blockConfirmTitle" | "blockConfirmBody" | "blockConfirmCta" | "actionCancel">;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <BoardConfirm
      body={copy.blockConfirmBody}
      cancelLabel={copy.actionCancel}
      confirmLabel={copy.blockConfirmCta}
      onCancel={onCancel}
      onConfirm={onConfirm}
      pending={pending}
      title={copy.blockConfirmTitle.replace("{name}", name || "·")}
    />
  );
}
