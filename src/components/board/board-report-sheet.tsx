"use client";
import "./board-white.css";

import { useState } from "react";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { haptic } from "@/lib/haptics";
import type { Dictionary } from "@/lib/i18n";
import { boardReasonLabel, type BoardReportReasonCode } from "@/lib/board-report-reasons";

export type { BoardReportReasonCode };

export type BoardReportSheetCopy = Pick<
  Dictionary["board"],
  | "reportAskPost"
  | "reportAskComment"
  | "reportSub"
  | "reasonSpam"
  | "reasonHarassment"
  | "reasonInappropriate"
  | "reasonPrivacy"
  | "reasonOther"
  | "reportNoteLabel"
  | "reportNoteExample"
  | "reportSubmit"
>;

const REASONS: BoardReportReasonCode[] = ["spam", "harassment", "inappropriate", "privacy", "other"];

/**
 * 게시판 글 · 댓글 신고 시트 (2026-10-06, 화이트 리디자인 2026-10-15 — 시안 BoardReport-Phone).
 * 「이 글을 신고할까요?」 · 사유 하나(필수, 고르면 보라 링이 차오른다) · 이름표 메모(선택) · 보라 「신고하기」(사유를 골라야 켜진다).
 * 제출은 부모가 서버 액션으로 한다 — 앱 스토어 UGC 요건(신고 수단). 문서: docs/product/23-board-workflow.md → 「신고 · 차단」.
 */
export function BoardReportSheet({
  targetType,
  copy,
  pending,
  onClose,
  onSubmit,
}: {
  targetType: "post" | "comment";
  copy: BoardReportSheetCopy;
  pending: boolean;
  onClose: () => void;
  onSubmit: (reason: BoardReportReasonCode, note: string) => void;
}) {
  const [reason, setReason] = useState<BoardReportReasonCode | null>(null);
  const [note, setNote] = useState("");
  const title = targetType === "post" ? copy.reportAskPost : copy.reportAskComment;

  return (
    <BottomSheet ariaLabel={title} onClose={onClose}>
      <div className="bdw-sheet">
        <div>
          <h2>{title}</h2>
          <p className="bdw-sheet__sub">{copy.reportSub}</p>
        </div>
        <div aria-label={title} className="bdw-rs" role="radiogroup">
          {REASONS.map((code) => (
            <button
              aria-checked={reason === code}
              key={code}
              onClick={() => {
                if (reason !== code) haptic("light");
                setReason(code);
              }}
              role="radio"
              type="button"
            >
              <span>{boardReasonLabel(copy, code)}</span>
              <i aria-hidden="true" className="bdw-rd" />
            </button>
          ))}
        </div>
        <label className="bdw-nf">
          <span className="bdw-nf__l">{copy.reportNoteLabel}</span>
          <textarea
            className="bdw-nf__in is-ta"
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            placeholder={copy.reportNoteExample}
            rows={2}
            value={note}
          />
        </label>
        <button
          className="bdw-btn is-pri"
          disabled={!reason || pending}
          onClick={() => reason && onSubmit(reason, note)}
          type="button"
        >
          {copy.reportSubmit}
        </button>
      </div>
    </BottomSheet>
  );
}
