"use client";

import { Fragment, useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { exportOpsOccupancyReport, exportOpsOccupancyWorkbook, type OpsOccupancyExportPayload } from "@/app/admin/ops/occupancy/actions";
import { AdminDateRangePicker } from "@/components/admin/shared/admin-date-range-picker";
import { AdminExportButtons } from "@/components/admin/shared/admin-export-buttons";
import { AdminMonthPicker } from "@/components/admin/shared/admin-month-picker";
import { shiftMonthKey } from "@/components/admin/shared/admin-month-key";
import { RollNumber } from "@/components/shared/roll-number";
import type { Dictionary } from "@/lib/i18n";
import {
  OCCUPANCY_LINE,
  heatLevel,
  isMostlyVacant,
  mostVacantCells,
  occupancyGrade,
  roomsBelowUsual,
  seriesAverage,
  vacancyLevel,
  type RoomSeries,
} from "@/lib/ops-occupancy";
import {
  REVENUE_MODES,
  fiscalPeriodNumber,
  metricsOf,
  monthPhase,
  shiftRange,
  sumMetrics,
  type RevenueCell,
  type RevenueMetrics,
  type RevenueMode,
  type RevenueRange,
} from "@/lib/ops-revenue";
import type { OpsRevenueData } from "@/lib/ops-revenue-server";
import "./ops-occupancy-white.css";

/**
 * 가동률 화면 — 추이 · 건물별 / 객실 × 월 / 앞으로, 탭 셋 (2026-10-07 구현 · 2026-10-15 화이트 리디자인).
 *
 * 도메인 계약: docs/product/34-metrics-and-automation.md 「가동률 화면」 · 시각 규칙: docs/design/05-white-redesign.md
 *
 * 숫자는 매출 화면과 **같은 칸**(`getOpsRevenueData`)이다 — 판매 박 · 전체 박을 건물 × 달 조각으로 받아, 합계에 넣을
 * 건물을 골라 더하고 비율을 다시 나눈다. 화이트 리디자인에서 매출 화면 부품(`orv__*`)을 떼고 이 화면 전용 `ocw-*`
 * (`ops-occupancy-white.css`)로 다시 그렸다 — 상자 · 알약 없이 한 화면, 합계 건물 고르기는 칩 9개 대신 드롭다운 하나.
 */
type Copy = Dictionary["opsOccupancy"];
type RevenueCopy = Dictionary["opsRevenue"];
type SharedCopy = Dictionary["admin"]["shared"];
export type OccupancyTab = "report" | "rooms" | "forward";
type SortKey = "occupancy" | "nights" | "vacant" | "previous" | "change";
type RoomSort = "catalog" | "last" | "avg";

const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);

/** 히트맵 5단계 — 60 아래 옅은 빨강, 그 위는 보라 농도 4단계(시안 OccHeat-PC). */
const HEAT_BG = ["#FCE8EA", "#EFEAFB", "#DCD0FA", "#C2AEF6", "#A688F0"];
/** 앞으로 칸 — 방 수 대비 빈 박. 0 = 거의 팔림(옅음) ~ 4 = 거의 빔(진함). */
const VACANCY_BG = ["#FAF8FF", "#EFEAFB", "#DCD0FA", "#C2AEF6", "#A688F0"];

export function occupancyHref(mode: RevenueMode, range: RevenueRange, tab: OccupancyTab): string {
  const query = new URLSearchParams({ mode });
  if (mode === "month") query.set("ym", range.from.slice(0, 7));
  else query.set("from", range.from);
  if (mode === "custom") query.set("to", range.to);
  if (tab !== "report") query.set("tab", tab);
  return `/admin/ops/occupancy?${query.toString()}`;
}

/** 판매 캘린더 그 건물 · 그 달(월간 보기). */
function calendarHref(property: string, month: string): string {
  const query = new URLSearchParams({ mode: "monthly", property, ym: month });
  return `/admin/ops/calendar?${query.toString()}`;
}

/** 다른 모드로 갈 때 — 지금 보던 기간의 끝(오늘보다 뒤면 오늘)이 든 그 모드의 기간으로. 모양은 서버가 바로잡는다. */
function shiftToMode(mode: RevenueMode, range: RevenueRange, today: string): RevenueRange {
  const base = range.to > today && range.from <= today ? today : range.to;
  return mode === "month" ? { from: `${base.slice(0, 7)}-01`, to: base } : { from: base, to: base };
}

