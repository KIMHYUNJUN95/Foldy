"use client";

/**
 * 한 예약의 자동 안내 목록 — PC 대화 오른쪽 패널(멈추기 · 다시 보내기) · 모바일 예약 정보 시트(읽기만). 시안 R2Main 「보낼 자동 안내 순서」.
 * docs/product/47-guest-messaging.md §5-1 · §5-6. 멈추기 액션은 부르는 쪽이 넘긴다(모바일은 넘기지 않음 — 규칙 · 멈춤은 PC 전용).
 */

import Link from "next/link";
import { autoRunStatusText, formatAutoAt } from "@/components/guest-messages/auto-format";
import { fill, type GmCopy } from "@/components/guest-messages/gm-format";
import { canPauseAutoRun, canResumeAutoRun, type AutoRunView } from "@/lib/guest-messages/auto-model";

export function AutoRunsList({
  runs,
  copy,
  locale,
  guestName,
  onPause,
  busyId = null,
  manageHref = null,
}: {
  runs: AutoRunView[];
  copy: GmCopy;
  locale: string;
  guestName: string | null;
  onPause?: (run: AutoRunView, paused: boolean) => void;
  busyId?: string | null;
  manageHref?: string | null;
}) {
  return (
    <section className="gm-aruns" aria-label={copy.autoPanelTitle}>
      <div className="gm-aruns__head">
        <h3 className="gm-aruns__title">{copy.autoPanelTitle}</h3>
        {manageHref ? (
          <Link className="gm-link gm-aruns__manage" href={manageHref}>
            {copy.autoPanelManage}
          </Link>
        ) : null}
      </div>
      {runs.length === 0 ? <p className="gm-hint">{copy.autoPanelEmpty}</p> : null}
      {runs.map((run) => {
        const status = autoRunStatusText(run, copy);
        const guest = guestName ?? copy.guestUnknown;
        return (
          <div className="gm-aruns__row" key={run.id}>
            <span className="gm-aruns__main">
              <b>{run.ruleName}</b>
              <span>
                <span className="gm-aruns__at">{formatAutoAt(run.scheduledAt, locale)}</span>
                {" · "}
                <span className={status.urgent ? "gm-urgent" : undefined}>{status.text}</span>
              </span>
            </span>
            {onPause && canPauseAutoRun(run) ? (
              <button
                type="button"
                className="gm-btn gm-btn--sm"
                disabled={busyId !== null}
                aria-label={fill(copy.autoPauseAria, { guest, rule: run.ruleName })}
                onClick={() => onPause(run, true)}
              >
                {copy.autoPause}
              </button>
            ) : onPause && canResumeAutoRun(run) ? (
              <button
                type="button"
                className="gm-btn gm-btn--sm"
                disabled={busyId !== null}
                aria-label={fill(copy.autoResumeAria, { guest, rule: run.ruleName })}
                onClick={() => onPause(run, false)}
              >
                {copy.autoResume}
              </button>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
