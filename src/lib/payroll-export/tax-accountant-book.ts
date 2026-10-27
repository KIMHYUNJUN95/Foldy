import type { PrepRow } from "@/lib/payroll-prep";
import { SheetBuilder, fitWrappedRows, type CellStyle, type ModelSheet } from "./sheet-model";

/**
 * 알바 급여 P4 — 세무사용 엑셀(`アルバイト給与一覧YYYYMMDD(税理士用).xlsx`) 모델. docs/product/39 §6.
 *
 * 세무사에게 보내던 양식(2026.9月分 실물 대조, 2026-10-27): 시트 하나(`YYYY.M月分`), 甲 · 乙 · 丙 블록마다 머리 줄 · 사람 · 합계.
 * 칸(사용자 지정 순서, 2026-10-27): 氏名(가타카나) · 課税対象額(교통비 뺀 과세 금액 — 원천세 표를 보는 금액) · 交通費(비과세) ·
 * 総支給額(`=B+C`) · 源泉所得税 · 差引支給額(`=D-E`, 고용보험 · 연말정산이 있으면 실수령 값) · 出勤日数.
 * 원본처럼 표 칸 · 합계 줄 전부 얇은 테두리, 머리 줄은 왼쪽 맞춤, 합계는 보통 굵기.
 * 사람이 없는 구분은 블록을 만들지 않는다. 원천세 구분이 아직 없는 사람은 「区分未設定」 블록(빠뜨리지 않게).
 */

export type TaxAccountantInput = {
  ym: string;
  rows: readonly PrepRow[];
};

const FONT = "游ゴシック";
const NUM = "#,##0 ;[Red](#,##0)";
const base: CellStyle = { font: { name: FONT, size: 11 }, border: "all", align: { v: "middle" } };
const num: CellStyle = { ...base, numFmt: NUM };
const title: CellStyle = { font: { name: FONT, size: 11, bold: true }, align: { v: "middle" } };
const HEADERS = ["氏名", "課税対象額", "交通費", "総支給額", "源泉所得税", "差引支給額", "出勤日数"] as const;

const CLASSES = [
  { key: "kou", label: "甲欄アルバイト" },
  { key: "otsu", label: "乙欄アルバイト" },
  { key: "hei", label: "丙欄アルバイト" },
  // 구분이 아직 없는 사람(급여 준비 「확인 필요」) — 빠뜨리지 않고 맨 아래에 따로.
  { key: null, label: "区分未設定アルバイト" },
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
    HEADERS.forEach((h, i) => b.set(`${"ABCDEFG"[i]}${r}`, h, base));
    r += 1;
    const first = r;
    for (const row of rows) {
      b.set(`A${r}`, row.nameKatakana ?? row.name, base);
      b.set(`B${r}`, row.taxable, num);
      b.set(`C${r}`, row.commute, num);
      b.set(`D${r}`, row.gross, num, `B${r}+C${r}`);
      b.set(`E${r}`, row.withholding ?? "", num);
      // 공제가 원천세뿐이면 원본처럼 =D-E. 고용보험 · 연말정산이 있으면 수식이 틀리므로 실수령 값.
      const plain = row.net != null && row.withholding != null && row.net === row.gross - row.withholding;
      b.set(`F${r}`, row.net ?? "", num, plain ? `D${r}-E${r}` : undefined);
      b.set(`G${r}`, row.workDays, base);
      r += 1;
    }
    const last = r - 1;
    const sum = (pick: (x: PrepRow) => number) => rows.reduce((s, x) => s + pick(x), 0);
    b.set(`A${r}`, "合計", base);
    const cols: [string, (x: PrepRow) => number][] = [
      ["B", (x) => x.taxable],
      ["C", (x) => x.commute],
      ["D", (x) => x.gross],
      ["E", (x) => x.withholding ?? 0],
      ["F", (x) => x.net ?? 0],
    ];
    for (const [c, pick] of cols) b.set(`${c}${r}`, sum(pick), num, `SUM(${c}${first}:${c}${last})`);
    b.set(`G${r}`, null, base);
    r += 2;
  }
  fitWrappedRows(b.sheet);
  return [b.sheet];
}

/** `アルバイト給与一覧YYYYMMDD(税理士用).xlsx`(지급일). */
export function taxAccountantFilename(paydayDate: string): string {
  return `アルバイト給与一覧${paydayDate.replace(/-/g, "")}(税理士用).xlsx`;
}
