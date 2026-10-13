"use client";

/**
 * Attendance correction request — status read-back (frames 상태 1~4), wired to real data in Step 6.
 * Renders 요청됨 / 검토 중 / 승인 / 반려 from a real `CorrectionRequestView`. Admin approve/reject is
 * Step 7, so in practice requests are `requested` for now; the four-state rendering is kept so Step 7
 * can light up without redesign.
 * 화이트 리디자인(2026-10-13, 시안 AttCorrStatus-Phone · Fold): 상태 한 마디 + 큰 문장 → 세로 진행(요청됨 · 검토 중 ·
 * 승인/반려/철회) → 요청 내용(시각 · 현장 · 메모 · 사진) → 관리자 답변 → 다시 요청 / 근무 기록에서 보기 / 철회.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelAttendanceCorrectionRequest } from "@/app/mobile/attendance/actions";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import "./attendance.css";
import type { AttendanceCorrectionStatus } from "@/lib/attendance";
import { getDictionary } from "@/lib/i18n";

export type CorrectionRequestView = {
  id: string;
  status: AttendanceCorrectionStatus;
  /** Localised reason label (deprecated — prefer reasonKey). */
  reasonLabel: string;
  /** i18n key for reason, e.g. "reasonMissingIn". Looked up via dictionary at render time. */
  reasonKey?: string;
  sessionId: string | null;
  targetDateLabel: string | null;
  desiredClockInLabel: string | null;
  desiredClockOutLabel: string | null;
  desiredSiteName: string | null;
  memo: string | null;
  photoCount: number;
  imageUrls?: string[];
  reviewComment: string | null;
  reviewerName: string | null;
  reviewedAtLabel: string | null;
  createdAtLabel: string;
};

