"use client";

import { Fragment, useEffect, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { exportOpsRevenueReport, exportOpsRevenueWorkbook, type OpsRevenueExportPayload } from "@/app/admin/ops/revenue/actions";
import { AdminDateRangePicker } from "@/components/admin/shared/admin-date-range-picker";
import { AdminExportButtons } from "@/components/admin/shared/admin-export-buttons";
import { AdminMonthPicker } from "@/components/admin/shared/admin-month-picker";
import { shiftMonthKey } from "@/components/admin/shared/admin-month-key";
import { RollNumber } from "@/components/shared/roll-number";
import type { Dictionary } from "@/lib/i18n";
import {
  REVENUE_MODES,
  changePct,
  fiscalPeriodNumber,
  metricsOf,
  monthPhase,
  quintileCuts,
  quintileLevel,
  shiftRange,
  sumMetrics,
  yoyLevel,
  type RevenueCell,
  type RevenueMetrics,
  type RevenueMode,
  type RevenueRange,
} from "@/lib/ops-revenue";
import type { OpsRevenueData } from "@/lib/ops-revenue-server";
import { IncludePicker } from "./ops-include-picker";
import { compareHref } from "./ops-revenue-compare";
import "./ops-occupancy-white.css";
import "./ops-revenue-white.css";

/**
 * 매출 화면 — 추이 · 건물별 / 건물 × 월 (2026-10-06 시안 A v2 구현 · 2026-10-15 화이트 리디자인, 시안 Rev-PC · RevMatrix-PC).
 *
 * 도메인 계약: docs/product/34-metrics-and-automation.md 「매출 화면」 · 시각 규칙: docs/design/05-white-redesign.md
 *
 * 숫자는 서버가 판매 캘린더 「매출 요약」과 같은 식으로 낸 **칸**(건물 × 달 조각)이고, 여기서는 합계에 넣을 건물을
 * 골라 더하고 비율을 다시 나눈다. 기간은 주소(`?mode=…`)라 새로고침 · 공유가 된다. 탭 · 건물 고르기 · 매트릭스
 * 선택은 화면 안 상태다. 화이트 리디자인에서 옛 `orv__*`(`ops-revenue.css`, 2026-10-15 비교 화면까지 옮기며 삭제)를 떼고, 가동률 화면의
 * `ocw-*` 도구 줄 · 숫자 줄 · 범례를 그대로 쓰며 매출 전용 모양은 `rvw-*`(`ops-revenue-white.css`).
 */
type Copy = Dictionary["opsRevenue"];
type SharedCopy = Dictionary["admin"]["shared"];
type Tab = "report" | "matrix";
type Metric = "revenue" | "net" | "occupancy" | "adr" | "revpar";
type Lens = "value" | "yoy";
type ChannelKey = "airbnb" | "booking" | "direct" | "other";

const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);

/** 값 보기 5단계 — 옅은 → 진한 보라(시안 RevMatrix-PC). */
const VALUE_BG = ["#FAF8FF", "#EFEAFB", "#DCD0FA", "#C2AEF6", "#A688F0"];
/** 전년 대비 5단계 — 크게 줄어듦(빨강) ~ 그대로(회색) ~ 크게 늘어남(초록). 글자 색도 같이. */
const YOY_BG = ["#FBE3E4", "#FDF1F1", "#F5F5F7", "#E8F4EC", "#D3EBDD"];
const YOY_FG = ["#a3202a", "#c5282e", "#6b6878", "#1f7a4d", "#17603c"];
/** 채널은 보라로 바꾸지 않고 각 회사 색 그대로(시안 Rev-PC). */
const CHANNEL_COLOR: Record<ChannelKey, string> = { airbnb: "#FF5A5F", booking: "#003B95", direct: "#8B8898", other: "#D9D7E0" };
const CHANNELS: readonly ChannelKey[] = ["airbnb", "booking", "direct", "other"];

/** 기간 → 주소. 월은 공용 월 선택기(`?ym=`)와 같은 키를 쓴다. */
export function revenueHref(mode: RevenueMode, range: RevenueRange, tab: Tab): string {
  const query = new URLSearchParams({ mode });
  if (mode === "month") query.set("ym", range.from.slice(0, 7));
  else query.set("from", range.from);
  if (mode === "custom") query.set("to", range.to);
  if (tab === "matrix") query.set("tab", tab);
  return `/admin/ops/revenue?${query.toString()}`;
}

/** 다른 모드로 갈 때 — 지금 보던 기간의 끝(오늘보다 뒤면 오늘)이 든 그 모드의 기간으로. 모양은 서버가 바로잡는다. */
function shiftToMode(mode: RevenueMode, range: RevenueRange, today: string): RevenueRange {
  const base = range.to > today && range.from <= today ? today : range.to;
  return mode === "month" ? { from: `${base.slice(0, 7)}-01`, to: base } : { from: base, to: base };
}

