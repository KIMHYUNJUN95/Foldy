import {
  colLetter,
  DEFAULT_ROW_HEIGHT,
  formatCellText,
  parseRange,
  type BorderLine,
  type CellStyle,
  type ModelSheet,
} from "./sheet-model";

/**
 * 알바 급여 P4 — 시트 모델 → 인쇄용 HTML(새 탭 → 인쇄 → PDF 로 저장). docs/product/39 §6.
 *
 * 엑셀과 같은 모델을 그린다: 열 너비 · 숨긴 열 · 병합 · 행 높이 · 글꼴 · 바탕 · 테두리 · 숫자 서식 · 쪽 나눔(명세서 2명마다)
 * · 가로/세로. 「페이지 폭에 맞춤」 시트는 A4 폭에 맞게 줄인다. 수식은 그리지 않고 Foldy 가 계산한 값만 그린다.
 */

export type SheetsHtmlInput = {
  title: string;
  sheets: readonly ModelSheet[];
  printLabel: string;
  lang: string;
};

/** A4 인쇄 가능 폭(px, 여백 8mm) — 세로 194mm · 가로 281mm. */
const PRINT_WIDTH = { portrait: 733, landscape: 1062 } as const;

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 엑셀 열 너비(글자 수) → px. 엑셀의 기본 글꼴 기준 근사(7px/글자 + 5px). */
function widthPx(w: number): number {
  return Math.round(w * 7 + 5);
}

function borderCss(line: BorderLine | undefined): string {
  if (!line) return "none";
  if (line === "dotted") return "1px dotted #808080";
  if (line === "medium") return "2px solid #000";
  return "1px solid #000";
}

function cellCss(s: CellStyle | undefined, numeric: boolean): string {
  const out: string[] = [];
  const f = s?.font;
  out.push(`font-size:${f?.size ?? 8}pt`);
  if (f?.bold) out.push("font-weight:700");
  if (f?.color) out.push(`color:#${f.color}`);
  if (f?.name) out.push(`font-family:'${f.name}',var(--ff)`);
  if (s?.fill) out.push(`background:#${s.fill}`);
  const b = s?.border;
  if (b === "all") out.push("border:1px solid #000");
  else if (b) {
    out.push(`border-top:${borderCss(b.top)}`, `border-left:${borderCss(b.left)}`);
    out.push(`border-bottom:${borderCss(b.bottom)}`, `border-right:${borderCss(b.right)}`);
  }
  const h = s?.align?.h ?? (numeric ? "right" : "left");
  out.push(`text-align:${h}`);
  out.push(`vertical-align:${s?.align?.v ?? "bottom"}`);
  if (s?.align?.wrap) out.push("white-space:pre-wrap");
  return out.join(";");
}

function renderSheet(sheet: ModelSheet): string {
  const hidden = new Set(sheet.hiddenCols ?? []);
  const cols = Array.from({ length: sheet.maxCol }, (_, i) => i).filter((i) => !hidden.has(i));
  const natural = cols.reduce((s, i) => s + widthPx(sheet.widths[i] ?? 8.43), 0);
  const pageWidth = PRINT_WIDTH[sheet.page.orientation];
  const zoom = sheet.page.fitToWidth && natural > pageWidth ? pageWidth / natural : 1;

  // 병합: 왼쪽 위 칸 → 몇 줄 · 몇 칸(숨긴 열은 빼고 셈), 나머지 칸은 건너뜀.
  const span = new Map<string, { rows: number; cols: number }>();
  const covered = new Set<string>();
  for (const range of sheet.merges) {
    const r = parseRange(range);
    let visibleCols = 0;
    for (let c = r.left; c <= r.right; c++) if (!hidden.has(c)) visibleCols += 1;
    let anchor: string | null = null;
    for (let row = r.top; row <= r.bottom; row++) {
      for (let c = r.left; c <= r.right; c++) {
        const addr = `${colLetter(c)}${row}`;
        if (row === r.top && c === r.left) anchor = addr;
        else covered.add(addr);
      }
    }
    if (anchor) span.set(anchor, { rows: r.bottom - r.top + 1, cols: visibleCols });
  }

  const colgroup = `<colgroup>${cols.map((i) => `<col style="width:${widthPx(sheet.widths[i] ?? 8.43)}px">`).join("")}</colgroup>`;
  const breaks = new Set(sheet.rowBreaks ?? []);
  const tables: string[] = [];
  let rows: string[] = [];
  const flush = () => {
    if (rows.length) tables.push(`<table style="width:${natural}px">${colgroup}<tbody>${rows.join("")}</tbody></table>`);
    rows = [];
  };
  for (let r = 1; r <= sheet.maxRow; r++) {
    const pt = sheet.heights.get(r) ?? DEFAULT_ROW_HEIGHT;
    const tds: string[] = [];
    for (const c of cols) {
      const addr = `${colLetter(c)}${r}`;
      if (covered.has(addr)) continue;
      const cell = sheet.cells.get(addr);
      const sp = span.get(addr);
      const attrs = sp ? `${sp.rows > 1 ? ` rowspan="${sp.rows}"` : ""}${sp.cols > 1 ? ` colspan="${sp.cols}"` : ""}` : "";
      if (sp && sp.cols === 0) continue; // 병합이 통째로 숨긴 열 안
      const text = cell ? formatCellText(cell) : "";
      const css = cellCss(cell?.s, typeof cell?.v === "number");
      tds.push(`<td${attrs} style="${css}">${esc(text)}</td>`);
    }
    rows.push(`<tr style="height:${pt}pt">${tds.join("")}</tr>`);
    if (breaks.has(r)) flush();
  }
  flush();

  const pageClass = sheet.page.orientation === "landscape" ? "land" : "port";
  return `<section class="sheet ${pageClass}" style="zoom:${zoom.toFixed(4)}">${tables
    .map((t, i) => `<div class="pg"${i > 0 ? ' style="break-before:page"' : ""}>${t}</div>`)
    .join("")}</section>`;
}

export function buildSheetsHtml(input: SheetsHtmlInput): string {
  const body = input.sheets.map(renderSheet).join("");
  return `<!DOCTYPE html>
<html lang="${esc(input.lang)}">
<head>
<meta charset="utf-8" />
<title>${esc(input.title)}</title>
<style>
  @page { size: A4 portrait; margin: 8mm; }
  @page land { size: A4 landscape; margin: 8mm; }
  :root { --ff: 'Meiryo','Hiragino Sans','Yu Gothic','Malgun Gothic','Apple SD Gothic Neo',sans-serif; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: var(--ff); color: #000; padding: 16px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { break-before: page; }
  .sheet:first-of-type { break-before: auto; }
  .sheet.land { page: land; }
  .sheet + .sheet { margin-top: 28px; }
  table { border-collapse: collapse; table-layout: fixed; }
  td { padding: 0 3px; overflow: hidden; white-space: nowrap; line-height: 1.2; font-variant-numeric: tabular-nums; }
  .toolbar { position: fixed; top: 16px; right: 16px; z-index: 10; }
  .printbtn { border: none; background: #2f3b5c; color: #fff; font-size: 13px; font-weight: 700;
    padding: 9px 16px; border-radius: 8px; cursor: pointer; }
  @media print {
    body { padding: 0; }
    .noprint { display: none !important; }
    .sheet + .sheet { margin-top: 0; }
  }
</style>
</head>
<body>
  <div class="toolbar noprint">
    <button type="button" class="printbtn" onclick="window.print()">${esc(input.printLabel)}</button>
  </div>
  ${body}
</body>
</html>`;
}
