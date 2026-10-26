import "server-only";

import type { AdminPayrollRow } from "@/lib/admin-attendance";

// 인쇄 품질의 급여 REPORT(PDF 용 자체 완결 HTML 문서).
//
// 워크북 내보내기와 같은 단순한 녹색 장부 언어를 써서 월간/사용자별 PDF 와 Excel 이
// 시각적으로 통일된다. 모든 문자열은 이미 현지화(ko/ja/en)되어 전달된다. 로드 시 브라우저
// 인쇄 대화상자를 자동으로 띄운다.

export type PayrollReportLabels = {
  title: string;
  orgName: string;
  monthLabel: string;
  generatedLabel: string;
  printLabel: string;
  colNo: string;
  colName: string;
  colEmployment: string;
  colRate: string;
  colHours: string;
  colWorkDays: string;
  colBaseWage: string;
  colAllowance: string;
  colSpecialAllowance: string;
  colTransport: string;
  colTotalWithTransport: string;
  totalLabel: string;
  employment: Record<AdminPayrollRow["employment"], string>;
};

function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hoursLabel(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

export function buildPayrollReportHtml(
  rows: AdminPayrollRow[],
  transportByUser: Record<string, number>,
  labels: PayrollReportLabels,
  localeTag: string,
): string {
  const nf = new Intl.NumberFormat(localeTag);
  const yen = (n: number) => `¥${nf.format(Math.round(n))}`;
  const transportOf = (userId: string) => transportByUser[userId] ?? 0;
  const totalBase = rows.reduce((s, r) => s + r.baseGross, 0);
  const totalAllowance = rows.reduce((s, r) => s + r.allowanceRegularTotal, 0);
  const totalSpecial = rows.reduce((s, r) => s + r.allowanceSpecialTotal, 0);
  const totalMinutes = rows.reduce((s, r) => s + r.totalPaidMinutes, 0);
  const totalDays = rows.reduce((s, r) => s + r.workDays, 0);
  const totalTransport = rows.reduce((s, r) => s + transportOf(r.userId), 0);

  const bodyRows = rows
    .map((r, i) => {
      const tr = transportOf(r.userId);
      const grand = r.baseGross + r.allowanceRegularTotal + r.allowanceSpecialTotal + tr;
      return `<tr${i % 2 ? " class=z" : ""}>
        <td class=c>${i + 1}</td>
        <td>${esc(r.userName)}</td>
        <td class=c>${esc(labels.employment[r.employment])}</td>
        <td class=r money>${r.primaryRate > 0 ? yen(r.primaryRate) : "—"}</td>
        <td class=r>${hoursLabel(r.totalPaidMinutes)}</td>
        <td class=r>${r.workDays}</td>
        <td class=r money strong>${r.baseGross > 0 ? yen(r.baseGross) : "—"}</td>
        <td class=r money>${r.allowanceRegularTotal > 0 ? yen(r.allowanceRegularTotal) : "—"}</td>
        <td class=r money>${r.allowanceSpecialTotal > 0 ? yen(r.allowanceSpecialTotal) : "—"}</td>
        <td class=r money>${tr > 0 ? yen(tr) : "—"}</td>
        <td class=r money>${grand > 0 ? yen(grand) : "—"}</td>
      </tr>`;
    })
    .join("");

  const totalRow = `<tr class=tot>
    <td class=c></td>
    <td>${esc(labels.totalLabel)}</td>
    <td class=c></td>
    <td class=r money></td>
    <td class=r>${hoursLabel(totalMinutes)}</td>
    <td class=r>${totalDays}</td>
    <td class=r money>${yen(totalBase)}</td>
    <td class=r money>${yen(totalAllowance)}</td>
    <td class=r money>${yen(totalSpecial)}</td>
    <td class=r money>${yen(totalTransport)}</td>
    <td class=r money>${yen(totalBase + totalAllowance + totalSpecial + totalTransport)}</td>
  </tr>`;

  return `<!DOCTYPE html>
<html lang="${esc(localeTag.slice(0, 2))}">
<head>
<meta charset="utf-8" />
<title>${esc(labels.title)} · ${esc(labels.monthLabel)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Meiryo','Malgun Gothic','Apple SD Gothic Neo','Hiragino Sans',sans-serif;
    color: #000; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact;
    padding: 18px;
  }
  .wrap { max-width: 1160px; margin: 0 auto; }
  .title { background: #b6d7a8; border: 1px solid #000; font-size: 17px; font-weight: 800; padding: 6px 8px; text-align: center; }
  .meta { margin: 8px 0 10px; font-size: 10px; text-align: center; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead th { background: #d9ead3; color: #000; font-size: 11px; font-weight: 800; padding: 6px 8px;
    border: 1px solid #000; white-space: normal; word-break: keep-all; line-height: 1.2; text-align: center; }
  thead th.l { text-align: left; }
  tbody td { border: 1px solid #000; padding: 5px 7px; font-size: 11px; height: 24px; text-align: center; }
  td.c { text-align: center; }
  td.r { text-align: center; font-variant-numeric: tabular-nums; }
  td.money { color: #000; font-weight: 700; }
  td[strong] { font-weight: 700; }
  tr.z td { background: #fbfcf8; }
  tr.tot td { background: #e2f0d9; font-weight: 800; }
  tbody tr { break-inside: avoid; }
  thead { display: table-header-group; }
  .toolbar { position: fixed; top: 16px; right: 16px; z-index: 10; }
  .printbtn { border: none; background: #2f3b5c; color: #fff; font-size: 13px; font-weight: 700;
    padding: 9px 16px; border-radius: 8px; cursor: pointer; }
  @media print { .noprint { display: none !important; } }
</style>
</head>
<body>
  <div class="toolbar noprint">
    <button type="button" class="printbtn" onclick="window.print()">${esc(labels.printLabel)}</button>
  </div>
  <div class="wrap">
    <div class="title">${esc(labels.monthLabel)} ${esc(labels.title)}</div>
    <div class="meta">${esc(labels.orgName)} / ${esc(labels.generatedLabel)}</div>
    <table>
      <colgroup>
        <col style="width:5%" /><col style="width:12%" /><col style="width:8%" /><col style="width:9%" /><col style="width:8%" /><col style="width:7%" /><col style="width:9%" /><col style="width:9%" /><col style="width:9%" /><col style="width:8%" /><col style="width:16%" />
      </colgroup>
      <thead>
        <tr>
          <th>${esc(labels.colNo)}</th>
          <th>${esc(labels.colName)}</th>
          <th>${esc(labels.colEmployment)}</th>
          <th class=money>${esc(labels.colRate)}</th>
          <th>${esc(labels.colHours)}</th>
          <th>${esc(labels.colWorkDays)}</th>
          <th class=money>${esc(labels.colBaseWage)}</th>
          <th class=money>${esc(labels.colAllowance)}</th>
          <th class=money>${esc(labels.colSpecialAllowance)}</th>
          <th class=money>${esc(labels.colTransport)}</th>
          <th class=money>${esc(labels.colTotalWithTransport)}</th>
        </tr>
      </thead>
      <tbody>${bodyRows}${totalRow}</tbody>
    </table>
  </div>
</body>
</html>`;
}
