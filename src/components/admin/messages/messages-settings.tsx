"use client";

/**
 * PC 손님 메시지 「설정」 탭(시안 R2Settings) — 응답 목표 시간 · Beds24 연결 · 과거 메시지 가져오기. docs/product/47 §6-1 · §6-2 · §4-0-2
 * `guest_messages.manage` 만 이 탭을 본다(서버 페이지가 거르고, 액션이 다시 본다).
 * 숫자는 모두 기록된 값 — 이 화면을 열어도 Beds24 를 부르지 않는다. 「지금 확인하기」 · 「비용 재기」 · 「가져오기」만 부른다.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { getGuestMessageBackfillStatus, startGuestMessageBackfill, type GuestMessageBackfillStatus } from "@/actions/guest-messages-backfill";
import { checkGuestMessagesNow } from "@/actions/guest-messages-settings";
import { saveGuestMessageSettings } from "@/app/admin/messages/actions";
import { AdmDropdown } from "@/components/admin/shared/adm-dropdown";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import { GmConfirm, useNow } from "@/components/guest-messages/gm-parts";
import { durationLabel, fill, formatWhen, reasonText, type GmCopy } from "@/components/guest-messages/gm-format";
import type { ChannelOverview } from "@/lib/guest-messages/channel-overview-server";
import { joinTargetMinutes, RESPONSE_TARGET_KEYS, splitTargetMinutes } from "@/lib/guest-messages/settings-model";
import type { ResponseTargetCategory } from "@/lib/guest-messages/types";

const TARGET_COPY: Record<ResponseTargetCategory, { name: keyof GmCopy; hint: keyof GmCopy }> = {
  inquiry: { name: "targetInquiry", hint: "targetInquiryHint" },
  request: { name: "targetRequest", hint: "targetRequestHint" },
  staying: { name: "targetStaying", hint: "targetStayingHint" },
  other: { name: "targetOther", hint: "targetOtherHint" },
};

type Draft = {
  targets: Record<ResponseTargetCategory, { value: string; unit: "min" | "hour" }>;
  nightPause: boolean;
  reserve: string;
  stall: string;
};

function draftOf(settings: ChannelOverview["settings"]): Draft {
  const targets = {} as Draft["targets"];
  for (const key of RESPONSE_TARGET_KEYS) {
    const split = splitTargetMinutes(settings.responseTargetMinutes[key]);
    targets[key] = { value: String(split.value), unit: split.unit };
  }
  return { targets, nightPause: settings.nightPause, reserve: String(settings.creditReserve), stall: String(settings.stallHours) };
}

function intOrNull(value: string): number | null {
  return /^\d{1,4}$/.test(value.trim()) ? Number(value.trim()) : null;
}

export function MessagesSettings({
  copy,
  locale,
  overview,
  backfill,
}: {
  copy: GmCopy;
  locale: string;
  overview: ChannelOverview | null;
  backfill: GuestMessageBackfillStatus | null;
}) {
  const router = useRouter();
  const now = useNow(15_000);
  const { toast, showToast, dismiss } = useAdminToast();
  const [draft, setDraft] = useState<Draft | null>(overview ? draftOf(overview.settings) : null);
  const [saving, startSaving] = useTransition();
  const [checking, startChecking] = useTransition();
  const [errorKey, setErrorKey] = useState<keyof GmCopy | null>(null);

  if (!overview || !draft) {
    return (
      <div className="gm-root gm-settings">
        <p className="gm-set__error" role="alert">
          {copy.loadFailed}
        </p>
      </div>
    );
  }

  const baseline = draftOf(overview.settings);
  const dirty = JSON.stringify(baseline) !== JSON.stringify(draft);

  const save = () => {
    const minutes = {} as Record<ResponseTargetCategory, number>;
    for (const key of RESPONSE_TARGET_KEYS) {
      const value = joinTargetMinutes(draft.targets[key].value, draft.targets[key].unit);
      if (value === null || value < 5 || value > 1440) {
        setErrorKey("settingsInvalidTarget");
        return;
      }
      minutes[key] = value;
    }
    const reserve = intOrNull(draft.reserve);
    if (reserve === null || reserve < 10 || reserve > 150) {
      setErrorKey("settingsInvalidReserve");
      return;
    }
    const stall = intOrNull(draft.stall);
    if (stall === null || stall < 1 || stall > 72) {
      setErrorKey("settingsInvalidStall");
      return;
    }
    setErrorKey(null);
    startSaving(async () => {
      const result = await saveGuestMessageSettings({
        responseTargetMinutes: minutes,
        nightPause: draft.nightPause,
        creditReserve: reserve,
        stallHours: stall,
      });
      if (result.ok) {
        showToast(copy.settingsSaved);
        router.refresh();
      } else if (result.errorKey === "invalid") {
        setErrorKey(
          result.field === "creditReserve" ? "settingsInvalidReserve" : result.field === "stallHours" ? "settingsInvalidStall" : "settingsInvalidTarget",
        );
      } else {
        showToast(result.errorKey === "forbidden" ? copy.forbidden : copy.settingsSaveFailed);
      }
    });
  };

  const checkNow = () => {
    startChecking(async () => {
      const result = await checkGuestMessagesNow();
      if (result.ok) {
        const reason = result.skipped ?? result.stoppedEarly;
        showToast(reason && result.pages === 0 ? fill(copy.checkNowSkipped, { reason: reasonText(reason, copy) }) : fill(copy.checkNowDone, { n: result.added }));
        router.refresh();
      } else {
        showToast(result.errorKey === "too_soon" ? copy.checkNowTooSoon : result.errorKey === "forbidden" ? copy.forbidden : copy.checkNowFailed);
      }
    });
  };

  const when = (iso: string | null) => (iso ? formatWhen(iso, locale, now) : copy.statNever);
  const ago = (iso: string | null) => {
    if (!iso) return copy.statNever;
    const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 60_000));
    return fill(copy.statAgo, { time: when(iso), ago: durationLabel(minutes, copy) });
  };
  const credit = overview.credit;
  const resetsIn = credit.known ? Math.max(0, credit.resetsInSec - Math.floor((now.getTime() - overview.nowMs) / 1000)) : 0;
  const stallTone = overview.stall.stalled ? "urgent" : undefined;
  // 두 칸이 같은 값 묶음을 저장한다 — 안내 글(「목표 넘은 알림은…」)은 응답 목표 칸에만.
  const footSave = (idleNote: string | null) => (
    <div className="gm-set__foot">
      <span className="gm-hint">{errorKey ? <span className="gm-set__error">{copy[errorKey] as string}</span> : dirty ? copy.settingsUnsaved : idleNote}</span>
      <button type="button" className="gm-btn gm-btn--primary gm-btn--lg" disabled={!dirty || saving} onClick={save}>
        {saving ? copy.settingsSaving : copy.settingsSave}
      </button>
    </div>
  );

  return (
    <div className="gm-root gm-settings">
      <section className="gm-set" aria-labelledby="gm-set-targets">
        <h2 id="gm-set-targets" className="gm-set__title">
          {copy.targetsTitle}
        </h2>
        <p className="gm-set__body">{copy.targetsBody}</p>
        {RESPONSE_TARGET_KEYS.map((key) => {
          const name = copy[TARGET_COPY[key].name] as string;
          const value = draft.targets[key];
          const minutes = joinTargetMinutes(value.value, value.unit);
          const invalid = minutes === null || minutes < 5 || minutes > 1440;
          return (
            <div className="gm-set__row" key={key}>
              <span className="gm-set__label">
                <b>{name}</b>
                <span>{copy[TARGET_COPY[key].hint] as string}</span>
              </span>
              <input
                className="gm-num"
                inputMode="numeric"
                aria-label={fill(copy.targetInputLabel, { name })}
                aria-invalid={invalid || undefined}
                value={value.value}
                onChange={(event) =>
                  setDraft({ ...draft, targets: { ...draft.targets, [key]: { ...value, value: event.target.value.replace(/[^\d]/g, "").slice(0, 4) } } })
                }
              />
              <AdmDropdown
                size="sm"
                ariaLabel={fill(copy.unitLabel, { name })}
                value={value.unit}
                options={[
                  { value: "min", label: copy.unitMinutes },
                  { value: "hour", label: copy.unitHours },
                ]}
                onChange={(unit) => setDraft({ ...draft, targets: { ...draft.targets, [key]: { ...value, unit: unit === "hour" ? "hour" : "min" } } })}
              />
            </div>
          );
        })}
        <div className="gm-set__row">
          <span className="gm-set__label">
            <b>{copy.nightPauseTitle}</b>
            <span>{copy.nightPauseHint}</span>
          </span>
          <button
            type="button"
            role="switch"
            className="gm-switch"
            aria-checked={draft.nightPause}
            aria-label={copy.nightPauseTitle}
            onClick={() => setDraft({ ...draft, nightPause: !draft.nightPause })}
          />
        </div>
        {footSave(copy.targetsAlertNote)}
      </section>

      <section className="gm-set" aria-labelledby="gm-set-conn">
        <div className="gm-set__head">
          <h2 id="gm-set-conn" className="gm-set__title">
            {copy.connectionTitle}
          </h2>
          <span className="gm-set__badge" data-tone={stallTone}>
            <i aria-hidden="true" />
            {overview.stall.never
              ? copy.connectionNever
              : overview.stall.stalled
                ? fill(copy.connectionStalled, { h: overview.settings.stallHours })
                : copy.connectionOk}
          </span>
        </div>
        <p className="gm-set__body">{copy.connectionBody}</p>
        <div className="gm-credit">
          {credit.known ? (
            <>
              <div className="gm-credit__nums">
                <b className="gm-credit__big">{credit.remaining}</b>
                <span className="gm-credit__of">{fill(credit.limitAssumed ? copy.creditOfAssumed : copy.creditOf, { limit: credit.limit })}</span>
                <span className="gm-credit__reset">
                  {fill(copy.creditResetsIn, { time: fill(copy.secondsShort, { m: Math.floor(resetsIn / 60), s: resetsIn % 60 }) })}
                </span>
              </div>
              <div
                className="gm-credit__bar"
                role="img"
                aria-label={fill(copy.creditBarLabel, { limit: credit.limit, used: credit.used, reserve: credit.reserve })}
              >
                <span className="gm-credit__used" style={{ width: `${credit.usedPct}%` }} />
                <span className="gm-credit__reserve" style={{ width: `${credit.reservePct}%` }} />
              </div>
              <div className="gm-credit__legend">
                <span>
                  <i aria-hidden="true" />
                  {fill(copy.creditUsed, { n: credit.used })}
                </span>
                <span>
                  <i aria-hidden="true" data-k="reserve" />
                  {fill(copy.creditReserved, { n: credit.reserve })}
                </span>
              </div>
              {credit.belowReserve ? <span className="gm-set__error">{copy.creditBelow}</span> : null}
            </>
          ) : (
            <span className="gm-hint">{copy.creditUnknown}</span>
          )}
        </div>
        <div className="gm-stat">
          <span className="gm-stat__k">{copy.statLastWebhook}</span>
          <span className="gm-stat__v" data-tone={stallTone}>
            {ago(overview.lastWebhookAt)}
          </span>
        </div>
        <div className="gm-stat">
          <span className="gm-stat__k">{copy.statLastMessageWebhook}</span>
          <span className="gm-stat__v">{ago(overview.lastMessageWebhookAt)}</span>
        </div>
        <div className="gm-stat">
          <span className="gm-stat__k">{copy.statLastReconcile}</span>
          <span className="gm-stat__v">
            {when(overview.lastReconcileAt)}
            {overview.lastReconcileError ? (
              <small className="gm-urgent">{fill(copy.lastCheckError, { reason: reasonText(overview.lastReconcileError, copy) })}</small>
            ) : null}
          </span>
          <button type="button" className="gm-link gm-stat__link" disabled={checking} onClick={checkNow}>
            {checking ? copy.checkingNow : copy.checkNow}
          </button>
        </div>
        <div className="gm-stat">
          <span className="gm-stat__k">{copy.statQueued}</span>
          <span className="gm-stat__v">{fill(copy.statCount, { n: overview.queuedCount })}</span>
        </div>
        <div className="gm-stat">
          <span className="gm-stat__k">{copy.statFailed}</span>
          <span className="gm-stat__v" data-tone={overview.failed.count > 0 ? "urgent" : undefined}>
            {overview.failed.count > 0 && overview.failed.latestAt
              ? fill(copy.statFailedLine, { n: overview.failed.count, time: when(overview.failed.latestAt) })
              : copy.statNone}
          </span>
          {overview.failed.conversationId ? (
            <Link className="gm-link gm-stat__link" href={`/admin/messages?status=all&c=${overview.failed.conversationId}`}>
              {copy.viewLink}
            </Link>
          ) : null}
        </div>
        <div className="gm-set__row">
          <span className="gm-set__label">
            <b>{copy.reserveTitle}</b>
            <span>{copy.reserveHint}</span>
          </span>
          <input
            className="gm-num"
            inputMode="numeric"
            aria-label={copy.reserveTitle}
            value={draft.reserve}
            onChange={(event) => setDraft({ ...draft, reserve: event.target.value.replace(/[^\d]/g, "").slice(0, 3) })}
          />
          <span className="gm-unit" aria-hidden="true" />
        </div>
        <div className="gm-set__row">
          <span className="gm-set__label">
            <b>{copy.stallTitle}</b>
            <span>{copy.stallHint}</span>
          </span>
          <input
            className="gm-num"
            inputMode="numeric"
            aria-label={copy.stallTitle}
            value={draft.stall}
            onChange={(event) => setDraft({ ...draft, stall: event.target.value.replace(/[^\d]/g, "").slice(0, 2) })}
          />
          <span className="gm-unit">{copy.unitHours}</span>
        </div>
        {footSave(null)}
      </section>

      <BackfillSection copy={copy} locale={locale} now={now} initial={backfill} notify={showToast} />

      {toast ? <AdminToast key={toast.id} message={toast.message} onDismiss={dismiss} /> : null}
    </div>
  );
}

const POLL_MS = 4_000;

function BackfillSection({
  copy,
  locale,
  now,
  initial,
  notify,
}: {
  copy: GmCopy;
  locale: string;
  now: Date;
  initial: GuestMessageBackfillStatus | null;
  notify: (message: string) => void;
}) {
  const [status, setStatus] = useState<GuestMessageBackfillStatus | null>(initial);
  const [pending, startPending] = useTransition();
  const [confirmRestart, setConfirmRestart] = useState(false);
  // 시작을 누른 뒤 일정 시간 다시 읽는다(뒤에서 도는 실행은 `after()` — 바로 running 으로 바뀌지 않을 수 있다).
  const [watchUntil, setWatchUntil] = useState(0);

  const running = status?.status === "running";
  useEffect(() => {
    if (!running && watchUntil === 0) return;
    const timer = setInterval(() => {
      if (!running && Date.now() > watchUntil) {
        clearInterval(timer);
        return;
      }
      void getGuestMessageBackfillStatus().then((result) => {
        if (result.ok) setStatus(result.status);
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, watchUntil]);

  const errorText = (key: string) =>
    key === "busy"
      ? copy.backfillErrBusy
      : key === "done"
        ? copy.backfillErrDone
        : key === "too_soon"
          ? copy.backfillErrTooSoon
          : key === "forbidden"
            ? copy.forbidden
            : copy.backfillErrFailed;

  const run = (restart: boolean) => {
    setConfirmRestart(false);
    startPending(async () => {
      const result = await startGuestMessageBackfill({ mode: "run", restart });
      if (result.ok) {
        setStatus(result.status);
        setWatchUntil(Date.now() + 30_000);
        notify(copy.backfillStarted);
      } else {
        notify(errorText(result.errorKey));
      }
    });
  };

  const measure = () => {
    startPending(async () => {
      const result = await startGuestMessageBackfill({ mode: "measure" });
      if (result.ok) setStatus(result.status);
      else notify(errorText(result.errorKey));
    });
  };

  const state = status?.status ?? "idle";
  const label =
    state === "running"
      ? copy.statusRunning
      : state === "paused"
        ? copy.statusPaused
        : state === "done"
          ? copy.statusDone
          : state === "failed"
            ? copy.statusFailed
            : copy.statusIdle;
  const m = status?.measure ?? null;
  const orderLabel = m
    ? m.order === "asc"
      ? copy.orderAsc
      : m.order === "desc"
        ? copy.orderDesc
        : m.order === "mixed"
          ? copy.orderMixed
          : copy.orderUnknown
    : "";
  const resumeAfter = status?.resumeAfter && Date.parse(status.resumeAfter) > now.getTime() ? status.resumeAfter : null;

  return (
    <section className="gm-set gm-set--wide gm-backfill" aria-labelledby="gm-set-backfill">
      <h2 id="gm-set-backfill" className="gm-set__title">
        {copy.backfillTitle}
      </h2>
      <p className="gm-set__body">{copy.backfillBody}</p>
      <div className="gm-stat">
        <span className="gm-stat__k">{copy.backfillMeasure}</span>
        <span className="gm-stat__v">
          {m ? (
            <>
              {fill(copy.backfillMeasureResult, {
                rows: m.rows,
                cost: m.requestCost ?? "?",
                remaining: m.remaining ?? "?",
                order: orderLabel,
              })}
              {m.nextPageExists ? ` · ${copy.backfillMore}` : ""}
              <small>{fill(copy.backfillMeasureAt, { time: formatWhen(m.at, locale, now) })}</small>
            </>
          ) : (
            copy.backfillMeasureNone
          )}
        </span>
        <button type="button" className="gm-link gm-stat__link" disabled={pending || running} onClick={measure}>
          {pending ? copy.backfillMeasuring : copy.backfillMeasure}
        </button>
      </div>
      <div className="gm-backfill__status" data-tone={state === "failed" ? "urgent" : undefined} role="status">
        <b>{label}</b>
        {status ? (
          <span className="gm-hint">
            {fill(copy.backfillProgress, { pages: status.pagesDone, imported: status.imported, skipped: status.skipped })}
          </span>
        ) : null}
      </div>
      {status ? (
        <div className="gm-backfill__lines">
          {status.unrouted > 0 ? <span>{fill(copy.backfillUnrouted, { n: status.unrouted })}</span> : null}
          {status.failedBookings > 0 ? <span className="gm-urgent">{fill(copy.backfillFailedBookings, { n: status.failedBookings })}</span> : null}
          {status.lastError && state !== "done" ? <span>{fill(copy.backfillReason, { reason: reasonText(status.lastError, copy) })}</span> : null}
          {resumeAfter ? <span>{fill(copy.backfillResumeAfter, { time: formatWhen(resumeAfter, locale, now) })}</span> : null}
          {status.lastRunAt ? <span>{fill(copy.backfillLastRun, { time: formatWhen(status.lastRunAt, locale, now) })}</span> : null}
        </div>
      ) : null}
      <div className="gm-backfill__actions">
        {state === "idle" ? (
          <button type="button" className="gm-btn gm-btn--primary gm-btn--lg" disabled={pending} onClick={() => run(false)}>
            {copy.backfillStart}
          </button>
        ) : null}
        {state === "paused" || state === "failed" ? (
          <button type="button" className="gm-btn gm-btn--primary gm-btn--lg" disabled={pending} onClick={() => run(false)}>
            {copy.backfillResume}
          </button>
        ) : null}
        {state === "paused" || state === "failed" || state === "done" ? (
          <button type="button" className="gm-btn gm-btn--lg" disabled={pending} onClick={() => setConfirmRestart(true)}>
            {copy.backfillRestart}
          </button>
        ) : null}
      </div>
      {confirmRestart ? (
        <GmConfirm
          title={copy.backfillRestartTitle}
          body={copy.backfillRestartBody}
          confirmLabel={copy.backfillRestart}
          cancelLabel={copy.replyCancel}
          onConfirm={() => run(true)}
          onCancel={() => setConfirmRestart(false)}
        />
      ) : null}
    </section>
  );
}
