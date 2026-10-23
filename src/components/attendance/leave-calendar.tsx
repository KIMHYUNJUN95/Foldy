import Link from "next/link";
import "./leave.css";
import type { ApprovedLeaveEntry } from "@/lib/annual-leave-requests-server";
import { getDictionary } from "@/lib/i18n";

// L5 · 연차 캘린더 — 승인된 연차가 자동 기입되는 월 그리드(리본) + 이번 달 목록.
// 확정 정책(2026-07-06): 전 직원의 "승인된" 연차만 표시(본인 포함) — 대기/반려/임시저장/취소는 비공개.
// `entries`는 page.tsx가 서버에서 조회해 내려준다(annual-leave-requests-server.ts, RLS는 migration
// 202607060003의 org-wide-approved-select 정책). 실제 연/월 이동(`?ym=` 쿼리 + Link)로 동작.
// 겹치는 휴가는 각자 레인(행)을 배정해 리본이 안 겹치게 한다.

type LeaveType = "annual" | "paid" | "special" | "other";

const pad2 = (n: number) => String(n).padStart(2, "0");

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function firstWeekday(year: number, month: number): number {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function localeTag(locale: string): string {
  return locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
}

type LeaveCopy = ReturnType<typeof getDictionary>["leave"];

function typeLabel(t: LeaveType, c: LeaveCopy): string {
  return t === "annual" ? c.typeAnnual : t === "paid" ? c.typePaid : t === "special" ? c.typeSpecial : c.typeOther;
}

export function LeaveCalendar({
  locale,
  ym,
  entries,
  todayDate,
}: {
  locale: string;
  ym: string;
  entries: ApprovedLeaveEntry[];
  todayDate: string;
}) {
  const c = getDictionary(locale).leave;
  const [year, month] = ym.split("-").map(Number);
  const total = daysInMonth(year, month);
  const lead = firstWeekday(year, month);
  const monthStart = `${ym}-01`;
  const monthEnd = `${ym}-${pad2(total)}`;
  const today = todayDate >= monthStart && todayDate <= monthEnd ? Number(todayDate.slice(8, 10)) : null;
  const monthLabel = new Intl.DateTimeFormat(localeTag(locale), { year: "numeric", month: "long" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );

  // 화이트 리디자인(2026-10-13, 시안 AttLeaveCalM): 제목 · 「승인된 휴가만」 · 월 알약 → 월요일 시작 달력(휴가 있는 날 점 —
  // 지난 날은 회색) → 이번 달 휴가 줄(이름 · 종류 / 기간 · 일수 / 오늘 휴가). 예전 리본 · 아바타 색 · 칩은 뺐다.
  const leadMon = (lead + 6) % 7;
  const dayHas = (d: number) => {
    const key = `${ym}-${pad2(d)}`;
    return entries.some((e) => e.startDate <= key && e.endDate >= key);
  };
  const wd = new Intl.DateTimeFormat(localeTag(locale), { weekday: "short", timeZone: "UTC" });
  const heads = Array.from({ length: 7 }, (_, i) => wd.format(new Date(Date.UTC(2024, 0, 1 + i))));
  // 알약 안 달 이름 — en 은 「October」 대신 「Oct」(ko 「10월」 · ja 「10月」는 short 도 같다).
  const monthShort = new Intl.DateTimeFormat(localeTag(locale), { month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
  const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

  return (
    <div className="lv lvw lvw--cal">
      <div className="lvw-left">
        <div className="lvw-title lvw-title--row">
          <div>
            <h1>{c.calTitle}</h1>
            <span>
              {monthLabel} · {c.calApprovedOnly}
            </span>
          </div>
          <div className="lvw-mpill">
            <Link aria-label={c.calPrevMonth} href={`/mobile/attendance/leave/calendar?ym=${shiftMonth(ym, -1)}`}>
              ‹
            </Link>
            <b>{monthShort}</b>
            <Link aria-label={c.calNextMonth} href={`/mobile/attendance/leave/calendar?ym=${shiftMonth(ym, 1)}`}>
              ›
            </Link>
          </div>
        </div>
        <div className="lvw-legend lvw-legend--cal">
          <span><i className="is-used" />{c.calLegendLeave}</span>
          <span><i className="is-past" />{c.calLegendPast}</span>
        </div>
        <div className="lvw-cal">
          {heads.map((h, i) => (
            <span key={h} className={`lvw-cal__wd${i === 5 ? " is-sat" : i === 6 ? " is-sun" : ""}`}>
              {h}
            </span>
          ))}
          {Array.from({ length: leadMon }, (_, i) => (
            <span key={`p${i}`} />
          ))}
          {Array.from({ length: total }, (_, i) => {
            const d = i + 1;
            const key = `${ym}-${pad2(d)}`;
            const has = dayHas(d);
            const past = key < todayDate;
            return (
              <span key={d} className="lvw-cal__cell">
                <span className={`lvw-cal__d${d === today ? " is-today" : ""}`}>
                  {d}
                  <span className="lvw-cal__dot">{has ? <i className={past ? "is-past" : undefined} /> : null}</span>
                </span>
              </span>
            );
          })}
        </div>
      </div>

      <div className="lvw-right">
        <div className="lvw-sec">
          <b>{c.calList}</b>
          <span className="lvw-sec__n">{c.calCount(entries.length)}</span>
        </div>
        {entries.length === 0 ? (
          <p className="lvw-empty">{c.histEmpty}</p>
        ) : (
          [...entries]
            .sort((x, y) => (x.startDate < y.startDate ? -1 : 1))
            .map((e) => {
              const off = e.startDate <= todayDate && e.endDate >= todayDate;
              const past = e.endDate < todayDate;
              return (
                <div className="lvw-row" key={e.id}>
                  <span className="lvw-row__b">
                    <span className="lvw-row__t">
                      {e.applicantName} · {typeLabel(e.leaveType as LeaveType, c)}
                    </span>
                    <span className="lvw-row__s">
                      {e.startDate === e.endDate ? md(e.startDate) : `${md(e.startDate)} – ${md(e.endDate)}`} · {e.daysCount}
                      {c.unitD}
                    </span>
                  </span>
                  {off ? <span className="lvw-row__v is-requested">{c.calOff}</span> : past ? <span className="lvw-row__v is-draft">{c.calLegendPast}</span> : null}
                </div>
              );
            })
        )}
      </div>
    </div>
  );
}
