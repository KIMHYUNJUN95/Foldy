"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Eye, MoveRight, Printer, Trash2, X } from "lucide-react";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import {
  deleteApplication,
  saveApplicationNote,
  setApplicationStatus,
} from "@/app/admin/recruit/actions";
import type { Dictionary } from "@/lib/i18n";
import type { ApplicationDetail } from "@/lib/recruit/applications";
import { nextStatusOf, prevStatusOf } from "@/lib/recruit/status";
import { haptic } from "@/lib/haptics";

/**
 * 상세 패널의 대화형 부분 — 화이트 리디자인(2026-10-14, 시안 Recruit-PC · RecruitDetail-PC · RecruitDelete-PC).
 * 연락처 한 줄(가림 토글) · 검토 메모(칸을 떠날 때 저장) · 아래 [되돌리기][다음 단계] · 위 인쇄 · 삭제(확인 창).
 * 패널 자체는 서버 컴포넌트라 여기만 클라이언트로 갈라 둔다. 도메인 계약: docs/product/30-recruit-workflow.md
 */

/** 전화번호는 뒤 4자리만 남긴다 — 목록 검색이 뒷자리로 찾고, 본인 확인 통화도 뒷자리로 대조한다. */
function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 5) return "•".repeat(value.length);
  return `•••-••••-${digits.slice(-4)}`;
}

export function RecruitContactLine({ application, copy }: { application: ApplicationDetail; copy: Dictionary["recruit"] }) {
  // 기본은 가림. 어깨너머 노출을 줄이고, 본 사람이 스스로 열게 한다.
  const [revealed, setRevealed] = useState(false);
  const hasMore = Boolean(application.kakaoId || application.address);
  return (
    <div className="rcw-contact">
      <div className="rcw-contact__row">
        <span className={`num rcw-contact__ph${revealed ? " is-open" : ""}`} key={revealed ? "o" : "m"}>
          {application.phone ? (revealed ? application.phone : maskPhone(application.phone)) : "—"}
        </span>
        {!revealed && hasMore ? <span className="rcw-contact__hint">{copy.wContactHidden}</span> : null}
        <button type="button" className="rcw-link" aria-pressed={revealed} onClick={() => setRevealed((prev) => !prev)}>
          {revealed ? copy.hideContact : copy.revealContact}
        </button>
      </div>
      {revealed && hasMore ? (
        <span className="rcw-contact__more is-open">
          {[application.kakaoId ? `${copy.labelKakao} ${application.kakaoId}` : null, application.address].filter(Boolean).join(" · ")}
        </span>
      ) : null}
    </div>
  );
}

