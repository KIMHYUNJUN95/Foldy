import Link from "next/link";
import "./leave.css";
import { tokyoToday, type AnnualLeaveSummary } from "@/lib/annual-leave";
import type { LeaveRequestView } from "@/lib/annual-leave-requests-server";
import { getDictionary, type Dictionary } from "@/lib/i18n";

// L1 · 연차 홈 · 현황 — 독립 흐름의 랜딩. 잔여/부여/사용 요약 · 최근 신청 · 부여 규칙.
// 디자인 핸드오프 leaveHome() 재현. 잔여 연차 `summary`와 최근 신청 `recent`/대기중 `pendingCount`는
// 호출부(page.tsx)가 서버에서 계산·조회해 내려준다 — 입사일/baseline이 없으면 page.tsx가 이 컴포넌트
// 대신 LeaveException(missing)을 렌더하므로, 여기서는 summary가 항상 존재한다고 가정한다.
// 승인/문서출력 백엔드는 아직 없어서 상태는 draft/requested/approved/rejected/cancelled만 실제로 나온다.

type LeaveCopy = Dictionary["leave"];

type LeaveType = "annual" | "paid" | "special" | "other";
type LeaveStatus = "requested" | "review" | "approved" | "rejected" | "draft" | "cancelled";

function shortDate(iso: string): string {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
}

function typeLabel(t: LeaveType, c: LeaveCopy): string {
  return t === "annual" ? c.typeAnnual : t === "paid" ? c.typePaid : t === "special" ? c.typeSpecial : c.typeOther;
}

function statusLabel(s: LeaveStatus, c: LeaveCopy): string {
  switch (s) {
    case "requested": return c.statusRequested;
    case "review": return c.statusReview;
    case "approved": return c.statusApproved;
    case "rejected": return c.statusRejected;
    case "draft": return c.statusDraft;
    case "cancelled": return c.statusCancelled;
  }
}

export function LeaveHome({
  locale,
  summary,
  recent,
  pendingCount,
}: {
  locale: string;
  summary: AnnualLeaveSummary;
  recent: LeaveRequestView[];
  pendingCount: number;
}) {
  const c: LeaveCopy = getDictionary(locale).leave;
  const rules = [c.rule1, c.rule2, c.rule3, c.rule4];
  const today = tokyoToday();

  // main card tracks the "유급 휴가" pool only — the 특별휴가(4-year bonus) pool is
  // a separate, parallel entitlement and is not part of this progress bar/total.
  const basePool = summary.buckets.filter((b) => b.kind !== "bonus");
  const totalPool = basePool.reduce((sum, b) => sum + b.amount, 0);
  const used = Math.max(0, totalPool - summary.baseRemaining);
  const usedPct = totalPool > 0 ? Math.round((used / totalPool) * 100) : 0;

  const bonusOn = summary.nextBonusGrant;
  const recentRows = recent.map((r) => {
    const st = r.status as LeaveStatus;
    const range = r.startDate === r.endDate ? shortDate(r.startDate) : `${shortDate(r.startDate)} – ${shortDate(r.endDate)}`;
    return (
      <Link className="lvw-row" key={r.id} href="/mobile/attendance/leave/history">
        <span className="lvw-row__b">
          <span className="lvw-row__t">
            {typeLabel(r.leaveType as LeaveType, c)} · {r.daysCount}
            {c.unitD}
          </span>
          <span className="lvw-row__s">
            {range}
            {r.submittedAt ? ` · ${c.submittedOn(shortDate(r.submittedAt.slice(0, 10)))}` : ""}
          </span>
        </span>
        <span className={`lvw-row__v is-${st}`}>{statusLabel(st, c)}</span>
      </Link>
    );
  });

  // 화이트 리디자인(2026-10-13, 시안 AttLeaveHomeM-Phone · Fold · Tablet): 큰 「사용 가능 n일」 → 부여 · 사용 · 대기 한 줄 + 막대 →
  // 다음 자동 부여 · 4년 보너스 줄 → 연차 신청하기 · 캘린더 · 신청 내역 → 최근 신청. 태블릿 가로는 오른쪽에 최근 신청 · 부여 규칙.
  return (
    <div className="lv lvw lvw--home">
      <div className="lvw-left">
        <div className="lvw-title">
          <h1>{c.homeTitle}</h1>
          <span>{c.homeYear.replace("{y}", today.slice(0, 4))}</span>
        </div>

        <div className="lvw-hero">
          <span className="lvw-hero__k">{c.balTitle}</span>
          <b className="lvw-hero__v">
            {summary.baseRemaining}
            <small>{c.unitD}</small>
          </b>
          <span className="lvw-hero__s">
            {c.balLine.replace("{g}", String(totalPool)).replace("{u}", String(used)).replace("{p}", String(pendingCount))}
          </span>
          <div className="lvw-bar" aria-hidden="true">
            <i className="is-used" style={{ flex: Math.max(used, 0.0001) }} />
            <i className="is-left" style={{ flex: Math.max(summary.baseRemaining, 0.0001) }} />
          </div>
          <div className="lvw-legend">
            <span><i className="is-used" />{c.legUsed}</span>
            <span><i className="is-left" />{c.legLeft}</span>
          </div>
          <span className="sr-only">{usedPct}%</span>
        </div>

        <div className="lvw-info">
          {summary.nextBaseGrant ? (
            <div className="lvw-row is-static">
              <span className="lvw-row__b">
                <span className="lvw-row__t">{c.nextGrantK}</span>
                <span className="lvw-row__s">{summary.nextBaseGrant.date}</span>
              </span>
              <b className="lvw-row__n">+{summary.nextBaseGrant.amount}{c.unitD}</b>
            </div>
          ) : null}
          {summary.bonusRemaining > 0 || bonusOn ? (
            <div className="lvw-row is-static">
              <span className="lvw-row__b">
                <span className="lvw-row__t">{c.balSpecialTitle}</span>
                <span className="lvw-row__s">
                  {summary.bonusRemaining > 0
                    ? c.bonusHave.replace("{n}", String(summary.bonusRemaining))
                    : c.bonusOn.replace("{date}", bonusOn!.date)}
                </span>
              </span>
              {bonusOn && summary.bonusRemaining <= 0 ? <b className="lvw-row__n">+{bonusOn.amount}{c.unitD}</b> : null}
            </div>
          ) : null}
        </div>

        <Link className="lvw-cta" href="/mobile/attendance/leave/new">
          {c.newReq}
        </Link>
        <div className="lvw-links">
          <Link href="/mobile/attendance/leave/calendar">{c.calTitle} ›</Link>
          <Link href="/mobile/attendance/leave/history">{c.histTitle} ›</Link>
        </div>
      </div>

      <div className="lvw-right">
        <div className="lvw-sec">
          <b>{c.recent}</b>
          <Link href="/mobile/attendance/leave/history">{c.viewAll} ›</Link>
        </div>
        {recent.length === 0 ? <p className="lvw-empty">{c.histEmpty}</p> : recentRows}
        <div className="lvw-sec lvw-rules-h">
          <b>{c.ruleTitle}</b>
        </div>
        <div className="lvw-rules">
          {rules.map((rule, i) => (
            <div className="lvw-row is-static" key={i}>
              <span className="lvw-row__t">{rule}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
