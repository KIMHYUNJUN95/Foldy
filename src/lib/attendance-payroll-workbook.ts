import "server-only";

import ExcelJS from "exceljs";
import type { AdminPayrollRow } from "@/lib/admin-attendance";

// 현지화된 인쇄 품질 네이티브 .xlsx 급여 워크북(exceljs 로 생성).
//
// 실무용 회계 시트로 설계: 단순한 격자, 촘촘한 행, 굵은 셀 테두리, 최대
// 50명 직원 행을 가진 스프레드시트 템플릿 형태이지 꾸민 보고서가 아니다. 서버 액션이 브라우저에
// 넘기도록 base64 로 돌려준다.
// 보이는 문자열은 모두 호출자가 이미 현지화(ko/ja/en)해서 넘긴다.

export type PayrollWorkbookLabels = {
  title: string;
  monthLabel: string;
  orgName: string;
  generatedLabel: string; // "생성일시 · 2026-07-02 15:40"
  statusEstimated: string;
  statusFinalized: string;
  colNo: string;
  colName: string;
  colRate: string;
  colHours: string;
  colWorkDays: string;
  colBaseWage: string;
  colAllowance: string;
  colSpecialAllowance: string;
  colTransport: string;
  colTotalWithTransport: string;
  totalLabel: string;
};

export type PayrollWorkbookRow = AdminPayrollRow & {
  transportTotal: number;
  totalWithTransport: number;
};

// 공용 회계 템플릿 팔레트 + 테두리 헬퍼 — 다른 관리자 근태 워크북
// 빌더(예: attendance-transport-workbook.ts)가 재사용해서 이 콘솔에서 내보내는 모든 .xlsx 가
// 기능마다 달라지지 않고 하나의 일관된 템플릿처럼 보이게 한다.
export const WORKBOOK_TITLE_FILL = "FFB6D7A8";
export const WORKBOOK_HEADER_FILL = "FFD9EAD3";
export const WORKBOOK_TOTAL_FILL = "FFE2F0D9";
export const WORKBOOK_INK = "FF000000";
export const WORKBOOK_LINE = "FF000000";
export const WORKBOOK_DASH = "—";

const TITLE_FILL = WORKBOOK_TITLE_FILL;
const HEADER_FILL = WORKBOOK_HEADER_FILL;
const TOTAL_FILL = WORKBOOK_TOTAL_FILL;
const INK = WORKBOOK_INK;
const DASH = WORKBOOK_DASH;
const TEMPLATE_ROWS = 50;

