/**
 * 알바 급여 P4 — 출력 양식 한 장(시트)을 그리는 공용 모델. docs/product/39 §6.
 *
 * 엑셀(`render-xlsx.ts`)과 PDF 인쇄 HTML(`render-html.ts`)이 **같은 모델**을 그린다 — 칸 · 병합 · 글꼴 · 테두리 · 숫자 서식이
 * 한 곳에서 정해져 두 파일이 어긋나지 않는다. 수식 칸은 수식(`f`)과 Foldy 가 계산한 값(`v`)을 같이 들고 있다 —
 * 엑셀은 수식을 쓰고 값을 미리 넣어 두며(열자마자 같은 숫자), HTML 은 값만 그린다.
 */

export type CellValue = string | number | null;

export type CellStyle = {
  font?: { name?: string; size?: number; bold?: boolean; color?: string };
  /** 바탕색 `RRGGBB`. */
  fill?: string;
  /** 테두리 — `"all"` 은 네 변 thin. 변마다 따로면 객체. */
  border?: "all" | { top?: BorderLine; left?: BorderLine; bottom?: BorderLine; right?: BorderLine };
  align?: { h?: "left" | "center" | "right"; v?: "top" | "middle" | "bottom"; wrap?: boolean };
  numFmt?: string;
};

export type BorderLine = "thin" | "medium" | "dotted";

export type ModelCell = { v: CellValue; f?: string; s?: CellStyle };

export type SheetPage = {
  orientation: "portrait" | "landscape";
  /** 페이지 폭에 맞춤(가로 1장). */
  fitToWidth?: boolean;
  /** 세로도 1장에(입력 시트처럼 한 장에 다 넣을 때). */
  fitToHeight?: boolean;
  margins?: { left: number; right: number; top: number; bottom: number };
};

export type ModelSheet = {
  name: string;
  hidden?: boolean;
  /** 열 너비(엑셀 글자 단위) — 0 번 = A 열. */
  widths: number[];
  hiddenCols?: number[];
  /** 행 높이(pt) — 1 번 행부터. 없으면 13.5. */
  heights: Map<number, number>;
  cells: Map<string, ModelCell>;
  /** `A1:D2` 형식. */
  merges: string[];
  /** 고정 — 위쪽 행 수 · 왼쪽 열 수. */
  freeze?: { rows: number; cols: number };
  showGridLines?: boolean;
  page: SheetPage;
  /** 이 행 **뒤에서** 쪽을 나눈다(명세서 두 명마다). */
  rowBreaks?: number[];
  autoFilter?: string;
  /** 「未 / 済」 고르기 칸. */
  checkLists?: string[];
  /**
   * 엑셀 조건부 서식 — `formula` 가 참이면 칸을 칠한다(왼쪽 위 칸 기준 상대 참조). 엑셀만 쓴다: HTML 은 셀 스타일에
   * 미리 칠한 값을 그리므로, 만들 때의 값으로 같은 칸을 칠해 둔다.
   */
  condFormats?: { range: string; formula: string; fill: string; color: string }[];
  tabColor?: string;
  /** 마지막 행 · 열(1 부터) — 그릴 범위. */
  maxRow: number;
  maxCol: number;
};

export const DEFAULT_ROW_HEIGHT = 13.5;

