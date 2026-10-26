import "server-only";

import ExcelJS from "exceljs";
import {
  WORKBOOK_DASH,
  WORKBOOK_HEADER_FILL,
  WORKBOOK_INK,
  WORKBOOK_TITLE_FILL,
  WORKBOOK_TOTAL_FILL,
  workbookBox,
} from "@/lib/attendance-payroll-workbook";

// 정규 관리자 콘솔 .xlsx 내보내기 빌더. /admin/* 의 모든 "Excel 내보내기" 버튼이
// 이 함수 하나를 거쳐 콘솔 전체가 하나의 녹색 장부 템플릿을 쓴다: 병합 제목
// 줄 → 헤더 행 → 번호 붙은 데이터 행 → 합계 행 → 조직/생성 푸터, 모두 가운데 정렬, Meiryo 9pt.
// 채우기/테두리는 attendance-payroll-workbook.ts 에서 가져온다 — 여기서 새 색을 쓰지 말 것.
// 짝이 되는 PDF/인쇄 빌더는 admin-table-report.ts 이며 완전히 같은 입력 형태를 받는다.
// See docs/product/05-admin-web-ia.md → "공용 프리미티브".

export type AdminTableColumn = {
  /** 행 조회 키. */
  key: string;
  /** 현지화된 헤더 라벨. */
  label: string;
  /** Excel 열 너비 (글자 수). */
  width: number;
  /** 인쇄/PDF 열 너비, 표에 대한 백분율. */
  printWidth: number;
  /** 값 강조 (숫자, 시간, 금액). */
  bold?: boolean;
  /** 셀 줄바꿈을 허용 (비고 같은 긴 자유 텍스트 열). */
  wrap?: boolean;
};

/** 데이터 행 하나: 열 키 → 이미 현지화된 표시 문자열. */
export type AdminTableExportRow = Record<string, string>;

export type AdminTableSheet = {
  /** 워크시트 탭 이름 (Excel 의 31자 제한으로 자름). */
  sheetName: string;
  /** 문서 제목, 예: "청소 기록". */
  title: string;
  /** 제목 줄의 제목 앞에 표시할 접두사, 예: "7월 1일 – 7월 31일". 선택. */
  rangeLabel?: string;
  /** 자동 생성되는 행 번호 열의 헤더 라벨. */
  colNoLabel: string;
  /** 합계 행에 그려지는 라벨 (첫 데이터 열). */
  totalLabel: string;
  columns: AdminTableColumn[];
  rows: AdminTableExportRow[];
  /** 열 키별 선택적 합계 행 값. 행 수는 항상 No. 셀을 채운다. */
  totals?: Record<string, string>;
};

export type AdminTableWorkbookInput = {
  orgName: string;
  /** e.g. "생성일시 · 2026-07-14 09:31". */
  generatedLabel: string;
  sheets: AdminTableSheet[];
};

const NO_COLUMN_WIDTH = 5;

// ── 줄바꿈 셀의 행 높이 ────────────────────────────────────────────
// 데이터 행 높이를 18pt 로 고정해 두면 `wrap: true` 열(메모/비고/반품 품목 등)의 두 번째 줄부터가
// 잘려 보인다 — 명시적 높이가 있으면 Excel/LibreOffice 모두 자동 맞춤을 하지 않기 때문이다.
// 그래서 줄 수를 추정해 필요한 만큼만 행을 키운다(줄바꿈이 없는 행은 그대로 18pt).
const DATA_ROW_HEIGHT = 18;
const WRAP_LINE_HEIGHT = 13.5;
const WRAP_ROW_PADDING = 4.5;
/** 비정상적으로 긴 메모 하나가 표 전체를 망가뜨리지 않게 상한을 둔다. */
const MAX_WRAP_LINES = 12;

/** 전각(한글/한자/가나/전각기호)은 Excel 열 너비 단위로 약 2칸을 차지한다. */
function isWideChar(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    code >= 0x20000
  );
}

/** Excel 열 너비("문자 수") 기준 표시 폭. */
function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += isWideChar(char.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return width;
}

function wrappedLineCount(text: string, columnWidth: number): number {
  if (!text) return 1;
  // 셀 좌우 여백만큼 빼서 살짝 넉넉하게 잡는다 — 모자란 것보다 남는 편이 안전하다.
  const usable = Math.max(1, columnWidth - 1);
  return text
    .split("\n")
    .reduce((sum, segment) => sum + Math.max(1, Math.ceil(displayWidth(segment) / usable)), 0);
}

/** 선언 너비에 더해 주는 좌우 여백. 글자가 테두리에 닿아 붙어 보이는 것을 막는다. */
const FIT_PADDING = 2;

/**
 * 한 열이 넓어질 수 있는 상한.
 *
 * 자유 입력 칸(지원 동기 등)이 한 줄 길다고 열 하나가 화면을 다 먹으면 표를 못 읽는다.
 * 상한을 넘는 값은 여전히 잘려 보이지만, 그건 셀을 눌러 보는 편이 낫다.
 */
const FIT_MAX_WIDTH = 42;

