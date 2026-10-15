"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { exportOpsCompareReport, exportOpsCompareWorkbook, type OpsCompareExportPayload } from "@/app/admin/ops/revenue/compare/actions";
import { AdminDateRangePicker } from "@/components/admin/shared/admin-date-range-picker";
import { AdminExportButtons } from "@/components/admin/shared/admin-export-buttons";
import { AdminMonthPicker } from "@/components/admin/shared/admin-month-picker";
import { RollNumber } from "@/components/shared/roll-number";
import type { Dictionary } from "@/lib/i18n";
import {
  REVENUE_MODES,
  defaultRange,
  fiscalPeriodNumber,
  lastDayOfMonth,
  metricsOf,
  previousYearRange,
  shiftRange,
  sumMetrics,
  type RevenueMetrics,
  type RevenueMode,
  type RevenueRange,
} from "@/lib/ops-revenue";
import { changePctOrNull, findNewRooms, groupProperties, growthDrivers, newRoomShare, topMover, totalOf } from "@/lib/ops-revenue-compare";
import type { OpsRevenueCompareData, OpsRevenueComparePeriod } from "@/lib/ops-revenue-server";
import { IncludePicker } from "./ops-include-picker";
import "./ops-occupancy-white.css";
import "./ops-revenue-compare-white.css";

/**
 * 매출 비교(A vs B) — 화이트 리디자인(2026-10-15, 시안 RevCompare-PC). 가동률 화면(`.ocw-*`)의 형제 — 탭 · 고르기 · 합계
 * 드롭다운 · 움직임을 같이 쓰고, 이 화면만의 모양은 `ops-revenue-compare-white.css`(`.rcw-*`).
 *
 * 도메인 계약: docs/product/34-metrics-and-automation.md 「매출 비교」
 *
 * 숫자는 매출 화면과 같은 칸(서버 `getOpsRevenueCompareData`)이고, 합계에 넣을 건물 · B → A 차이 분해는 여기서
 * (`ops-revenue-compare.ts`, 순수). 두 기간 · 건물 선택은 주소에 남는다 — 링크로 같은 비교를 공유한다.
 */
type Copy = Dictionary["opsRevenueCompare"];
type WhiteCopy = Copy["white"];
type RevenueCopy = Dictionary["opsRevenue"];
type SharedCopy = Dictionary["admin"]["shared"];
type Metric = "revenue" | "occupancy" | "adr" | "revpar";
type Tone = "up" | "dn" | "z";

const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);

const sameRange = (x: RevenueRange, y: RevenueRange) => x.from === y.from && x.to === y.to;

export function compareHref(a: OpsRevenueComparePeriod, b: OpsRevenueComparePeriod, excluded: readonly string[]): string {
  const query = new URLSearchParams({ af: a.range.from, am: a.mode, at: a.range.to, bf: b.range.from, bm: b.mode, bt: b.range.to });
  for (const name of excluded) query.append("ex", name);
  return `/admin/ops/revenue/compare?${query.toString()}`;
}

/** 모드를 바꿀 때 — 지금 기간의 끝(오늘보다 뒤면 오늘)이 든 그 모드의 기간. */
function rangeForMode(mode: RevenueMode, range: RevenueRange, today: string): RevenueRange {
  if (mode === "custom") return range;
  const base = range.to > today && range.from <= today ? today : range.to;
  if (mode === "month") return { from: `${base.slice(0, 7)}-01`, to: lastDayOfMonth(base.slice(0, 7)) };
  return defaultRange(mode, base);
}

