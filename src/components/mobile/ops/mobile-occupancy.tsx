"use client";

import { useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { shiftMonthKey } from "@/components/admin/shared/admin-month-key";
import { RollNumber } from "@/components/shared/roll-number";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { haptic } from "@/lib/haptics";
import type { Dictionary } from "@/lib/i18n";
import { localizeBuildingName } from "@/lib/room-label-normalization";
import { OCCUPANCY_LINE } from "@/lib/ops-occupancy";
import type { OccupancySummary } from "@/lib/ops-occupancy-summary";
import "./mobile-occupancy.css";

/**
 * 모바일 가동률 — 시안 Occ-Phone · Occ-Fold · Occ-Tablet(2026-10-15).
 *
 * 도메인 계약: docs/product/34-metrics-and-automation.md 「모바일 가동률」
 *
 * 숫자는 서버가 낸 요약(`buildOccupancySummary`)을 그대로 그린다 — 여기서 새로 셈하지 않는다. 폰 · 폴드는 한 줄(폴드는 가운데
 * 540px), 태블릿 가로는 왼쪽 링 · 앞으로 3달 | 오른쪽 건물별 + 아래 월별 추이(그 폭에서만).
 */
type Copy = Dictionary["opsOccupancy"]["mobile"];

const BASE_PATH = "/mobile/ops/occupancy";
const RING_R = 68;
const RING_C = 2 * Math.PI * RING_R;
/** 달 고르기 시트 — 앞으로 2달부터 거꾸로 이만큼. */
const PICKER_MONTHS = 18;

const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);

const monthHref = (month: string) => `${BASE_PATH}?ym=${month}`;

function calendarHref(property: string, month: string): string {
  const query = new URLSearchParams({ mode: "monthly", property, ym: month });
  return `/mobile/ops/calendar?${query.toString()}`;
}

