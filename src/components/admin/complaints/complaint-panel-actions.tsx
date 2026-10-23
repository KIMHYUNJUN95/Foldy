"use client";

// 수동 컴플레인 상세 패널의 움직이는 부분 — 화이트 리디자인(2026-10-14, 시안 FBManual-PC · FBDelete-PC).
// 서버 경로는 모바일과 같다(resolve/reopen/comment 액션, 삭제는 콘솔 액션) — 화면별 저장 경로를 만들지 않는다.
// 권한은 노출 판단용일 뿐이고 액션이 서버에서 다시 본다.
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Trash2 } from "lucide-react";
import { deleteComplaintAction } from "@/app/admin/complaints/actions";
import {
  createComplaintCommentAction,
  reopenComplaintAction,
  resolveComplaintAction,
} from "@/actions/complaints";
import { haptic } from "@/lib/haptics";

export type ComplaintActionLabels = {
  deleteAction: string;
  deleteTitle: string;
  deleteSummary: string;
  deleteBody: string;
  deleteLinked: string;
  deleteWarn: string;
  keep: string;
  confirmDelete: string;
  logPlaceholder: string;
  send: string;
  resolve: string;
  reopen: string;
  failed: string;
};

/** 패널 위 휴지통 → 가운데 확인 창(그대로 두기 / 삭제). 닫기는 「그대로 두기」 하나(Esc · 바깥 누르기도). */
export function ComplaintDeleteButton({
  complaintId,
  closeHref,
  labels,
}: {
  complaintId: string;
  closeHref: string;
  labels: ComplaintActionLabels;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        event.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, pending]);

  function confirm() {
    const form = new FormData();
    form.set("complaintId", complaintId);
    startTransition(async () => {
      await deleteComplaintAction(form);
      haptic("success");
      setOpen(false);
      router.replace(closeHref, { scroll: false });
    });
  }

  return (
    <>
      <button type="button" className="cxw-ph__del" aria-label={labels.deleteAction} title={labels.deleteAction} onClick={() => setOpen(true)}>
        <Trash2 aria-hidden="true" />
      </button>
      {open ? (
        <>
          <div className="modal-scrim on" onClick={pending ? undefined : () => setOpen(false)} />
          <div className="modal on cxw-modal" role="dialog" aria-modal="true" aria-labelledby="cxw-del-t">
            <div className="cxw-modal__h">
              <h2 id="cxw-del-t">{labels.deleteTitle}</h2>
              <span>{labels.deleteSummary}</span>
            </div>
            <p className="cxw-modal__b">
              {labels.deleteBody} {labels.deleteLinked}
            </p>
            <p className="cxw-modal__b is-warn">{labels.deleteWarn}</p>
            <div className="cxw-modal__f">
              <button type="button" className="cxw-btn is-gray" disabled={pending} onClick={() => setOpen(false)}>
                {labels.keep}
              </button>
              <button type="button" className="cxw-btn is-danger" disabled={pending} onClick={confirm}>
                {labels.confirmDelete}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

/** 처리 기록 남기기 — 글만(모바일과 같은 저장 경로). 보내면 줄이 떠오르며 붙는다(router.refresh). */
export function ComplaintComposer({ complaintId, labels }: { complaintId: string; labels: ComplaintActionLabels }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);

  function send() {
    const content = text.trim();
    if (!content || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await createComplaintCommentAction(complaintId, content, []);
      if ("error" in result) {
        setError(labels.failed);
        haptic("error");
        return;
      }
      setText("");
      haptic("light");
      router.refresh();
      ref.current?.focus();
    });
  }

  return (
    <div className="cxw-compose">
      <div className="cxw-compose__row">
        <textarea
          ref={ref}
          rows={1}
          name="content"
          autoComplete="off"
          value={text}
          aria-label={labels.logPlaceholder}
          placeholder={labels.logPlaceholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              send();
            }
          }}
        />
        <button type="button" className="cxw-send" aria-label={labels.send} disabled={!text.trim() || pending} onClick={send}>
          <ArrowRight aria-hidden="true" />
        </button>
      </div>
      {error ? (
        <p className="cxw-err" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** 패널 아래 — 미처리면 「처리 완료로 바꾸기」(체크 그리기 + 진동), 처리 완료면 「미처리로 되돌리기」. */
export function ComplaintStatusButton({
  complaintId,
  open,
  labels,
}: {
  complaintId: string;
  open: boolean;
  labels: ComplaintActionLabels;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    startTransition(async () => {
      const result = open ? await resolveComplaintAction(complaintId) : await reopenComplaintAction(complaintId);
      if ("error" in result) {
        setError(labels.failed);
        haptic("error");
        return;
      }
      if (open) {
        setDone(true);
        haptic("success");
      }
      router.refresh();
    });
  }

  return (
    <>
      {error ? (
        <p className="cxw-err" role="alert">
          {error}
        </p>
      ) : null}
      <button type="button" className={`cxw-btn ${open ? "is-pri" : "is-soft"}${done ? " is-done" : ""}`} disabled={pending} onClick={run}>
        {open ? <Check className="cxw-check" aria-hidden="true" /> : null}
        {open ? labels.resolve : labels.reopen}
      </button>
    </>
  );
}
