import Link from "next/link";
import type {
  AdminAttendanceOverviewData,
  AdminCorrectionField,
  AdminCorrectionRow,
} from "@/lib/admin-attendance";
import type { ReviewQueueItem } from "@/lib/attendance-review";
import type { Dictionary } from "@/lib/i18n";
import { formatAdminYen } from "../shared/admin-format";

// 화이트 리디자인(2026-10-13, 시안 Att-PC): 상자 없는 한 장 — 숫자 줄 → 즉시 검토(검토 필요 세션 | 정정 요청) →
// 급여 · 교통비 요약. 공용 흰 프리미티브(.wkpis · .wsec · .wrow · .wtag …)는 admin-console.css 맨 아래.

type Att = Dictionary["admin"]["attendanceConsole"];

function initial(name: string): string {
  return Array.from(name.trim())[0] ?? "·";
}

function corrFieldLabel(field: AdminCorrectionField, c: Att): string {
  if (field === "clock_in") return c.corrFieldClockIn;
  if (field === "clock_out") return c.corrFieldClockOut;
  if (field === "site") return c.corrFieldSite;
  return c.corrFieldOther;
}

function ReviewRow({ item, c, ym, cardExpired }: { item: ReviewQueueItem; c: Att; ym: string; cardExpired: boolean }) {
  const isUrgent = item.reviewState === "review_required" && (item.isAbnormal || !item.clockOutLabel);
  // 사유는 데이터로 알 수 있는 것만 — 퇴근 누락 · 장시간(인정 12시간 초과) · 이상 감지(2026-10-13 시안 컨펌).
  const reason = !item.clockOutLabel
    ? c.issueClockoutMissing
    : (item.paidDurationSec ?? 0) > 12 * 3600
      ? c.issueLongShift
      : item.isAbnormal
        ? c.issueAbnormal
        : c.cardReviewLive;
  const tag = isUrgent && reason !== c.cardReviewLive ? `${c.tagUrgent} · ${reason}` : isUrgent ? c.tagUrgent : reason;
  const subParts = [
    item.clockInLabel ? `${item.clockInLabel} → ${item.clockOutLabel ?? "—"}` : null,
    item.clockInSiteName ?? null,
  ].filter(Boolean) as string[];
  return (
    <Link href={`/admin/attendance/queue?ym=${ym}&sessionId=${item.sessionId}`} className="wrow">
      <span className="wav">{initial(item.userName)}</span>
      <div className="wrow__b">
        <div className="wrow__t">
          {item.userName}
          {cardExpired ? (
            <span className="adm-idexp" title={c.cardExpiredHint}>
              {c.cardExpiredChip}
            </span>
          ) : null}
          <span className="wrow__dim"> · {item.dateLabel}</span>
        </div>
        {subParts.length ? <div className="wrow__s">{subParts.join(" · ")}</div> : null}
      </div>
      <span className={`wtag ${isUrgent ? "wtag--danger" : "wtag--warn"}`}>{tag}</span>
    </Link>
  );
}

function CorrectionRow({ item, c, ym }: { item: AdminCorrectionRow; c: Att; ym: string }) {
  return (
    <Link href={`/admin/attendance/queue?ym=${ym}`} className="wrow">
      <span className="wav">{initial(item.requesterName)}</span>
      <div className="wrow__b">
        <div className="wrow__t">
          {item.requesterName}
          <span className="wrow__dim"> · {item.dateLabel ?? c.corrColTargetDate}</span>
        </div>
        <div className="wrow__s">
          {item.beforeLabel} → {item.afterLabel} · {item.submittedLabel}
        </div>
      </div>
      <span className="wtag wtag--info">{corrFieldLabel(item.field, c)}</span>
    </Link>
  );
}