/** 검토 메모 — 이름표 칸. 칸을 떠날 때 바뀌었으면 저장한다(따로 누르는 저장 버튼 없음). 재지원하면 이력에 그대로 뜬다. */
export function RecruitNoteField({ application, copy }: { application: ApplicationDetail; copy: Dictionary["recruit"] }) {
  const [note, setNote] = useState(application.reviewNote ?? "");
  const [saved, setSaved] = useState(application.reviewNote ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [, startTransition] = useTransition();

  function persist() {
    if (note === saved) return;
    setState("saving");
    startTransition(async () => {
      const result = await saveApplicationNote(application.id, note);
      if (result.ok) {
        setSaved(note);
        setState("saved");
      } else {
        setState("failed");
        haptic("error");
      }
    });
  }

  return (
    <div className="rcw-nf">
      <label className="rcw-nf__l" htmlFor="rcw-note">
        {copy.sectionNote}
      </label>
      <textarea
        id="rcw-note"
        name="reviewNote"
        rows={2}
        value={note}
        maxLength={2000}
        placeholder={copy.wNotePh}
        onChange={(event) => {
          setNote(event.target.value);
          if (state !== "saving") setState("idle");
        }}
        onBlur={persist}
      />
      <span className={`rcw-nf__st${state === "failed" ? " is-bad" : ""}`} role="status" aria-live="polite">
        {state === "saving" ? copy.wNoteSaving : state === "saved" ? copy.wNoteSavedShort : state === "failed" ? copy.actionFailed : ""}
      </span>
    </div>
  );
}

export function RecruitPrintIcon({ label }: { label: string }) {
  return (
    <button type="button" className="rcw-ph__ic" aria-label={label} title={label} onClick={() => window.print()}>
      <Printer aria-hidden="true" />
    </button>
  );
}

/**
 * 위 「지원서 보기」 → 가운데 큰 창에 인쇄용 A4 지원서를 그대로 띄운다(2026-10-20). 프린터가 없으면 종이 모양 지원서를
 * 볼 방법이 없었다. 종이는 서버가 그린 `ApplicationPrintSheet variant="screen"` 을 `children` 으로 받는다 — 인쇄 시트와 한 벌이다.
 * 창 안 「인쇄」는 패널의 인쇄와 같은 `window.print()`(숨은 `#rcSheet` 가 나간다). Esc · 바깥 누르기 · ✕ 로 닫고, Esc 는 패널까지 닫지 않는다.
 */
export function RecruitViewSheet({ labels, children }: { labels: { view: string; print: string; close: string }; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const trigger = triggerRef.current;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      trigger?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="rcw-ph__ic"
        aria-label={labels.view}
        title={labels.view}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Eye aria-hidden="true" />
      </button>
      {open ? (
        <>
          <div className="modal-scrim on rcw-viewer-scrim" onClick={() => setOpen(false)} />
          <div className="modal on rcw-viewer" role="dialog" aria-modal="true" aria-labelledby="rcw-view-t">
            <div className="rcw-viewer__h">
              <h2 id="rcw-view-t">{labels.view}</h2>
              <button type="button" className="rcw-btn is-soft" onClick={() => window.print()}>
                <Printer aria-hidden="true" />
                {labels.print}
              </button>
              <button ref={closeRef} type="button" className="rcw-ph__x" aria-label={labels.close} onClick={() => setOpen(false)}>
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="rcw-viewer__b">{children}</div>
          </div>
        </>
      ) : null}
    </>
  );
}

export type DeleteLabels = {
  aria: string;
  title: string;
  summary: string;
  body: string;
  warn: string;
  keep: string;
  confirm: string;
  deleted: string;
  failed: string;
};

/** 위 휴지통 → 가운데 확인 창(그대로 두기 / 삭제). 이력서 파일까지 지우는 하드 삭제라 확인을 거친다(CLAUDE.md §9). */
export function RecruitDeleteButton({ applicationId, closeHref, labels }: { applicationId: string; closeHref: string; labels: DeleteLabels }) {
  const router = useRouter();
  const { toast, showToast, dismiss } = useAdminToast();
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

  function remove() {
    startTransition(async () => {
      const result = await deleteApplication(applicationId);
      if (result.ok) {
        haptic("success");
        showToast(labels.deleted);
        setOpen(false);
        router.push(closeHref);
        return;
      }
      haptic("error");
      showToast(labels.failed);
    });
  }

  return (
    <>
      <button type="button" className="rcw-ph__ic is-danger" aria-label={labels.aria} title={labels.aria} onClick={() => setOpen(true)}>
        <Trash2 aria-hidden="true" />
      </button>
      {open ? (
        <>
          <div className="modal-scrim on" onClick={pending ? undefined : () => setOpen(false)} />
          <div className="modal on rcw-modal" role="dialog" aria-modal="true" aria-labelledby="rcw-del-t">
            <div className="rcw-modal__h">
              <h2 id="rcw-del-t">{labels.title}</h2>
              <span>{labels.summary}</span>
            </div>
            <p className="rcw-modal__b">{labels.body}</p>
            <p className="rcw-modal__b is-warn">{labels.warn}</p>
            <div className="rcw-modal__f">
              <button type="button" className="rcw-btn is-gray" disabled={pending} onClick={() => setOpen(false)}>
                {labels.keep}
              </button>
              <button type="button" className="rcw-btn is-danger" disabled={pending} onClick={remove}>
                {labels.confirm}
              </button>
            </div>
          </div>
        </>
      ) : null}
      {toast ? <AdminToast message={toast.message} onDismiss={dismiss} /> : null}
    </>
  );
}

/** 아래 고정 — [되돌리기][다음 단계]. 되돌리기는 여기(상세)에만 있고 일괄에는 없다. */
export function RecruitPanelActions({ application, copy }: { application: ApplicationDetail; copy: Dictionary["recruit"] }) {
  const { toast, showToast, dismiss } = useAdminToast();
  const [pending, startTransition] = useTransition();
  const next = nextStatusOf(application.status);
  const prev = prevStatusOf(application.status);

  function move(target: typeof next | typeof prev) {
    if (!target) return;
    startTransition(async () => {
      const result = await setApplicationStatus([application.id], target);
      showToast(result.ok ? copy.statusChanged : copy.actionFailed);
      haptic(result.ok ? "success" : "error");
    });
  }

  return (
    <div className="rcw-pf">
      <div className={`rcw-pf__btns${prev && next ? " is-two" : ""}`}>
        {prev ? (
          <button type="button" className="rcw-btn is-gray" onClick={() => move(prev)} disabled={pending}>
            {copy.revertTo[prev]}
          </button>
        ) : null}
        {next ? (
          <button type="button" className="rcw-btn is-pri" onClick={() => move(next)} disabled={pending}>
            {copy.advanceTo[next]}
            <MoveRight aria-hidden="true" />
          </button>
        ) : (
          <span className="rcw-pf__note">{copy.wLastStage}</span>
        )}
      </div>
      {toast ? <AdminToast message={toast.message} onDismiss={dismiss} /> : null}
    </div>
  );
}
