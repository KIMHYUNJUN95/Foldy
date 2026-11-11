"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteInviteCode } from "@/app/admin/settings/actions";

type InviteDeleteButtonProps = {
  inviteCodeId: string;
  organizationId: string;
  labels: { aria: string; title: string; summary: string; body: string; keep: string; confirm: string };
};

/**
 * 초대코드 삭제 — 화이트 리디자인(2026-10-14): 휴지통 아이콘 → 가운데 확인 창(그대로 두기 / 삭제).
 * 하드 삭제지만 이미 가입한 멤버의 멤버십은 그대로 남는다.
 */
export function InviteDeleteButton({ inviteCodeId, organizationId, labels }: InviteDeleteButtonProps) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    keepRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button type="button" className="usi-ib is-danger" aria-label={labels.aria} title={labels.aria} onClick={() => setOpen(true)}>
        <Trash2 aria-hidden="true" />
      </button>
      {open ? (
        <>
          <div className="modal-scrim on usw-scrim" onClick={sending ? undefined : () => setOpen(false)} />
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (sending) return;
              const data = new FormData(event.currentTarget);
              setSending(true);
              try {
                // 성공 · 실패 모두 서버가 목록으로 되돌리고(redirect) 결과 줄을 띄운다. 던져도 창이 잠기지 않게 finally 로 푼다.
                await deleteInviteCode(data);
              } catch {
                /* 네트워크 실패 — 창을 닫고 목록이 그대로 남는다 */
              } finally {
                setSending(false);
                setOpen(false);
              }
            }}
            className="modal on usw-modal" role="dialog" aria-modal="true" aria-labelledby={`usi-del-${inviteCodeId}`}>
            <input name="inviteCodeId" type="hidden" value={inviteCodeId} />
            <input name="organizationId" type="hidden" value={organizationId} />
            <div className="usw-modal__h">
              <h2 id={`usi-del-${inviteCodeId}`}>{labels.title}</h2>
              <span>{labels.summary}</span>
            </div>
            <p className="usw-modal__b">{labels.body}</p>
            <div className="usw-modal__f">
              <button ref={keepRef} type="button" className="usw-btn is-gray" disabled={sending} onClick={() => setOpen(false)}>
                {labels.keep}
              </button>
              <button type="submit" className="usw-btn is-danger" disabled={sending}>
                {labels.confirm}
              </button>
            </div>
          </form>
        </>
      ) : null}
    </>
  );
}
