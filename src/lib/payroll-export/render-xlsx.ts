import "server-only";

import ExcelJS from "exceljs";
import { colLetter, DEFAULT_ROW_HEIGHT, type BorderLine, type CellStyle, type ModelSheet } from "./sheet-model";

/**
 * 알바 급여 P4 — 시트 모델 → .xlsx(base64). 값은 Foldy 계산값, 수식 칸은 수식 + 그 값(열면 바로 같은 숫자,
 * 칸을 고치면 엑셀이 다시 계산). docs/product/39 §6.
 */

function argb(rgb: string): string {
  return `FF${rgb.toUpperCase()}`;
}

function line(style: BorderLine | undefined): Partial<ExcelJS.Border> | undefined {
  return style ? { style } : undefined;
}

function applyStyle(cell: ExcelJS.Cell, s: CellStyle | undefined) {
  if (!s) return;
  if (s.font) {
    cell.font = {
      name: s.font.name ?? "Meiryo",
      size: s.font.size ?? 8,
      bold: s.font.bold ?? false,
      ...(s.font.color ? { color: { argb: argb(s.font.color) } } : {}),
    };
  }
  if (s.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(s.fill) } };
  if (s.border === "all") {
    const thin = { style: "thin" } as const;
    cell.border = { top: thin, left: thin, bottom: thin, right: thin };
  } else if (s.border) {
    cell.border = {
      top: line(s.border.top),
      left: line(s.border.left),
      bottom: line(s.border.bottom),
      right: line(s.border.right),
    };
  }
  if (s.align) {
    cell.alignment = {
      horizontal: s.align.h,
      vertical: s.align.v,
      wrapText: s.align.wrap,
    };
  }
  if (s.numFmt) cell.numFmt = s.numFmt;
}

function addSheet(wb: ExcelJS.Workbook, m: ModelSheet) {
  const ws = wb.addWorksheet(m.name, {
    state: m.hidden ? "hidden" : "visible",
    properties: { defaultRowHeight: DEFAULT_ROW_HEIGHT, ...(m.tabColor ? { tabColor: { argb: argb(m.tabColor) } } : {}) },
    views: [
      {
        state: m.freeze ? "frozen" : "normal",
        xSplit: m.freeze?.cols ?? 0,
        ySplit: m.freeze?.rows ?? 0,
        showGridLines: m.showGridLines ?? true,
      },
    ],
    pageSetup: {
      paperSize: 9, // A4
      orientation: m.page.orientation,
      fitToPage: !!m.page.fitToWidth,
      fitToWidth: m.page.fitToWidth ? 1 : undefined,
      fitToHeight: m.page.fitToWidth ? (m.page.fitToHeight ? 1 : 0) : undefined,
      margins: m.page.margins
        ? { ...m.page.margins, header: 0.3, footer: 0.3 }
        : { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
      printArea: `A1:${colLetter(m.maxCol - 1)}${Math.max(1, m.maxRow)}`,
    },
  });

  m.widths.forEach((w, i) => {
    const col = ws.getColumn(i + 1);
    col.width = w;
    if (m.hiddenCols?.includes(i)) col.hidden = true;
  });
  for (const [row, pt] of m.heights) ws.getRow(row).height = pt;

  for (const [addr, c] of m.cells) {
    const cell = ws.getCell(addr);
    if (c.f) {
      cell.value = { formula: c.f, result: c.v ?? "" } as ExcelJS.CellFormulaValue;
    } else if (c.v != null) {
      cell.value = c.v;
    }
    applyStyle(cell, c.s);
  }
  for (const range of m.merges) ws.mergeCells(range);
  for (const row of m.rowBreaks ?? []) ws.getRow(row).addPageBreak();
  if (m.autoFilter) ws.autoFilter = m.autoFilter;
  for (const addr of m.checkLists ?? []) {
    ws.getCell(addr).dataValidation = { type: "list", allowBlank: true, formulae: ['"未,済"'] };
  }
  m.condFormats?.forEach((cf, i) => {
    ws.addConditionalFormatting({
      ref: cf.range,
      rules: [
        {
          type: "expression",
          priority: i + 1,
          formulae: [cf.formula],
          style: {
            fill: { type: "pattern", pattern: "solid", bgColor: { argb: argb(cf.fill) } },
            font: { color: { argb: argb(cf.color) }, bold: true },
          },
        },
      ],
    });
  });
}

export async function renderWorkbookBase64(sheets: readonly ModelSheet[], creator = "Foldy"): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = creator;
  wb.created = new Date();
  for (const s of sheets) addSheet(wb, s);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf).toString("base64");
}
