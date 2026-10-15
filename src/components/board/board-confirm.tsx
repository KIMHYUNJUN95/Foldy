"use client";

import "./board-white.css";

/**
 * 게시판 가운데 확인 창(글 · 댓글 삭제 · 사용자 차단 · 신고 처리 삭제) — 되돌릴 수 없는 일에만. 의도된 BottomSheet 예외.
 * 화이트 리디자인(2026-10-15): 흰 카드 · 회색 「취소」 + 빨간 확인, 살짝 커지며 나타난다.
 */
export function BoardConfirm({
  title,
  body,
  cancelLabel,
  confirmLabel,
  pending = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  cancelLabel: string;
  confirmLabel: string;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div aria-label={title} aria-modal="true" className="bdw-cf" role="dialog">
      <div className="bdw-cf__card">
        <p>{title}</p>
        <span>{body}</span>
        <div className="bdw-cf__btns">
          <button className="bdw-btn is-gray" onClick={onCancel} type="button">
            {cancelLabel}
          </button>
          <button className="bdw-btn is-red" disabled={pending} onClick={onConfirm} type="button">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