/**
 * 열 너비를 내용에 맞춘다 — **선언 너비는 최소값**이고, 그보다 좁아지지 않는다.
 *
 * 왜 필요한가: 열 너비가 고정이라 「객실 클리닝 스태프」·「체류 자격 만료 D-38」처럼 선언 너비보다
 * 긴 값이 잘려 보였다(2026-09-10 채용 지원서 내보내기에서 확인). 한글·가나는 라틴의 두 배 폭이라
 * 문자 수로만 잡으면 특히 자주 넘친다 — `displayWidth` 가 그 폭을 센다.
 *
 * `wrap` 열은 건드리지 않는다. 그 열의 선언 너비는 **줄바꿈 기준**이기도 해서(`dataRowHeight`),
 * 넓히면 행 높이 계산이 함께 어긋난다.
 */
function fittedWidth(column: AdminTableColumn, rows: AdminTableExportRow[]): number {
  if (column.wrap) return column.width;
  let widest = displayWidth(column.label);
  for (const row of rows) {
    const value = row[column.key];
    if (value) widest = Math.max(widest, displayWidth(value));
  }
  return Math.min(Math.max(column.width, widest + FIT_PADDING), FIT_MAX_WIDTH);
}

/** 이 행에서 가장 많이 줄바꿈되는 `wrap` 열에 맞춘 행 높이. */
function dataRowHeight(row: AdminTableExportRow, columns: AdminTableColumn[]): number {
  let lines = 1;
  for (const col of columns) {
    if (!col.wrap) continue;
    lines = Math.max(lines, wrappedLineCount(row[col.key] ?? "", col.width));
  }
  if (lines <= 1) return DATA_ROW_HEIGHT;
  return Math.min(lines, MAX_WRAP_LINES) * WRAP_LINE_HEIGHT + WRAP_ROW_PADDING;
}

function textFont() {
  return { name: "Meiryo", size: 9, color: { argb: WORKBOOK_INK } };
}
function boldFont() {
  return { name: "Meiryo", size: 9, bold: true, color: { argb: WORKBOOK_INK } };
}

function titleText(sheet: AdminTableSheet): string {
  return [sheet.rangeLabel, sheet.title].filter(Boolean).join(" ");
}

function addSheet(wb: ExcelJS.Workbook, sheet: AdminTableSheet, input: AdminTableWorkbookInput) {
  const ws = wb.addWorksheet(sheet.sheetName.slice(0, 31), {
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
  const lastCol = sheet.columns.length + 1; // 자동 No. 열 몫으로 +1
  ws.columns = [
    { width: NO_COLUMN_WIDTH },
    ...sheet.columns.map((c) => ({ width: fittedWidth(c, sheet.rows) })),
  ];

  // ── 제목 ──
  ws.mergeCells(1, 1, 1, lastCol);
  const title = ws.getCell("A1");
  title.value = titleText(sheet);
  title.font = { name: "Meiryo", bold: true, size: 12, color: { argb: WORKBOOK_INK } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WORKBOOK_TITLE_FILL } };
  title.alignment = { vertical: "middle", horizontal: "center" };
  title.border = workbookBox();
  ws.getRow(1).height = 22;

  // ── 헤더 ──
  const header = ws.getRow(2);
  header.height = 22;
  [sheet.colNoLabel, ...sheet.columns.map((c) => c.label)].forEach((label, i) => {
    const cell = header.getCell(i + 1);
    cell.value = label;
    cell.font = boldFont();
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WORKBOOK_HEADER_FILL } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: false, shrinkToFit: true };
    cell.border = workbookBox();
  });

  // ── 데이터 행 ──
  const firstDataRow = 3;
  sheet.rows.forEach((r, i) => {
    const row = ws.getRow(firstDataRow + i);
    row.height = dataRowHeight(r, sheet.columns);

    const no = row.getCell(1);
    no.value = String(i + 1);
    no.font = textFont();
    no.border = workbookBox();
    no.alignment = { vertical: "middle", horizontal: "center" };

    sheet.columns.forEach((col, ci) => {
      const cell = row.getCell(ci + 2);
      cell.value = r[col.key] || WORKBOOK_DASH;
      cell.font = col.bold ? boldFont() : textFont();
      cell.border = workbookBox();
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: Boolean(col.wrap) };
    });
  });

  // ── 합계 행 ──
  const totalRowIdx = firstDataRow + sheet.rows.length;
  const total = ws.getRow(totalRowIdx);
  total.height = 20;
  total.getCell(1).value = String(sheet.rows.length);
  if (sheet.columns.length > 0) {
    total.getCell(2).value = sheet.totalLabel;
  }
  sheet.columns.forEach((col, ci) => {
    const value = sheet.totals?.[col.key];
    if (value) total.getCell(ci + 2).value = value;
  });
  for (let ci = 1; ci <= lastCol; ci++) {
    const cell = total.getCell(ci);
    cell.font = boldFont();
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WORKBOOK_TOTAL_FILL } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = workbookBox();
  }

  // ── 푸터 ──
  const footer = ws.getCell(`A${totalRowIdx + 2}`);
  footer.value = `${input.orgName} / ${input.generatedLabel}`;
  footer.font = { name: "Meiryo", size: 8, color: { argb: WORKBOOK_INK } };
  footer.alignment = { vertical: "middle", horizontal: "center" };

  ws.pageSetup.printArea = `A1:${ws.getColumn(lastCol).letter}${totalRowIdx + 2}`;
}

export async function buildAdminTableWorkbookBase64(input: AdminTableWorkbookInput): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Foldy";
  wb.created = new Date();

  for (const sheet of input.sheets) {
    addSheet(wb, sheet, input);
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer).toString("base64");
}