export function MobileOccupancy({
  summary,
  copy,
  title,
  empty,
  localeTag,
  buildingLabels,
}: {
  summary: OccupancySummary;
  copy: Copy;
  title: string;
  empty: string;
  localeTag: string;
  /** 건물 이름을 보는 사람 언어로(`dictionary.cleaning.buildingLabels`) — 요약은 한국어 정규 명칭을 들고 온다. */
  buildingLabels: Record<string, string>;
}) {
  const bName = (name: string) => localizeBuildingName(name, buildingLabels);
  const router = useRouter();
  const [pending, startNav] = useTransition();
  const [picking, setPicking] = useState(false);

  const todayMonth = summary.today.slice(0, 7);
  const go = (month: string) => startNav(() => router.push(monthHref(month), { scroll: false }));
  const step = (direction: -1 | 1) => {
    haptic("light");
    go(shiftMonthKey(summary.month, direction));
  };

  const n = (value: number) => value.toLocaleString(localeTag);
  const whole = (value: number) => `${Math.round(value)}%`;
  const monthName = (month: string, withYear: boolean) =>
    new Intl.DateTimeFormat(localeTag, { month: "long", timeZone: "UTC", ...(withYear ? { year: "numeric" } : {}) }).format(
      new Date(`${month}-15T00:00:00Z`),
    );
  const monthLabel = (month: string) => monthName(month, month.slice(0, 4) !== todayMonth.slice(0, 4));
  const monthShort = (month: string) =>
    new Intl.DateTimeFormat(localeTag, { month: "short", timeZone: "UTC" }).format(new Date(`${month}-15T00:00:00Z`));

  const subtitle =
    summary.excluded.length > 0
      ? fill(copy.totalExcluding, { names: summary.excluded.map(bName).join(" · ") })
      : fill(copy.totalAll, { n: summary.includedCount });

  const header = (
    <header className="moc-h">
      <div className="moc-h__t">
        <h1>{title}</h1>
        <span>{subtitle}</span>
      </div>
      <div className="moc-mnav">
        <button aria-label={copy.prevMonth} className="moc-arrow" onClick={() => step(-1)} type="button">
          <ChevronLeft aria-hidden="true" />
        </button>
        <button aria-haspopup="dialog" className="moc-mlabel" onClick={() => setPicking(true)} type="button">
          {monthLabel(summary.month)}
          <ChevronDown aria-hidden="true" />
        </button>
        <button aria-label={copy.nextMonth} className="moc-arrow" onClick={() => step(1)} type="button">
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
    </header>
  );

  const picker = picking && (
    <BottomSheet
      ariaLabel={copy.pickMonth}
      header={<div className="moc-sheet__h">{copy.pickMonth}</div>}
      onClose={() => setPicking(false)}
    >
      {({ close }) => (
        <div className="moc-sheet">
          {Array.from({ length: PICKER_MONTHS }, (_, index) => shiftMonthKey(todayMonth, 2 - index)).map((month) => (
            <button
              aria-current={month === summary.month ? "true" : undefined}
              className={`moc-sheet__m${month === summary.month ? " on" : ""}`}
              key={month}
              onClick={() => {
                close();
                if (month !== summary.month) go(month);
              }}
              type="button"
            >
              {monthName(month, true)}
              {month === todayMonth && <span>{copy.inProgress}</span>}
            </button>
          ))}
        </div>
      )}
    </BottomSheet>
  );

  if (!summary.hasProperties) {
    return (
      <div className="moc">
        {header}
        <p className="moc-empty">{empty}</p>
        {picker}
      </div>
    );
  }

  const hasMonth = summary.pct !== null;
  const delta = summary.pct !== null && summary.previousPct !== null ? summary.pct - summary.previousPct : null;
  const deltaText =
    delta === null
      ? copy.lastYearNone
      : fill(copy.lastYear, { d: `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}${copy.pointSuffix}` });
  const ringPct = summary.pct ?? 0;

  return (
    <div className="moc">
      <div className={`moc-in${pending ? " is-pending" : ""}`} key={summary.month}>
        {header}

        <section className="moc-hero">
          <div className="moc-ring">
            <svg
              aria-label={fill(copy.ringAria, { month: monthLabel(summary.month), v: hasMonth ? `${ringPct.toFixed(1)}%` : "—" })}
              role="img"
              viewBox="0 0 152 152"
            >
              <circle className="moc-ring__track" cx="76" cy="76" r={RING_R} />
              {hasMonth && ringPct > 0 && (
                <circle
                  className="moc-ring__arc"
                  cx="76"
                  cy="76"
                  r={RING_R}
                  style={{ "--c": RING_C, "--off": RING_C * (1 - Math.min(100, ringPct) / 100) } as CSSProperties}
                  transform="rotate(-90 76 76)"
                />
              )}
            </svg>
            <span className="moc-ring__c">
              <b className="num">
                {hasMonth ? <RollNumber text={ringPct.toFixed(1)} /> : "—"}
                {hasMonth && <small>%</small>}
              </b>
              {hasMonth && <span className={delta !== null && delta < 0 ? "is-down" : delta === null ? "is-none" : ""}>{deltaText}</span>}
            </span>
          </div>
          <dl className="moc-nums">
            <div>
              <dt>{copy.sold}</dt>
              <dd className="num">{hasMonth ? n(summary.occupied) : "—"}</dd>
            </div>
            <div>
              <dt>{copy.vacant}</dt>
              <dd className="num">{hasMonth ? n(summary.vacant) : "—"}</dd>
            </div>
            <div>
              <dt>{copy.under}</dt>
              <dd className={`num${summary.underLine > 0 ? " is-low" : ""}`}>
                {hasMonth ? fill(summary.underLine === 1 ? copy.underUnitOne : copy.underUnit, { n: n(summary.underLine) }) : "—"}
              </dd>
            </div>
            {summary.thisMonth && (
              <div>
                <dt>{fill(copy.booked, { month: monthShort(summary.thisMonth.month) })}</dt>
                <dd className="num">{summary.thisMonth.pct === null ? "—" : whole(summary.thisMonth.pct)}</dd>
              </div>
            )}
          </dl>
        </section>

        <section className="moc-sec moc-bld">
          <h2>{copy.byProperty}</h2>
          {summary.buildings.length === 0 ? (
            <p className="moc-none">{copy.noMonthData}</p>
          ) : (
            <ul>
              {summary.buildings.map((building, index) => {
                const low = building.pct < OCCUPANCY_LINE;
                return (
                  <li key={building.name}>
                    <Link
                      aria-label={fill(copy.openCalendar, { name: bName(building.name) })}
                      className={`moc-row${low ? " is-low" : ""}`}
                      href={calendarHref(building.name, summary.month)}
                      style={{ "--i": index } as CSSProperties}
                    >
                      <span className="moc-row__n">{bName(building.name)}</span>
                      <span className="moc-bar">
                        <span className="moc-bar__track">
                          <i style={{ width: `${Math.min(100, building.pct)}%` }} />
                        </span>
                        <b style={{ left: `${OCCUPANCY_LINE}%` }} />
                      </span>
                      <b className="moc-row__v num">{whole(building.pct)}</b>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {summary.forward.length > 0 && (
          <section className="moc-sec moc-fwd">
            <div className="moc-sec__h">
              <h2>{copy.forwardTitle}</h2>
              <span>{copy.forwardHint}</span>
            </div>
            <div className="moc-fwd__cols">
              {summary.forward.map((month, index) => (
                <div className="moc-fwd__c" key={month.month} style={{ "--i": index } as CSSProperties}>
                  <span className="moc-fwd__m">
                    {monthLabel(month.month)}
                    {month.month === todayMonth && (
                      <>
                        {" · "}
                        <b>{copy.inProgress}</b>
                      </>
                    )}
                  </span>
                  <b className="moc-fwd__v num">
                    {month.pct === null ? "—" : whole(month.pct)}
                  </b>
                  <span className="moc-fwd__bar">
                    <i style={{ width: `${Math.min(100, month.pct ?? 0)}%` }} />
                  </span>
                  <span className="moc-fwd__s num">{fill(copy.vacantN, { v: n(month.vacant) })}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <p className="moc-hint">{copy.pcHint}</p>

        <section aria-label={copy.trendTitle} className="moc-sec moc-trend">
          <div className="moc-sec__h is-start">
            <h2>{copy.trendTitle}</h2>
            <span>{copy.trendHint}</span>
          </div>
          <div className="moc-chart">
            <span aria-hidden="true" className="moc-chart__line" style={{ "--h": OCCUPANCY_LINE } as CSSProperties} />
            {summary.trend.map((month, index) => {
              const selected = month.month === summary.month;
              const low = month.pct !== null && month.pct < OCCUPANCY_LINE && month.phase === "past";
              const tone = month.phase === "future" ? "is-future" : month.phase === "current" ? "is-current" : low ? "is-low" : "";
              return (
                <button
                  aria-label={`${monthName(month.month, true)} ${month.pct === null ? "—" : whole(month.pct)}`}
                  aria-pressed={selected}
                  className={`moc-col ${tone}${selected ? " is-sel" : ""}`}
                  key={month.month}
                  onClick={() => {
                    if (!selected) {
                      haptic("light");
                      go(month.month);
                    }
                  }}
                  style={{ "--i": index, "--done": `${month.donePct}%` } as CSSProperties}
                  type="button"
                >
                  <span className="moc-col__v num">{month.pct === null ? "—" : Math.round(month.pct)}</span>
                  <span className="moc-col__b" style={{ "--h": Math.min(100, month.pct ?? 0) } as CSSProperties} />
                </button>
              );
            })}
          </div>
          <div aria-hidden="true" className="moc-chart__x">
            {summary.trend.map((month) => (
              <span className={month.month === summary.month ? "on" : ""} key={month.month}>
                {monthShort(month.month)}
              </span>
            ))}
          </div>
        </section>
      </div>
      {picker}
    </div>
  );
}
