"use client";

/**
 * 직원 건의 — 댓글 한 줄(Step 5).
 * 스레드 댓글을 확정된 `.cmt` 스타일로 그리고, 현재 사용자 본인 댓글에 가장 작은 수정/삭제
 * 기능을 더한다(작성자 전용, 건의 상태와 무관).
 * 수정은 인라인 텍스트(기존 사진은 유지), 삭제는 2단계 인라인 확인.
 */

import { useState, useTransition } from "react";
import {
  deleteStaffSuggestionComment,
  updateStaffSuggestionComment,
} from "@/app/mobile/suggestions/actions";
import type { Dictionary, Locale } from "@/lib/i18n";
import type { SuggestionComment, SuggestionViewerRole } from "@/lib/suggestions-queries";
import { Ic, SgIcon } from "./sg-icons";
import { haptic } from "@/lib/haptics";

const ROLE_CLS: Record<SuggestionViewerRole, string> = {
  author: "role-author",
  recipient: "role-recip",
  referenced: "role-ref",
};

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

const linkBtn: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 700,
  color: "var(--faint)",
  padding: "0 2px",
};

export function SuggestionCommentItem({
  comment,
  isOwn,
  locale,
  hydrated,
  copy,
}: {
  comment: SuggestionComment;
  isOwn: boolean;
  locale: Locale;
  hydrated: boolean;
  copy: Dictionary["mobile"]["suggestions"];
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(comment.body ?? "");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const roleLabel = {
    author: copy.roleAuthor,
    recipient: copy.roleRecipient,
    referenced: copy.roleReference,
  }[comment.authorRole];
  const canSaveEdit = (editText.trim().length > 0 || comment.imageUrls.length > 0) && !isPending;

  function saveEdit() {
    if (!canSaveEdit) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("commentId", comment.id);
      fd.set("body", editText.trim());
      // 텍스트 수정 시 댓글의 기존 사진을 유지한다.
      for (const url of comment.imageUrls) fd.append("imageUrls", url);
      const result = await updateStaffSuggestionComment(fd);
      if (!result.ok) {
        haptic("error");
        setError(copy.errors.save_failed);
        return;
      }
      haptic("success");
      setEditing(false);
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("commentId", comment.id);
      const result = await deleteStaffSuggestionComment(fd);
      if (!result.ok) {
        haptic("error");
        setError(copy.errors.save_failed);
        return;
      }
    });
  }

  return (
    <div className="cmt">
      <span
        className="cmt__av"
        style={
          comment.authorRole === "recipient"
            ? { background: "var(--sg-primary)", color: "#fff" }
            : undefined
        }
      >
        {(comment.authorName || "—").slice(0, 1)}
      </span>
      <div className="cmt__b">
        <div className="cmt__h">
          <span className="cmt__n">{comment.authorName || "—"}</span>
          <span className={`role-pill ${ROLE_CLS[comment.authorRole]}`}>{roleLabel}</span>
          <span className="cmt__t">{hydrated ? relativeTime(comment.createdAt, locale) : ""}</span>
        </div>

        {editing ? (
          <div>
            <textarea
              className="inp"
              rows={2}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              placeholder={copy.commentEditPlaceholder}
            />
            <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
              <button
                type="button"
                style={{ ...linkBtn, color: "var(--sg-muted)" }}
                onClick={() => {
                  setEditing(false);
                  setEditText(comment.body ?? "");
                }}
              >{copy.cancel}</button>
              <button
                type="button"
                style={{ ...linkBtn, color: "var(--sg-primary)", opacity: canSaveEdit ? 1 : 0.5 }}
                onClick={saveEdit}
                disabled={!canSaveEdit}
              >{copy.save}</button>
            </div>
          </div>
        ) : (
          <>
            {comment.body ? <div className="cmt__body">{comment.body}</div> : null}
            {comment.imageCount ? (
              <span className="cmt__photo">
                <Ic>{SgIcon.image}</Ic>
                {copy.photoCount.replace("{n}", String(comment.imageCount))}
              </span>
            ) : null}
            {isOwn ? (
              confirming ? (
                <div style={{ display: "flex", gap: "8px", marginTop: "4px", alignItems: "center" }}>
                  <span style={{ fontSize: "11px", color: "var(--faint)" }}>{copy.deletePrompt}</span>
                  <button
                    type="button"
                    style={{ ...linkBtn, color: "#c0392b" }}
                    onClick={remove}
                    disabled={isPending}
                  >{copy.delete}</button>
                  <button type="button" style={linkBtn} onClick={() => setConfirming(false)}>{copy.cancel}</button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
                  <button type="button" style={linkBtn} onClick={() => setEditing(true)}>{copy.edit}</button>
                  <button type="button" style={linkBtn} onClick={() => setConfirming(true)}>{copy.delete}</button>
                </div>
              )
            ) : null}
          </>
        )}

        {error ? (
          <p role="alert" style={{ fontSize: "11px", color: "#c0392b", marginTop: "4px" }}>
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
