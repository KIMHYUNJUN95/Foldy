"use client";

import { useState, useTransition, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { shiftMonthKey } from "@/components/admin/shared/admin-month-key";
import { RollNumber } from "@/components/shared/roll-number";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { haptic } from "@/lib/haptics";
import type { Dictionary } from "@/lib/i18n";
import { localizeBuildingName } from "@/lib/room-label-normalization";
import type { RevenueChannelKey, RevenueSummary } from "@/lib/ops-revenue-summary";
import "./mobile-revenue.css";

/**
 * 모바일 매출 — 시안 Rev-Phone · Rev-Fold · Rev-Tablet(2026-10-15).
 *
 * 도메인 계약: docs/product/34-metrics-and-automation.md 「모바일 매출」
 *
 * 숫자는 서버가 낸 요약(`buildRevenueSummary`)을 그대로 그린다 — 여기서 새로 셈하지 않는다(막대 높이 비율만). 폰 · 폴드는 한 줄
 * (폴드는 가운데 540px), 태블릿 가로는 왼쪽 숫자 · 채널 | 오른쪽 건물별 + 아래 월별 매출 전체 폭. 월별 막대는 15칸을 다 그리고
 * 폭마다 끝에서 7(폰) · 9(폴드) · 15(태블릿)칸만 보인다 — 높이도 그 창의 최댓값 기준이라 칸마다 세 높이(`--h7` · `--h9` · `--h15`)를
 * 들고 CSS 가 고른다(서버 그림과 처음 그림이 같다).
 */
type Copy = Dictionary["opsRevenue"]["mobile"];

const BASE_PATH = "/mobile/ops/revenue";
/** 달 고르기 시트 — 앞으로 2달부터 거꾸로 이만큼(가동률과 같다). */
const PICKER_MONTHS = 18;
/** 폭마다 보이는 월별 칸 수(끝에서부터). */
const WINDOWS = [7, 9, 15] as const;

const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);

const monthHref = (month: string) => `${BASE_PATH}?ym=${month}`;

/** 건물 줄 → 모바일 판매 캘린더(그 건물 · 그 달) — 모바일 가동률과 같은 주소. */
function calendarHref(property: string, month: string): string {
  const query = new URLSearchParams({ mode: "monthly", property, ym: month });
  return `/mobile/ops/calendar?${query.toString()}`;
}

const CHANNEL_COLOR: Record<RevenueChannelKey, string> = {
  airbnb: "#ff5a5f",
  booking: "#003b95",
  direct: "#8b8898",
  other: "#d9d7e0",
};