function hoursLabel(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

export const workbookThinBorder = { style: "thin" as const, color: { argb: WORKBOOK_LINE } };
export function workbookBox() {
  return {
    top: workbookThinBorder,
    bottom: workbookThinBorder,
    left: workbookThinBorder,
    right: workbookThinBorder,
  };
}

function box() {
  return workbookBox();
}

function moneyFont() {
  return { name: "Meiryo", size: 9, bold: true, color: { argb: INK } };
}

export async function buildPayrollWorkbookBase64(
  rows: PayrollWorkbookRow[],
  labels: PayrollWorkbookLabels,
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

  ws.properties.defaultRowHeight = 18;
  ws.pageSetup.printArea = `A1:J${TEMPLATE_ROWS + 4}`;

  // 촘촘한 급여 원장 레이아웃. 기본급, 추가수당, 특별수당,
  // 교통비는 별도 열로 두어 섞이지 않게 하고, 마지막 열이 네 가지를 합산한다.
  const cols: { width: number; align: "center"; numFmt?: string }[] = [
    { width: 6, align: "center" }, // 번호
    { width: 22, align: "center" }, // 이름
    { width: 10, align: "center", numFmt: "0" }, // 근무일수
    { width: 14, align: "center" }, // 시간
    { width: 11, align: "center", numFmt: "¥#,##0" }, // 시급
    { width: 15, align: "center", numFmt: "¥#,##0" }, // 기본급
    { width: 14, align: "center", numFmt: "¥#,##0" }, // extra allowance (추가수당)
    { width: 14, align: "center", numFmt: "¥#,##0" }, // special allowance (특별수당)
    { width: 14, align: "center", numFmt: "¥#,##0" }, // 교통비
    { width: 20, align: "center", numFmt: "¥#,##0" }, // 합계(기본급 + 수당 + 교통비)
  ];
  ws.columns = cols.map((c) => ({ width: c.width }));
  const LAST = cols.length;

  // ── 단순 워크북 제목 ──
  ws.mergeCells(1, 1, 1, LAST);
  const t = ws.getCell("A1");
  t.value = `${labels.monthLabel} ${labels.title}`;
  t.font = { name: "Meiryo", bold: true, size: 12, color: { argb: INK } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TITLE_FILL } };
  t.alignment = { vertical: "middle", horizontal: "center" };
  t.border = box();
  ws.getRow(1).height = 22;

  // ── 헤더(2행) ──
  const headerLabels = [
    labels.colNo,
    labels.colName,
    labels.colWorkDays,
    labels.colHours,
    labels.colRate,
    labels.colBaseWage,
    labels.colAllowance,
    labels.colSpecialAllowance,
    labels.colTransport,
    labels.colTotalWithTransport,
  ];
  const header = ws.getRow(2);
  header.height = 22;
  headerLabels.forEach((label, i) => {
    const cell = header.getCell(i + 1);
    cell.value = label;
    cell.font = {
      name: "Meiryo",
      bold: true,
      color: { argb: INK },
      size: 9,
    };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: false, shrinkToFit: true };
    cell.border = box();
  });

  // ── 데이터 행 ──
  const firstDataRow = 3;
  const templateRows = Math.max(TEMPLATE_ROWS, rows.length);
  for (let i = 0; i < templateRows; i++) {
    const r = rows[i];
    const row = ws.getRow(firstDataRow + i);
    row.height = 18;
    const rate: string | number = r && r.primaryRate > 0 ? r.primaryRate : r ? DASH : "";
    const baseWage: string | number = r ? (r.baseGross > 0 ? r.baseGross : 0) : "";
    const allowance: string | number =
      r ? (r.allowanceRegularTotal > 0 ? r.allowanceRegularTotal : 0) : "";
    const specialAllowance: string | number =
      r ? (r.allowanceSpecialTotal > 0 ? r.allowanceSpecialTotal : 0) : "";
    const transport: string | number = r ? (r.transportTotal > 0 ? r.transportTotal : 0) : "";
    const totalWithTransport: string | number =
      r ? (r.totalWithTransport > 0 ? r.totalWithTransport : 0) : "";
    const values: (string | number)[] = [
      r ? i + 1 : "",
      r?.userName ?? "",
      r?.workDays ?? "",
      r ? hoursLabel(r.totalPaidMinutes) : "",
      rate,
      baseWage,
      allowance,
      specialAllowance,
      transport,
      totalWithTransport,
    ];
    values.forEach((v, ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = v;
      cell.font = ci >= 4 ? moneyFont() : { name: "Meiryo", size: 9, color: { argb: INK } };
      cell.border = box();
      cell.alignment = { vertical: "middle", horizontal: cols[ci].align };
      if (cols[ci].numFmt && typeof v === "number") cell.numFmt = cols[ci].numFmt!;
    });
  }

  // ── 합계 행 ──
  const lastDataRow = firstDataRow + templateRows - 1;
  const totalRowIdx = lastDataRow + 1;
  const total = ws.getRow(totalRowIdx);
  total.height = 20;
  const totalMinutes = rows.reduce((sum, r) => sum + r.totalPaidMinutes, 0);
  total.getCell(2).value = labels.totalLabel;
  total.getCell(3).value = { formula: `SUM(C${firstDataRow}:C${lastDataRow})` };
  total.getCell(4).value = hoursLabel(totalMinutes);
  total.getCell(6).value = { formula: `SUM(F${firstDataRow}:F${lastDataRow})` };
  total.getCell(7).value = { formula: `SUM(G${firstDataRow}:G${lastDataRow})` };
  total.getCell(8).value = { formula: `SUM(H${firstDataRow}:H${lastDataRow})` };
  total.getCell(9).value = { formula: `SUM(I${firstDataRow}:I${lastDataRow})` };
  total.getCell(10).value = { formula: `SUM(J${firstDataRow}:J${lastDataRow})` };
  total.getCell(3).numFmt = "0";
  total.getCell(6).numFmt = "¥#,##0";
  total.getCell(7).numFmt = "¥#,##0";
  total.getCell(8).numFmt = "¥#,##0";
  total.getCell(9).numFmt = "¥#,##0";
  total.getCell(10).numFmt = "¥#,##0";
  for (let ci = 1; ci <= LAST; ci++) {
    const cell = total.getCell(ci);
    cell.font = ci >= 6 ? moneyFont() : { name: "Meiryo", bold: true, size: 9, color: { argb: INK } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } };
    cell.alignment = { vertical: "middle", horizontal: cols[ci - 1].align };
    cell.border = box();
  }

  ws.getCell(`A${totalRowIdx + 2}`).value = `${labels.orgName} / ${labels.generatedLabel}`;
  ws.getCell(`A${totalRowIdx + 2}`).font = { name: "Meiryo", size: 8, color: { argb: INK } };
  ws.getCell(`A${totalRowIdx + 2}`).alignment = { vertical: "middle", horizontal: "center" };

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer).toString("base64");
}
