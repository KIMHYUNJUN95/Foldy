"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Bus,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Shield,
  Wallet,
  X,
} from "lucide-react";
import type {
  AdminStaffDay,
  AdminStaffDaySession,
  AdminStaffDetailData,
} from "@/lib/admin-attendance";
import { getDictionary, type Dictionary, type Locale } from "@/lib/i18n";
import { adminTransportStatusPill, formatAdminYen } from "../shared/admin-format";
import { useAdminPanelA11y } from "../shared/use-admin-panel-a11y";

type Att = Dictionary["admin"]["attendanceConsole"];

function Ic({ children }: { children: React.ReactNode }) {
  return <span className="ic">{children}</span>;
}
function initial(name: string): string {
  return name.trim().slice(0, 1) || "·";
}
function issueLabel(key: AdminStaffDaySession["issueKey"], c: Att): string | null {
  switch (key) {
    case "clockout_missing":
      return c.issueClockoutMissing;
    case "correction_pending":
      return c.issueCorrectionPending;
    case "abnormal":
      return c.issueAbnormal;
    case "incomplete":
      return c.issueIncomplete;
    default:
      return null;
  }
}

function sessionStatusPill(
  s: AdminStaffDaySession,
  c: Att,
): { label: string; cls: string } {
  if (s.status === "invalid") return { label: c.statusInvalid, cls: "pill--muted" };
  if (s.correctionPending) return { label: c.statusPending, cls: "pill--info" };
  if (s.reviewState === "review_required") return { label: c.statusReview, cls: "pill--warn" };
  if (s.status === "open") return { label: c.statusOpen, cls: "pill--open" };
  if (s.status === "completed") return { label: c.statusCompleted, cls: "pill--done" };
  return { label: c.statusNormal, cls: "pill--muted" };
}

