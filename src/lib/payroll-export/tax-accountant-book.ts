import type { PrepRow } from "@/lib/payroll-prep";
import { SheetBuilder, type CellStyle, type ModelSheet } from "./sheet-model";

/**
 * 알바 급여 P4 — 세무사용 엑셀(`アルバイト給与一覧YYYYMMDD(税理士用).xlsx`) 모델. docs/product/39 §6.
 *
 * 세무사에게 보내던 양식 그대로: 시트 하나(`YYYY.M月分`), 甲 · 乙 · 丙 블록마다 머리 줄 · 사람 · 합계.
 * 칸: 氏名(가타카나) · 支給額(課税計, 교통비 뺌) · 交通費 · 総支給額 · 源泉所得税 · 差引支給額(10엔 올림 뒤 실수령) · 出勤日数.
 * 사람이 없는 구분은 블록을 만들지 않는다.
 */

export type TaxAccountantInput = {
  ym: string;
  rows: readonly PrepRow[];
};

const FONT = "游ゴシック";
const NUM = "#,##0 ;[Red](#,##0)";
const base: CellStyle = { font: { name: FONT, size: 11 } };
const num: CellStyle = { ...base, numFmt: NUM };
const head: CellStyle = { font: { name: FONT, size: 11 }, align: { h: "center" } };
const title: CellStyle = { font: { name: FONT, size: 11, bold: true } };

const CLASSES = [
  { key: "kou", label: "甲欄アルバイト" },
  { key: "otsu", label: "乙欄アルバイト" },
  { key: "hei", label: "丙欄アルバイト" },
] as const;

export function taxAccountantSheetName(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${y}.${m}月分`;
}

export function buildTaxAccountantBook(input: TaxAccountantInput): ModelSheet[] {
  const b = new SheetBuilder(taxAccountantSheetName(input.ym), [21.4, 11.1, 11.1, 11.1, 11.1, 11.1, 11.1], {
    orientation: "portrait",
    fitToWidth: true,
  });
  let r = 1;
  for (const cls of CLASSES) {
    const rows = input.rows
      .filter((x) => x.withholdingClass === cls.key)
      .sort((a, z) => (a.nameKatakana ?? a.name).localeCompare(z.nameKatakana ?? z.name, "ja"));
    if (rows.length === 0) continue;
    b.set(`A${r}`, cls.label, title);
    r += 1;
    ["氏名", "支給額", "交通費", "総支給額", "源泉所得税", "差引支給額", "出勤日数"].forEach((h, i) =>
      b.set(`${"ABCDEFG"[i]}${r}`, h, head),
    );
    r += 1;
    const first = r;
    for (const row of rows) {
      b.set(`A${r}`, row.nameKatakana ?? row.name, base);
      b.set(`B${r}`, row.taxable, num);
      b.set(`C${r}`, row.commute, num);
      b.set(`D${r}`, row.gross, num);
      b.set(`E${r}`, row.withholding ?? "", num);
      b.set(`F${r}`, row.net ?? "", num);
      b.set(`G${r}`, row.workDays, base);
      r += 1;
    }
    const last = r - 1;
    const sum = (pick: (x: PrepRow) => number) => rows.reduce((s, x) => s + pick(x), 0);
    b.set(`A${r}`, "合計", title);
    const cols: [string, (x: PrepRow) => number][] = [
      ["B", (x) => x.taxable],
      ["C", (x) => x.commute],
      ["D", (x) => x.gross],
      ["E", (x) => x.withholding ?? 0],
      ["F", (x) => x.net ?? 0],
    ];
    for (const [c, pick] of cols) b.set(`${c}${r}`, sum(pick), { ...num, font: { name: FONT, size: 11, bold: true } }, `SUM(${c}${first}:${c}${last})`);
    r += 2;
  }
  return [b.sheet];
}

/** `アルバイト給与一覧YYYYMMDD(税理士用).xlsx`(지급일). */
export function taxAccountantFilename(paydayDate: string): string {
  return `アルバイト給与一覧${paydayDate.replace(/-/g, "")}(税理士用).xlsx`;
}
