import "server-only";

import ExcelJS from "exceljs";
import {
  WORKBOOK_HEADER_FILL,
  WORKBOOK_INK,
  WORKBOOK_TITLE_FILL,
  WORKBOOK_TOTAL_FILL,
  workbookBox,
} from "@/lib/attendance-payroll-workbook";

// 현지화된 인쇄 품질의 네이티브 .xlsx 교통비 정산 장부 (exceljs 로 생성). 급여 워크북 템플릿과
// 같은 스타일 (같은 녹색 회계 팔레트, 같은 "최소 50행" 인쇄용
// 장부 패딩). 정산 항목마다 한 행. 단순 장부다: 영수증
// 이미지나 링크는 없다 — 영수증은 전용 웹 영수증 페이지에서 검토한다. 열은 교통비 장부에
// 꼭 필요한 것만: No / 직원 / 날짜 / 건물 / 상태 / 금액. 모든 셀은
// 가운데 정렬.

export type TransportWorkbookItem = {
  userName: string;
  usageDate: string; // 'YYYY-MM-DD'
  buildingLabel: string;
  statusLabel: string;
  amountYen: number;
  /** 「기타」 항목은 메모가 필수다 — 건물이 아니면 사유가 유일한 근거라 대장에 함께 나가야 한다. */
  memo: string;
};

export type TransportWorkbookLabels = {
  colMemo: string;
  title: string;
  monthLabel: string;
  orgName: string;
  generatedLabel: string;
  colNo: string;
  colStaff: string;
  colDate: string;
  colBuilding: string;
  colStatus: string;
  colAmount: string;
  totalLabel: string;
};

const TEMPLATE_ROWS = 50;

function dateLabel(usageDate: string): string {
  const [, m, d] = usageDate.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export async function buildTransportWorkbookBase64(
  items: TransportWorkbookItem[],
  labels: TransportWorkbookLabels,
): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Foldy";
  wb.created = new Date();

  const ws = wb.addWorksheet(labels.monthLabel.slice(0, 31), {
    views: [{ showGridLines: true }],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    },
  });

  // 모든 열을 요청된 장부 레이아웃대로 가운데 정렬.
  const cols: { width: number; numFmt?: string }[] = [
    { width: 6 }, // No
    { width: 24 }, // 직원
    { width: 12 }, // 날짜
    { width: 24 }, // 목적지 (건물 / 사무실 / 기타)
    { width: 30 }, // 메모
    { width: 14 }, // 상태
    { width: 18, numFmt: "¥#,##0" }, // 금액
  ];
  ws.columns = cols.map((c) => ({ width: c.width }));
  const LAST = cols.length;
  const AMOUNT_COL = 7;

  // ── 제목 ──
  ws.mergeCells(1, 1, 1, LAST);
  const t = ws.getCell("A1");
  t.value = `${labels.monthLabel} ${labels.title}`;
  t.font = { name: "Meiryo", bold: true, size: 12, color: { argb: WORKBOOK_INK } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WORKBOOK_TITLE_FILL } };
  t.alignment = { vertical: "middle", horizontal: "left" };
  t.border = workbookBox();
  ws.getRow(1).height = 22;

  // ── 헤더 ──
  const headerLabels = [
    labels.colNo,
    labels.colStaff,
    labels.colDate,
    labels.colBuilding,
    labels.colMemo,
    labels.colStatus,
    labels.colAmount,
  ];
  const header = ws.getRow(2);
  header.height = 22;
  headerLabels.forEach((label, i) => {
    const cell = header.getCell(i + 1);
    cell.value = label;
    cell.font = { name: "Meiryo", bold: true, size: 9, color: { argb: WORKBOOK_INK } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WORKBOOK_HEADER_FILL } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: false, shrinkToFit: true };
    cell.border = workbookBox();
  });

  // ── 데이터 행 (항목마다 한 행, 급여 장부처럼 최소 50행으로 채움) ──
  const firstDataRow = 3;
  const templateRows = Math.max(TEMPLATE_ROWS, items.length);
  for (let i = 0; i < templateRows; i++) {
    const item = items[i];
    const row = ws.getRow(firstDataRow + i);
    row.height = 18;
    const values: (string | number)[] = [
      item ? i + 1 : "",
      item?.userName ?? "",
      item ? dateLabel(item.usageDate) : "",
      item ? item.buildingLabel || "—" : "",
      item ? item.memo || "—" : "",
      item?.statusLabel ?? "",
      item ? item.amountYen : "",
    ];
    values.forEach((v, ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = v;
      cell.font = { name: "Meiryo", size: 9, color: { argb: WORKBOOK_INK } };
      cell.border = workbookBox();
      cell.alignment = { vertical: "middle", horizontal: "center" };
      if (cols[ci].numFmt && typeof v === "number") cell.numFmt = cols[ci].numFmt!;
    });
  }

  // ── 합계 행 ──
  const lastDataRow = firstDataRow + templateRows - 1;
  const totalRowIdx = lastDataRow + 1;
  const total = ws.getRow(totalRowIdx);
  total.height = 20;
  total.getCell(2).value = labels.totalLabel;
  // 열 글자를 박아 두면 컬럼을 하나 끼울 때 합계가 엉뚱한 열을 더한다 — 실제로 메모 열을 넣으며
  // 금액이 F→G 로 밀렸다(2026-09-11). `AMOUNT_COL` 에서 글자를 만들어 쓴다.
  const amountColLetter = String.fromCharCode("A".charCodeAt(0) + AMOUNT_COL - 1);
  total.getCell(AMOUNT_COL).value = {
    formula: `SUM(${amountColLetter}${firstDataRow}:${amountColLetter}${lastDataRow})`,
  };
  total.getCell(AMOUNT_COL).numFmt = "¥#,##0";
  for (let ci = 1; ci <= LAST; ci++) {
    const cell = total.getCell(ci);
    cell.font = { name: "Meiryo", bold: true, size: 9, color: { argb: WORKBOOK_INK } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WORKBOOK_TOTAL_FILL } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = workbookBox();
  }

  ws.getCell(`A${totalRowIdx + 2}`).value = `${labels.orgName} / ${labels.generatedLabel}`;
  ws.getCell(`A${totalRowIdx + 2}`).font = { name: "Meiryo", size: 8, color: { argb: WORKBOOK_INK } };

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer).toString("base64");
}