/** 0 → A, 26 → AA. */
export function colLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** A → 0, AA → 26. */
export function colIndex(letter: string): number {
  let n = 0;
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function parseAddress(addr: string): { row: number; col: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(addr);
  if (!m) throw new Error(`bad address ${addr}`);
  return { col: colIndex(m[1]), row: Number(m[2]) };
}

export function parseRange(range: string): { top: number; left: number; bottom: number; right: number } {
  const [a, b] = range.split(":");
  const s = parseAddress(a);
  const e = parseAddress(b ?? a);
  return { top: s.row, left: s.col, bottom: e.row, right: e.col };
}

/** 시트 이름이 수식에서 따옴표가 필요한지 — 일본어 · 가운뎃점은 엑셀이 따옴표 없이 받는다. */
export function sheetRef(name: string): string {
  return /^[\p{L}\p{N}_]+$/u.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

export class SheetBuilder {
  readonly sheet: ModelSheet;

  constructor(name: string, widths: number[], page: SheetPage) {
    this.sheet = {
      name,
      widths,
      heights: new Map(),
      cells: new Map(),
      merges: [],
      page,
      maxRow: 0,
      maxCol: widths.length,
    };
  }

  set(addr: string, v: CellValue, s?: CellStyle, f?: string): this {
    const { row, col } = parseAddress(addr);
    this.sheet.cells.set(addr, { v, s, f });
    this.sheet.maxRow = Math.max(this.sheet.maxRow, row);
    this.sheet.maxCol = Math.max(this.sheet.maxCol, col + 1);
    return this;
  }

  /** 병합 칸 — 왼쪽 위에 값, 나머지 칸에도 같은 스타일(테두리가 끊기지 않게). */
  merge(range: string, v: CellValue, s?: CellStyle, f?: string): this {
    const r = parseRange(range);
    for (let row = r.top; row <= r.bottom; row++) {
      for (let col = r.left; col <= r.right; col++) {
        const addr = `${colLetter(col)}${row}`;
        if (row === r.top && col === r.left) this.set(addr, v, s, f);
        else this.set(addr, null, s);
      }
    }
    if (r.top !== r.bottom || r.left !== r.right) this.sheet.merges.push(range);
    return this;
  }

  height(row: number, pt: number): this {
    this.sheet.heights.set(row, pt);
    this.sheet.maxRow = Math.max(this.sheet.maxRow, row);
    return this;
  }
}

/** 글자 폭(반각 = 1, 전각 · 한글 · 한자 = 2) — 행 높이 어림용. */
function textUnits(text: string): number {
  let n = 0;
  for (const ch of text) n += /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff01-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1;
  return n;
}

/**
 * 줄바꿈(wrap) 글자 칸이 열 폭을 넘으면 그 행을 몇 줄만큼 높인다(2026-10-27 — 社長確認用 「出勤日数 / 메모」 ·
 * 備考가 두 줄로 접혀 위아래가 잘렸다). 정해 둔 높이보다 **낮추지는 않는다**. 여러 행 병합 칸은 건너뛴다.
 * 엑셀 열 폭 1 = 11pt 글자 「0」 하나 — 글자 크기에 맞춰 칸에 들어가는 반각 글자 수를 어림한다(여유 10%).
 */
export function fitWrappedRows(sheet: ModelSheet): void {
  const spans = new Map<string, { cols: number[]; multiRow: boolean }>();
  for (const range of sheet.merges) {
    const r = parseRange(range);
    const cols: number[] = [];
    for (let c = r.left; c <= r.right; c++) cols.push(c);
    spans.set(`${colLetter(r.left)}${r.top}`, { cols, multiRow: r.bottom > r.top });
  }
  for (const [addr, cell] of sheet.cells) {
    if (typeof cell.v !== "string" || !cell.v || !cell.s?.align?.wrap) continue;
    const span = spans.get(addr);
    if (span?.multiRow) continue;
    const { row, col } = parseAddress(addr);
    const width = (span?.cols ?? [col]).reduce((sum, c) => sum + (sheet.widths[c] ?? 8.43), 0);
    const size = cell.s.font?.size ?? 11;
    const perLine = Math.max(1, Math.floor(((width * 11) / size) * 0.9));
    const lines = cell.v.split("\n").reduce((sum, part) => sum + Math.max(1, Math.ceil(textUnits(part) / perLine)), 0);
    if (lines < 2) continue;
    const need = Math.ceil(lines * size * 1.45 + 3);
    if (need > (sheet.heights.get(row) ?? DEFAULT_ROW_HEIGHT)) sheet.heights.set(row, need);
  }
}

/** 엑셀 `#,##0` 처럼 — HTML 에 값을 그릴 때. */
export function formatCellText(cell: ModelCell): string {
  const v = cell.v;
  if (v == null || v === "") return "";
  if (typeof v === "string") return v;
  const fmt = cell.s?.numFmt;
  if (fmt === "[h]:mm") {
    const minutes = Math.round(v * 1440);
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
  }
  if (fmt && fmt.startsWith("#,##0")) {
    const s = Math.abs(Math.round(v)).toLocaleString("en-US");
    if (v < 0) return fmt.includes("[Red]") ? `(${s})` : `-${s}`;
    return s;
  }
  if (fmt === "+0;-0;0") return v > 0 ? `+${v}` : String(v);
  return String(v);
}
