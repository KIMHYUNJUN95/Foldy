import "server-only";

// 인쇄 품질 교통비 정산 REPORT (PDF 용 독립 HTML 문서).
//
// attendance-payroll-report.ts 와 똑같은 단순 초록 원장 언어를 쓴다(같은 제목 막대,
// 헤더/지브라/합계 색, 테두리, 글꼴, 툴바/인쇄 버튼 스타일). 그래서 이 콘솔의 모든 PDF 내보내기가
// 시각적으로 한 가족이다. 정산 항목 하나가 한 행. 이것은 PLAIN LEDGER 다: 영수증
// 이미지나 링크가 없다 — 영수증은 전용 웹 영수증 페이지에서 검토하고
// (`/admin/attendance/transport/receipt`) 내보낸 파일에서는 보지 않는다. 모든 셀은 가운데 정렬.

export type TransportReportItem = {
  userName: string;
  usageDate: string; // 'YYYY-MM-DD'
  buildingLabel: string;
  /** 「기타」는 건물이 아니라 사유가 유일한 근거다 — 대장에 함께 나가야 한다. */
  memo: string;
  statusLabel: string;
  amountYen: number;
};

export type TransportReportLabels = {
  title: string;
  orgName: string;
  monthLabel: string;
  generatedLabel: string;
  printLabel: string;
  colNo: string;
  colStaff: string;
  colDate: string;
  colBuilding: string;
  colMemo: string;
  colStatus: string;
  colAmount: string;
  totalLabel: string;
};

function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dateLabel(usageDate: string): string {
  const [, m, d] = usageDate.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export function buildTransportReportHtml(
  items: TransportReportItem[],
  labels: TransportReportLabels,
  localeTag: string,
): string {
  const nf = new Intl.NumberFormat(localeTag);
  const yen = (n: number) => `¥${nf.format(Math.round(n))}`;
  const totalAmount = items.reduce((s, i) => s + i.amountYen, 0);

  const bodyRows = items
    .map((item, i) => {
      return `<tr${i % 2 ? " class=z" : ""}>
        <td class=c>${i + 1}</td>
        <td class=c>${esc(item.userName)}</td>
        <td class=c>${dateLabel(item.usageDate)}</td>
        <td class=c>${esc(item.buildingLabel || "—")}</td>
        <td class=c>${esc(item.memo || "—")}</td>
        <td class=c>${esc(item.statusLabel)}</td>
        <td class=c money strong>${yen(item.amountYen)}</td>
      </tr>`;
    })
    .join("");

  // 셀 수가 머리글과 같아야 한다 — 메모 열을 넣으며 하나 늘었다(2026-09-11).
  const totalRow = `<tr class=tot>
    <td class=c></td>
    <td class=c>${esc(labels.totalLabel)}</td>
    <td class=c></td>
    <td class=c></td>
    <td class=c></td>
    <td class=c></td>
    <td class=c money>${yen(totalAmount)}</td>
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
  .title { background: #b6d7a8; border: 1px solid #000; font-size: 17px; font-weight: 800; padding: 6px 8px; }
  .meta { margin: 8px 0 10px; font-size: 10px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead th { background: #d9ead3; color: #000; font-size: 11px; font-weight: 800; padding: 6px 8px;
    border: 1px solid #000; white-space: nowrap; text-align: center; }
  tbody td { border: 1px solid #000; padding: 5px 7px; font-size: 11px; height: 24px; }
  td.c { text-align: center; }
  td.money { color: #000; font-weight: 700; font-variant-numeric: tabular-nums; }
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
      <thead>
        <tr>
          <th>${esc(labels.colNo)}</th>
          <th>${esc(labels.colStaff)}</th>
          <th>${esc(labels.colDate)}</th>
          <th>${esc(labels.colBuilding)}</th>
          <th>${esc(labels.colMemo)}</th>
          <th>${esc(labels.colStatus)}</th>
          <th class=money>${esc(labels.colAmount)}</th>
        </tr>
      </thead>
      <tbody>${bodyRows}${totalRow}</tbody>
    </table>
  </div>
</body>
</html>`;
}