export function OpsOccupancyConsole({
  data,
  copy,
  rcopy,
  shared,
  localeTag,
  initialTab,
}: {
  data: OpsRevenueData;
  copy: Copy;
  rcopy: RevenueCopy;
  shared: SharedCopy;
  localeTag: string;
  initialTab: OccupancyTab;
}) {
  const router = useRouter();
  const [navPending, startNav] = useTransition();
  const [tab, setTab] = useState<OccupancyTab>(initialTab);
  const [included, setIncluded] = useState<Set<string>>(() => new Set(data.properties.filter((p) => !p.defaultExcluded).map((p) => p.name)));
  const [toast, setToast] = useState<string | null>(null);
  const w = copy.white;

  useEffect(() => {
    const url = new URL(window.location.href);
    if (tab === "report") url.searchParams.delete("tab");
    else url.searchParams.set("tab", tab);
    window.history.replaceState(window.history.state, "", url.toString());
  }, [tab]);

  const flash = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((current) => (current === text ? null : current)), 2000);
  };
  const go = (href: string) => startNav(() => router.push(href));

  const n = (value: number) => value.toLocaleString(localeTag);
  const pct = (value: number) => `${value.toFixed(1)}%`;
  const pointText = (current: number, previous: number) => {
    const d = current - previous;
    return `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}${rcopy.pointSuffix}`;
  };
  const monthShort = (month: string) =>
    new Intl.DateTimeFormat(localeTag, {
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${month}-15T00:00:00Z`));
  const monthLong = (month: string) =>
    new Intl.DateTimeFormat(localeTag, {
      month: "long",
      timeZone: "UTC",
      year: "numeric",
    }).format(new Date(`${month}-15T00:00:00Z`));
  const dayLabel = (date: string, withYear: boolean) =>
    new Intl.DateTimeFormat(localeTag, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
      ...(withYear ? { year: "numeric" } : {}),
    }).format(new Date(`${date}T00:00:00Z`));
  const rangeLabel = (mode: RevenueMode, range: RevenueRange) => {
    if (mode === "month") return monthLong(range.from.slice(0, 7));
    if (mode === "fiscal") {
      return fill(rcopy.fiscalLabel, {
        from: range.from.slice(0, 7).replace("-", "."),
        n: fiscalPeriodNumber(Number(range.from.slice(0, 4))),
        to: range.to.slice(0, 7).replace("-", "."),
      });
    }
    if (mode === "year") return range.from.slice(0, 4);
    const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
    return `${dayLabel(range.from, true)} – ${dayLabel(range.to, !sameYear)}`;
  };
  const gradeLabel = (value: number) =>
    ({
      excellent: copy.gradeExcellent,
      fair: copy.gradeFair,
      good: copy.gradeGood,
      poor: copy.gradePoor,
    })[occupancyGrade(value)];

  const isIn = (name: string) => included.has(name);
  const inNames = data.properties.filter((p) => isIn(p.name)).map((p) => p.name);
  const totalOf = (cells: Record<string, RevenueCell> | undefined) => sumMetrics(inNames.map((name) => cells?.[name]));
  const current = totalOf(data.rangeCells);
  const previous = totalOf(data.previousRangeCells);
  const phase = data.range.to < data.today ? "past" : data.range.from > data.today ? "future" : "current";
  const months12 = data.months.slice(0, 12);
  const anchor = data.months[11];

  /** 객실 12달 — 문 열기 전(분모 0)은 `null`. 한 달도 안 열린 방(목록 밖)은 뺀다. */
  const roomSeries: RoomSeries[] = data.properties.flatMap((property) =>
    property.rooms
      .map((room) => ({
        key: room.key,
        label: room.label,
        property: property.name,
        values: months12.map((month) => {
          const cell = data.monthRoomCells[month]?.[room.key];
          return cell && cell.availableNights > 0 ? (cell.occupiedNights / cell.availableNights) * 100 : null;
        }),
      }))
      .filter((room) => room.values.some((value) => value !== null)),
  );

  const exportPayload = (): OpsOccupancyExportPayload => {
    const row = (name: string, cur: RevenueMetrics, prev: RevenueMetrics) => ({
      available: cur.availableNights,
      name,
      occupied: cur.occupiedNights,
      previousPct: prev.availableNights > 0 ? prev.occupancyPct : null,
    });
    const fwdCell = (cell: RevenueCell | undefined) => ({
      available: cell?.availableNights ?? 0,
      occupied: cell?.occupiedNights ?? 0,
    });
    return {
      forward: data.properties.map((p) => ({
        cells: data.forwardMonths.map((month) => fwdCell(data.forwardCells[month]?.[p.name])),
        name: p.name,
      })),
      forwardLabel: fill(copy.forwardBadge, { today: data.today }),
      forwardMonthLabels: data.forwardMonths.map((month) => monthLong(month)),
      forwardTotal: data.forwardMonths.map((month) => fwdCell(totalOf(data.forwardCells[month]))),
      rangeLabel: rangeLabel(data.mode, data.range),
      roomMonthLabels: months12.map((month) => monthShort(month)),
      roomRangeLabel: fill(copy.roomsRange, {
        from: monthLong(months12[0]),
        to: monthLong(anchor),
      }),
      rooms: roomSeries.map((room) => ({
        name: `${room.property} ${room.label}`,
        values: room.values,
      })),
      rows: data.properties
        .filter((p) => (data.rangeCells[p.name]?.availableNights ?? 0) > 0)
        .map((p) => row(p.name, metricsOf(data.rangeCells[p.name] ?? sumMetrics([])), metricsOf(data.previousRangeCells[p.name] ?? sumMetrics([])))),
      total: row(fill(rcopy.totalRow, { n: inNames.length }), current, previous),
    };
  };

  if (data.properties.length === 0) {
    return (
      <div className="ocw">
        <div className="ocw-empty">{copy.empty}</div>
      </div>
    );
  }

  const rangePickerLabels = {
    apply: shared.dateApply,
    nextMonth: shared.dateNextMonth,
    pickMonth: shared.datePickMonth,
    pickYear: shared.datePickYear,
    prevMonth: shared.datePrevMonth,
    reset: shared.dateReset,
    thisMonth: shared.dateThisMonth,
    typeEnd: shared.dateTypeEnd,
    typeStart: shared.dateTypeStart,
  };
  const modeLabel: Record<RevenueMode, string> = {
    custom: rcopy.modeCustom,
    fiscal: rcopy.modeFiscal,
    month: rcopy.modeMonth,
    week: rcopy.modeWeek,
    year: rcopy.modeYear,
  };

  // ── 숫자 6개 ──
  const lowest = data.properties
    .filter((p) => isIn(p.name) && (data.rangeCells[p.name]?.availableNights ?? 0) > 0)
    .map((p) => ({
      cur: metricsOf(data.rangeCells[p.name]!),
      name: p.name,
      prev: metricsOf(data.previousRangeCells[p.name] ?? sumMetrics([])),
    }))
    .sort((a, b) => a.cur.occupancyPct - b.cur.occupancyPct)[0];
  const underLine = data.properties
    .filter((p) => isIn(p.name))
    .flatMap((p) => p.rooms)
    .filter((room) => {
      const cell = data.rangeRoomCells[room.key];
      return !!cell && cell.availableNights > 0 && (cell.occupiedNights / cell.availableNights) * 100 < OCCUPANCY_LINE;
    }).length;
  const thisMonth = data.forwardMonths[0];
  const thisMonthTotal = thisMonth ? totalOf(data.forwardCells[thisMonth]) : null;
  const roomTotal = data.properties.filter((p) => isIn(p.name)).reduce((sum, p) => sum + p.roomCount, 0);
  const hasPrev = previous.availableNights > 0;
  const kpis: Array<{
    key: string;
    label: string;
    value: string;
    unit: string;
    sub: string;
    red?: boolean;
  }> = [
    {
      key: "occ",
      label: w.kpiOccupancy,
      sub: hasPrev
        ? `${fill(w.vsLastYear, { d: pointText(current.occupancyPct, previous.occupancyPct) })} · ${fill(rcopy.lastYearValue, { v: pct(previous.occupancyPct) })}`
        : rcopy.newLabel,
      unit: current.availableNights > 0 ? "%" : "",
      value: current.availableNights > 0 ? current.occupancyPct.toFixed(1) : "—",
    },
    {
      key: "sold",
      label: w.kpiSold,
      sub: fill(w.kpiSoldSub, {
        n: inNames.length,
        rooms: roomTotal,
        total: n(current.availableNights),
      }),
      unit: w.unitNights,
      value: n(current.occupiedNights),
    },
    {
      key: "vacant",
      label: copy.kpiVacant,
      sub: copy.kpiVacantSub,
      unit: w.unitNights,
      value: n(Math.max(0, current.availableNights - current.occupiedNights)),
    },
    {
      key: "lowest",
      label: copy.kpiLowest,
      red: !!lowest,
      sub: lowest
        ? lowest.prev.availableNights > 0
          ? `${lowest.name} · ${fill(w.vsLastYear, { d: pointText(lowest.cur.occupancyPct, lowest.prev.occupancyPct) })}`
          : lowest.name
        : "",
      unit: lowest ? "%" : "",
      value: lowest ? lowest.cur.occupancyPct.toFixed(1) : "—",
    },
    {
      key: "under",
      label: copy.kpiUnder,
      red: underLine > 0,
      sub: copy.kpiUnderSub,
      unit: w.unitRooms,
      value: n(underLine),
    },
    {
      key: "booked",
      label: thisMonth ? fill(w.kpiBooked, { month: monthShort(thisMonth) }) : copy.kpiThisMonth,
      sub: w.kpiBookedSub,
      unit: thisMonthTotal && thisMonthTotal.availableNights > 0 ? "%" : "",
      value: thisMonthTotal && thisMonthTotal.availableNights > 0 ? thisMonthTotal.occupancyPct.toFixed(1) : "—",
    },
  ];

  const prevRange = shiftRange(data.mode, data.range, -1);
  const nextRange = shiftRange(data.mode, data.range, 1);
  const tabs: Array<[OccupancyTab, string]> = [
    ["report", copy.tabReport],
    ["rooms", copy.tabRooms],
    ["forward", copy.tabForward],
  ];

  const excludedNames = data.properties.filter((p) => !isIn(p.name)).map((p) => p.name);
  const includeSummary =
    excludedNames.length === 0
      ? w.includeAll
      : excludedNames.length <= 3 && inNames.length > 0
        ? fill(w.includeExcept, { list: excludedNames.join(" · ") })
        : fill(w.includeCount, { n: inNames.length });

  return (
    <div className={`ocw${navPending ? " is-pending" : ""}`}>
      <div className="ocw-bar">
        <div className="ocw-seg" role="tablist" aria-label={copy.title}>
          {tabs.map(([key, label]) => (
            <button aria-selected={tab === key} className={tab === key ? "on" : ""} key={key} onClick={() => setTab(key)} role="tab" type="button">
              {label}
            </button>
          ))}
        </div>
        <div className="ocw-seg" role="tablist">
          {REVENUE_MODES.map((mode) => (
            <Link
              aria-selected={mode === data.mode}
              className={mode === data.mode ? "on" : ""}
              href={occupancyHref(mode, mode === "custom" ? data.range : shiftToMode(mode, data.range, data.today), tab)}
              key={mode}
              role="tab"
            >
              {modeLabel[mode]}
            </Link>
          ))}
        </div>
        <div className="ocw-period">
          {data.mode === "month" ? (
            <AdminMonthPicker
              basePath="/admin/ops/occupancy"
              labels={{
                nextMonth: shared.dateNextMonth,
                nextYear: shared.dateNextYear,
                open: shared.dateSelect,
                prevMonth: shared.datePrevMonth,
                prevYear: shared.datePrevYear,
                thisMonth: shared.dateThisMonth,
              }}
              localeTag={localeTag}
              preserveQueryKeys={["mode", "tab"]}
              ym={data.range.from.slice(0, 7)}
            />
          ) : data.mode === "custom" ? (
            <AdminDateRangePicker
              ariaLabel={shared.pickRange}
              from={data.range.from}
              labels={rangePickerLabels}
              localeTag={localeTag}
              onChange={(from, to) => {
                if (from && to) go(occupancyHref("custom", { from, to }, tab));
              }}
              to={data.range.to}
            />
          ) : (
            <>
              <Link aria-label={rcopy.prev} className="ocw-arw" href={occupancyHref(data.mode, prevRange, tab)}>
                <ChevronLeft aria-hidden="true" />
              </Link>
              <span className="ocw-plabel">{rangeLabel(data.mode, data.range)}</span>
              <Link aria-label={rcopy.next} className="ocw-arw" href={occupancyHref(data.mode, nextRange, tab)}>
                <ChevronRight aria-hidden="true" />
              </Link>
            </>
          )}
        </div>
        {/* 비교 · 진행 · 합계 · 내보내기는 한 덩어리 — 줄이 모자라면 비교 글자가 먼저 줄고, 그래도 안 되면 덩어리째 다음 줄로. */}
        <div className="ocw-bar__rest">
          {/* 객실 × 월은 늘 고른 달까지 12달이라 비교 · 진행 표시를 그리지 않는다(시안 OccHeat-PC). */}
          {tab !== "rooms" && (
            <span className="ocw-cmp">
              {rcopy.compare} ·{" "}
              {fill(rcopy.compareSame, {
                range: rangeLabel(data.mode, data.previousRange),
              })}
            </span>
          )}
          {tab !== "rooms" && phase !== "past" && (
            <span className="ocw-phase" title={phase === "current" ? rcopy.inProgress : rcopy.futureOnly}>
              {phase === "current" ? copy.fwdInProgress : rcopy.futureOnly}
            </span>
          )}
          <div className="ocw-tools">
            <IncludePicker
              allLabel={w.includeAllOn}
              onSet={setIncluded}
              properties={data.properties.map((p) => p.name)}
              summary={includeSummary}
              title={rcopy.includeLabel}
              included={included}
            />
            <AdminExportButtons
              disabled={current.availableNights === 0}
              labels={shared}
              onExportPdf={() => exportOpsOccupancyReport(exportPayload())}
              onExportXls={() => exportOpsOccupancyWorkbook(exportPayload())}
              onToast={flash}
            />
          </div>
        </div>
      </div>

      <div className="ocw-body">
        {tab === "report" && (
          <div className="ocw-kpis">
            {kpis.map((kpi, index) => (
              <div className="ocw-kpi" key={kpi.key}>
                <span className="l">{kpi.label}</span>
                <span className={`v${kpi.red ? " is-red" : ""}`}>
                  {kpi.value === "—" ? kpi.value : <RollNumber delay={120 + index * 60} text={kpi.value} />}
                  {kpi.unit && <small>{kpi.unit}</small>}
                </span>
                <span className="s" title={kpi.sub}>
                  {kpi.sub}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="ocw-pane" key={tab}>
          {tab === "report" && (
            <ReportTab
              copy={copy}
              data={data}
              go={go}
              gradeLabel={gradeLabel}
              inNames={inNames}
              isIn={isIn}
              monthShort={monthShort}
              n={n}
              pct={pct}
              pointText={pointText}
              rangeText={data.mode === "month" ? monthShort(data.range.from.slice(0, 7)) : rangeLabel(data.mode, data.range)}
              rcopy={rcopy}
              tab={tab}
            />
          )}
          {tab === "rooms" && (
            <RoomsTab
              anchor={anchor}
              copy={copy}
              data={data}
              inNames={inNames}
              isIn={isIn}
              monthLong={monthLong}
              monthShort={monthShort}
              months12={months12}
              n={n}
              pct={pct}
              pointText={pointText}
              rcopy={rcopy}
              series={roomSeries}
            />
          )}
          {tab === "forward" && (
            <ForwardTab copy={copy} data={data} inNames={inNames} isIn={isIn} monthLong={monthLong} monthShort={monthShort} n={n} rcopy={rcopy} />
          )}
        </div>

        <p className="ocw-basis">{copy.basisNote}</p>
      </div>
      {toast && (
        <div className="ocw-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

// ── 합계에 넣을 건물 — 칩 9개 대신 드롭다운 하나 ─────────────────────────────

function IncludePicker({
  properties,
  included,
  onSet,
  summary,
  title,
  allLabel,
}: {
  properties: string[];
  included: Set<string>;
  onSet: (update: (prev: Set<string>) => Set<string>) => void;
  summary: string;
  title: string;
  allLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (name: string) =>
    onSet((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className={`ocw-inc${open ? " open" : ""}`} ref={rootRef}>
      <button aria-expanded={open} aria-haspopup="dialog" className="ocw-inc__btn" onClick={() => setOpen((v) => !v)} title={title} type="button">
        <span className="t">{summary}</span>
        <ChevronDown aria-hidden="true" className="chev" />
      </button>
      {open && (
        <div aria-label={title} className="ocw-inc__menu" role="dialog">
          <div className="ocw-inc__hd">
            <span>{title}</span>
            {included.size < properties.length && (
              <button className="ocw-inc__all" onClick={() => onSet(() => new Set(properties))} type="button">
                {allLabel}
              </button>
            )}
          </div>
          {properties.map((name) => {
            const on = included.has(name);
            return (
              <button aria-pressed={on} className={`ocw-inc__opt${on ? " on" : ""}`} key={name} onClick={() => toggle(name)} type="button">
                <span aria-hidden="true" className="ck">
                  {on && <Check />}
                </span>
                <span className="n">{name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 추이 · 건물별 ─────────────────────────────────────────────────────────

type Fmt = {
  n: (value: number) => string;
  pct: (value: number) => string;
  pointText: (current: number, previous: number) => string;
};

function ReportTab({
  data,
  copy,
  rcopy,
  inNames,
  isIn,
  monthShort,
  rangeText,
  go,
  tab,
  gradeLabel,
  n,
  pct,
  pointText,
}: Fmt & {
  data: OpsRevenueData;
  copy: Copy;
  rcopy: RevenueCopy;
  inNames: string[];
  isIn: (name: string) => boolean;
  monthShort: (month: string) => string;
  rangeText: string;
  go: (href: string) => void;
  tab: OccupancyTab;
  gradeLabel: (value: number) => string;
}) {
  const w = copy.white;
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [sort, setSort] = useState<{
    key: SortKey;
    dir: "desc" | "asc";
  } | null>(null);
  const cycleSort = (key: SortKey) => setSort((cur) => (cur?.key !== key ? { dir: "desc", key } : cur.dir === "desc" ? { dir: "asc", key } : null));
  const sortValue = (key: SortKey, cur: RevenueMetrics, prev: RevenueMetrics): number | null => {
    switch (key) {
      case "occupancy":
        return cur.availableNights > 0 ? cur.occupancyPct : null;
      case "nights":
        return cur.availableNights > 0 ? cur.occupiedNights : null;
      case "vacant":
        return cur.availableNights > 0 ? cur.availableNights - cur.occupiedNights : null;
      case "previous":
        return prev.availableNights > 0 ? prev.occupancyPct : null;
      case "change":
        return cur.availableNights > 0 && prev.availableNights > 0 ? cur.occupancyPct - prev.occupancyPct : null;
    }
  };
  const sorted = <T,>(items: T[], pick: (item: T) => { cur: RevenueMetrics; prev: RevenueMetrics }) => {
    if (!sort) return items;
    return items
      .map((item, index) => ({
        index,
        item,
        value: sortValue(sort.key, pick(item).cur, pick(item).prev),
      }))
      .sort((a, b) => {
        if (a.value === null || b.value === null) return a.value === null ? (b.value === null ? a.index - b.index : 1) : -1;
        return sort.dir === "desc" ? b.value - a.value || a.index - b.index : a.value - b.value || a.index - b.index;
      })
      .map((entry) => entry.item);
  };
  const sortHead = (key: SortKey, label: string, className = "r") => {
    const active = sort?.key === key;
    const next = !active ? rcopy.sortDesc : sort.dir === "desc" ? rcopy.sortAsc : rcopy.sortReset;
    return (
      <th aria-sort={active ? (sort.dir === "desc" ? "descending" : "ascending") : "none"} className={className} scope="col">
        <button className={`ocw-sort${active ? " on" : ""}`} onClick={() => cycleSort(key)} title={next} type="button">
          {label}
          {active && (sort.dir === "desc" ? <ArrowDown aria-hidden="true" /> : <ArrowUp aria-hidden="true" />)}
        </button>
      </th>
    );
  };

  const todayDay = Number(data.today.slice(8));
  const daysIn = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
  const selectedMonths = new Set(data.months.filter((month) => month >= data.range.from.slice(0, 7) && month <= data.range.to.slice(0, 7)));
  const bars = data.months.map((month) => ({
    cur: sumMetrics(inNames.map((name) => data.monthCells[month]?.[name])),
    month,
  }));

  const deltaCell = (cur: RevenueMetrics, prev: RevenueMetrics) => {
    const ok = cur.availableNights > 0 && prev.availableNights > 0;
    const d = ok ? cur.occupancyPct - prev.occupancyPct : 0;
    return <td className={`r num${ok && d <= -0.05 ? " is-red" : ""}`}>{ok ? pointText(cur.occupancyPct, prev.occupancyPct) : "—"}</td>;
  };
  const line = (cur: RevenueMetrics, prev: RevenueMetrics, room: boolean, isNew: boolean) => {
    const has = cur.availableNights > 0;
    const vacant = cur.availableNights - cur.occupiedNights;
    return (
      <>
        <td>
          <OccBar value={has ? cur.occupancyPct : null} />
        </td>
        <td className="r num">{has ? `${n(cur.occupiedNights)} / ${n(cur.availableNights)}` : "—"}</td>
        <td className={`r num${room && isMostlyVacant(cur.occupiedNights, cur.availableNights) ? " is-red is-bold" : ""}`}>
          {has ? n(vacant) : "—"}
        </td>
        <td className="r num">{prev.availableNights > 0 ? pct(prev.occupancyPct) : isNew ? rcopy.newLabel : "—"}</td>
        {deltaCell(cur, prev)}
        <td className="r">
          {has ? <span className={`ocw-grade is-${occupancyGrade(cur.occupancyPct)}`}>{gradeLabel(cur.occupancyPct)}</span> : null}
        </td>
      </>
    );
  };

  const total = sumMetrics(inNames.map((name) => data.rangeCells[name]));
  const totalPrev = sumMetrics(inNames.map((name) => data.previousRangeCells[name]));
  const lineBottom = `${OCCUPANCY_LINE}%`;

  return (
    <>
      <div className="ocw-sec">
        <b>{w.chartTitle}</b>
        <span className="ocw-lgs">
          <span>
            <i className="sel" />
            {w.legendSelected}
          </span>
          <span>
            <i className="past" />
            {w.legendPast}
          </span>
          <span>
            <i className="fut" />
            {w.legendBooked}
          </span>
          <span>
            <i className="low" />
            {w.legendLow}
          </span>
          <span className="hint">· {w.chartHint}</span>
        </span>
      </div>
      <div className="ocw-chart">
        <div className="ocw-plot">
          <span className="ocw-line" style={{ bottom: lineBottom }}>
            <span>{OCCUPANCY_LINE}%</span>
          </span>
          {bars.map(({ cur, month }, index) => {
            const p = monthPhase(month, data.today);
            const has = cur.availableNights > 0;
            const value = has ? cur.occupancyPct : 0;
            const sel = selectedMonths.has(month);
            const low = has && value < OCCUPANCY_LINE && p === "past";
            const tone = low ? "low" : p === "future" ? "fut" : p === "current" ? "cur" : sel ? "sel" : "past";
            return (
              <button
                className={`ocw-col${sel ? " on" : ""}`}
                key={month}
                onClick={() => go(occupancyHref("month", { from: `${month}-01`, to: `${month}-01` }, tab))}
                style={{ "--i": index } as CSSProperties}
                title={`${month} · ${has ? pct(cur.occupancyPct) : "—"}`}
                type="button"
              >
                <span className="ocw-col__v" style={{ bottom: `calc(${Math.min(100, value)}% + 6px)` }}>
                  {has ? cur.occupancyPct.toFixed(0) : "—"}
                </span>
                <span
                  className={`ocw-col__b is-${tone}`}
                  style={
                    {
                      height: `${Math.min(100, value)}%`,
                      ...(p === "current"
                        ? {
                            "--done": `${Math.round((todayDay / daysIn(month)) * 100)}%`,
                          }
                        : {}),
                    } as CSSProperties
                  }
                />
              </button>
            );
          })}
        </div>
        <div className="ocw-months">
          {bars.map(({ month }) => (
            <span className={`${selectedMonths.has(month) ? "on" : ""}${month.endsWith("-01") ? " y" : ""}`} key={month} title={month}>
              {monthShort(month)}
            </span>
          ))}
        </div>
      </div>

      <div className="ocw-sec">
        <b>{copy.tableTitle}</b>
        <span className="hint">
          {rangeText} · {w.tableHint}
        </span>
      </div>
      <div className="ocw-tablewrap">
        <table className="ocw-table">
          <colgroup>
            <col className="c-name" />
            <col />
            <col className="c-nights" />
            <col className="c-s" />
            <col className="c-s" />
            <col className="c-s" />
            <col className="c-g" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">
                <button className={`ocw-sort${sort ? "" : " on"}`} onClick={() => setSort(null)} title={rcopy.sortReset} type="button">
                  {rcopy.colProperty}
                </button>
              </th>
              {sortHead("occupancy", rcopy.colOccupancy, "")}
              {sortHead("nights", copy.colNights)}
              {sortHead("vacant", copy.colVacant)}
              {sortHead("previous", rcopy.colLastYear)}
              {sortHead("change", rcopy.colChange)}
              <th className="r" scope="col">
                {copy.colGrade}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted(data.properties, (property) => ({
              cur: metricsOf(data.rangeCells[property.name] ?? sumMetrics([])),
              prev: metricsOf(data.previousRangeCells[property.name] ?? sumMetrics([])),
            })).map((property) => {
              const cur = metricsOf(data.rangeCells[property.name] ?? sumMetrics([]));
              const prev = metricsOf(data.previousRangeCells[property.name] ?? sumMetrics([]));
              const open = openRow === property.name;
              const rooms = open
                ? sorted(
                    property.rooms
                      .map((room) => ({
                        cur: metricsOf(data.rangeRoomCells[room.key] ?? sumMetrics([])),
                        label: room.label,
                        prev: metricsOf(data.previousRangeRoomCells[room.key] ?? sumMetrics([])),
                      }))
                      .filter((room) => room.cur.availableNights > 0),
                    (room) => room,
                  )
                : [];
              return (
                <Fragment key={property.name}>
                  <tr
                    aria-expanded={open}
                    className={`ocw-row${open ? " open" : ""}${isIn(property.name) ? "" : " off"}`}
                    onClick={() => setOpenRow(open ? null : property.name)}
                  >
                    <td>
                      <span className="ocw-bn">
                        <ChevronRight aria-hidden="true" className="tw" />
                        <b>{property.name}</b>
                        {!isIn(property.name) && <span className="ex">{rcopy.excludedTag}</span>}
                      </span>
                    </td>
                    {line(cur, prev, false, true)}
                  </tr>
                  {rooms.map((room, index) => (
                    <tr className="ocw-room" key={room.label} style={{ "--i": index } as CSSProperties}>
                      <td>
                        <span className="rn">{room.label}</span>
                      </td>
                      {line(room.cur, room.prev, true, false)}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
            <tr className="ocw-total">
              <td>{fill(rcopy.totalRow, { n: inNames.length })}</td>
              <td>
                <OccBar value={total.availableNights > 0 ? total.occupancyPct : null} />
              </td>
              <td className="r num">{`${n(total.occupiedNights)} / ${n(total.availableNights)}`}</td>
              <td className="r num">{n(Math.max(0, total.availableNights - total.occupiedNights))}</td>
              <td className="r num">{totalPrev.availableNights > 0 ? pct(totalPrev.occupancyPct) : "—"}</td>
              {deltaCell(total, totalPrev)}
              <td className="r">
                {total.availableNights > 0 && (
                  <span className={`ocw-grade is-${occupancyGrade(total.occupancyPct)}`}>{gradeLabel(total.occupancyPct)}</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="ocw-foot">{copy.tableFoot}</p>
    </>
  );
}

function OccBar({ value }: { value: number | null }) {
  if (value === null) return <span className="ocw-faint">—</span>;
  const low = value < OCCUPANCY_LINE;
  return (
    <span className="ocw-obar">
      <span className="track">
        <span className="rail">
          <i className={low ? "low" : ""} style={{ width: `${Math.min(100, value)}%` }} />
        </span>
        <b style={{ left: `${OCCUPANCY_LINE}%` }} />
      </span>
      <span className={`p${low ? " is-red" : ""}`}>{Math.round(value)}%</span>
    </span>
  );
}

// ── 객실 × 월 ─────────────────────────────────────────────────────────────

function RoomsTab({
  data,
  copy,
  rcopy,
  series,
  months12,
  anchor,
  inNames,
  isIn,
  monthShort,
  monthLong,
  n,
  pct,
  pointText,
}: Fmt & {
  data: OpsRevenueData;
  copy: Copy;
  rcopy: RevenueCopy;
  series: RoomSeries[];
  months12: string[];
  anchor: string;
  inNames: string[];
  isIn: (name: string) => boolean;
  monthShort: (month: string) => string;
  monthLong: (month: string) => string;
}) {
  const w = copy.white;
  const [roomSort, setRoomSort] = useState<RoomSort>("catalog");
  const sortRooms = (rooms: RoomSeries[]) => {
    if (roomSort === "catalog") return rooms;
    const key = (room: RoomSeries) => (roomSort === "last" ? room.values.at(-1) : seriesAverage(room.values));
    return rooms
      .map((room, index) => ({ index, room, value: key(room) ?? null }))
      .sort((a, b) => (a.value === null || b.value === null ? (a.value === null ? 1 : -1) : a.value - b.value || a.index - b.index))
      .map((entry) => entry.room);
  };

  const anchorTotal = sumMetrics(inNames.map((name) => data.monthCells[anchor]?.[name]));
  const anchorPrev = sumMetrics(inNames.map((name) => data.monthCells[shiftMonthKey(anchor, -12)]?.[name]));
  const inSeries = series.filter((room) => isIn(room.property));
  const low = inSeries
    .filter((room) => room.values.at(-1) !== null && room.values.at(-1) !== undefined)
    .sort((a, b) => (a.values.at(-1) as number) - (b.values.at(-1) as number))
    .slice(0, 8);
  const below = roomsBelowUsual(inSeries).slice(0, 8);
  const lastIndex = months12.length - 1;
  const legend = [w.heatLow, "60–75", "75–85", "85–95", "95+"];

  return (
    <div className="ocw-split">
      <div className="ocw-main">
        <div className="ocw-heatbar">
          <div className="ocw-seg" role="tablist" aria-label={copy.sortLabel}>
            {(
              [
                ["catalog", copy.sortCatalog],
                ["last", copy.sortLast],
                ["avg", copy.sortAvg],
              ] as const
            ).map(([key, label]) => (
              <button
                aria-selected={roomSort === key}
                className={roomSort === key ? "on" : ""}
                key={key}
                onClick={() => setRoomSort(key)}
                role="tab"
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <span className="ocw-cmp">
            {fill(copy.roomsRange, {
              from: monthLong(months12[0]),
              to: monthLong(anchor),
            })}
          </span>
          <span className="ocw-heatlg">
            {legend.map((label, index) => (
              <span key={label}>
                <i style={{ background: HEAT_BG[index] }} />
                {label}
              </span>
            ))}
            <span>
              <i className="na" />
              {rcopy.legendNotOpen}
            </span>
          </span>
        </div>
        <div className="ocw-heatwrap">
          <div className="ocw-heat" role="grid">
            <div />
            {months12.map((month, index) => (
              <div className={`ocw-mh${index === lastIndex ? " on" : ""}`} key={month}>
                {(index === 0 || month.endsWith("-01")) && <span className="yy">{month.slice(0, 4)}</span>}
                {monthShort(month)}
              </div>
            ))}
            <div className="ocw-mh avg">{copy.colAvg}</div>
            {data.properties.flatMap((property) => {
              const off = !isIn(property.name);
              return sortRooms(series.filter((room) => room.property === property.name)).map((room) => {
                const avg = seriesAverage(room.values);
                return (
                  <Fragment key={room.key}>
                    <div className={`ocw-rl${off ? " off" : ""}`}>
                      <b>{room.label}</b>
                      <span>{off ? `${property.name} · ${rcopy.excludedTag}` : property.name}</span>
                    </div>
                    {room.values.map((value, index) => {
                      const level = value === null ? -1 : heatLevel(value);
                      return (
                        <Link
                          aria-label={`${property.name} ${room.label} ${monthLong(months12[index])}`}
                          className={`ocw-hc${value === null ? " na" : ""}${level === 0 ? " low" : ""}${off ? " off" : ""}`}
                          href={calendarHref(property.name, months12[index])}
                          key={months12[index]}
                          style={
                            {
                              "--c": index,
                              ...(value === null ? {} : { background: HEAT_BG[level] }),
                            } as CSSProperties
                          }
                          title={value === null ? rcopy.legendNotOpen : pct(value)}
                        >
                          {value === null ? "" : Math.round(value)}
                        </Link>
                      );
                    })}
                    <div className={`ocw-avg${avg !== null && avg < 75 ? " is-red" : ""}${off ? " off" : ""}`}>
                      {avg === null ? "—" : `${Math.round(avg)}%`}
                    </div>
                  </Fragment>
                );
              });
            })}
          </div>
        </div>
        <p className="ocw-foot">{copy.roomsHint}</p>
      </div>

      <aside className="ocw-side">
        <div className="ocw-sum">
          <span className="l">{fill(w.sumTitle, { month: monthShort(anchor) })}</span>
          <b className="v">{anchorTotal.availableNights > 0 ? <RollNumber delay={100} text={pct(anchorTotal.occupancyPct)} /> : "—"}</b>
          <span className="s">
            {fill(copy.summarySub, {
              a: n(anchorTotal.occupiedNights),
              b: n(anchorTotal.availableNights),
              c: n(Math.max(0, anchorTotal.availableNights - anchorTotal.occupiedNights)),
            })}
            {anchorPrev.availableNights > 0 && anchorTotal.availableNights > 0 && (
              <>
                {" "}
                ·{" "}
                {fill(w.vsLastYear, {
                  d: pointText(anchorTotal.occupancyPct, anchorPrev.occupancyPct),
                })}
              </>
            )}
          </span>
        </div>
        <div className="ocw-sidesec">
          <span className="h">{w.lowRooms}</span>
          {low.map((room) => {
            const value = room.values.at(-1) as number;
            return (
              <Link className="ocw-sr" href={calendarHref(room.property, anchor)} key={room.key}>
                <span className="n">
                  <b>{room.label}</b> <span>{room.property}</span>
                </span>
                <b className={`p${value < 75 ? " is-red" : ""}`}>{Math.round(value)}%</b>
              </Link>
            );
          })}
        </div>
        <div className="ocw-sidesec">
          <span className="h">{copy.dropTitle}</span>
          <span className="hint">{w.dropHint}</span>
          {below.length === 0 ? (
            <span className="hint">{copy.dropNone}</span>
          ) : (
            below.map((room) => (
              <Link className="ocw-sr" href={calendarHref(room.property, anchor)} key={room.key} title={room.property}>
                <span className="n">
                  <b>{room.label}</b> <span>{fill(w.usual, { v: Math.round(room.usual) })}</span>
                </span>
                <b className="p is-red">
                  {Math.round(room.now)}% · −{Math.round(room.usual - room.now)}
                  {rcopy.pointSuffix}
                </b>
              </Link>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}

// ── 앞으로 ────────────────────────────────────────────────────────────────

function ForwardTab({
  data,
  copy,
  rcopy,
  inNames,
  isIn,
  monthLong,
  monthShort,
  n,
}: Pick<Fmt, "n"> & {
  data: OpsRevenueData;
  copy: Copy;
  rcopy: RevenueCopy;
  inNames: string[];
  isIn: (name: string) => boolean;
  monthLong: (month: string) => string;
  monthShort: (month: string) => string;
}) {
  const w = copy.white;
  const months = data.forwardMonths;
  const totals = months.map((month) => ({
    cur: sumMetrics(inNames.map((name) => data.forwardCells[month]?.[name])),
    month,
    prev: sumMetrics(inNames.map((name) => data.forwardPreviousCells[month]?.[name])),
  }));
  const cellOf = (name: string, month: string) => metricsOf(data.forwardCells[month]?.[name] ?? sumMetrics([]));
  const watch = mostVacantCells(
    data.properties
      .filter((p) => isIn(p.name))
      .flatMap((p) =>
        months.slice(0, 3).map((month) => {
          const cell = cellOf(p.name, month);
          return {
            available: cell.availableNights,
            month,
            occupancy: cell.occupancyPct,
            property: p.name,
            vacant: cell.availableNights - cell.occupiedNights,
          };
        }),
      ),
  );
  const whole = (value: number) => `${value.toFixed(0)}%`;

  return (
    <>
      <div className="ocw-fcols">
        {totals.map(({ cur, month, prev }, index) => {
          const vacant = Math.max(0, cur.availableNights - cur.occupiedNights);
          return (
            <div className={`ocw-fcol${index === 0 ? " cur" : ""}`} key={month} style={{ "--i": index } as CSSProperties} title={monthLong(month)}>
              <span className="l">
                {monthShort(month)}
                {index === 0 && (
                  <>
                    {" "}
                    · <b>{copy.fwdInProgress}</b>
                  </>
                )}
              </span>
              <span className="v">{cur.availableNights > 0 ? <RollNumber delay={100 + index * 60} text={whole(cur.occupancyPct)} /> : "—"}</span>
              <span className="track">
                <i style={{ width: `${Math.min(100, cur.occupancyPct)}%` }} />
              </span>
              <span className="s">
                {fill(copy.fwdVacant, { v: n(vacant) })} ·{" "}
                {fill(copy.fwdPrevFinal, {
                  v: prev.availableNights > 0 ? whole(prev.occupancyPct) : "—",
                })}
              </span>
            </div>
          );
        })}
      </div>
      <p className="ocw-foot">
        {w.fwdNote} · {fill(copy.forwardBadge, { today: data.today })}
      </p>

      <div className="ocw-sec">
        <b>{w.fwdMatrixTitle}</b>
        <span className="hint">{w.fwdMatrixHint}</span>
      </div>
      <div className="ocw-heatwrap">
        <div className="ocw-fgrid">
          <span />
          {months.map((month, index) => (
            <span className={`ocw-mh${index === 0 ? " on" : ""}`} key={month}>
              {(index === 0 || month.endsWith("-01")) && <span className="yy">{month.slice(0, 4)}</span>}
              {monthShort(month)}
            </span>
          ))}
          {data.properties.map((property) => {
            const off = !isIn(property.name);
            return (
              <Fragment key={property.name}>
                <span className={`ocw-frl${off ? " off" : ""}`} title={property.name}>
                  <b>{property.name}</b>
                  <span>{off ? rcopy.excludedTag : fill(rcopy.roomCount, { n: property.roomCount })}</span>
                </span>
                {months.map((month, index) => {
                  const cell = cellOf(property.name, month);
                  const vacant = Math.max(0, cell.availableNights - cell.occupiedNights);
                  return (
                    <Link
                      aria-label={`${property.name} ${monthLong(month)}`}
                      className={`ocw-fc${off ? " off" : ""}`}
                      href={calendarHref(property.name, month)}
                      key={month}
                      style={
                        {
                          "--c": index,
                          background: VACANCY_BG[vacancyLevel(vacant, cell.availableNights)],
                        } as CSSProperties
                      }
                    >
                      <b>{cell.availableNights > 0 ? fill(w.nights, { n: n(vacant) }) : "—"}</b>
                      <span>{cell.availableNights > 0 ? fill(w.booked, { v: cell.occupancyPct.toFixed(0) }) : ""}</span>
                    </Link>
                  );
                })}
              </Fragment>
            );
          })}
          <span className="ocw-frl tot">
            <b>{rcopy.totalLabel}</b>
            <span>{fill(rcopy.propertyCount, { n: inNames.length })}</span>
          </span>
          {totals.map(({ cur, month }) => (
            <span className="ocw-fc tot" key={month}>
              <b>
                {fill(w.nights, {
                  n: n(Math.max(0, cur.availableNights - cur.occupiedNights)),
                })}
              </b>
              <span>{cur.availableNights > 0 ? fill(w.booked, { v: cur.occupancyPct.toFixed(0) }) : ""}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="ocw-fsplit">
        <div>
          <div className="ocw-sec">
            <b>{copy.fwdCompareTitle}</b>
            <span className="hint">{w.fwdCompareHint}</span>
          </div>
          <div className="ocw-cmprows">
            {totals.map(({ cur, month, prev }, index) => (
              <div className="ocw-cmprow" key={month} style={{ "--i": index } as CSSProperties}>
                <span>{monthShort(month)}</span>
                <span className="bars">
                  <span className="now">
                    <i style={{ width: `${Math.min(100, cur.occupancyPct)}%` }} />
                  </span>
                  <span className="prev">
                    <i
                      style={{
                        width: `${prev.availableNights > 0 ? Math.min(100, prev.occupancyPct) : 0}%`,
                      }}
                    />
                  </span>
                </span>
                <span className="r">
                  <b>{cur.availableNights > 0 ? whole(cur.occupancyPct) : "—"}</b>
                  <span> / {prev.availableNights > 0 ? whole(prev.occupancyPct) : "—"}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="ocw-sec">
            <b>{copy.fwdWatchTitle}</b>
            <span className="hint">{w.fwdWatchHint}</span>
          </div>
          {watch.map((cell) => (
            <Link className="ocw-wr" href={calendarHref(cell.property, cell.month)} key={`${cell.property}|${cell.month}`}>
              <b>{cell.property}</b>
              <span className="m">{monthShort(cell.month)}</span>
              <b className="v">{fill(w.nights, { n: n(cell.vacant) })}</b>
              <span className="s">
                {fill(w.vacantShare, {
                  v: cell.available > 0 ? Math.round((cell.vacant / cell.available) * 100) : 0,
                })}
              </span>
            </Link>
          ))}
          {months[0] && (
            <Link className="ocw-more" href={`/admin/ops/calendar?mode=monthly&ym=${months[0]}`}>
              {copy.fwdOpenCalendar} →
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