export function AttendanceOverview({
  data,
  c,
  localeTag,
  expiredCardUserIds = [],
}: {
  data: AdminAttendanceOverviewData;
  c: Att;
  localeTag: string;
  /** 재류카드가 만료된 사람 — 이름 옆 빨간 칩(경고만, docs/product/41 「만료 표시」). */
  expiredCardUserIds?: string[];
}) {
  const expiredCards = new Set(expiredCardUserIds);
  const k = data.kpi;
  const yen = (n: number) => `${c.yenSym}${formatAdminYen(n, localeTag)}`;

  const kpis: { label: string; value: string; unit?: string; sub: string; tone?: "danger" }[] = [
    { label: c.kpiReviewSessions, value: `${k.reviewSessions}`, unit: c.unitCount, sub: c.kpiReviewUrgent(k.urgent), tone: k.urgent > 0 ? "danger" : undefined },
    { label: c.kpiCorrOpen, value: `${k.corrOpen}`, unit: c.unitCount, sub: c.kpiCorrSub },
    { label: c.kpiPayEstimated, value: yen(k.payTotal), sub: c.kpiPaySub(k.payEstimated) },
    { label: c.kpiPayExcluded, value: `${k.payExcluded}`, unit: c.unitCount, sub: c.kpiPayExcludedSub },
    { label: c.kpiTrPending, value: `${k.trPending}`, unit: c.unitCount, sub: c.kpiTrSub(yen(k.trTotal)) },
  ];

  return (
    <>
      {!data.isPrivileged ? <div className="privnote">{c.privilegedNotice}</div> : null}

      <div className="wkpis">
        {kpis.map((cell) => (
          <div key={cell.label} className="wkpi">
            <span className="wkpi__k">{cell.label}</span>
            <span className={`wkpi__v${cell.tone ? ` is-${cell.tone}` : ""}`}>
              {cell.value}
              {cell.unit ? <small>{cell.unit}</small> : null}
            </span>
            <span className="wkpi__d">{cell.sub}</span>
          </div>
        ))}
      </div>

      {/* 즉시 검토 */}
      <div className="wsec">
        <b>{c.sectImmediate}</b>
        <span className="wsec__c">{c.sectImmediateCount(k.urgent, k.reviewSessions)}</span>
        <Link href={`/admin/attendance/queue?ym=${data.ym}`} className="wsec__a">
          {c.goQueue} →
        </Link>
      </div>
      <div className="wcols">
        <section>
          <div className="wsub">
            <b>{c.cardReview}</b>
            <span className="wsub__c">
              {k.reviewSessions}
              {c.unitCount}
            </span>
          </div>
          {data.reviewSample.length === 0 ? (
            <div className="wempty">{c.cardReviewEmpty}</div>
          ) : (
            data.reviewSample.map((item) => <ReviewRow key={item.sessionId} item={item} c={c} ym={data.ym} cardExpired={expiredCards.has(item.userId)} />)
          )}
        </section>
        <section>
          <div className="wsub">
            <b>{c.cardCorr}</b>
            <span className="wsub__c">
              {k.corrOpen}
              {c.unitCount}
            </span>
          </div>
          {data.correctionSample.length === 0 ? (
            <div className="wempty">{c.cardCorrEmpty}</div>
          ) : (
            data.correctionSample.map((item) => <CorrectionRow key={item.id} item={item} c={c} ym={data.ym} />)
          )}
          <p className="wnote">{c.cardCorrPermNote}</p>
        </section>
      </div>

      {/* 급여 · 교통비 요약 */}
      <div className="wsec wsec--line">
        <b>{c.sectSummary}</b>
      </div>
      <div className="wcols">
        <section>
          <div className="wsub">
            <b>{c.cardPayroll(data.monthLabel)}</b>
            <span className="wtag wtag--info">{c.tagEstimated}</span>
            <Link href={`/admin/attendance/payroll?ym=${data.ym}`} className="wsub__a">
              {c.tabPayroll} →
            </Link>
          </div>
          <div className="wstats">
            <div className="wstat">
              <span className="wstat__k">{c.payHourlyTarget}</span>
              <span className="wstat__v">{k.payEstimated}</span>
            </div>
            <div className="wstat">
              <span className="wstat__k">{c.payPretaxTotal}</span>
              <span className="wstat__v">{yen(k.payTotal)}</span>
            </div>
            <div className="wstat">
              <span className="wstat__k">{c.payExcluded}</span>
              <span className={`wstat__v${k.payExcluded > 0 ? " is-warn" : ""}`}>{k.payExcluded}</span>
            </div>
          </div>
          <p className="wnote">{c.payNote(k.payExcluded)}</p>
          <p className="wnote">{c.payFootNote}</p>
        </section>
        <section>
          <div className="wsub">
            <b>{c.cardTransport(data.monthLabel)}</b>
            <Link href={`/admin/attendance/transport?ym=${data.ym}`} className="wsub__a">
              {c.tabTransport} →
            </Link>
          </div>
          <div className="wstats">
            <div className="wstat">
              <span className="wstat__k">{c.trPending}</span>
              <span className="wstat__v">{k.trPending}</span>
            </div>
            <div className="wstat">
              <span className="wstat__k">{c.trSubmittedTotal}</span>
              <span className="wstat__v">{yen(k.trTotal)}</span>
            </div>
            <div className="wstat">
              <span className="wstat__k">{c.trMissing}</span>
              <span className={`wstat__v${k.trMissing > 0 ? " is-warn" : ""}`}>{k.trMissing}</span>
            </div>
          </div>
          <p className="wnote">{c.trNote(k.trMissing)}</p>
          <p className="wnote">{c.trFootNote}</p>
        </section>
      </div>
    </>
  );
}