export function MobileRevenue({
  summary,
  copy,
  title,
  empty,
  localeTag,
  buildingLabels,
}: {
  summary: RevenueSummary;
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

  const yen = (value: number) => `¥${Math.round(value).toLocaleString(localeTag)}`;
  const pct1 = (value: number) => `${value.toFixed(1)}%`;
  // 소수 첫째 자리로 반올림한 값으로 부호 · 색을 정한다 — 「−0.0%」가 빨갛게 나오지 않게.
  const round1 = (delta: number) => Math.round(delta * 10) / 10;
  const signed = (delta: number) => `${round1(delta) >= 0 ? "+" : "−"}${Math.abs(round1(delta)).toFixed(1)}%`;
  const isDown = (delta: number) => round1(delta) < 0;
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
    <header className="mrv-h">
      <div className="mrv-h__t">
        <h1>{title}</h1>
        <span>{subtitle}</span>
      </div>
      <div className="mrv-mnav">
        <button aria-label={copy.prevMonth} className="mrv-arrow" onClick={() => step(-1)} type="button">
          <ChevronLeft aria-hidden="true" />
        </button>
        <button aria-haspopup="dialog" className="mrv-mlabel" onClick={() => setPicking(true)} type="button">
          {monthLabel(summary.month)}
          <ChevronDown aria-hidden="true" />
        </button>
        <button aria-label={copy.nextMonth} className="mrv-arrow" onClick={() => step(1)} type="button">
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
    </header>
  );

  const picker = picking && (
    <BottomSheet
      ariaLabel={copy.pickMonth}
      header={<div className="mrv-sheet__h">{copy.pickMonth}</div>}
      onClose={() => setPicking(false)}
    >
      {({ close }) => (
        <div className="mrv-sheet">
          {Array.from({ length: PICKER_MONTHS }, (_, index) => shiftMonthKey(todayMonth, 2 - index)).map((month) => (
            <button
              aria-current={month === summary.month ? "true" : undefined}
              className={`mrv-sheet__m${month === summary.month ? " on" : ""}`}
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
      <div className="mrv">
        {header}
        <p className="mrv-empty">{empty}</p>
        {picker}
      </div>
    );
  }

  /** 증감 한 줄 — 오르면 보라, 내리면 빨강, 전년 없으면 흐리게. */
  const deltaLine = (delta: number | null) => (
    <span className={`mrv-d${delta === null ? " is-none" : isDown(delta) ? " is-down" : ""}`}>
      {delta === null ? copy.lastYearNone : fill(copy.vsLastYear, { d: signed(delta) })}
    </span>
  );

  const nums: Array<{ key: string; label: string; value: string; sub: ReactNode }> = [
    { key: "net", label: copy.net, sub: deltaLine(summary.change.net), value: yen(summary.net) },
    {
      key: "commission",
      label: copy.commission,
      sub: (
        <span className="mrv-d is-none">
          {fill(copy.shareOfRevenue, { v: summary.commissionShare === null ? "—" : pct1(summary.commissionShare) })}
        </span>
      ),
      value: yen(summary.commission),
    },
    { key: "adr", label: copy.adr, sub: deltaLine(summary.adr === null ? null : summary.change.adr), value: summary.adr === null ? "—" : yen(summary.adr) },
    {
      key: "revpar",
      label: copy.revpar,
      sub: deltaLine(summary.revpar === null ? null : summary.change.revpar),
      value: summary.revpar === null ? "—" : yen(summary.revpar),
    },
  ];

  // 월별 — 창마다 최댓값(올해 · 전년 중 큰 쪽)으로 높이를 낸다.
  const trend = summary.trend;
  const maxOf = (size: number) =>
    Math.max(1, ...trend.slice(-size).flatMap((month) => [month.revenue, month.previous]));
  const maxima = WINDOWS.map(maxOf);
  const channelName: Record<RevenueChannelKey, string> = {
    airbnb: copy.channelAirbnb,
    booking: copy.channelBooking,
    direct: copy.channelDirect,
    other: copy.channelOther,
  };
  const topBuilding = Math.max(1, ...summary.buildings.map((building) => building.revenue));

  return (
    <div className="mrv">
      <div className={`mrv-in${pending ? " is-pending" : ""}`} key={summary.month}>
        {header}

        <section className="mrv-hero">
          <span className="mrv-hero__l">{copy.total}</span>
          <b className="mrv-hero__v num">
            <RollNumber text={yen(summary.revenue)} />
          </b>
          <span className="mrv-hero__s">
            {deltaLine(summary.change.revenue)}
            {summary.occupancyPct !== null && (
              <>
                {" · "}
                {fill(copy.occupancy, { v: pct1(summary.occupancyPct) })}
              </>
            )}
          </span>
        </section>

        <dl className="mrv-nums">
          {nums.map((item, index) => (
            <div key={item.key}>
              <dt>{item.label}</dt>
              <dd className="num">{item.value === "—" ? "—" : <RollNumber delay={80 + index * 60} text={item.value} />}</dd>
              <dd className="mrv-nums__s">{item.sub}</dd>
            </div>
          ))}
        </dl>

        <section aria-label={copy.trendTitle} className="mrv-sec mrv-trend">
          <div className="mrv-sec__h">
            <h2>{copy.trendTitle}</h2>
            <span aria-hidden="true" className="mrv-lg">
              <span><i className="is-cur" />{copy.legendThisYear}</span>
              <span><i className="is-prev" />{copy.legendLastYear}</span>
              <span><i className="is-booked" />{copy.legendBooked}</span>
            </span>
          </div>
          <div className="mrv-chart">
            {trend.map((month, index) => {
              const fromEnd = trend.length - index;
              const selected = month.month === summary.month;
              const heights = Object.fromEntries(
                WINDOWS.flatMap((size, w) => [
                  [`--h${size}`, `${(month.revenue / maxima[w]) * 100}%`],
                  [`--p${size}`, `${(month.previous / maxima[w]) * 100}%`],
                ]),
              );
              const occ = month.occupancyPct === null ? "—" : `${Math.round(month.occupancyPct)}%`;
              return (
                <button
                  aria-label={fill(copy.barAria, { month: monthName(month.month, true), o: occ, v: yen(month.revenue) })}
                  aria-pressed={selected}
                  className={`mrv-col is-${month.phase}${selected ? " is-sel" : ""}${fromEnd <= 7 ? " in7" : ""}${fromEnd <= 9 ? " in9" : ""}`}
                  key={month.month}
                  onClick={() => {
                    if (!selected) {
                      haptic("light");
                      go(month.month);
                    }
                  }}
                  style={{ "--done": `${month.donePct}%`, "--i": index, ...heights } as CSSProperties}
                  type="button"
                >
                  <span className="mrv-col__bars">
                    <span className="mrv-col__b" />
                    <span className="mrv-col__p" />
                  </span>
                  <span className="mrv-col__m">{monthShort(month.month)}</span>
                  <span className="mrv-col__o num">{occ}</span>
                </button>
              );
            })}
          </div>
          <p className="mrv-note">{copy.trendHint}</p>
        </section>

        <section className="mrv-sec mrv-ch">
          <h2>{copy.channelsTitle}</h2>
          {summary.channels.length === 0 ? (
            <p className="mrv-none">{copy.noMonthData}</p>
          ) : (
            <>
              <span aria-hidden="true" className="mrv-ch__bar">
                {summary.channels.map((channel) => (
                  <i key={channel.key} style={{ background: CHANNEL_COLOR[channel.key], width: `${channel.pct}%` }} />
                ))}
              </span>
              <ul>
                {summary.channels.map((channel) => (
                  <li key={channel.key}>
                    <i style={{ background: CHANNEL_COLOR[channel.key] }} />
                    <span className="mrv-ch__n">{channelName[channel.key]}</span>
                    <span className="mrv-ch__v num">{yen(channel.amount)}</span>
                    <b className="num">{Math.round(channel.pct)}%</b>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="mrv-sec mrv-bld">
          <div className="mrv-sec__h">
            <h2>{copy.byProperty}</h2>
            <span>{copy.byPropertyHint}</span>
          </div>
          {summary.buildings.length === 0 ? (
            <p className="mrv-none">{copy.noMonthData}</p>
          ) : (
            <ul>
              {summary.buildings.map((building, index) => (
                <li key={building.name}>
                  <Link
                    aria-label={fill(copy.openCalendar, { name: bName(building.name) })}
                    className="mrv-row"
                    href={calendarHref(building.name, summary.month)}
                    style={{ "--i": index } as CSSProperties}
                  >
                    <span className="mrv-row__top">
                      <span className="mrv-row__n">{bName(building.name)}</span>
                      <b className="mrv-row__v num">{yen(building.revenue)}</b>
                      <span
                        className={`mrv-row__d num${building.change === null ? " is-new" : isDown(building.change) ? " is-down" : " is-up"}`}
                      >
                        {building.change === null ? copy.newLabel : signed(building.change)}
                      </span>
                    </span>
                    <span className="mrv-row__bar">
                      <i style={{ width: `${(building.revenue / topBuilding) * 100}%` }} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="mrv-note mrv-hint">{copy.pcHint}</p>
        </section>
      </div>
      {picker}
    </div>
  );
}
