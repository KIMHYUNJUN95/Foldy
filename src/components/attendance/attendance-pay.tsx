"use client";

/**
 * 출석 본인 월 급여 — 스크린샷 핸드오프에 맞춰 다시 디자인.
 * 구조: ptitle-row (seg-month) → paycard → excl 배너 → 시급 구간 → 일별 ptbl.
 * 월급제 → 문서 아이콘 빈 상태.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import "./attendance.css";
import { AIc, AttIcon } from "./att-icons";
import { MonthSwitcher } from "./month-switcher";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import type { MonthlyPayView, PayExcludeReason } from "@/lib/attendance-pay";
import { ONE_YEN_PAY_START_YM } from "@/lib/attendance-pay-calculation";
import { getDictionary } from "@/lib/i18n";
import { usePersistentToggle } from "@/lib/use-persistent-toggle";

function fmtDur(totalMinutes: number, hourLabel: string, minLabel: string): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return `${h}${hourLabel} ${m}${minLabel}`;
  return `${m}${minLabel}`;
}

function shortMonthLabel(ym: string, locale: string): string {
  const dt = new Date(`${ym}-01T00:00:00+09:00`);
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Tokyo",
    month: "long",
  }).format(dt);
}

/** YYYY-MM-DD 에서 "M/D" */
function shortDate(date: string): string {
  const [, mm, dd] = date.split("-");
  return `${parseInt(mm, 10)}/${parseInt(dd, 10)}`;
}

/** ptbl 용 일/요일, YYYY-MM-DD 에서 */
function ptblDate(date: string, locale: string): { day: string; wd: string } {
  const dt = new Date(`${date}T00:00:00+09:00`);
  const day = dt.getDate().toString();
  const wd = new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Tokyo",
    weekday: "short",
  }).format(dt);
  return { day, wd };
}

type SegmentWithRange = {
  rate: number;
  paidMinutes: number;
  gross: number;
  startDate: string;
  endDate: string;
  isRaise: boolean;
};

/** 일 배열에서 시급 구간의 날짜 범위를 계산한다. */
function computeSegmentsWithRanges(
  rateSegments: MonthlyPayView["rateSegments"],
  days: MonthlyPayView["days"],
): SegmentWithRange[] {
  const ranges = new Map<number, { start: string; end: string }>();
  for (const d of days) {
    if (d.hourlyRate == null) continue;
    const r = d.hourlyRate;
    const ex = ranges.get(r);
    if (!ex) {
      ranges.set(r, { start: d.date, end: d.date });
    } else {
      if (d.date < ex.start) ex.start = d.date;
      if (d.date > ex.end) ex.end = d.date;
    }
  }

  const sorted = [...rateSegments].sort((a, b) => {
    const aR = ranges.get(a.rate);
    const bR = ranges.get(b.rate);
    if (aR && bR) return aR.start.localeCompare(bR.start);
    return a.rate - b.rate;
  });

  const minRate = Math.min(...sorted.map((s) => s.rate));

  return sorted.map((seg) => {
    const range = ranges.get(seg.rate) ?? { start: "—", end: "—" };
    return {
      ...seg,
      startDate: range.start,
      endDate: range.end,
      isRaise: seg.rate > minRate,
    };
  });
}