export function AttendanceCorrectionStatus({
  request,
  locale,
}: {
  request: CorrectionRequestView;
  locale: string;
}) {
  const copy = getDictionary(locale).attendance;
  const router = useRouter();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, startCancel] = useTransition();
  const [cancelErr, setCancelErr] = useState(false);
  // 아직 처리되지 않은 요청만 철회할 수 있다(서버가 같은 조건으로 다시 막는다).
  const canCancel = request.status === "requested" || request.status === "in_review";
  const runCancel = () =>
    startCancel(async () => {
      const r = await cancelAttendanceCorrectionRequest(request.id);
      setConfirmCancel(false);
      if (r.ok) router.refresh();
      else setCancelErr(true);
    });

  const editHref = request.sessionId
    ? `/mobile/attendance/correction?sessionId=${request.sessionId}`
    : "/mobile/attendance/correction";
  const st = request.status;
  const done = st === "approved" || st === "rejected" || st === "cancelled";
  const stateLabel =
    st === "requested" ? copy.stepRequested : st === "in_review" ? copy.stepInReview : st === "approved" ? copy.stepApproved : st === "rejected" ? copy.stepRejected : copy.stepCancelled;
  const headline =
    st === "requested"
      ? copy.corrHeadRequested
      : st === "in_review"
        ? copy.corrHeadInReview
        : st === "approved"
          ? copy.corrHeadApproved
          : st === "rejected"
            ? copy.corrHeadRejected
            : copy.corrHeadCancelled;
  const reasonText = request.reasonKey
    ? ((copy[request.reasonKey as keyof typeof copy] as string | undefined) ?? request.reasonLabel)
    : request.reasonLabel;
  const reviewedBits = [request.reviewedAtLabel, request.reviewerName].filter(Boolean).join(" · ");
  const steps: { label: string; sub: string; on: boolean; tone?: "danger" }[] = [
    { label: copy.stepRequested, sub: request.createdAtLabel, on: true },
    { label: copy.stepInReview, sub: "", on: st !== "requested" && st !== "cancelled" },
    {
      label: st === "rejected" ? copy.stepRejected : st === "cancelled" ? copy.stepCancelled : copy.stepApproved,
      sub: done ? reviewedBits : copy.corrStepAfterReview,
      on: done,
      tone: st === "rejected" ? "danger" : undefined,
    },
  ];
  const photos = request.imageUrls ?? [];

  return (
    <div className="att att--corrst">
      <div className="ptitle-row">
        <div>
          <h1 className="ptitle">{copy.corrStatusTitle}</h1>
          <div className="ptitle__sub">
            {request.targetDateLabel ?? copy.corrStatusSubException} · {reasonText}
          </div>
        </div>
      </div>

      <div className="corrst-head">
        <span className={`corrst-head__k is-${st}`}>{stateLabel}</span>
        <b>{headline}</b>
      </div>

      <ol className="corrst-steps">
        {steps.map((x) => (
          <li key={x.label} className={`${x.on ? "is-on" : ""}${x.tone ? ` is-${x.tone}` : ""}`}>
            <i aria-hidden="true" />
            <div>
              <b>{x.label}</b>
              {x.sub ? <span>{x.sub}</span> : null}
            </div>
          </li>
        ))}
      </ol>

      <dl className="corrst-dl">
        <dt>{copy.corrRowRequested}</dt>
        <dd className="mono">
          {request.desiredClockInLabel ?? "—"} → {request.desiredClockOutLabel ?? "—"}
        </dd>
        <dt>{copy.corrDetailSite}</dt>
        <dd>{request.desiredSiteName ?? copy.corrSiteNone}</dd>
        {request.memo ? (
          <>
            <dt>{copy.corrDetailMemo}</dt>
            <dd>{request.memo}</dd>
          </>
        ) : null}
        {photos.length > 0 ? (
          <>
            <dt className="is-mid">{copy.corrRowPhotos}</dt>
            <dd className="corrst-photos">
              {photos.map((u) => (
                <a key={u} href={u} target="_blank" rel="noreferrer" style={{ backgroundImage: `url(${u})` }} aria-label={copy.corrRowPhotos} />
              ))}
            </dd>
          </>
        ) : null}
      </dl>

      {request.reviewComment && (st === "approved" || st === "rejected") ? (
        <div className="corrst-reply">
          <span>{[copy.corrReplyLabel, request.reviewerName, request.reviewedAtLabel].filter(Boolean).join(" · ")}</span>
          <p>{request.reviewComment}</p>
        </div>
      ) : null}

      <div className="corrst-actions">
        {st === "approved" ? (
          <Link href="/mobile/attendance/history" className="corrst-link">
            {copy.corrViewInHistory} ›
          </Link>
        ) : null}
        {st === "requested" || st === "rejected" ? (
          <Link href={editHref} className="corrst-link">
            {copy.corrResend} ›
          </Link>
        ) : null}
        {/* 철회 — 대기 중인 요청에만. 예전에는 잘못 낸 요청을 거둘 방법이 없어, 관리자가 반려해 줄
            때까지 대기 큐에 남고 그 달 근태 마감까지 막혔다(2026-08-03). */}
        {canCancel ? (
          <>
            {cancelErr ? <div className="ferr">{copy.corrCancelFailed}</div> : null}
            <button
              className="corrst-cancel"
              disabled={cancelling}
              onClick={() => {
                setCancelErr(false);
                setConfirmCancel(true);
              }}
              type="button"
            >
              {copy.corrCancel}
            </button>
          </>
        ) : null}
      </div>

      {confirmCancel ? (
        <BottomSheet ariaLabel={copy.corrCancelConfirmTitle} onClose={() => setConfirmCancel(false)}>
          <div className="px-1 pb-1">
            <p className="text-[16px] font-extrabold tracking-[-0.01em] text-foreground">
              {copy.corrCancelConfirmTitle}
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              {copy.corrCancelConfirmBody}
            </p>
            <div className="mt-5 flex gap-2.5">
              <button
                className="h-12 flex-1 rounded-2xl border border-border bg-surface text-[14px] font-bold text-foreground"
                onClick={() => setConfirmCancel(false)}
                type="button"
              >
                {copy.corrCancelKeep}
              </button>
              <button
                className="h-12 flex-1 rounded-2xl bg-rose-600 text-[14px] font-extrabold text-white transition-opacity disabled:opacity-50"
                disabled={cancelling}
                onClick={runCancel}
                type="button"
              >
                {copy.corrCancel}
              </button>
            </div>
          </div>
        </BottomSheet>
      ) : null}

    </div>
  );
}
