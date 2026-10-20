"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { saveFlagThreshold } from "@/app/admin/cleaning-assign/actions";
import { exportCompareReport, exportCompareWorkbook } from "@/app/admin/cleaning-assign/compare/actions";
import { AdmDropdown } from "@/components/admin/shared/adm-dropdown";
import { AdminExportButtons } from "@/components/admin/shared/admin-export-buttons";
import { AdminMonthPicker } from "@/components/admin/shared/admin-month-picker";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import type { Dictionary } from "@/lib/i18n";
import { fill, type CleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import { computeCompare, devText, flaggedRows, type CompareComputedRow } from "@/lib/cleaning-assign/compare";
import type { CompareRow } from "@/lib/cleaning-assign/data";
import { FLAG_THRESHOLD_OPTIONS } from "@/lib/cleaning-assign/rules";
import { yen } from "./format";
import "./cleaning-assign.css";

/**
 * 청소 월 비교표 — 시안 「⑥ 월 비교표」. 방당 급여 = 그달 급여 ÷ 청소한 방(같이 한 방은 나눠 셈). 평균에서 기준(기본 25%) 넘게 벗어난 사람은
 * 「확인할 사람」(3줄까지 + 「N명 더 · 신호 있는 사람만」) · 점 그래프 · 표 신호로. 벗어났다고 잘못은 아니다 — 확인할 사람을 고르는 신호.
 * 견습(같이 한 방을 반만 세서 튐) · 직원(청소 말고 일이 많음)은 기본으로 비교에서 뺀다.
 * docs/product/37-cleaning-shift-assignment.md 「4-4」
 */

type Shared = Dictionary["admin"]["shared"];

type Row = CompareComputedRow;

export function AssignCompare({ rows, ym, threshold: initialThreshold, copy, locale, shared }: { rows: CompareRow[]; ym: string; threshold: number; copy: CleaningAssignCopy; locale: string; shared: Shared }) {
  const [exclude, setExclude] = useState(true);
  const [threshold, setThreshold] = useState(initialThreshold);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [, startTransition] = useTransition();
  const { toast, showToast, dismiss } = useAdminToast();

  // 화면과 Excel · PDF 가 같은 숫자를 쓰도록 계산은 공용 모듈 하나(`computeCompare`).
  const data = useMemo(() => computeCompare(rows, exclude), [rows, exclude]);

  const flagged = flaggedRows(data.rows, threshold);
  const checks = flagged.slice(0, 3);
  const table = onlyFlagged ? flagged : data.rows;

  // 점 그래프 — 가로 청소한 방 · 세로 급여.
  const chart = useMemo(() => {
    const counted = data.rows.filter((row) => row.cleaned > 0);
    const maxX = Math.max(10, ...counted.map((row) => row.cleaned)) * 1.1;
    const maxY = Math.max(10000, ...counted.map((row) => row.pay)) * 1.1;
    const W = 460;
    const x0 = 44;
    const y0 = 260;
    const sx = (v: number) => x0 + (v / maxX) * (W - x0 - 20);
    const sy = (v: number) => y0 - (v / maxY) * (y0 - 16);
    const lineEndX = Math.min(maxX, maxY / Math.max(1, data.avg));
    return {
      dots: counted.map((row) => ({ flagged: row.dev !== null && Math.abs(row.dev) > threshold, high: (row.dev ?? 0) > 0, name: row.name, x: sx(row.cleaned), y: sy(row.pay), dim: Boolean(row.excluded), dev: row.dev })),
      line: data.avg > 0 ? { x1: sx(0), x2: sx(lineEndX), y1: sy(0), y2: sy(lineEndX * data.avg) } : null,
      maxX,
      maxY,
      sx,
      sy,
    };
  }, [data, threshold]);

  const signal = (row: Row) => {
    if (row.excluded === "trainee") return { className: "sig", text: copy.sigTrainee };
    if (row.excluded === "staff") return { className: "sig", text: copy.sigStaff };
    if (row.dev === null) return { className: "sig", text: "—" };
    if (row.dev > threshold) return { className: "sig is-hi", text: fill(copy.sigHigh, { n: row.dev }) };
    if (row.dev < -threshold) return { className: "sig is-lo", text: fill(copy.sigLow, { n: Math.abs(row.dev) }) };
    return { className: "sig", text: `${row.dev >= 0 ? "+" : "−"}${Math.abs(row.dev)}%` };
  };

  return (
    <div className="cas">
      <div className="cas-bar">
        <Link className="cas-btn is-ghost" href="/admin/cleaning-assign">
          {copy.settingsBack}
        </Link>
        <AdminMonthPicker
          ym={ym}
          localeTag={locale}
          basePath="/admin/cleaning-assign/compare"
          labels={{
            nextMonth: shared.dateNextMonth,
            nextYear: shared.dateNextYear,
            open: shared.dateSelect,
            prevMonth: shared.datePrevMonth,
            prevYear: shared.datePrevYear,
            thisMonth: shared.dateThisMonth,
          }}
        />
        <label className="cas-check">
          <input type="checkbox" checked={exclude} onChange={(event) => setExclude(event.target.checked)} />
          {copy.excludeToggle}
        </label>
        <span className="cas-sp" />
        <span className="cas-hintline">{copy.payNote}</span>
        <AdminExportButtons
          onExportXls={() => exportCompareWorkbook({ exclude, threshold, ym })}
          onExportPdf={() => exportCompareReport({ exclude, threshold, ym })}
          disabled={rows.length === 0}
          onToast={showToast}
          labels={shared}
        />
      </div>

      {rows.length === 0 ? (
        <p className="cas-empty">{copy.compareEmpty}</p>
      ) : (
        <>
          <div className="cas-cmp-top">
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div className="cas-cmp-nums">
                <div>
                  <span>{copy.avgPerRoom}</span>
                  <b>{yen(data.avg)}</b>
                </div>
                <div>
                  <span>{copy.avgMinutes}</span>
                  <b>
                    {data.avgMinutes}
                    <small style={{ fontSize: 13, fontWeight: 500, color: "#6b6878", marginLeft: 2 }}>{copy.minutesUnit}</small>
                  </b>
                </div>
                <div>
                  <div style={{ maxWidth: 220 }}>
                    <AdmDropdown
                      size="sm"
                      value={String(threshold)}
                      ariaLabel={fill(copy.flagged, { n: threshold })}
                      onChange={(value) => {
                        const next = Number(value);
                        setThreshold(next);
                        startTransition(async () => {
                          await saveFlagThreshold({ threshold: next });
                        });
                      }}
                      options={FLAG_THRESHOLD_OPTIONS.map((n) => ({ label: fill(copy.flagged, { n }), value: String(n) }))}
                    />
                  </div>
                  <b className={flagged.length > 0 ? "is-warn" : ""}>
                    {flagged.length}
                    <small style={{ fontSize: 13, fontWeight: 500, color: "#6b6878", marginLeft: 2 }}>{copy.unitPerson}</small>
                  </b>
                </div>
              </div>
              <section aria-label={copy.checkTitle} style={{ display: "flex", flexDirection: "column" }}>
                <div className="cas-h">
                  <h2>{copy.checkTitle}</h2>
                </div>
                {checks.length === 0 ? <p className="cas-empty">{copy.checkNone}</p> : null}
                {checks.map((row) => (
                  <div key={row.userId} className="cas-check-row">
                    <b>{row.name}</b>
                    <span>
                      {fill(copy.checkLine, { pay: yen(row.pay), rooms: row.cleaned })}
                      {" · "}
                      <span className={(row.dev ?? 0) > 0 ? "is-hi" : "is-lo"}>{fill(copy.checkPer, { dev: devText(row.dev ?? 0), per: yen(row.perRoom ?? 0) })}</span>
                      {" · "}
                      {fill(copy.checkMinutes, { min: row.perMinutes ?? 0 })}
                    </span>
                    <Link className="cas-btn is-gray" href={`/admin/attendance/staff/${row.userId}?ym=${ym}`}>
                      {copy.attendanceLink}
                    </Link>
                  </div>
                ))}
                {flagged.length > 3 ? (
                  <button type="button" className="cas-more" onClick={() => setOnlyFlagged(true)}>
                    {fill(copy.checkMore, { n: flagged.length - 3 })}
                  </button>
                ) : null}
                <p className="cas-hint" style={{ marginTop: 10 }}>
                  {copy.readGuide}
                </p>
              </section>
            </div>

            <figure className="cas-fig">
              <figcaption>{copy.chartCaption}</figcaption>
              <svg role="img" aria-label={copy.chartCaption} width="460" height="290" viewBox="0 0 460 290">
                <line x1="44" y1="260" x2="440" y2="260" stroke="#E4E3E9" />
                <line x1="44" y1="16" x2="44" y2="260" stroke="#E4E3E9" />
                <text x="44" y="280" fontSize="11" fill="#6B6878">
                  0
                </text>
                <text x="400" y="280" fontSize="11" fill="#6B6878">
                  {Math.round(chart.maxX)}
                </text>
                <text x="0" y="22" fontSize="11" fill="#6B6878">
                  {yen(chart.maxY)}
                </text>
                {chart.line ? <line x1={chart.line.x1} y1={chart.line.y1} x2={chart.line.x2} y2={chart.line.y2} stroke="#B9A6F2" strokeWidth="1.5" strokeDasharray="4 4" /> : null}
                {chart.dots.map((dot) => (
                  <g key={dot.name + dot.x}>
                    <circle cx={dot.x} cy={dot.y} r={dot.flagged ? 6 : 5} fill={dot.dim ? "#FFFFFF" : dot.flagged ? (dot.high ? "#C5282E" : "#D98A1F") : "#7A52E6"} stroke={dot.dim ? "#A8A5B3" : "#FFFFFF"} strokeWidth="1.5">
                      <title>{dot.name}</title>
                    </circle>
                    {dot.flagged ? (
                      <text x={dot.x + 9} y={dot.y + 4} fontSize="12" fontWeight="600" fill={dot.high ? "#B4232A" : "#8A4B00"}>
                        {`${dot.name} ${devText(dot.dev ?? 0)}`}
                      </text>
                    ) : null}
                  </g>
                ))}
              </svg>
            </figure>
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className={`cas-btn ${onlyFlagged ? "is-ghost" : "is-soft"}`} onClick={() => setOnlyFlagged(false)}>
              {copy.showAll}
            </button>
            <button type="button" className={`cas-btn ${onlyFlagged ? "is-soft" : "is-ghost"}`} onClick={() => setOnlyFlagged(true)}>
              {copy.showFlagged}
            </button>
          </div>
          <div className="cas-table" role="table" aria-label={copy.compareTitle}>
            <div className="cas-crow is-head" role="row">
              <span>{copy.colName}</span>
              <span>{copy.colDays}</span>
              <span className="r">{copy.colAssigned}</span>
              <span className="r">{copy.colCleaned}</span>
              <span className="r">{copy.colHours}</span>
              <span className="r">{copy.colPay}</span>
              <span className="r">{copy.colPerRoom} ↓</span>
              <span className="r">{copy.colPerMinutes}</span>
              <span>{copy.colSignal}</span>
            </div>
            {table.map((row) => {
              const sig = signal(row);
              const hi = row.dev !== null && row.dev > threshold;
              const lo = row.dev !== null && row.dev < -threshold;
              return (
                <div key={row.userId} className={`cas-crow${row.excluded ? " is-dim" : ""}`} role="row">
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{row.name}</span>
                  <span>{fill(copy.daysUnit, { n: row.days })}</span>
                  <span className="r">{row.assigned}</span>
                  <span className="r">{row.cleaned}</span>
                  <span className="r">{fill(copy.hoursUnit, { n: (row.paidMinutes / 60).toFixed(1) })}</span>
                  <span className="r">{yen(row.pay)}</span>
                  <span className={`r${hi ? " is-hi" : lo ? " is-lo" : ""}`} style={{ fontWeight: 700 }}>
                    {row.perRoom === null ? "—" : yen(row.perRoom)}
                  </span>
                  <span className="r">{row.perMinutes === null ? "—" : `${row.perMinutes}${copy.minutesUnit}`}</span>
                  <span className={sig.className}>{sig.text}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
      {toast ? <AdminToast message={toast.message} onDismiss={dismiss} /> : null}
    </div>
  );
}