export function OpsRevenueConsole({
  data,
  copy,
  shared,
  localeTag,
  initialTab,
}: {
  data: OpsRevenueData;
  copy: Copy;
  shared: SharedCopy;
  localeTag: string;
  initialTab: Tab;
}) {
  const router = useRouter();
  const [navPending, startNav] = useTransition();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [included, setIncluded] = useState<Set<string>>(() => new Set(data.properties.filter((p) => !p.defaultExcluded).map((p) => p.name)));
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("revenue");
  const [lens, setLens] = useState<Lens>("value");
  const anchor = data.months[11];
  const [pick, setPick] = useState<{ property: string | null; month: string }>(() => ({
    month: anchor,
    property: data.properties.find((p) => !p.defaultExcluded)?.name ?? data.properties[0]?.name ?? null,
  }));
  const [toast, setToast] = useState<string | null>(null);
  const w = copy.white;

  // 탭은 주소에도 적는다 — 기간을 옮겨도(링크) 같은 탭으로 돌아온다.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (tab === "matrix") url.searchParams.set("tab", "matrix");
    else url.searchParams.delete("tab");
    window.history.replaceState(window.history.state, "", url.toString());
  }, [tab]);

  const flash = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((current) => (current === text ? null : current)), 2000);
  };
  const go = (href: string) => startNav(() => router.push(href));

  // ── 숫자 모양 ── 금액은 전부 엔 단위 전체 숫자(2026-10-08 사용자). 「건물 × 월」 칸만 좁아서 백만 엔 단위.
  const yen = (value: number) => `¥${Math.round(value).toLocaleString(localeTag)}`;
  const pct = (value: number) => `${value.toFixed(1)}%`;
  const deltaText = (delta: number | null) => (delta === null ? copy.newLabel : `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}%`);
  const pointText = (current: number, previous: number) => {
    const d = current - previous;
    return `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}${copy.pointSuffix}`;
  };
  const monthShort = (month: string) =>
    new Intl.DateTimeFormat(localeTag, { month: "short", timeZone: "UTC" }).format(new Date(`${month}-15T00:00:00Z`));
  const monthLong = (month: string) =>
    new Intl.DateTimeFormat(localeTag, { month: "long", timeZone: "UTC", year: "numeric" }).format(new Date(`${month}-15T00:00:00Z`));
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
      return fill(copy.fiscalLabel, {
        from: range.from.slice(0, 7).replace("-", "."),
        n: fiscalPeriodNumber(Number(range.from.slice(0, 4))),
        to: range.to.slice(0, 7).replace("-", "."),
      });
    }
    if (mode === "year") return range.from.slice(0, 4);
    const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
    return `${dayLabel(range.from, true)} – ${dayLabel(range.to, !sameYear)}`;
  };

  // ── 합 ──
  const isIn = (name: string) => included.has(name);
  const inNames = data.properties.filter((p) => isIn(p.name)).map((p) => p.name);
  const totalOf = (cells: Record<string, RevenueCell> | undefined) => sumMetrics(inNames.map((name) => cells?.[name]));
  const current = totalOf(data.rangeCells);
  const previous = totalOf(data.previousRangeCells);
  const phase = data.range.to < data.today ? "past" : data.range.from > data.today ? "future" : "current";

  const exportPayload = (): OpsRevenueExportPayload => {
    const row = (name: string, cur: RevenueMetrics, prev: RevenueMetrics) => ({
      adr: cur.occupiedNights > 0 ? cur.adr : null,
      commission: cur.commission,
      name,
      net: cur.net,
      occupancyPct: cur.availableNights > 0 ? cur.occupancyPct : null,
      previous: prev.revenue,
      revenue: cur.revenue,
      revpar: cur.availableNights > 0 ? cur.revpar : null,
    });
    return {
      monthLabels: data.months.map((month) => monthLong(month)),
      monthRangeLabel: `${monthLong(data.months[0])} – ${monthLong(data.months[data.months.length - 1])}`,
      monthlyTotal: data.months.map((month) => inNames.reduce((sum, name) => sum + (data.monthCells[month]?.[name]?.revenue ?? 0), 0)),
      monthly: data.properties.map((p) => ({
        name: p.name,
        values: data.months.map((month) => {
          const cell = data.monthCells[month]?.[p.name];
          return cell && cell.revenue > 0 ? cell.revenue : null;
        }),
      })),
      rangeLabel: rangeLabel(data.mode, data.range),
      rows: data.properties
        .filter((p) => (data.rangeCells[p.name]?.revenue ?? 0) > 0 || (data.previousRangeCells[p.name]?.revenue ?? 0) > 0)
        .map((p) => row(p.name, metricsOf(data.rangeCells[p.name] ?? sumMetrics([])), metricsOf(data.previousRangeCells[p.name] ?? sumMetrics([])))),
      total: row(fill(copy.totalRow, { n: included.size }), current, previous),
    };
  };

  if (data.properties.length === 0) {
    return (
      <div className="ocw rvw">
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
    custom: copy.modeCustom,
    fiscal: copy.modeFiscal,
    month: copy.modeMonth,
    week: copy.modeWeek,
    year: copy.modeYear,
  };

  // ── 숫자 6개 ── 아래 줄은 진짜 전년 대비(줄었으면 그 부분만 빨강).
  const vs = (delta: number | null): ReactNode =>
    delta === null ? copy.newLabel : <span className={delta <= -0.05 ? "is-red" : undefined}>{fill(w.vsLastYear, { d: deltaText(delta) })}</span>;
  const hasPrevOcc = previous.availableNights > 0 && current.availableNights > 0;
  const occDelta = current.occupancyPct - previous.occupancyPct;
  const kpis: Array<{ key: string; label: string; value: string; unit?: string; sub: ReactNode; title: string }> = [
    {
      key: "rev",
      label: copy.kpiRevenue,
      sub: vs(previous.revenue > 0 ? changePct(current.revenue, previous.revenue) : null),
      title: fill(copy.lastYearValue, { v: yen(previous.revenue) }),
      value: yen(current.revenue),
    },
    {
      key: "com",
      label: copy.kpiCommission,
      sub: fill(copy.shareOfRevenue, { v: current.revenue > 0 ? pct((current.commission / current.revenue) * 100) : "—" }),
      title: fill(copy.lastYearValue, { v: yen(previous.commission) }),
      value: yen(current.commission),
    },
    {
      key: "net",
      label: copy.kpiNet,
      sub: vs(previous.revenue > 0 ? changePct(current.net, previous.net) : null),
      title: fill(copy.lastYearValue, { v: yen(previous.net) }),
      value: yen(current.net),
    },
    {
      key: "occ",
      label: copy.kpiOccupancy,
      sub: (
        <>
          {fill(copy.nightsOf, { a: current.occupiedNights.toLocaleString(localeTag), b: current.availableNights.toLocaleString(localeTag) })}
          {hasPrevOcc && (
            <>
              {" · "}
              <span className={occDelta <= -0.05 ? "is-red" : undefined}>{pointText(current.occupancyPct, previous.occupancyPct)}</span>
            </>
          )}
        </>
      ),
      title: previous.availableNights > 0 ? fill(copy.lastYearValue, { v: pct(previous.occupancyPct) }) : copy.noLastYear,
      unit: current.availableNights > 0 ? "%" : undefined,
      value: current.availableNights > 0 ? current.occupancyPct.toFixed(1) : "—",
    },
    {
      key: "adr",
      label: copy.colAdr,
      sub: vs(previous.occupiedNights > 0 && current.occupiedNights > 0 ? changePct(current.adr, previous.adr) : null),
      title: `${copy.kpiAdr} · ${fill(copy.lastYearValue, { v: yen(previous.adr) })}`,
      value: current.occupiedNights > 0 ? yen(current.adr) : "—",
    },
    {
      key: "revpar",
      label: copy.colRevpar,
      sub: vs(previous.availableNights > 0 && current.availableNights > 0 ? changePct(current.revpar, previous.revpar) : null),
      title: `${copy.kpiRevpar} · ${fill(copy.lastYearValue, { v: yen(previous.revpar) })}`,
      value: current.availableNights > 0 ? yen(current.revpar) : "—",
    },
  ];

  const prevRange = shiftRange(data.mode, data.range, -1);
  const nextRange = shiftRange(data.mode, data.range, 1);
  const excludedNames = data.properties.filter((p) => !isIn(p.name)).map((p) => p.name);
  const includeSummary =
    excludedNames.length === 0
      ? w.includeAll
      : excludedNames.length <= 3 && inNames.length > 0
        ? fill(w.includeExcept, { list: excludedNames.join(" · ") })
        : fill(w.includeCount, { n: inNames.length });
  const channelName: Record<ChannelKey, string> = {
    airbnb: copy.channelAirbnb,
    booking: copy.channelBooking,
    direct: copy.channelDirect,
    other: copy.channelOther,
  };

  return (
    <div className={`ocw rvw${navPending ? " is-pending" : ""}`}>
      <div className="ocw-bar">
        <div className="ocw-seg" role="tablist" aria-label={copy.title}>
          {(["report", "matrix"] as const).map((key) => (
            <button aria-selected={tab === key} className={tab === key ? "on" : ""} key={key} onClick={() => setTab(key)} role="tab" type="button">
              {key === "report" ? copy.tabReport : copy.tabMatrix}
            </button>
          ))}
          {/* 비교(2026-10-08)는 따로 된 화면 — 지금 보던 기간이 A, 그 전년 같은 기간이 B 로 열린다. */}
          <Link
            aria-selected={false}
            href={compareHref({ mode: data.mode, range: data.range }, { mode: data.mode, range: data.previousRange }, [])}
            role="tab"
          >
            {copy.tabCompare}
          </Link>
        </div>
        <div className="ocw-seg" role="tablist">
          {REVENUE_MODES.map((mode) => (
            <Link
              aria-selected={mode === data.mode}
              className={mode === data.mode ? "on" : ""}
              href={revenueHref(mode, mode === "custom" ? data.range : shiftToMode(mode, data.range, data.today), tab)}
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
              basePath="/admin/ops/revenue"
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
                if (from && to) go(revenueHref("custom", { from, to }, tab));
              }}
              to={data.range.to}
            />
          ) : (
            <>
              <Link aria-label={copy.prev} className="ocw-arw" href={revenueHref(data.mode, prevRange, tab)}>
                <ChevronLeft aria-hidden="true" />
              </Link>
              <span className="ocw-plabel">{rangeLabel(data.mode, data.range)}</span>
              <Link aria-label={copy.next} className="ocw-arw" href={revenueHref(data.mode, nextRange, tab)}>
                <ChevronRight aria-hidden="true" />
              </Link>
            </>
          )}
        </div>
        <div className="ocw-bar__rest">
          {/* 건물 × 월은 늘 기준 달 앞뒤 15달이라 비교 · 진행 글자를 그리지 않는다(시안 RevMatrix-PC). */}
          {tab === "report" && (
            <span className="ocw-cmp">
              {copy.compare} · {fill(copy.compareSame, { range: rangeLabel(data.mode, data.previousRange) })}
            </span>
          )}
          {tab === "report" && phase !== "past" && (
            <span className="ocw-phase" title={phase === "current" ? copy.inProgress : copy.futureOnly}>
              {phase === "current" ? w.phaseNow : w.phaseAhead}
            </span>
          )}
          <div className="ocw-tools">
            <IncludePicker
              allLabel={w.includeAllOn}
              included={included}
              onSet={setIncluded}
              properties={data.properties.map((p) => p.name)}
              summary={includeSummary}
              title={copy.includeLabel}
            />
            <AdminExportButtons
              disabled={current.revenue === 0 && previous.revenue === 0}
              labels={shared}
              onExportPdf={() => exportOpsRevenueReport(exportPayload())}
              onExportXls={() => exportOpsRevenueWorkbook(exportPayload())}
              onToast={flash}
            />
          </div>
        </div>
      </div>

      <div className="ocw-body">
        {tab === "report" && (
          <div className="ocw-kpis rvw-kpis">
            {kpis.map((kpi, index) => (
              <div className="ocw-kpi" key={kpi.key} title={kpi.title}>
                <span className="l">{kpi.label}</span>
                <span className="v">
                  {kpi.value === "—" ? kpi.value : <RollNumber delay={120 + index * 60} text={kpi.value} />}
                  {kpi.unit && <small>{kpi.unit}</small>}
                </span>
                <span className="s">{kpi.sub}</span>
              </div>
            ))}
          </div>
        )}

        <div className="ocw-pane" key={tab}>
          {tab === "report" ? (
            <ReportTab
              channelName={channelName}
              copy={copy}
              current={current}
              data={data}
              deltaText={deltaText}
              go={go}
              inNames={inNames}
              isIn={isIn}
              monthShort={monthShort}
              openRow={openRow}
              pct={pct}
              rangeText={data.mode === "month" ? monthShort(data.range.from.slice(0, 7)) : rangeLabel(data.mode, data.range)}
              setOpenRow={setOpenRow}
              yen={yen}
            />
          ) : (
            <MatrixTab
              channelName={channelName}
              copy={copy}
              data={data}
              deltaText={deltaText}
              inNames={inNames}
              isIn={isIn}
              lens={lens}
              metric={metric}
              monthLong={monthLong}
              monthShort={monthShort}
              pct={pct}
              pick={pick}
              pointText={pointText}
              setLens={setLens}
              setMetric={setMetric}
              setPick={setPick}
              yen={yen}
            />
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

// ── 추이 · 건물별 ─────────────────────────────────────────────────────────

type Fmt = {
  yen: (value: number) => string;
  pct: (value: number) => string;
  deltaText: (delta: number | null) => string;
};

type SortKey = "revenue" | "previous" | "change" | "occupancy" | "adr" | "revpar" | "net";

function ReportTab({
  data,
  copy,
  current,
  inNames,
  isIn,
  openRow,
  setOpenRow,
  monthShort,
  rangeText,
  go,
  channelName,
  yen,
  deltaText,
}: Fmt & {
  data: OpsRevenueData;
  copy: Copy;
  current: RevenueMetrics;
  inNames: string[];
  isIn: (name: string) => boolean;
  openRow: string | null;
  setOpenRow: (name: string | null) => void;
  monthShort: (month: string) => string;
  rangeText: string;
  go: (href: string) => void;
  channelName: Record<ChannelKey, string>;
}) {
  const w = copy.white;
  /*
   * 머리글 정렬(2026-10-06 사용자 요청) — 누를 때마다 높은순 → 낮은순 → 원래 순서(캘린더 탭 순서). 「건물」 머리글은 바로 원래
   * 순서로. 값이 없는 줄(—)은 방향과 상관없이 맨 아래. 펼친 객실 줄도 같은 기준으로 정렬한다.
   */
  const [sort, setSort] = useState<{ key: SortKey; dir: "desc" | "asc" } | null>(null);
  const cycleSort = (key: SortKey) =>
    setSort((cur) => (cur?.key !== key ? { dir: "desc", key } : cur.dir === "desc" ? { dir: "asc", key } : null));
  const sortValue = (key: SortKey, cur: RevenueMetrics, prev: RevenueMetrics): number | null => {
    switch (key) {
      case "revenue":
        return cur.revenue > 0 ? cur.revenue : null;
      case "previous":
        return prev.revenue > 0 ? prev.revenue : null;
      case "change":
        return changePct(cur.revenue, prev.revenue);
      case "occupancy":
        return cur.availableNights > 0 ? cur.occupancyPct : null;
      case "adr":
        return cur.occupiedNights > 0 ? cur.adr : null;
      case "revpar":
        return cur.availableNights > 0 ? cur.revpar : null;
      case "net":
        return cur.revenue > 0 ? cur.net : null;
    }
  };
  const sorted = <T,>(items: T[], pickOf: (item: T) => { cur: RevenueMetrics; prev: RevenueMetrics }) => {
    if (!sort) return items;
    return items
      .map((item, index) => ({ index, item, value: sortValue(sort.key, pickOf(item).cur, pickOf(item).prev) }))
      .sort((a, b) => {
        if (a.value === null || b.value === null) return a.value === null ? (b.value === null ? a.index - b.index : 1) : -1;
        return sort.dir === "desc" ? b.value - a.value || a.index - b.index : a.value - b.value || a.index - b.index;
      })
      .map((entry) => entry.item);
  };
  const sortHead = (key: SortKey, label: string) => {
    const active = sort?.key === key;
    const next = !active ? copy.sortDesc : sort.dir === "desc" ? copy.sortAsc : copy.sortReset;
    return (
      <th aria-sort={active ? (sort.dir === "desc" ? "descending" : "ascending") : "none"} className="r" scope="col">
        <button className={`ocw-sort${active ? " on" : ""}`} onClick={() => cycleSort(key)} title={next} type="button">
          {active && (sort.dir === "desc" ? <ArrowDown aria-hidden="true" /> : <ArrowUp aria-hidden="true" />)}
          {label}
        </button>
      </th>
    );
  };

  const bars = data.months.map((month) => ({
    cur: sumMetrics(inNames.map((name) => data.monthCells[month]?.[name])),
    month,
    prev: sumMetrics(inNames.map((name) => data.monthCells[shiftMonthKey(month, -12)]?.[name])),
  }));
  const top = Math.max(1, ...bars.map((bar) => Math.max(bar.cur.revenue, bar.prev.revenue))) * 1.04;
  const todayDay = Number(data.today.slice(8));
  const daysIn = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
  const selectedMonths = new Set(data.months.filter((month) => month >= data.range.from.slice(0, 7) && month <= data.range.to.slice(0, 7)));

  const channels = CHANNELS.map((key) => ({ key, value: current[key] })).filter((c) => c.value > 0);
  const share = (value: number, total: number) => (value / Math.max(1, total)) * 100;

  const line = (cur: RevenueMetrics, prev: RevenueMetrics, isNew: boolean) => {
    const delta = changePct(cur.revenue, prev.revenue);
    return (
      <>
        <td className="r num rvw-strong">{cur.revenue > 0 ? yen(cur.revenue) : "—"}</td>
        <td className="r num ocw-faint">{prev.revenue > 0 ? yen(prev.revenue) : "—"}</td>
        <td className={`r num${prev.revenue > 0 && delta !== null && delta <= -0.05 ? " is-red" : ""}`}>
          {prev.revenue > 0 ? deltaText(delta) : isNew && cur.revenue > 0 ? copy.newLabel : "—"}
        </td>
        <td className="r num">{cur.availableNights > 0 ? `${cur.occupancyPct.toFixed(0)}%` : "—"}</td>
        <td className="r num">{cur.occupiedNights > 0 ? yen(cur.adr) : "—"}</td>
        <td className="r num">{cur.availableNights > 0 ? yen(cur.revpar) : "—"}</td>
        <td className="r num">{cur.revenue > 0 ? yen(cur.net) : "—"}</td>
        <td className="rvw-chcell">
          <ChannelBar cell={cur} />
        </td>
      </>
    );
  };
  const total = sumMetrics(inNames.map((name) => data.rangeCells[name]));
  const totalPrev = sumMetrics(inNames.map((name) => data.previousRangeCells[name]));

  return (
    <>
      <div className="rvw-top">
        <div className="rvw-trend">
          <div className="ocw-sec rvw-sec">
            <b>{copy.chartTitle}</b>
            <span className="ocw-lgs">
              <span>
                <i className="sel" />
                {w.legendSelected}
              </span>
              <span>
                <i className="past" />
                {copy.legendThisYear}
              </span>
              <span>
                <i className="rvw-lg-prev" />
                {w.legendLastYear}
              </span>
              <span>
                <i className="fut" />
                {w.legendBooked}
              </span>
              <span className="hint">· {w.legendOccHint}</span>
            </span>
          </div>
          <div className="rvw-plot">
            {bars.map(({ cur, month, prev }, index) => {
              const p = monthPhase(month, data.today);
              const sel = selectedMonths.has(month);
              const tone = p === "future" ? "fut" : p === "current" ? "cur" : sel ? "sel" : "past";
              return (
                <button
                  className={`rvw-col${sel ? " on" : ""}`}
                  key={month}
                  onClick={() => go(`/admin/ops/revenue?mode=month&ym=${month}`)}
                  style={{ "--i": index } as CSSProperties}
                  title={`${monthShort(month)} · ${yen(cur.revenue)} · ${w.legendLastYear} ${yen(prev.revenue)}`}
                  type="button"
                >
                  <span
                    className={`rvw-col__b is-${tone}`}
                    style={
                      {
                        height: `${(cur.revenue / top) * 100}%`,
                        ...(p === "current" ? { "--done": `${Math.round((todayDay / daysIn(month)) * 100)}%` } : {}),
                      } as CSSProperties
                    }
                  />
                  <span className="rvw-col__p" style={{ height: `${(prev.revenue / top) * 100}%` }} />
                </button>
              );
            })}
          </div>
          <div className="rvw-months">
            {bars.map(({ cur, month }) => (
              <span className={selectedMonths.has(month) ? "on" : ""} key={month} title={month}>
                <b className={month.endsWith("-01") ? "y" : undefined}>{monthShort(month)}</b>
                <small>{cur.availableNights > 0 ? `${cur.occupancyPct.toFixed(0)}%` : "—"}</small>
              </span>
            ))}
          </div>
        </div>

        <aside className="rvw-side">
          <div className="rvw-flow">
            <span className="l">{copy.flowTitle}</span>
            <b className="v">
              <RollNumber delay={300} text={yen(current.net)} />
            </b>
            <span className="s">{fill(w.flowLine, { com: yen(current.commission), rev: yen(current.revenue) })}</span>
            <span className="s">{w.flowNote}</span>
          </div>
          <div className="rvw-chan">
            <span className="l">{copy.channelTitle}</span>
            <span aria-hidden="true" className="rvw-stack">
              {channels.map(({ key, value }) => (
                <i key={key} style={{ background: CHANNEL_COLOR[key], width: `${share(value, current.revenue)}%` }} />
              ))}
            </span>
            {channels.map(({ key, value }, index) => (
              <div className="rvw-chr" key={key} style={{ "--i": index } as CSSProperties}>
                <i style={{ background: CHANNEL_COLOR[key] }} />
                <span className="n">{channelName[key]}</span>
                <span className="a">{yen(value)}</span>
                <b>{`${share(value, current.revenue).toFixed(0)}%`}</b>
              </div>
            ))}
          </div>
        </aside>
      </div>

      <div className="ocw-sec">
        <b>{copy.tableTitle}</b>
        <span className="hint">
          {rangeText} · {w.tableHint}
        </span>
      </div>
      <div className="ocw-tablewrap">
        <table className="ocw-table rvw-table">
          <colgroup>
            <col className="c-name" />
            <col className="c-m" />
            <col className="c-m" />
            <col className="c-s" />
            <col className="c-s" />
            <col className="c-k" />
            <col className="c-k" />
            <col className="c-m" />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">
                <button className={`ocw-sort${sort ? "" : " on"}`} onClick={() => setSort(null)} title={copy.sortReset} type="button">
                  {copy.colProperty}
                </button>
              </th>
              {sortHead("revenue", copy.colRevenue)}
              {sortHead("previous", copy.colLastYear)}
              {sortHead("change", copy.colChange)}
              {sortHead("occupancy", copy.colOccupancy)}
              {sortHead("adr", copy.colAdr)}
              {sortHead("revpar", copy.colRevpar)}
              {sortHead("net", copy.colNet)}
              <th className="rvw-chcell" scope="col">
                {copy.colChannels}
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
                    property.rooms.map((room) => ({
                      cur: metricsOf(data.rangeRoomCells[room.key] ?? sumMetrics([])),
                      label: room.label,
                      prev: metricsOf(data.previousRangeRoomCells[room.key] ?? sumMetrics([])),
                    })),
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
                        {!isIn(property.name) && <span className="ex">{copy.excludedTag}</span>}
                      </span>
                    </td>
                    {line(cur, prev, true)}
                  </tr>
                  {rooms.map((room, index) => (
                    <tr className="ocw-room" key={room.label} style={{ "--i": index } as CSSProperties}>
                      <td>
                        <span className="rn">{room.label}</span>
                      </td>
                      {line(room.cur, room.prev, false)}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
            <tr className="ocw-total">
              <td>{fill(copy.totalRow, { n: inNames.length })}</td>
              {line(total, totalPrev, false)}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function ChannelBar({ cell }: { cell: RevenueCell }) {
  if (cell.revenue <= 0) return <span className="ocw-faint">—</span>;
  return (
    <span aria-hidden="true" className="rvw-stack rvw-stack--row">
      {CHANNELS.filter((key) => cell[key] > 0).map((key) => (
        <i key={key} style={{ background: CHANNEL_COLOR[key], width: `${(cell[key] / cell.revenue) * 100}%` }} />
      ))}
    </span>
  );
}

// ── 건물 × 월 ─────────────────────────────────────────────────────────────

function MatrixTab({
  data,
  copy,
  inNames,
  isIn,
  metric,
  setMetric,
  lens,
  setLens,
  pick,
  setPick,
  monthShort,
  monthLong,
  pointText,
  channelName,
  yen,
  pct,
  deltaText,
}: Fmt & {
  data: OpsRevenueData;
  copy: Copy;
  inNames: string[];
  isIn: (name: string) => boolean;
  metric: Metric;
  setMetric: (metric: Metric) => void;
  lens: Lens;
  setLens: (lens: Lens) => void;
  pick: { property: string | null; month: string };
  setPick: (pick: { property: string | null; month: string }) => void;
  monthShort: (month: string) => string;
  monthLong: (month: string) => string;
  pointText: (current: number, previous: number) => string;
  channelName: Record<ChannelKey, string>;
}) {
  const w = copy.white;
  const months = data.months;
  const value = (m: RevenueMetrics) =>
    metric === "revenue" ? m.revenue : metric === "net" ? m.net : metric === "occupancy" ? m.occupancyPct : metric === "adr" ? m.adr : m.revpar;
  const short = (v: number) =>
    metric === "occupancy" ? `${v.toFixed(0)}%` : metric === "adr" || metric === "revpar" ? `${Math.round(v / 1000)}K` : (v / 1e6).toFixed(1);
  const unit = metric === "occupancy" ? copy.unitPercent : metric === "adr" || metric === "revpar" ? copy.unitThousand : copy.unitMillion;
  const perRow = metric === "revenue" || metric === "net";
  const isPast = (month: string) => monthPhase(month, data.today) === "past";
  const has = (m: RevenueMetrics) => (metric === "revenue" || metric === "net" ? m.revenue > 0 : metric === "adr" ? m.occupiedNights > 0 : m.availableNights > 0);
  const deltaOf = (cur: RevenueMetrics, prev: RevenueMetrics) =>
    metric === "occupancy" ? (prev.availableNights > 0 ? cur.occupancyPct - prev.occupancyPct : null) : has(prev) ? changePct(value(cur), value(prev)) : null;
  const deltaShort = (d: number) =>
    Math.abs(d) >= 100 && metric !== "occupancy" ? "100%+" : `${Math.abs(d).toFixed(0)}${metric === "occupancy" ? copy.pointSuffix : "%"}`;

  const rowCells = (names: string[]) =>
    months.map((month) => ({
      cur: sumMetrics(names.map((name) => data.monthCells[month]?.[name])),
      month,
      prev: sumMetrics(names.map((name) => data.monthCells[shiftMonthKey(month, -12)]?.[name])),
    }));
  type Cells = ReturnType<typeof rowCells>;
  const rows = data.properties.map((p) => ({ cells: rowCells([p.name]), name: p.name, rooms: p.roomCount }));
  const totalCells = rowCells(inNames);
  const pastValues = (cells: Cells) => cells.filter((c) => isPast(c.month) && has(c.cur)).map((c) => value(c.cur));
  const globalCuts = quintileCuts(rows.flatMap((row) => pastValues(row.cells)));

  const sum12 = (cells: Cells) => {
    const cur = sumMetrics(cells.slice(0, 12).map((c) => c.cur));
    const prev = sumMetrics(cells.slice(0, 12).map((c) => c.prev));
    const v = value(cur);
    const d = deltaOf(cur, prev);
    // 전년 12개월 중 문을 연 달이 절반도 안 되면 증감 대신 「신규」(2026-10-06 — 연 지 얼마 안 된 건물의 +650% 같은 숫자).
    const thin = cells.slice(0, 12).filter((c) => c.prev.occupiedNights > 0).length < 6;
    return {
      d: thin ? copy.newLabel : metric === "occupancy" ? (d === null ? copy.newLabel : pointText(v, value(prev))) : deltaText(d),
      down: !thin && d !== null && d <= -0.05,
      // 매출 · 수수료 뺀 금액은 칸과 같은 백만 엔 단위(왼쪽 위 단위 글자) — 전체 엔은 툴팁. 단가 지표는 엔 그대로.
      full: metric === "occupancy" ? pct(v) : yen(v),
      v: metric === "occupancy" ? pct(v) : perRow ? short(v) : yen(v),
    };
  };

  const cell = (cur: RevenueMetrics, prev: RevenueMetrics, month: string, cuts: number[], property: string | null, index: number, label: string) => {
    const future = !isPast(month);
    const selected = pick.property === property && pick.month === month;
    const off = property !== null && !isIn(property);
    if (cur.occupiedNights === 0 && cur.revenue === 0) {
      return <span aria-hidden="true" className="rvw-mc na" key={month} style={{ "--c": index } as CSSProperties} />;
    }
    const d = deltaOf(cur, prev);
    let style: CSSProperties = { "--c": index } as CSSProperties;
    let text: string;
    let sub: ReactNode;
    if (lens === "value") {
      if (!future) style = { ...style, background: VALUE_BG[quintileLevel(value(cur), cuts)] };
      text = short(value(cur));
      sub = future ? w.bookedTag : d === null ? "" : <span className={d >= 0 ? "u" : "dn"}>{`${d >= 0 ? "▲" : "▼"}${deltaShort(d)}`}</span>;
    } else {
      const level = yoyLevel(d);
      if (!future) style = { ...style, ...(level < 0 ? { background: "#F7F7F9", color: "#6f6c7c" } : { background: YOY_BG[level], color: YOY_FG[level] }) };
      text = d === null ? copy.newLabel : `${d >= 0 ? "▲" : "▼"}${deltaShort(d)}`;
      sub = future ? w.bookedTag : short(value(cur));
    }
    return (
      <button
        aria-label={`${label} ${monthLong(month)}`}
        aria-pressed={selected}
        className={`rvw-mc${future ? " fut" : ""}${selected ? " on" : ""}${off ? " off" : ""}`}
        key={month}
        onClick={() => setPick({ month, property })}
        style={style}
        type="button"
      >
        <b>{text}</b>
        <span className="s">{sub}</span>
      </button>
    );
  };

  // ── 고른 칸 ──
  const pickNames = pick.property === null ? inNames : [pick.property];
  const pickCur = sumMetrics(pickNames.map((name) => data.monthCells[pick.month]?.[name]));
  const pickPrev = sumMetrics(pickNames.map((name) => data.monthCells[shiftMonthKey(pick.month, -12)]?.[name]));
  const pickProperty = data.properties.find((p) => p.name === pick.property);
  const pickRooms = pickProperty
    ? pickProperty.rooms
        .map((room) => ({ label: room.label, m: metricsOf(data.monthRoomCells[pick.month]?.[room.key] ?? sumMetrics([])) }))
        .filter((room) => room.m.availableNights > 0)
        .sort((a, b) => a.m.occupancyPct - b.m.occupancyPct)
    : [];
  const pickChannels = CHANNELS.map((key) => ({ key, value: pickCur[key] })).filter((c) => c.value > 0);
  const change = (text: string, delta: number | null) => (
    <span className={delta !== null && delta <= -0.05 ? "is-red" : "rvw-up"}>{text}</span>
  );
  const adrDelta = pickPrev.occupiedNights > 0 && pickCur.occupiedNights > 0 ? changePct(pickCur.adr, pickPrev.adr) : null;
  const revparDelta = pickPrev.availableNights > 0 && pickCur.availableNights > 0 ? changePct(pickCur.revpar, pickPrev.revpar) : null;
  const revDelta = pickPrev.revenue > 0 ? changePct(pickCur.revenue, pickPrev.revenue) : null;
  const arrow = (delta: number | null) => (delta === null ? "" : `${delta >= 0 ? "▲" : "▼"}${Math.abs(delta).toFixed(1)}%`);
  const metricName: Record<Metric, string> = {
    adr: copy.metricAdr,
    net: copy.metricNet,
    occupancy: copy.metricOccupancy,
    revenue: copy.metricRevenue,
    revpar: copy.metricRevpar,
  };

  return (
    <>
      <div className="rvw-mxbar">
        <div className="ocw-seg" role="tablist" aria-label={copy.tabMatrix}>
          {(["revenue", "net", "occupancy", "adr", "revpar"] as const).map((key) => (
            <button aria-selected={metric === key} className={metric === key ? "on" : ""} key={key} onClick={() => setMetric(key)} role="tab" type="button">
              {metricName[key]}
            </button>
          ))}
        </div>
        <div className="ocw-seg" role="tablist">
          {(["value", "yoy"] as const).map((key) => (
            <button aria-selected={lens === key} className={lens === key ? "on" : ""} key={key} onClick={() => setLens(key)} role="tab" type="button">
              {key === "value" ? copy.lensValue : copy.lensYoy}
            </button>
          ))}
        </div>
        <span className="hint">{lens === "yoy" ? w.heatHintYoy : perRow ? w.heatHintRow : w.heatHintAll}</span>
      </div>

      <div className="rvw-mxsplit">
        <div className="rvw-mxmain">
          <div className="rvw-mxwrap">
            <div className={`rvw-mx${lens === "yoy" ? " is-yoy" : ""}`} role="grid" aria-label={fill(lens === "value" ? copy.matrixTitle : copy.matrixTitleYoy, { metric: metricName[metric] })}>
              <span className="rvw-unit">{lens === "value" ? unit : copy.lensYoy}</span>
              {months.map((month, index) => (
                <span className={`ocw-mh${pick.month === month ? " on" : ""}`} key={month}>
                  <span className="yy">{index === 0 || month.endsWith("-01") ? month.slice(0, 4) : ""}</span>
                  {monthShort(month)}
                </span>
              ))}
              <span className="rvw-unit r">{w.sum12}</span>

              {rows.map((row) => {
                const cuts = perRow ? quintileCuts(pastValues(row.cells)) : globalCuts;
                const total = sum12(row.cells);
                const off = !isIn(row.name);
                return (
                  <Fragment key={row.name}>
                    <span className={`rvw-rl${off ? " off" : ""}`} title={row.name}>
                      <b>{row.name}</b>
                      <span>{off ? copy.excludedTag : fill(copy.roomCount, { n: row.rooms })}</span>
                    </span>
                    {row.cells.map(({ cur, prev, month }, index) => cell(cur, prev, month, cuts, row.name, index, row.name))}
                    <span className={`rvw-sm${off ? " off" : ""}`} title={total.full}>
                      <b>{total.v}</b>
                      <span className={total.down ? "is-red" : undefined}>{total.d}</span>
                    </span>
                  </Fragment>
                );
              })}

              <span className="rvw-rl tot">
                <b>{copy.totalLabel}</b>
                <span>{fill(copy.propertyCount, { n: inNames.length })}</span>
              </span>
              {totalCells.map(({ cur, prev, month }, index) =>
                cell(cur, prev, month, quintileCuts(pastValues(totalCells)), null, index, copy.totalLabel),
              )}
              {(() => {
                const total = sum12(totalCells);
                return (
                  <span className="rvw-sm tot" title={total.full}>
                    <b>{total.v}</b>
                    <span className={total.down ? "is-red" : undefined}>{total.d}</span>
                  </span>
                );
              })()}
            </div>
          </div>
          <p className="ocw-foot">{w.matrixFoot}</p>
        </div>

        <aside className="rvw-detail" key={`${pick.property ?? ""}|${pick.month}`}>
          <div className="rvw-dhead">
            <span className="eyebrow">
              {copy.tabMatrix}
              {!isPast(pick.month) && <em> · {copy.detailBooked}</em>}
            </span>
            <h2>
              {pick.property ?? copy.totalLabel} · {monthShort(pick.month)}
            </h2>
            <span className="sub">
              {pickProperty
                ? fill(w.detailSub, { n: pickCur.occupiedNights.toLocaleString(), rooms: pickProperty.roomCount })
                : fill(w.detailSubTotal, { n: pickCur.occupiedNights.toLocaleString(), p: inNames.length })}
            </span>
          </div>
          <dl className="rvw-dl">
            <dt>{copy.colRevenue}</dt>
            <dd>
              {yen(pickCur.revenue)}
              {revDelta !== null ? <> · {change(arrow(revDelta), revDelta)}</> : <span className="ocw-faint"> · {copy.noLastYear}</span>}
            </dd>
            <dt>{copy.colOccupancy}</dt>
            <dd>
              {pickCur.availableNights > 0 ? `${pickCur.occupancyPct.toFixed(0)}%` : "—"}
              {pickPrev.availableNights > 0 && pickCur.availableNights > 0 && (
                <> · {change(pointText(pickCur.occupancyPct, pickPrev.occupancyPct), pickCur.occupancyPct - pickPrev.occupancyPct)}</>
              )}
            </dd>
            <dt>{copy.colAdr}</dt>
            <dd>
              {pickCur.occupiedNights > 0 ? yen(pickCur.adr) : "—"}
              {adrDelta !== null && <> · {change(arrow(adrDelta), adrDelta)}</>}
            </dd>
            <dt>{copy.colRevpar}</dt>
            <dd>
              {pickCur.availableNights > 0 ? yen(pickCur.revpar) : "—"}
              {revparDelta !== null && <> · {change(arrow(revparDelta), revparDelta)}</>}
            </dd>
            <dt>{copy.colCommission}</dt>
            <dd>{yen(pickCur.commission)}</dd>
            <dt>{copy.colNet}</dt>
            <dd>{yen(pickCur.net)}</dd>
          </dl>
          {pickChannels.length > 0 && (
            <div className="rvw-dsec">
              <span className="h">{copy.colChannels}</span>
              <span aria-hidden="true" className="rvw-stack">
                {pickChannels.map(({ key, value: v }) => (
                  <i key={key} style={{ background: CHANNEL_COLOR[key], width: `${(v / Math.max(1, pickCur.revenue)) * 100}%` }} />
                ))}
              </span>
              <span className="rvw-dlg">
                {pickChannels.map(({ key, value: v }) => (
                  <span key={key}>
                    <i style={{ background: CHANNEL_COLOR[key] }} />
                    {channelName[key]} {((v / Math.max(1, pickCur.revenue)) * 100).toFixed(0)}
                  </span>
                ))}
              </span>
            </div>
          )}
          {pickProperty ? (
            pickRooms.length > 0 && (
              <div className="rvw-dsec">
                <span className="h">{w.detailRooms}</span>
                <div className="rvw-rooms">
                  {pickRooms.map((room, index) => (
                    <div className="rvw-rr" key={room.label} style={{ "--i": index } as CSSProperties}>
                      <span className="n">{room.label}</span>
                      <span className="a">{yen(room.m.revenue)}</span>
                      <b className={room.m.occupancyPct < 60 ? "is-red" : undefined}>{room.m.occupancyPct.toFixed(0)}%</b>
                    </div>
                  ))}
                </div>
              </div>
            )
          ) : (
            <p className="rvw-dnote">{copy.detailTotalNote}</p>
          )}
        </aside>
      </div>
    </>
  );
}