export function AttendancePay({
  view,
  currentYm,
  locale,
}: {
  view: MonthlyPayView;
  currentYm: string;
  locale: string;
}) {
  const copy = getDictionary(locale).attendance;
  const isCurrentMonth = view.ym === currentYm;
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // HIG 2차(2026-10-20): 막대 칸 폭을 정수 px 로 내림 — 폭 ÷ 날 수가 소수점이면 막대마다 굵기가 1px씩 달라 보였다.
  const chartRef = useRef<HTMLDivElement>(null);
  const [colPx, setColPx] = useState<number | null>(null);
  const dayCount = new Date(Number(view.ym.slice(0, 4)), Number(view.ym.slice(5, 7)), 0).getDate();
  useEffect(() => {
    const el = chartRef.current;
    if (!el || dayCount === 0) return;
    const measure = () => setColPx(Math.max(1, Math.floor(el.clientWidth / dayCount)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dayCount, view]);
  const selected = view.days.find((d) => d.date === selectedDate) ?? null;
  const close = () => setSelectedDate(null);
  const [excludedOpen, setExcludedOpen] = useState(false);
  // 기본은 숨김(true). 세션 간 유지되며 attendance-home 과 키를 공유한다.
  const [payHidden, togglePayHidden] = usePersistentToggle(
    "stayops:attendance:pay-amount-visible",
    true,
  );

  function dur(mins: number) {
    return fmtDur(mins, copy.durationHour, copy.durationMin);
  }
  function amount(n: number) {
    return copy.payAmount(n.toLocaleString("ja-JP"));
  }
  function excludeLabel(r: PayExcludeReason): string {
    if (r === "open") return copy.sessOpen;
    if (r === "invalid") return copy.statusInvalid;
    if (r === "review_required") return copy.statusReviewRequired;
    if (r === "pending_correction") return copy.statusPendingCorrection;
    return copy.excludeDefault;
  }

  const isFinal = !!view.finalization;
  const grossAmount = isFinal ? view.finalization!.gross : view.expectedGross;
  const paidMins = isFinal ? view.finalization!.paidMinutes : view.totalPaidMinutes;
  // grossAmount 에는 이미 근태 수당이 포함돼 있다. 기본급 = 합계 − 수당이므로 일별
  // 표 하단(기본급)과 수당 구간이 항상 헤드라인 합계로 다시 맞아떨어진다.
  const allowanceTotal = view.allowanceTotal;
  const baseSubtotal = grossAmount - allowanceTotal;

  // Page title: "이번 달 급여" / "6월 급여" / "급여" for salaried
  const segCurLabel = shortMonthLabel(view.ym, locale);
  const pageTitle = copy.payPageTitle;
  void isCurrentMonth;

  const titleRow = (
    <div className="ptitle-row">
      <div>
        <h1 className="ptitle">{pageTitle}</h1>
        <div className="ptitle__sub">
          {view.salariedOnly
            ? copy.paySubtitle
            : (isFinal ? copy.payTitleSubFinal : copy.payTitleSubEst).replace("{month}", segCurLabel)}
        </div>
      </div>
      <MonthSwitcher
        ym={view.ym}
        currentYm={currentYm}
        basePath="/mobile/attendance/pay"
        locale={locale}
        labels={{ prev: copy.monthPrev, next: copy.monthNext, select: copy.monthSelect }}
      />
    </div>
  );

  // 월급제 빈 상태
  if (view.salariedOnly) {
    return (
      <div className="att">
        {titleRow}
        <div className="salaried">
          <span className="salaried__ic"><AIc>{AttIcon.doc}</AIc></span>
          <p className="salaried__t">{copy.payOnlySalaried}</p>
          <p className="salaried__s">{copy.payOnlySalariedSub}</p>
          <Link href="/mobile/attendance/history" className="salaried__btn">
            <AIc>{AttIcon.clock}</AIc>{copy.historyTitle}
          </Link>
        </div>
      </div>
    );
  }

  // 기록 없음
  if (view.days.length === 0) {
    return (
      <div className="att">
        {titleRow}
        <div className="salaried">
          <span className="salaried__ic"><AIc>{AttIcon.clock}</AIc></span>
          <p className="salaried__t">{copy.payNoRecords}</p>
        </div>
      </div>
    );
  }

  const segmentsWithRanges = computeSegmentsWithRanges(view.rateSegments, view.days);
  const hourlyDays = view.days.filter((d) => d.employmentType === "hourly").length;
  const heroBits = [
    segmentsWithRanges.length > 1
      ? copy.payHeroRates.replace("{n}", String(segmentsWithRanges.length))
      : segmentsWithRanges[0]
        ? copy.payHeroRate.replace("{rate}", `¥${segmentsWithRanges[0].rate.toLocaleString("ja-JP")}`)
        : null,
    copy.payHeroPaid.replace("{dur}", dur(paidMins)),
    allowanceTotal > 0 ? copy.payHeroAllow.replace("{amt}", `¥${allowanceTotal.toLocaleString("ja-JP")}`) : null,
  ].filter(Boolean);

  // 날짜별 막대 — 그 달 1일~말일 전체 축. 인정 시간 비례, 진행 중 = 진한 보라 짧은 막대,
  // 급여 제외 = 빨간 짧은 막대 + 사유(2026-10-13 시안). 근무 없는 날은 빈 칸.
  const dayByDate = new Map(view.days.map((d) => [d.date, d]));
  const [yy, mo] = view.ym.split("-").map(Number);
  const monthDays = new Date(yy, mo, 0).getDate();
  const bars = Array.from({ length: monthDays }, (_, i) => {
    const date = `${view.ym}-${String(i + 1).padStart(2, "0")}`;
    const d = dayByDate.get(date) ?? null;
    const isRunning = !!d && d.sessions.some((ss) => !ss.included && ss.excludeReason === "open" && !ss.clockOutLabel);
    const isExcluded = !!d && !isRunning && d.sessions.length > 0 && d.sessions.every((ss) => !ss.included);
    return { n: i + 1, date, d, isRunning, isExcluded };
  });
  const maxMin = Math.max(60, ...view.days.map((d) => d.paidMinutes));
  // 날짜 숫자는 1 · 5 · 10 … 만(근무일마다 쓰면 붙어서 겹친다, 2026-10-13 제보).
  // 막대가 좁아 숫자는 근무일이 적을 때만(이웃과 겹치지 않게). 진행 중 · 제외 사유는 아래 날짜 줄에.
  const showValues = view.days.length <= 8;
  function hm(mins: number) {
    return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;
  }

  return (
    <div className="att att--pay att--payw">
      {titleRow}

      {/* 화이트 리디자인(2026-10-13, 시안 AttPay-Phone · Fold · Tablet): 큰 예상 총액 · 숫자 셋 · 날짜별 막대 · 날짜 줄.
          태블릿 가로는 왼쪽(총액 · 숫자 · 구간 · 수당) | 오른쪽(막대 · 날짜 줄). */}
      <div className="att-pay__side">
        <div className="payw-hero">
          <div className="payw-hero__k">
            {isFinal ? copy.payFinalizedLabel : copy.payExpectedLabel}
            <button type="button" className="payw-eye" onClick={togglePayHidden} aria-label={copy.homePayHide}>
              <AIc>{payHidden ? AttIcon.eyeOff : AttIcon.eye}</AIc>
            </button>
          </div>
          <div className={`payw-hero__v${payHidden ? " is-hidden" : ""}`}>
            {payHidden ? `¥${grossAmount.toLocaleString("ja-JP")}` : <PayOdometer key="shown" text={`¥${grossAmount.toLocaleString("ja-JP")}`} />}
          </div>
          <div className="payw-hero__s">{heroBits.join(" · ")}</div>
          {isFinal ? <div className="payw-hero__note">{copy.payFinalizedNote(view.finalization!.finalizedAtLabel ?? "")}</div> : null}
        </div>

        <div className="payw-stats">
          <div className="payw-stat">
            <span className="payw-stat__k">{copy.payWorkDays}</span>
            <b className="payw-stat__v">{copy.payWorkDaysCount(hourlyDays)}</b>
          </div>
          <div className="payw-stat">
            <span className="payw-stat__k">{copy.payPaidHours}</span>
            <b className="payw-stat__v">{dur(paidMins)}</b>
          </div>
          <button
            type="button"
            className={`payw-stat${view.excludedCount > 0 ? " is-danger" : ""}`}
            onClick={() => (view.excludedCount > 0 ? setExcludedOpen(true) : undefined)}
            disabled={view.excludedCount === 0}
          >
            <span className="payw-stat__k">{copy.payStatExcluded}</span>
            <b className="payw-stat__v">{copy.payExcludedN.replace("{n}", String(view.excludedCount))}</b>
          </button>
        </div>

        {segmentsWithRanges.length > 1 ? (
          <div className="payw-sec">
            <div className="payw-sec__t">
              {copy.payRateSegments}
              <span>{copy.paySegCount(segmentsWithRanges.length)}</span>
            </div>
            {segmentsWithRanges.map((seg) => (
              <div key={seg.rate} className="payw-row">
                <div className="payw-row__b">
                  <div className="payw-row__t">¥{seg.rate.toLocaleString("ja-JP")}{copy.payRatePerHour}{seg.isRaise ? ` ${copy.payRateRaise}` : ""}</div>
                  <div className="payw-row__s">{seg.startDate !== "—" ? `${shortDate(seg.startDate)} – ${shortDate(seg.endDate)}` : "—"} · {dur(seg.paidMinutes)}</div>
                </div>
                <b className="payw-row__v">{amount(Math.round(seg.gross))}</b>
              </div>
            ))}
          </div>
        ) : null}

        {view.allowances.length > 0 ? (
          <div className="payw-sec">
            <div className="payw-sec__t">
              {copy.payAllowanceSection}
              <span>{copy.paySegCount(view.allowances.length)}</span>
            </div>
            {view.allowances.map((al) => (
              <div key={al.allowanceId} className="payw-row">
                <div className="payw-row__b">
                  <div className="payw-row__t">{al.category === "special" ? copy.payAllowanceSpecial : copy.payAllowanceRegular}</div>
                  <div className="payw-row__s">
                    {shortDate(al.date)} · {al.type === "hourly_extra" ? copy.payAllowanceHourly : copy.payAllowanceDaily}
                  </div>
                </div>
                <b className="payw-row__v">+{amount(Math.round(al.calculatedAmount))}</b>
              </div>
            ))}
            <p className="gross-note">{copy.payAllowanceIncluded}</p>
          </div>
        ) : null}
      </div>

      <div className="att-pay__main">
        <div className="payw-chart" ref={chartRef} style={colPx ? ({ "--col": `${colPx}px` } as React.CSSProperties) : undefined}>
          <div className="payw-chart__h">
            <b>{copy.payChartTitle}</b>
            <span>{copy.payChartLegend}</span>
          </div>
          <div className="payw-bars">
            {bars.map(({ n, date, d, isRunning, isExcluded }) =>
              d ? (
                <button key={date} type="button" className="payw-bar" style={{ "--i": n } as React.CSSProperties} onClick={() => setSelectedDate(date)} aria-label={d.dateLabel}>
                  <span className="payw-bar__v">{showValues && !isRunning && !isExcluded && d.paidMinutes > 0 ? hm(d.paidMinutes) : ""}</span>
                  <i
                    className={isRunning ? "is-now" : isExcluded ? "is-danger" : undefined}
                    style={{ height: isRunning || isExcluded ? 8 : Math.max(4, Math.round((d.paidMinutes / maxMin) * 100)) }}
                  />
                </button>
              ) : (
                <span key={date} className="payw-bar is-empty" aria-hidden="true">
                  <i />
                  <span className="payw-bar__n">{n}</span>
                </span>
              ),
            )}
          </div>
          <div className="payw-days" aria-hidden="true">
            {bars.map(({ n, date, d }) => (
              <span key={date} className={d ? "is-on" : undefined}>
                {n === 1 || n % 5 === 0 || (n === monthDays && n % 5 >= 3) ? n : ""}
              </span>
            ))}
          </div>
        </div>

        <div className="payw-list">
          {[...view.days].reverse().map((d) => {
            const { wd } = ptblDate(d.date, locale);
            const isExcluded = d.sessions.length > 0 && d.sessions.every((ss) => !ss.included);
            const isRunning = d.sessions.some((ss) => !ss.included && ss.excludeReason === "open" && !ss.clockOutLabel);
            const first = d.sessions.find((ss) => !ss.included);
            return (
              <button key={d.date} type="button" className="payw-line" onClick={() => setSelectedDate(d.date)}>
                <span className="payw-line__t">
                  {shortDate(d.date)} ({wd}) · {d.paidMinutes > 0 ? dur(d.paidMinutes) : "—"}
                </span>
                <span className={`payw-line__v${isExcluded && !isRunning ? " is-danger" : isRunning ? " is-now" : ""}`}>
                  {isRunning
                    ? copy.sessOpen
                    : isExcluded
                      ? first
                        ? excludeLabel(first.excludeReason)
                        : copy.excludeDefault
                      : d.employmentType === "hourly"
                        ? amount(Math.round(d.grossExact))
                        : "—"}
                </span>
              </button>
            );
          })}
          <div className="payw-line payw-line--foot">
            <span className="payw-line__t">
              {segCurLabel} {allowanceTotal > 0 ? copy.payBaseSubtotal : copy.payTotal} · {dur(paidMins)}
            </span>
            <b className="payw-line__v">{amount(baseSubtotal)}</b>
          </div>
        </div>

        <p className="gross-note">
          {copy.payDisclaimerBase} {isFinal ? copy.payDisclaimerFinal : copy.payDisclaimerPending}{" "}
          {view.ym >= ONE_YEN_PAY_START_YM ? copy.payRoundNote : copy.payRoundNoteLegacy}
        </p>
      </div>

      {/* 제외된 세션 목록 시트 */}
      {excludedOpen && (
        <BottomSheet onClose={() => setExcludedOpen(false)}>
          <div className="att">
            <h3 className="rsheet__t">{copy.payExcludedTitle(view.excludedCount)}</h3>
            <p className="rsheet__s">{copy.payExcludedBody}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
              {view.days.flatMap((d) =>
                d.sessions
                  .filter((s) => !s.included)
                  .map((s) => (
                    <button
                      key={s.sessionId}
                      type="button"
                      onClick={() => {
                        setExcludedOpen(false);
                        setSelectedDate(d.date);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        background: "var(--bg)",
                        border: "1px solid var(--line-soft)",
                        borderRadius: 14,
                        padding: "12px 13px",
                        textAlign: "left",
                        font: "inherit",
                        cursor: "pointer",
                        color: "inherit",
                        width: "100%",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 800 }}>{d.dateLabel}</div>
                        <div className="mono" style={{ fontSize: 12, color: "var(--att-muted)", marginTop: 3 }}>
                          {s.clockInLabel ?? "--:--"} –{" "}
                          {s.clockOutLabel ?? (s.excludeReason === "open" ? copy.sessOpen : copy.histNoRecord)}
                        </div>
                      </div>
                      <span
                        className={`chip ${s.excludeReason === "review_required" || s.excludeReason === "pending_correction" ? "c-warn" : "c-invalid"}`}
                        style={{ fontSize: 10, padding: "2px 7px", flexShrink: 0 }}
                      >
                        {excludeLabel(s.excludeReason)}
                      </span>
                      <span style={{ color: "var(--att-muted)", flexShrink: 0 }}><AIc>{AttIcon.chevR}</AIc></span>
                    </button>
                  ))
              )}
            </div>
          </div>
        </BottomSheet>
      )}

      {/* 일별 상세 하단 시트 */}
      {selected && (
        <BottomSheet onClose={close}>
          <div className="att">
            <h3 className="rsheet__t">{selected.dateLabel}</h3>
            <div className="histsheet__chips">
              {selected.employmentType === "hourly" ? (
                <span className="chip c-method">
                  {copy.empHourlyRate(selected.hourlyRate?.toLocaleString("ja-JP") ?? "—")}
                </span>
              ) : selected.employmentType === "salaried" ? (
                <span className="chip c-invalid">{copy.empSalaried}</span>
              ) : (
                <span className="chip c-warn">{copy.empUnset}</span>
              )}
            </div>
            <div className="recap">
              <div className="recap__r">
                <span className="recap__k">{copy.payPaidHours}</span>
                <span className="recap__v mono">{dur(selected.paidMinutes)}</span>
              </div>
              <div className="recap__r">
                <span className="recap__k">{copy.payDailyPay}</span>
                <span className="recap__v">
                  {selected.employmentType === "hourly"
                    ? amount(Math.round(selected.grossExact))
                    : "—"}
                </span>
              </div>
            </div>
            <div className="histbreaks">
              {selected.sessions.map((s, i) => (
                <div className="histbreaks__r" key={s.sessionId}>
                  <span className="histbreaks__k">{copy.paySessionLabel(i + 1)}</span>
                  <span className="mono">
                    {s.clockInLabel ?? "--:--"} – {s.clockOutLabel ?? "--:--"}
                  </span>
                  <span className="histbreaks__d">
                    {s.included
                      ? dur(s.paidMinutes)
                      : (excludeLabel(s.excludeReason) || copy.excludeDefault)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}

/** 급여 금액 자릿수 굴림(2026-10-14, 시안 Motion-B-PayCount-Phone) — 보이게 할 때마다(가림을 걷을 때 다시 마운트) 자리마다 0에서 굴러
 *  정확한 금액에서 스프링으로 멈춘다. 오른쪽 자리일수록 늦게 · 더 많이 굴린다. 굴릴 때만 살짝 흐림. 화면 읽기 프로그램엔 금액 그대로. */
function PayOdometer({ text }: { text: string }) {
  return (
    <span className="payo" aria-label={text}>
      {text.split("").map((ch, i) => {
        if (!/[0-9]/.test(ch)) {
          return (
            <span key={i} className="payo__sym" aria-hidden="true">
              {ch}
            </span>
          );
        }
        const n = Number(ch);
        const idx = text.slice(0, i).replace(/[^0-9]/g, "").length;
        const steps = n + 10 + (idx >= 3 ? 10 : 0);
        return (
          <span key={i} className="payo__col" aria-hidden="true">
            <span className="payo__strip" style={{ "--to": `-${steps}em`, animationDelay: `${120 + idx * 70}ms`, animationDuration: `${1000 + idx * 110}ms` } as React.CSSProperties}>
              {Array.from({ length: 31 }, (_, k) => (
                <b key={k}>{k % 10}</b>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