export function AttendanceStaffDetail({
  data,
  locale,
  localeTag,
  cardExpired = false,
}: {
  data: AdminStaffDetailData;
  locale: Locale;
  localeTag: string;
  /** 재류카드 만료 — 이름 옆 빨간 칩(경고만, docs/product/41 「만료 표시」). */
  cardExpired?: boolean;
}) {
  const c = getDictionary(locale).admin.attendanceConsole;
  const [panelSel, setPanelSel] = useState<string | null>(null);
  const [ledgerExpanded, setLedgerExpanded] = useState(false);
  const selSession =
    panelSel !== null
      ? data.days
          .flatMap((d) => d.sessions.map((s) => ({ day: d, session: s })))
          .find((p) => p.session.sessionId === panelSel) ?? null
      : null;

  // Flatten day → session rows, marking the first row of each day (which shows the date column).
  const ledgerRows = data.days.flatMap((d) =>
    d.sessions.map((s, sIdx) => ({ day: d, session: s, showDate: sIdx === 0 })),
  );
  const LEDGER_COLLAPSED = 6;
  const ledgerCollapsible = ledgerRows.length > LEDGER_COLLAPSED;
  const visibleLedgerRows =
    ledgerExpanded || !ledgerCollapsible ? ledgerRows : ledgerRows.slice(0, LEDGER_COLLAPSED);

  const isSalaried = data.pay.employment === "salaried";
  const expectedDisplay = isSalaried
    ? "—"
    : `${c.yenSym}${formatAdminYen(data.pay.expectedGross, localeTag)}`;
  const trPill = adminTransportStatusPill(data.transport.status, c);

  return (
    <div style={{ position: "relative" }}>
      <Link
        className="uhead__back"
        href={`/admin/attendance/payroll?ym=${data.ym}`}
      >
        <Ic>
          <ArrowLeft />
        </Ic>
        {c.staffBackToPayroll}
      </Link>

      {/* User header */}
      <div className="uhead">
        <span
          className="uhead__av"
          style={{
            background: "var(--adm-primary)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontWeight: 800,
          }}
        >
          {initial(data.user.name)}
        </span>
        <div className="uhead__b">
          <div className="uhead__nm">
            {data.user.name}
            {cardExpired ? (
              <span className="adm-idexp" title={c.cardExpiredHint}>
                {c.cardExpiredChip}
              </span>
            ) : null}
          </div>
          <div className="uhead__sub">
            {data.user.role ?? "—"}
            <span className="sep" />
            {data.monthLabel}
          </div>
        </div>
        <div className="uhead__stats">
          <div className="uhead__stat">
            <div className="uhead__sv">{data.pay.recognizedLabel}</div>
            <div className="uhead__sk">{c.staffStatRecognized}</div>
          </div>
          {/* 금액은 급여 보기 · 교통비 처리 권한이 있을 때만(2026-10-21 — 근태만 넘겨받은 사람에게 급여가 보이지 않게). */}
          {data.canSeePay ? (
            <div className="uhead__stat">
              <div className="uhead__sv">{expectedDisplay}</div>
              <div className="uhead__sk">{c.staffStatExpected}</div>
            </div>
          ) : null}
          {data.canSeeTransport ? (
            <div className="uhead__stat">
              <div className="uhead__sv">
                {c.yenSym}
                {formatAdminYen(data.transport.totalAmount, localeTag)}
              </div>
              <div className="uhead__sk">{c.staffStatTransport}</div>
            </div>
          ) : null}
          <div className="uhead__stat">
            <div
              className="uhead__sv"
              style={{
                color:
                  data.stats.issueSessions > 0 ? "var(--warn)" : "var(--done)",
              }}
            >
              {data.stats.issueSessions}
            </div>
            <div className="uhead__sk">{c.staffStatIssues}</div>
          </div>
        </div>
      </div>

      {/* Daily ledger */}
      <div className="secthead">
        <span className="secthead__t">{c.staffSecLedger}</span>
        <span className="secthead__c">
          {c.staffLedgerCount(
            data.stats.totalDays,
            data.stats.doneSessions,
            data.stats.issueSessions,
          )}
        </span>
        <span className="secthead__line" />
      </div>
      {data.days.length === 0 ? (
        <div className="card">
          <div className="state">
            <span className="state__ic empty">
              <Ic>
                <Clock />
              </Ic>
            </span>
            <div className="state__t">{c.staffNoSessions}</div>
          </div>
        </div>
      ) : (
        <>
          <div
            className={`card ledger${ledgerCollapsible && !ledgerExpanded ? " ledger--collapsed" : ""}`}
            style={{ overflow: "hidden", position: "relative" }}
          >
            {visibleLedgerRows.map(({ day, session, showDate }) => (
              <DayRowItem
                key={session.sessionId}
                day={day}
                session={session}
                c={c}
                showDate={showDate}
                selected={panelSel === session.sessionId}
                onClick={() => setPanelSel(session.sessionId)}
              />
            ))}
            {ledgerCollapsible && !ledgerExpanded ? (
              <div className="ledger__fade" aria-hidden="true" />
            ) : null}
          </div>
          {ledgerCollapsible ? (
            <button
              type="button"
              className="ledger__toggle"
              onClick={() => setLedgerExpanded((v) => !v)}
              aria-expanded={ledgerExpanded}
            >
              {ledgerExpanded ? c.staffLedgerCollapse : c.staffLedgerExpand(ledgerRows.length)}
              <span className={`ledger__toggle-chev${ledgerExpanded ? " on" : ""}`}>
                <Ic>
                  <ChevronDown />
                </Ic>
              </span>
            </button>
          ) : null}
        </>
      )}

      {/* Payroll + Transport summary */}
      {data.canSeePay || data.canSeeTransport ? (
        <>
      <div className="secthead">
        <span className="secthead__t">{c.staffSecSummary}</span>
        <span className="secthead__line" />
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(12,1fr)" }}>
        {/* Payroll card */}
        {!data.canSeePay ? null : isSalaried ? (
          <div className="card" style={{ gridColumn: "span 6" }}>
            <div className="card__h">
              <span className="card__ic bg-surf">
                <Ic>
                  <Wallet />
                </Ic>
              </span>
              <div className="card__ti">
                <span className="card__t">{c.staffPaySalariedTitle}</span>
              </div>
            </div>
            <div className="card__body">
              <div className="locknote">
                <Ic>
                  <FileText />
                </Ic>
                {c.staffPaySalariedNote}
              </div>
            </div>
          </div>
        ) : (
          <div className="card" style={{ gridColumn: "span 6" }}>
            <div className="card__h">
              <span className="card__ic bg-pri">
                <Ic>
                  <Wallet />
                </Ic>
              </span>
              <div className="card__ti">
                <span className="card__t">{c.staffPayHourlyTitle}</span>
                <span className="pill pill--info" style={{ marginLeft: 2 }}>
                  <span className="d" />
                  {c.tagEstimated}
                </span>
              </div>
              <div className="card__act">
                <Link
                  href={`/admin/attendance/payroll?ym=${data.ym}`}
                  className="linkmore"
                >
                  {c.staffViewMonthlyDetail}
                  <Ic>
                    <ChevronRight />
                  </Ic>
                </Link>
              </div>
            </div>
            <div className="card__body" style={{ paddingTop: 6 }}>
              <div className="psum">
                <span className="psum__amt">
                  <span className="yen">{c.yenSym}</span>
                  {formatAdminYen(data.pay.expectedGross, localeTag)}
                </span>
                <span className="psum__lbl">{c.staffPayPretax}</span>
              </div>
              <div style={{ marginTop: 12 }}>
                <div className="kv">
                  <span className="kv__k">{c.staffPayKvRecognized}</span>
                  <span className="kv__v mono">{data.pay.recognizedLabel}</span>
                </div>
                <div className="kv">
                  <span className="kv__k">{c.staffPayKvRate}</span>
                  <span className="kv__v mono">
                    {data.pay.primaryRate > 0
                      ? `${c.yenSym}${formatAdminYen(data.pay.primaryRate, localeTag)} ${c.payRateUnit}`
                      : "—"}
                  </span>
                </div>
                <div className="kv">
                  <span className="kv__k">{c.staffPayKvExcluded}</span>
                  <span
                    className="kv__v"
                    style={{ color: data.pay.excludedCount > 0 ? "var(--warn)" : "inherit" }}
                  >
                    {data.pay.excludedCount > 0
                      ? `${data.pay.excludedCount}${c.unitCount}`
                      : "—"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Transport card */}
        {data.canSeeTransport ? (
        <div className="card" style={{ gridColumn: "span 6" }}>
          <div className="card__h">
            <span className="card__ic bg-info">
              <Ic>
                <Bus />
              </Ic>
            </span>
            <div className="card__ti">
              <span className="card__t">{c.staffTrTitle}</span>
              <span className={`pill ${trPill.cls}`} style={{ marginLeft: 2 }}>
                <span className="d" />
                {trPill.label}
              </span>
            </div>
            <div className="card__act">
              <Link
                href={`/admin/attendance/transport?ym=${data.ym}&user=${data.user.id}`}
                className="linkmore"
              >
                {c.staffTrOpenLedger}
                <Ic>
                  <ChevronRight />
                </Ic>
              </Link>
            </div>
          </div>
          <div className="card__body" style={{ paddingTop: 6 }}>
            <div className="psum">
              <span className="psum__amt">
                <span className="yen">{c.yenSym}</span>
                {formatAdminYen(data.transport.totalAmount, localeTag)}
              </span>
              <span className="psum__lbl">{c.staffTrItemCount(data.transport.itemCount)}</span>
            </div>
            <div style={{ marginTop: 12 }}>
              <div className="kv">
                <span className="kv__k">{c.staffTrKvLinked}</span>
                <span className="kv__v">{c.staffTrKvLinkedValue(data.transport.linkedCount)}</span>
              </div>
              <div className="kv">
                <span className="kv__k">{c.staffTrKvManual}</span>
                <span className="kv__v">
                  {c.staffTrKvManualValue(
                    Math.max(0, data.transport.itemCount - data.transport.linkedCount),
                  )}
                </span>
              </div>
              <div className="kv">
                <span className="kv__k">{c.staffTrKvMissing}</span>
                <span
                  className="kv__v"
                  style={{
                    color: data.transport.missingCount > 0 ? "var(--warn)" : "inherit",
                  }}
                >
                  {c.staffTrKvMissingValue(data.transport.missingCount)}
                </span>
              </div>
            </div>
          </div>
        </div>
        ) : null}
      </div>
        </>
      ) : null}

      {/* Side panel — day session detail */}
      {selSession ? (
        <DaySessionPanel
          day={selSession.day}
          session={selSession.session}
          ym={data.ym}
          c={c}
          onClose={() => setPanelSel(null)}
        />
      ) : null}
    </div>
  );
}

function DayRowItem({
  day,
  session,
  c,
  showDate,
  selected,
  onClick,
}: {
  day: AdminStaffDay;
  session: AdminStaffDaySession;
  c: Att;
  showDate: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const issue = issueLabel(session.issueKey, c);
  const pill = sessionStatusPill(session, c);
  const hasIn = session.clockInLabel != null;
  const hasOut = session.clockOutLabel != null;

  return (
    <div className={`dayrow${selected ? " sel" : ""}`} onClick={onClick}>
      <div className="dayrow__date" style={{ visibility: showDate ? "visible" : "hidden" }}>
        <div className="dayrow__d">{day.day}</div>
        <div className="dayrow__wd">
          {day.weekdayShort}
          {c.staffWeekdaySuffix}
        </div>
      </div>
      <div className="dayrow__b">
        {hasIn || hasOut ? (
          <span className="dayrow__times">
            {hasIn ? session.clockInLabel : <span className="none">{c.missingOut}</span>}{" "}
            <span className="arr">→</span>{" "}
            {hasOut ? session.clockOutLabel : <span className="none">{c.missingOut}</span>}
          </span>
        ) : (
          <span className="dayrow__times">
            <span className="none" style={{ color: "var(--adm-muted)" }}>
              {c.cardReviewEmpty}
            </span>
          </span>
        )}
        <div className="dayrow__meta">
          {session.siteName ?? c.staffNoAssigned}
          {session.paidDurationLabel !== "—" ? (
            <>
              <span className="sep" />
              {c.staffPayKvRecognized} {session.paidDurationLabel}
            </>
          ) : null}
          {session.breakLabel !== "00:00" && session.breakLabel !== "—" ? (
            <>
              <span className="sep" />
              {c.panelKvBreak} {session.breakLabel}
            </>
          ) : null}
          {issue ? (
            <>
              <span className="sep" />
              <span style={{ color: "var(--warn)", fontWeight: 800 }}>{issue}</span>
            </>
          ) : null}
        </div>
      </div>
      <div className="dayrow__r">
        <span className={`pill ${pill.cls}`}>
          <span className="d" />
          {pill.label}
        </span>
        <span className="ic qrow__chev">
          <ChevronRight />
        </span>
      </div>
    </div>
  );
}

function DaySessionPanel({
  day,
  session,
  ym,
  c,
  onClose,
}: {
  day: AdminStaffDay;
  session: AdminStaffDaySession;
  ym: string;
  c: Att;
  onClose: () => void;
}) {
  const issue = issueLabel(session.issueKey, c);
  const pill = sessionStatusPill(session, c);
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose);
  return (
    <>
      <div className="panel-scrim on" onClick={onClose} />
      <aside ref={panelRef} className="panel on" role="dialog" tabIndex={-1}>
        <div className="panel__h">
          <div className="panel__top">
            <span className="panel__kicker">
              {day.day} {day.weekdayShort}
              {c.staffWeekdaySuffix}
            </span>
            <button type="button" className="panel__x" onClick={onClose} aria-label={c.panelClose}>
              <Ic>
                <X />
              </Ic>
            </button>
          </div>
          <div className="panel__title">
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                className="panel__room"
                style={{ fontFamily: "var(--mono)", fontSize: 20, fontWeight: 900 }}
              >
                {day.date.slice(5)}
              </span>
              <span className="panel__sub">{session.siteName ?? c.staffNoAssigned}</span>
            </span>
          </div>
          <div className="panel__chips">
            <span className={`pill ${pill.cls}`}>
              <span className="d" />
              {pill.label}
            </span>
            {issue ? <span className="pill pill--warn">{issue}</span> : null}
          </div>
        </div>

        <div className="panel__body">
          <div className="pblock">
            <div className="pblock__t">{c.panelSecInfo}</div>
            <div className="kv">
              <span className="kv__k">{c.colInOut}</span>
              <span className="kv__v">
                {session.clockInLabel == null && session.clockOutLabel == null ? (
                  <span className="dim-cell">{c.staffNoSessions}</span>
                ) : (
                  <span className="mono">
                    {session.clockInLabel ?? "—"} → {session.clockOutLabel ?? c.missingOut}
                  </span>
                )}
              </span>
            </div>
            <div className="kv">
              <span className="kv__k">{c.staffPayKvRecognized}</span>
              <span className="kv__v mono">{session.paidDurationLabel}</span>
            </div>
            <div className="kv">
              <span className="kv__k">{c.panelKvBreak}</span>
              <span className="kv__v mono">{session.breakLabel}</span>
            </div>
            <div className="kv">
              <span className="kv__k">{c.colStatus}</span>
              <span className="kv__v">{pill.label}</span>
            </div>
          </div>

          {issue ? (
            <div className="pblock">
              <div className="pblock__t">{c.panelSecAnomaly}</div>
              <div className="errbar is-warn" style={{ margin: 0 }}>
                <span className="errbar__ic">
                  <Ic>
                    {session.status === "invalid" ? <Ban /> : <AlertTriangle />}
                  </Ic>
                </span>
                <div>
                  <div className="errbar__t">{issue}</div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="panel__foot">
          <Link
            href={`/admin/attendance/queue?ym=${ym}`}
            className="btn btn--ghost"
            style={{ flex: 1 }}
          >
            <Ic>
              <Shield />
            </Ic>
            {c.tabQueue}
          </Link>
          <button
            type="button"
            className="btn btn--ok"
            style={{ flex: 1.3 }}
            disabled
            title={c.panelEditPendingNote}
          >
            <Ic>
              <Check />
            </Ic>
            {c.panelBtnApprove}
          </button>
        </div>
      </aside>
    </>
  );
}