export function OpsRevenueCompareConsole({
  data,
  copy,
  rcopy,
  shared,
  localeTag,
  initialExcluded,
}: {
  data: OpsRevenueCompareData;
  copy: Copy;
  rcopy: RevenueCopy;
  shared: SharedCopy;
  localeTag: string;
  initialExcluded: string[] | null;
}) {
  const w = copy.white;
  const router = useRouter();
  const [navPending, startNav] = useTransition();
  const [included, setIncluded] = useState<Set<string>>(() => {
    const out = initialExcluded ? new Set(initialExcluded) : new Set(data.properties.filter((p) => p.defaultExcluded).map((p) => p.name));
    return new Set(data.properties.filter((p) => !out.has(p.name)).map((p) => p.name));
  });
  const [metric, setMetric] = useState<Metric>("revenue");
  const [toast, setToast] = useState<string | null>(null);
  const excluded = data.properties.filter((p) => !included.has(p.name)).map((p) => p.name);

  // 건물 선택도 주소에 — 링크를 복사하면 같은 비교가 열린다.
  const excludedKey = excluded.join("|");
  useEffect(() => {
    window.history.replaceState(window.history.state, "", compareHref(data.a, data.b, excludedKey ? excludedKey.split("|") : []));
  }, [data.a, data.b, excludedKey]);

  const flash = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((current) => (current === text ? null : current)), 2000);
  };
  const go = (a: OpsRevenueComparePeriod, b: OpsRevenueComparePeriod) => startNav(() => router.push(compareHref(a, b, excluded)));

  // ── 글자 모양 ──
  const yen = (v: number) => `¥${Math.round(v).toLocaleString(localeTag)}`;
  const signedYen = (v: number) => (Math.round(v) === 0 ? yen(0) : `${v > 0 ? "+" : "−"}${yen(Math.abs(v))}`);
  const n = (v: number) => Math.round(v).toLocaleString(localeTag);
  const pct = (v: number) => `${v.toFixed(1)}%`;
  const signedPct = (v: number | null) => (v === null ? rcopy.newLabel : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`);
  const signedPoint = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}${rcopy.pointSuffix}`;
  const tone = (v: number | null): Tone => (v === null ? "z" : v > 0.05 ? "up" : v < -0.05 ? "dn" : "z");
  const dayLabel = (date: string, withYear: boolean) =>
    new Intl.DateTimeFormat(localeTag, { day: "numeric", month: "short", timeZone: "UTC", ...(withYear ? { year: "numeric" } : {}) }).format(
      new Date(`${date}T00:00:00Z`),
    );
  const periodLabel = ({ mode, range }: OpsRevenueComparePeriod) => {
    if (mode === "month") {
      return new Intl.DateTimeFormat(localeTag, { month: "long", timeZone: "UTC", year: "numeric" }).format(new Date(`${range.from}T00:00:00Z`));
    }
    if (mode === "fiscal") {
      return fill(rcopy.fiscalLabel, {
        from: range.from.slice(0, 7).replace("-", "."),
        n: fiscalPeriodNumber(Number(range.from.slice(0, 4))),
        to: range.to.slice(0, 7).replace("-", "."),
      });
    }
    if (mode === "year") return range.from.slice(0, 4);
    return `${dayLabel(range.from, true)} – ${dayLabel(range.to, range.from.slice(0, 4) !== range.to.slice(0, 4))}`;
  };
  const aLabel = periodLabel(data.a);
  const bLabel = periodLabel(data.b);

  // ── 숫자 ──
  const inNames = data.properties.filter((p) => included.has(p.name)).map((p) => p.name);
  const groups = groupProperties(inNames, data.aCells, data.bCells);
  const aTot = totalOf(inNames, data.aCells);
  const bTot = totalOf(inNames, data.bCells);
  const delta = aTot.revenue - bTot.revenue;
  const growth = changePctOrNull(aTot.revenue, bTot.revenue);
  // 기존 건물의 새 객실(첫 판매일이 B 뒤) — 건물 숫자는 그대로, 차이 분해에서만 몫을 떼어 낸다(2026-10-08).
  const newRooms = findNewRooms(groups.existing, data.rooms, data.roomFirstSale, data.b.range.to, data.a.range.to);
  const roomShare = newRoomShare(newRooms, data.aRoomCells, data.bRoomCells);
  const drivers = growthDrivers(groups, data.aCells, data.bCells, roomShare);
  const aEx = totalOf(groups.existing, data.aCells);
  const bEx = totalOf(groups.existing, data.bCells);
  const exGrowth = changePctOrNull(aEx.revenue, bEx.revenue);
  const freshSum = totalOf(groups.fresh, data.aCells).revenue;
  const closedSum = totalOf(groups.closed, data.bCells).revenue;
  const mixChanged = groups.fresh.length > 0 || groups.closed.length > 0;
  const isSameRange = sameRange(data.a.range, data.b.range);
  // 단가 · 가동률 변화는 **같은 방들끼리**(새 객실 뺀 것) — 기여 막대와 같은 기준.
  const same = { a: drivers.existingA, b: drivers.existingB };
  const exAdr = changePctOrNull(same.a.adr, same.b.adr);
  const exOcc = same.a.availableNights > 0 && same.b.availableNights > 0 ? same.a.occupancyPct - same.b.occupancyPct : null;
  const newRoomsDelta = roomShare ? roomShare.a.revenue - roomShare.b.revenue : 0;

  // B 가 어느 빠른 고르기와 같은가 — 그 버튼 글자만 보라.
  const lastYearB: OpsRevenueComparePeriod = { mode: data.a.mode, range: previousYearRange(data.a.range) };
  const prevB: OpsRevenueComparePeriod = { mode: data.a.mode, range: shiftRange(data.a.mode, data.a.range, -1) };
  const isLastYear = data.b.mode === data.a.mode && sameRange(data.b.range, lastYearB.range);
  const isPrev = !isLastYear && data.b.mode === data.a.mode && sameRange(data.b.range, prevB.range);
  const headline = fill(isLastYear ? w.headlineLastYear : isPrev ? w.headlinePrev : w.headlineVs, { a: aLabel, b: bLabel });

  const includeSummary =
    excluded.length === 0
      ? w.includeAll
      : excluded.length <= 3 && inNames.length > 0
        ? fill(w.includeExcept, { list: excluded.join(" · ") })
        : fill(w.includeCount, { n: inNames.length });

  const insights = [
    ...(groups.fresh.length > 0 ? [fill(copy.insNew, { d: signedYen(delta), n: yen(freshSum), names: groups.fresh.join(" · ") })] : []),
    ...(roomShare && newRoomsDelta !== 0 ? [fill(copy.insNewRooms, { names: roomShare.labels.join(" · "), v: signedYen(newRoomsDelta) })] : []),
    ...(groups.existing.length > 0 && (mixChanged || roomShare)
      ? [fill(copy.insExisting, { adr: signedPct(exAdr), n: groups.existing.length, occ: exOcc === null ? "—" : signedPoint(exOcc) })]
      : []),
    ...(() => {
      const mover = topMover(groups.existing, data.aCells, data.bCells);
      if (!mover) return [];
      return [fill(mover.delta > 0 ? copy.insTopUp : copy.insTopDown, { d: signedPct(mover.pct), name: mover.name, v: signedYen(mover.delta) })];
    })(),
    ...(!mixChanged ? [copy.insSame] : []),
  ].slice(0, 3);

  const exportPayload = (): OpsCompareExportPayload => {
    const side = (m: RevenueMetrics) => ({ available: m.availableNights, occupied: m.occupiedNights, revenue: m.revenue });
    return {
      aLabel,
      bLabel,
      rows: inNames
        .map((name) => ({ a: side(metricsOf(data.aCells[name] ?? sumMetrics([]))), b: side(metricsOf(data.bCells[name] ?? sumMetrics([]))), name }))
        .filter((row) => row.a.revenue !== 0 || row.b.revenue !== 0),
      total: { a: side(aTot), b: side(bTot) },
    };
  };

  const pickProps = { localeTag, periodLabel, rcopy, shared, today: data.today, w };

  return (
    <div className={`ocw rcw${navPending ? " is-pending" : ""}`}>
      <div className="ocw-bar">
        <div aria-label={copy.title} className="ocw-seg rcw-tabs" role="tablist">
          <Link aria-selected={false} href="/admin/ops/revenue" role="tab">
            {rcopy.tabReport}
          </Link>
          <Link aria-selected={false} href="/admin/ops/revenue?tab=matrix" role="tab">
            {rcopy.tabMatrix}
          </Link>
          <span aria-current="page" aria-selected className="on" role="tab">
            {rcopy.tabCompare}
          </span>
        </div>
      </div>

      <div className="ocw-body">
        <header className="rcw-head">
          <div className="rcw-headl">
            <span className="rcw-live">
              <i aria-hidden="true" />
              {w.live}
            </span>
            <h1 className="rcw-h1">
              {headline} <span className={`rcw-n ${tone(growth)}`}><RollNumber delay={80} text={signedPct(growth)} /></span>
              {mixChanged && groups.existing.length > 0 && (
                <>
                  {w.headlineExisting} <span className={`rcw-n ${tone(exGrowth)}`}><RollNumber delay={160} text={signedPct(exGrowth)} /></span>
                </>
              )}
            </h1>
            {isSameRange && <span className="rcw-warn">{copy.sameRange}</span>}
          </div>
          <div className="ocw-tools rcw-tools">
            <button
              className="rcw-link"
              onClick={() => {
                void navigator.clipboard?.writeText(window.location.href).then(() => flash(copy.copied));
              }}
              type="button"
            >
              {copy.copyLink}
            </button>
            <AdminExportButtons
              disabled={aTot.revenue === 0 && bTot.revenue === 0}
              labels={shared}
              onExportPdf={() => exportOpsCompareReport(exportPayload())}
              onExportXls={() => exportOpsCompareWorkbook(exportPayload())}
              onToast={flash}
            />
          </div>
        </header>

        <div className="rcw-periods">
          <PeriodPick {...pickProps} onChange={(next) => go(next, data.b)} period={data.a} side="a" />
          <span className="rcw-vs">vs</span>
          <PeriodPick {...pickProps} onChange={(next) => go(data.a, next)} period={data.b} side="b" />
          <button aria-pressed={isLastYear} className={`rcw-quick${isLastYear ? " on" : ""}`} onClick={() => go(data.a, lastYearB)} type="button">
            {copy.quickLastYear}
          </button>
          <button aria-pressed={isPrev} className={`rcw-quick${isPrev ? " on" : ""}`} onClick={() => go(data.a, prevB)} type="button">
            {copy.quickPrev}
          </button>
          <div className="rcw-inc">
            <IncludePicker
              allLabel={w.includeAllOn}
              included={included}
              onSet={setIncluded}
              properties={data.properties.map((p) => p.name)}
              summary={includeSummary}
              title={rcopy.includeLabel}
            />
          </div>
        </div>

        {aTot.revenue === 0 && bTot.revenue === 0 ? (
          <div className="ocw-empty">{copy.empty}</div>
        ) : (
          <>
            <section className="rcw-hero">
              <TotalColumn
                aTotal={aTot.revenue}
                bTotal={bTot.revenue}
                closedSum={closedSum}
                existingCount={groups.existing.length}
                existingDelta={same.a.revenue - same.b.revenue}
                freshSum={freshSum}
                newRoomsDelta={newRoomsDelta}
                signedYen={signedYen}
                w={w}
                yen={yen}
              />
              <GrowthColumn
                aEx={same.a}
                bEx={same.b}
                closedNames={groups.closed}
                copy={copy}
                drivers={drivers}
                freshNames={groups.fresh}
                growth={growth}
                insights={insights}
                n={n}
                newRoomLabels={roomShare?.labels ?? []}
                signedPct={signedPct}
                signedPoint={signedPoint}
                signedYen={signedYen}
                tone={tone}
                yen={yen}
              />
            </section>

            <section className="rcw-kpis">
              {[
                {
                  a: aTot.availableNights > 0 ? pct(aTot.occupancyPct) : "—",
                  aBar: aTot.occupancyPct / 100,
                  b: bTot.availableNights > 0 ? pct(bTot.occupancyPct) : "—",
                  bBar: bTot.occupancyPct / 100,
                  delta: aTot.availableNights > 0 && bTot.availableNights > 0 ? signedPoint(aTot.occupancyPct - bTot.occupancyPct) : rcopy.newLabel,
                  key: "occ",
                  label: rcopy.metricOccupancy,
                  note: fill(copy.kpiOccNote, { a: n(aTot.occupiedNights), b: n(aTot.availableNights) }),
                  tone: tone(aTot.occupancyPct - bTot.occupancyPct),
                },
                {
                  a: fill(w.nightsValue, { n: n(aTot.occupiedNights) }),
                  aBar: aTot.occupiedNights,
                  b: fill(w.nightsValue, { n: n(bTot.occupiedNights) }),
                  bBar: bTot.occupiedNights,
                  delta: signedPct(changePctOrNull(aTot.occupiedNights, bTot.occupiedNights)),
                  key: "nights",
                  label: copy.kpiNights,
                  note: fill(copy.kpiNightsNote, { a: n(aTot.availableNights), b: n(bTot.availableNights) }),
                  tone: tone(changePctOrNull(aTot.occupiedNights, bTot.occupiedNights)),
                },
                {
                  a: aTot.occupiedNights > 0 ? yen(aTot.adr) : "—",
                  aBar: aTot.adr,
                  b: bTot.occupiedNights > 0 ? yen(bTot.adr) : "—",
                  bBar: bTot.adr,
                  delta: signedPct(changePctOrNull(aTot.adr, bTot.adr)),
                  key: "adr",
                  label: rcopy.metricAdr,
                  note: copy.kpiAdrNote,
                  tone: tone(changePctOrNull(aTot.adr, bTot.adr)),
                },
                {
                  a: aTot.availableNights > 0 ? yen(aTot.revpar) : "—",
                  aBar: aTot.revpar,
                  b: bTot.availableNights > 0 ? yen(bTot.revpar) : "—",
                  bBar: bTot.revpar,
                  delta: signedPct(changePctOrNull(aTot.revpar, bTot.revpar)),
                  key: "revpar",
                  label: rcopy.metricRevpar,
                  note: copy.kpiRevparNote,
                  tone: tone(changePctOrNull(aTot.revpar, bTot.revpar)),
                },
              ].map((kpi, index) => {
                // 가동률은 0~100% 그대로, 나머지는 둘 중 큰 값에 여유를 둔 비율.
                const scale = kpi.key === "occ" ? 1 : Math.max(kpi.aBar, kpi.bBar, 1e-9) * 1.08;
                const width = (v: number) => `${Math.max(0, Math.min(100, (v / scale) * 100))}%`;
                return (
                  <div className="rcw-kpi" key={kpi.key} style={{ "--i": index } as CSSProperties} title={kpi.note}>
                    <span className="l">{kpi.label}</span>
                    <div className="v">
                      <b>{kpi.a === "—" ? kpi.a : <RollNumber delay={200 + index * 60} text={kpi.a} />}</b>
                      <span className={`d ${kpi.tone}`}>{kpi.delta}</span>
                    </div>
                    <div className="bars">
                      <span>
                        <em>A</em>
                        <span className="tr"><i className="a" style={{ width: width(kpi.aBar) }} /></span>
                      </span>
                      <span>
                        <em>B</em>
                        <span className="tr"><i className="b" style={{ width: width(kpi.bBar) }} /></span>
                      </span>
                    </div>
                    <span className="s">B {kpi.b}</span>
                  </div>
                );
              })}
            </section>

            <Duel
              aCells={data.aCells}
              aLabel={aLabel}
              bCells={data.bCells}
              bLabel={bLabel}
              copy={copy}
              metric={metric}
              names={inNames}
              pct={pct}
              rcopy={rcopy}
              setMetric={setMetric}
              signedPct={signedPct}
              signedPoint={signedPoint}
              yen={yen}
            />
          </>
        )}

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

// ── A · B 기간 고르기 — 글자 버튼 + 그 자리에서 열리는 작은 창(모드 · 기간) ─────────────

function PeriodPick({
  side,
  period,
  onChange,
  today,
  w,
  rcopy,
  shared,
  localeTag,
  periodLabel,
}: {
  side: "a" | "b";
  period: OpsRevenueComparePeriod;
  onChange: (next: OpsRevenueComparePeriod) => void;
  today: string;
  w: WhiteCopy;
  rcopy: RevenueCopy;
  shared: SharedCopy;
  localeTag: string;
  periodLabel: (period: OpsRevenueComparePeriod) => string;
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

  const modeLabel: Record<RevenueMode, string> = {
    custom: rcopy.modeCustom,
    fiscal: rcopy.modeFiscal,
    month: rcopy.modeMonth,
    week: rcopy.modeWeek,
    year: rcopy.modeYear,
  };
  const letter = side.toUpperCase();
  // 기간을 하나 고르면 닫는다. 모드 바꾸기 · ‹ › 는 열어 둔 채 이어서 고를 수 있게.
  const pick = (next: OpsRevenueComparePeriod) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <div className={`rcw-pick is-${side}${open ? " open" : ""}`} ref={rootRef}>
      <b aria-hidden="true" className="rcw-side">{letter}</b>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${letter} · ${w.pickPeriod} · ${modeLabel[period.mode]} · ${periodLabel(period)}`}
        className="rcw-pick__btn"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span className="t">
          {modeLabel[period.mode]} · {periodLabel(period)}
        </span>
        <ChevronDown aria-hidden="true" className="chev" />
      </button>
      {open && (
        <div aria-label={`${letter} · ${w.pickPeriod}`} className="rcw-pop" role="dialog">
          <div className="ocw-seg" role="tablist">
            {REVENUE_MODES.map((mode) => (
              <button
                aria-selected={mode === period.mode}
                className={mode === period.mode ? "on" : ""}
                key={mode}
                onClick={() => mode !== period.mode && onChange({ mode, range: rangeForMode(mode, period.range, today) })}
                role="tab"
                type="button"
              >
                {modeLabel[mode]}
              </button>
            ))}
          </div>
          <div className="ocw-period rcw-pop__period">
            {period.mode === "month" ? (
              <AdminMonthPicker
                basePath="/admin/ops/revenue/compare"
                labels={{
                  nextMonth: shared.dateNextMonth,
                  nextYear: shared.dateNextYear,
                  open: shared.dateSelect,
                  prevMonth: shared.datePrevMonth,
                  prevYear: shared.datePrevYear,
                  thisMonth: shared.dateThisMonth,
                }}
                localeTag={localeTag}
                onSelect={(ym) => pick({ mode: "month", range: { from: `${ym}-01`, to: lastDayOfMonth(ym) } })}
                ym={period.range.from.slice(0, 7)}
              />
            ) : period.mode === "custom" ? (
              <AdminDateRangePicker
                ariaLabel={shared.pickRange}
                from={period.range.from}
                labels={{
                  apply: shared.dateApply,
                  nextMonth: shared.dateNextMonth,
                  pickMonth: shared.datePickMonth,
                  pickYear: shared.datePickYear,
                  prevMonth: shared.datePrevMonth,
                  reset: shared.dateReset,
                  thisMonth: shared.dateThisMonth,
                  typeEnd: shared.dateTypeEnd,
                  typeStart: shared.dateTypeStart,
                }}
                localeTag={localeTag}
                onChange={(from, to) => {
                  if (from && to) pick({ mode: "custom", range: { from, to } });
                }}
                to={period.range.to}
              />
            ) : (
              <>
                <button aria-label={rcopy.prev} className="ocw-arw" onClick={() => onChange({ ...period, range: shiftRange(period.mode, period.range, -1) })} type="button">
                  <ChevronLeft aria-hidden="true" />
                </button>
                <span className="ocw-plabel">{periodLabel(period)}</span>
                <button aria-label={rcopy.next} className="ocw-arw" onClick={() => onChange({ ...period, range: shiftRange(period.mode, period.range, 1) })} type="button">
                  <ChevronRight aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 총매출 — 큰 숫자 · 가는 눈금 선 위 B · A 표식 · 작은 숫자 넷 ─────────────────────

function TotalColumn({
  w,
  aTotal,
  bTotal,
  freshSum,
  closedSum,
  existingDelta,
  newRoomsDelta,
  existingCount,
  yen,
  signedYen,
}: {
  w: WhiteCopy;
  aTotal: number;
  bTotal: number;
  freshSum: number;
  closedSum: number;
  existingDelta: number;
  newRoomsDelta: number;
  existingCount: number;
  yen: (v: number) => string;
  signedYen: (v: number) => string;
}) {
  const top = Math.max(aTotal, bTotal, 1) * 1.1;
  const at = (v: number) => `${Math.max(0, Math.min(100, (v / top) * 100))}%`;
  const figs: Array<{ key: string; label: string; value: string; neg?: boolean }> = [
    { key: "b", label: w.splitB, value: yen(bTotal) },
    { key: "ex", label: w.splitExisting, neg: existingDelta < 0, value: existingCount > 0 ? signedYen(existingDelta) : "—" },
    ...(newRoomsDelta !== 0 ? [{ key: "rooms", label: w.splitNewRooms, neg: newRoomsDelta < 0, value: signedYen(newRoomsDelta) }] : []),
    { key: "fresh", label: w.splitNew, value: signedYen(freshSum) },
    { key: "closed", label: w.splitClosed, neg: closedSum > 0, value: signedYen(-closedSum) },
  ];
  return (
    <div className="rcw-col">
      <span className="rcw-k is-a">{w.secTotal}</span>
      <div className="rcw-big">
        <b>
          <RollNumber delay={80} text={yen(aTotal)} />
        </b>
        <span className="b">B {yen(bTotal)}</span>
      </div>
      <div aria-hidden="true" className="rcw-scale">
        <span className="ln" />
        <span className="mk is-b" style={{ "--x": at(bTotal) } as CSSProperties} />
        <span className="mk is-a" style={{ "--x": at(aTotal) } as CSSProperties} />
      </div>
      <div className="rcw-figs">
        {figs.map((fig) => (
          <span key={fig.key}>
            <span className="k">{fig.label}</span>
            <b className={fig.neg ? "is-red" : ""}>{fig.value}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── 증감 — 큰 증감률 · 가운데 0 선에서 자라는 기여 막대 · 요점 ──────────────────────

function GrowthColumn({
  copy,
  growth,
  insights,
  signedPct,
  tone,
  drivers,
  aEx,
  bEx,
  freshNames,
  closedNames,
  newRoomLabels,
  n,
  yen,
  signedYen,
  signedPoint,
}: {
  copy: Copy;
  growth: number | null;
  insights: string[];
  signedPct: (v: number | null) => string;
  tone: (v: number | null) => Tone;
  drivers: ReturnType<typeof growthDrivers>;
  aEx: RevenueMetrics;
  bEx: RevenueMetrics;
  freshNames: string[];
  closedNames: string[];
  newRoomLabels: string[];
  n: (v: number) => string;
  yen: (v: number) => string;
  signedYen: (v: number) => string;
  signedPoint: (v: number) => string;
}) {
  const w = copy.white;
  const label = (key: (typeof drivers.drivers)[number]["key"]) =>
    ({
      closed: { name: w.driverClosed, sub: closedNames.join(" · ") },
      fresh: { name: w.driverFresh, sub: freshNames.join(" · ") },
      newRooms: { name: w.driverNewRooms, sub: newRoomLabels.join(" · ") },
      price: { name: w.driverPrice, sub: fill(copy.driverPriceSub, { a: yen(aEx.adr), b: yen(bEx.adr) }) },
      volume: { name: w.driverVolume, sub: fill(copy.driverVolumeSub, { a: n(aEx.occupiedNights), b: n(bEx.occupiedNights) }) },
    })[key];
  // 0 선 자리 — 뺀 몫이 없으면 왼쪽 30%(시안), 보탠 몫이 없으면 오른쪽 30%, 둘 다 있으면 크기 비율(20~80%).
  const pos = Math.max(0, ...drivers.drivers.map((d) => d.points ?? 0));
  const neg = Math.max(0, ...drivers.drivers.map((d) => -(d.points ?? 0)));
  const zero = neg === 0 ? 0.3 : pos === 0 ? 0.7 : Math.min(0.8, Math.max(0.2, neg / (pos + neg)));
  const unit = Math.max(pos / (1 - zero), neg / zero, 1e-9);
  const bar = (points: number | null): CSSProperties => {
    const width = `${(Math.abs(points ?? 0) / unit) * 100}%`;
    return (points ?? 0) < 0 ? { right: `${(1 - zero) * 100}%`, width } : { left: `${zero * 100}%`, width };
  };
  return (
    <div className="rcw-col">
      <span className="rcw-k" title={copy.driverNote}>
        {w.secGrowth}
      </span>
      <b className={`rcw-gv ${tone(growth)}`}>
        <RollNumber delay={140} text={signedPct(growth)} />
      </b>
      <div className="rcw-drv" style={{ "--z": `${zero * 100}%` } as CSSProperties}>
        {drivers.drivers.map((d, index) => {
          const t = label(d.key);
          const down = (d.points ?? 0) < 0;
          return (
            <div className="rcw-dr" key={d.key} style={{ "--i": index } as CSSProperties} title={[t.sub, signedYen(d.value)].filter(Boolean).join(" · ")}>
              <span className="nm">{t.name}</span>
              <span className="tr">
                <i className={down ? "dn" : "up"} style={bar(d.points)} />
                <em />
              </span>
              <b className={down ? "is-red" : ""}>{d.points === null ? "—" : signedPoint(d.points)}</b>
            </div>
          );
        })}
        <div className="rcw-dr is-total">
          <b className="nm">{w.driverTotal}</b>
          <span className="y">{signedYen(drivers.total)}</span>
          <b className={`rcw-n ${tone(drivers.totalPoints)}`}>{signedPct(drivers.totalPoints)}</b>
        </div>
      </div>
      <ul className="rcw-ins">
        {insights.map((text, index) => (
          <li key={index}>{text}</li>
        ))}
      </ul>
    </div>
  );
}

// ── 건물별 맞대기 ──────────────────────────────────────────────────────────

function Duel({
  names,
  aCells,
  bCells,
  aLabel,
  bLabel,
  metric,
  setMetric,
  copy,
  rcopy,
  yen,
  pct,
  signedPct,
  signedPoint,
}: {
  names: string[];
  aCells: OpsRevenueCompareData["aCells"];
  bCells: OpsRevenueCompareData["bCells"];
  aLabel: string;
  bLabel: string;
  metric: Metric;
  setMetric: (metric: Metric) => void;
  copy: Copy;
  rcopy: RevenueCopy;
  yen: (v: number) => string;
  pct: (v: number) => string;
  signedPct: (v: number | null) => string;
  signedPoint: (v: number) => string;
}) {
  const w = copy.white;
  const valueOf = (m: RevenueMetrics): number | null => {
    switch (metric) {
      case "revenue":
        return m.revenue !== 0 ? m.revenue : null;
      case "occupancy":
        return m.availableNights > 0 ? m.occupancyPct : null;
      case "adr":
        return m.occupiedNights > 0 ? m.adr : null;
      case "revpar":
        return m.availableNights > 0 ? m.revpar : null;
    }
  };
  const fmt = (v: number | null) => (v === null ? "—" : metric === "occupancy" ? pct(v) : yen(v));
  const rows = names
    .map((name) => {
      const a = metricsOf(aCells[name] ?? sumMetrics([]));
      const b = metricsOf(bCells[name] ?? sumMetrics([]));
      return { a: valueOf(a), b: valueOf(b), fresh: b.revenue === 0 && a.revenue !== 0, gone: a.revenue === 0 && b.revenue !== 0, name };
    })
    .filter((row) => row.a !== null || row.b !== null)
    .sort((x, y) => (y.a ?? -Infinity) - (x.a ?? -Infinity));
  const max = Math.max(1e-9, ...rows.flatMap((row) => [row.a ?? 0, row.b ?? 0]));
  const width = (v: number | null) => `${Math.max(0, ((v ?? 0) / max) * 100)}%`;
  const metrics: Array<[Metric, string]> = [
    ["revenue", rcopy.metricRevenue],
    ["occupancy", rcopy.metricOccupancy],
    ["adr", rcopy.metricAdr],
    ["revpar", rcopy.metricRevpar],
  ];
  return (
    <section className="rcw-duel">
      <div className="rcw-dbar">
        <span className="rcw-k">{w.secProperties}</span>
        <div aria-label={w.secProperties} className="ocw-seg" role="tablist">
          {metrics.map(([key, label]) => (
            <button aria-selected={metric === key} className={metric === key ? "on" : ""} key={key} onClick={() => setMetric(key)} role="tab" type="button">
              {label}
            </button>
          ))}
        </div>
        <span className="ocw-lgs rcw-lgs">
          <span>
            <i className="a" />A · {aLabel}
          </span>
          <span>
            <i className="b" />B · {bLabel}
          </span>
          <span className="hint">· {w.sortHint}</span>
        </span>
      </div>
      <div className="rcw-dgrid">
        <div className="rcw-dhd">
          <span>{copy.tableHead}</span>
          <span />
          <span className="r">A</span>
          <span className="r">B</span>
          <span className="r">{w.colChange}</span>
        </div>
        {rows.map((row, index) => {
          const d = row.a === null || row.b === null ? null : metric === "occupancy" ? row.a - row.b : changePctOrNull(row.a, row.b);
          const t = d === null ? "z" : d > 0.05 ? "up" : d < -0.05 ? "dn" : "z";
          return (
            <div className="rcw-drow" key={row.name} style={{ "--i": index } as CSSProperties}>
              <b className="nm" title={row.name}>
                {row.name}
              </b>
              <span aria-hidden="true" className="bars">
                <i className="a" style={{ width: width(row.a) }} />
                <i className="b" style={{ width: width(row.b) }} />
              </span>
              <span className="va">{row.gone ? <span className="na">{w.tagNoSale}</span> : fmt(row.a)}</span>
              <span className="vb">{row.fresh ? w.tagNoSale : fmt(row.b)}</span>
              <b className={`dl ${row.fresh ? "up" : row.gone ? "dn" : t}`}>
                {row.fresh ? w.tagNew : row.gone ? w.tagGone : d === null ? "—" : metric === "occupancy" ? signedPoint(d) : signedPct(d)}
              </b>
            </div>
          );
        })}
      </div>
    </section>
  );
}
