"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Ban, CheckCircle2, Clock3, Edit3, Package, Timer, Wrench } from "lucide-react";
import { cancelCleaningSession, completeCleaningSession } from "@/app/mobile/cleaning/actions";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { haptic } from "@/lib/haptics";

type CleaningCompletionPanelProps = {
  labels: {
    cancelCleaning: string;
    cancelCleaningMessage: string;
    cancelCleaningTitle: string;
    cancelCompletion: string;
    completedToday: string;
    confirmCancelCleaning: string;
    confirmCompletion: string;
    completionConfirmation: string;
    elapsed: string;
    notesLabel: string;
    notesPlaceholder: string;
    reviewCompletion: string;
    room: string;
    startedAt: string;
    task: string;
    cleaningNow: string;
    finishCleaning: string;
    lostShort: string;
    issueShort: string;
  };
  /** 링 아래 한 줄 — 「오쿠보 A · 체크아웃 청소 · 10:20 시작」 */
  metaLine: string;
  lostHref: string;
  maintenanceHref: string;
  roomLabel: string;
  sessionId: string;
  startedAt: string;
  startedAtLabel: string;
  taskLabel: string;
};

function formatElapsed(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function CleaningCompletionPanel({
  labels,
  metaLine,
  lostHref,
  maintenanceHref,
  roomLabel,
  sessionId,
  startedAt,
  startedAtLabel,
  taskLabel,
}: CleaningCompletionPanelProps) {
  const [elapsed, setElapsed] = useState(0);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isCancelConfirming, setIsCancelConfirming] = useState(false);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    const started = new Date(startedAt).getTime();

    function updateElapsed() {
      setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    }

    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const elapsedLabel = formatElapsed(elapsed);

  // 링은 한 시간에 한 바퀴 — 시안(2026-10-13). 숫자는 그대로 경과 시간.
  const RING = 2 * Math.PI * 88;
  const ringFill = ((elapsed % 3600) / 3600) * RING;

  return (
    <>
      {/* 화이트 리디자인(2026-10-13): 링 타이머 · 객실 · 한 줄 메타 · 꽉 찬 「청소 완료」 · 분실물 · 문제 신고 · 청소 취소.
          태블릿에서는 링이 왼쪽, 버튼이 오른쪽(cleaning-screen.css). */}
      <div
        className={`cln-active__grid${
          isConfirming || isCancelConfirming ? " pointer-events-none opacity-0 transition-all duration-200" : " transition-all duration-300"
        }`}
      >
        <div className="cln-active__ringwrap">
          <div className="cln-ring">
            <svg aria-hidden="true" viewBox="0 0 200 200">
              <circle cx="100" cy="100" fill="none" r="88" stroke="#ede7fc" strokeWidth="12" />
              <circle
                cx="100"
                cy="100"
                fill="none"
                r="88"
                stroke="#7a52e6"
                strokeDasharray={`${ringFill} ${RING}`}
                strokeLinecap="round"
                strokeWidth="12"
                transform="rotate(-90 100 100)"
              />
            </svg>
            <div className="cln-ring__in">
              <span className="cln-ring__lbl">
                <i aria-hidden="true" />
                {labels.cleaningNow}
              </span>
              <span className="cln-ring__time">{elapsedLabel}</span>
            </div>
          </div>
          <p className="cln-active__room">{roomLabel}</p>
          <p className="cln-active__meta">{metaLine}</p>
        </div>
        <div className="cln-active__acts">
          <button className="cln-btn cln-btn--pri" onClick={() => setIsConfirming(true)} type="button">
            {labels.finishCleaning}
          </button>
          <div className="cln-active__row">
            <Link className="cln-btn cln-btn--soft" href={lostHref}>
              <Package aria-hidden="true" />
              {labels.lostShort}
            </Link>
            <Link className="cln-btn cln-btn--soft" href={maintenanceHref}>
              <Wrench aria-hidden="true" />
              {labels.issueShort}
            </Link>
            <button className="cln-btn cln-btn--soft is-muted" onClick={() => setIsCancelConfirming(true)} type="button">
              {labels.cancelCleaning}
            </button>
          </div>
        </div>
      </div>

      {isConfirming ? (
        <BottomSheet
          ariaLabel={labels.completionConfirmation}
          header={
            <>
              <div className="flex justify-center">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-[#f1ecfd] text-primary">
                  <CheckCircle2 className="size-6" aria-hidden="true" />
                </div>
              </div>

              <div className="mt-3 text-center">
                <h2 className="text-2xl font-black">
                  {labels.completionConfirmation}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{labels.reviewCompletion}</p>
              </div>
            </>
          }
          onClose={() => setIsConfirming(false)}
        >
          {({ close }) => (
            <>
              <div className="mt-4 rounded-2xl bg-[#f7f7f9] p-4">
                <div className="min-w-0">
                  <p className="text-lg font-black leading-tight">{labels.room} {roomLabel}</p>
                  <p className="mt-0.5 text-xs font-semibold text-muted-foreground">{taskLabel}</p>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl bg-white p-3">
                    <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      <Clock3 className="size-3.5" aria-hidden="true" />
                      {labels.startedAt}
                    </dt>
                    <dd className="mt-1 font-black">{startedAtLabel}</dd>
                  </div>
                  <div className="rounded-xl bg-white p-3">
                    <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      <Timer className="size-3.5" aria-hidden="true" />
                      {labels.elapsed}
                    </dt>
                    <dd className="mt-1 font-mono font-black text-primary">{elapsedLabel}</dd>
                  </div>
                </dl>
              </div>

              <label className="mt-4 block space-y-2">
                <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{labels.notesLabel}</span>
                <div className="relative">
                  <Edit3 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <input
                    className="h-11 w-full rounded-xl border border-border bg-surface pl-10 pr-3 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder={labels.notesPlaceholder}
                    type="text"
                    value={notes}
                  />
                </div>
              </label>

              <form action={completeCleaningSession} className="mt-4 space-y-2" onSubmit={() => haptic("success")}>
                <input name="sessionId" type="hidden" value={sessionId} />
                <input name="notes" type="hidden" value={notes} />
                <SubmitButton autoFocus className="h-12 w-full rounded-xl bg-primary font-black text-white shadow-[0_10px_28px_hsl(var(--primary-hsl)/0.28)] hover:bg-primary/90">
                  {labels.confirmCompletion}
                </SubmitButton>
                <Button
                  className="h-12 w-full rounded-xl border-0 bg-[#f4f4f7] font-bold"
                  onClick={close}
                  type="button"
                  variant="secondary"
                >
                  {labels.cancelCompletion}
                </Button>
              </form>
            </>
          )}
        </BottomSheet>
      ) : null}

      {isCancelConfirming ? (
        <BottomSheet
          ariaLabel={labels.cancelCleaningTitle}
          header={
            <>
              <div className="flex justify-center">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
                  <Ban className="size-6" aria-hidden="true" />
                </div>
              </div>

              <div className="mt-3 text-center">
                <h2 className="text-2xl font-black">
                  {labels.cancelCleaningTitle}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{labels.cancelCleaningMessage}</p>
              </div>
            </>
          }
          onClose={() => setIsCancelConfirming(false)}
        >
          {({ close }) => (
            <>
              <div className="mt-4 rounded-2xl bg-[#f7f7f9] p-4">
                <div className="min-w-0">
                  <p className="text-lg font-black leading-tight">{labels.room} {roomLabel}</p>
                  <p className="mt-0.5 text-xs font-semibold text-muted-foreground">{taskLabel}</p>
                </div>
                <div className="mt-3 rounded-xl bg-white p-3">
                  <dt className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                    <Clock3 className="size-3.5" aria-hidden="true" />
                    {labels.startedAt}
                  </dt>
                  <dd className="mt-1 font-black">{startedAtLabel}</dd>
                </div>
              </div>

              <form action={cancelCleaningSession} className="mt-4 space-y-2">
                <input name="sessionId" type="hidden" value={sessionId} />
                <Button
                  autoFocus
                  className="h-12 w-full rounded-xl bg-destructive font-black text-white hover:bg-destructive/90"
                  type="submit"
                >
                  {labels.confirmCancelCleaning}
                </Button>
                <Button
                  className="h-12 w-full rounded-xl border-0 bg-[#f4f4f7] font-bold"
                  onClick={close}
                  type="button"
                  variant="secondary"
                >
                  {labels.cancelCompletion}
                </Button>
              </form>
            </>
          )}
        </BottomSheet>
      ) : null}
    </>
  );
}
