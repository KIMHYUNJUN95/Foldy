"use client";

// 수동 컴플레인 상세 패널의 움직이는 부분 — 화이트 리디자인(2026-10-14, 시안 FBManual-PC · FBDelete-PC).
// 서버 경로는 모바일과 같다(resolve/reopen/comment/delete 모두 `src/actions/complaints.ts`) — 화면별 저장 경로를 만들지 않는다.
// 권한은 노출 판단용일 뿐이고 액션이 서버에서 다시 본다. 실패는 그 자리에 문구 + 오류 햅틱(2026-11-10).
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Trash2 } from "lucide-react";
import {
  createComplaintCommentAction,
  deleteComplaintAction,
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
  deleteFailed: string;
  /** 해결 · 다시 열기를 누른 사이 다른 사람이 먼저 바꿨을 때. */
  stale: string;
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 처리 중에도 Esc 를 여기서 멈춘다 — 그냥 두면 패널 쪽 Esc(useAdminPanelA11y)로 새어 패널이 닫힌다.
      event.stopPropagation();
      if (!pending) setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, pending]);

  function confirm() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteComplaintAction(complaintId);
      if ("error" in result) {
        // 창은 열어 둔 채 사유를 보여 준다 — 예전엔 실패해도 성공 진동 + 닫기 + 이동이었다.
        setError(labels.deleteFailed);
        haptic("error");
        return;
      }
      haptic("light");
      setOpen(false);
      router.replace(closeHref, { scroll: false });
    });
  }

  return (
    <>
      <button
        type="button"
        className="cxw-ph__del"
        aria-label={labels.deleteAction}
        title={labels.deleteAction}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
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
            {error ? (
              <p className="cxw-err" role="alert">
                {error}
              </p>
            ) : null}
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
  // 남기기 한 번당 uuid — 응답을 못 받아 다시 눌러도 처리 기록이 두 번 생기지 않는다. 성공하면 새 id(2026-11-10).
  const submissionRef = useRef<string | null>(null);

  function send() {
    const content = text.trim();
    if (!content || pending) return;
    setError(null);
    submissionRef.current ??= crypto.randomUUID();
    const submissionId = submissionRef.current;
    startTransition(async () => {
      const result = await createComplaintCommentAction(complaintId, content, [], submissionId);
      if ("error" in result) {
        setError(labels.failed);
        haptic("error");
        return;
      }
      submissionRef.current = null;
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
          onChange={(event) => {
            setText(event.target.value);
            // 글을 고치면 새 기록이다.
            submissionRef.current = null;
          }}
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
        // 그 사이 다른 사람이 먼저 바꿨으면 그렇게 말하고 지금 상태로 다시 그린다.
        setError(result.error === "stale" ? labels.stale : labels.failed);
        haptic("error");
        if (result.error === "stale") router.refresh();
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
      <button
        type="button"
        className={`cxw-btn ${open ? "is-pri" : "is-soft"}${done ? " is-done" : ""}`}
        disabled={pending}
        aria-busy={pending}
        onClick={run}
      >
        {open ? <Check className="cxw-check" aria-hidden="true" /> : null}
        {open ? labels.resolve : labels.reopen}
      </button>
    </>
  );
}
