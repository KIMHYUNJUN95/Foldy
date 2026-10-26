import type { PrepRow } from "@/lib/payroll-prep";
import { withholdingTable } from "@/lib/withholding-tax";
import {
  colLetter,
  SheetBuilder,
  sheetRef,
  type CellStyle,
  type CellValue,
  type ModelSheet,
} from "./sheet-model";

/**
 * 알바 급여 P4 — 급여 엑셀(`新アルバイト給与管理YYYYMMDD.xlsx`) 모델. docs/product/39 §2 · §6, 38.
 *
 * 인사팀이 쓰던 엑셀과 같은 시트 · 같은 칸 · 같은 수식 흐름(입력 시트 → 명세서 · 사장 확인표 · 지급 확인 목록)을 만든다.
 * 다른 점(문서 38 §9 의 오류는 따라 하지 않음): 사람 수만큼 행 · 블록(50칸 제한 없음), 수당 칸 이름(前月調整額 · 週末手当 ·
 * 特別手当), 원천세는 국세청 표 그대로(사회보험 뺀 금액 · 甲 부양 인원 열 · 乙 하한 없음), 有給日数 칸 없음,
 * 勤務表チェック用 시트는 뺌(Foldy 근태가 같은 원천이라 대조할 것이 없음).
 * 숫자는 모두 급여 준비 화면(P2 엔진)과 같은 값 — 수식 칸에도 그 값을 미리 넣어 둔다.
 */

export type PayrollBookInput = {
  /** 근무 달 `YYYY-MM`. */
  ym: string;
  /** 실제 지급일 `YYYY-MM-DD`. */
  paydayDate: string;
  companyName: string;
  /** 세금표의 해(지급일의 해). */
  taxYear: number;
  rows: readonly PrepRow[];
};

export const SHEET = {
  guide: "印刷方法",
  settings: "設定",
  cashInput: "現金入力_50名",
  transferInput: "振込入力_50名",
  owner: "社長確認用・資金準備表",
  cashSlip: "現金_明細印刷",
  transferSlip: "振込_明細印刷",
  check: "支給確認一覧",
} as const;

/** 2026 → 令和8. */
export function reiwaYear(year: number): number {
  return year - 2018;
}

export function taxSheetName(taxYear: number): string {
  return `令和${reiwaYear(taxYear)}源泉税表`;
}

// ── 스타일 — 원본 엑셀의 글꼴 · 색 그대로(Meiryo 8 · 머리 칸 D9EAD3 · 제목 A9D18E · 합계 FFD966) ──

const HEAD_FILL = "D9EAD3";
const TITLE_FILL = "A9D18E";
const TOTAL_FILL = "FFD966";
const RED = "FF0000";

const center = { h: "center", v: "middle", wrap: true } as const;
const left = { h: "left", v: "middle", wrap: true } as const;

const st = {
  title: (size: number): CellStyle => ({ font: { size, bold: true }, fill: TITLE_FILL, border: "all", align: center }),
  head: (size = 8, color?: string): CellStyle => ({
    font: { size, bold: true, color },
    fill: HEAD_FILL,
    border: "all",
    align: center,
  }),
  cell: (numFmt?: string, size = 8, align: CellStyle["align"] = center): CellStyle => ({
    font: { size },
    border: "all",
    align,
    numFmt,
  }),
  total: (numFmt?: string): CellStyle => ({ font: { size: 9, bold: true }, fill: TOTAL_FILL, border: "all", align: center, numFmt }),
};

const YEN = "#,##0";
const HOURS = "[h]:mm";

const minutesToDays = (m: number) => m / 1440;
const blankZero = (n: number): CellValue => (n === 0 ? null : n);

function jpMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${y}年 ${m}月分`;
}

function jpDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${y}年 ${m}月${d}日`;
}

/** 設定 B9 수식과 같은 글 — 「10月アルバイト給与(11/10支給)」. */
export function payrollTitle(ym: string, paydayDate: string): string {
  const m = Number(ym.slice(5, 7));
  const [, pm, pd] = paydayDate.split("-").map(Number);
  return `${m}月アルバイト給与(${pm}/${pd}支給)`;
}

function methodLabel(row: PrepRow): "振込" | "現金" {
  return row.paymentMethod === "cash" ? "現金" : "振込";
}

function classLabel(row: PrepRow): string {
  return row.withholdingClass === "kou" ? "甲" : row.withholdingClass === "otsu" ? "乙" : row.withholdingClass === "hei" ? "丙" : "";
}

function hm(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** 備考(AL) — 前月調整額이면 「N月分」 앞머리, 시급 ③ 이상이면 구간 메모, 원천세를 못 냈으면 그 사실. */
export function rowNote(row: PrepRow): string {
  const parts: string[] = [];
  if (row.manual.prevAdjustment !== 0 && row.manual.prevAdjustmentYm) {
    parts.push(`${Number(row.manual.prevAdjustmentYm.slice(5, 7))}月分`);
  }
  if (row.segments.length > 2) {
    parts.push(
      `時給②以降 ${row.segments
        .slice(1)
        .map((s) => `${s.rate.toLocaleString("en-US")}円 ${hm(s.paidMinutes)}`)
        .join(" / ")}`,
    );
  }
  if (row.net == null) parts.push("源泉税未確定");
  const memo = row.manual.memo?.trim();
  if (memo) parts.push(memo);
  return parts.join(" ");
}

// ── 입력 시트 ──

const INPUT_WIDTHS = [
  5.375, 12, 16, 8, 10, 11, 8, 10, 11, 9, 9, 9, 9, 9, 10, 10, 11, 9, 9, 9, 9, 11, 10, 9, 9, 10, 11, 11, 8, 8, 8, 10, 10, 10, 10,
  8, 8, 16, 9, 14, 12,
];

const INPUT_HEADS: { label: string; red?: boolean }[] = [
  { label: "No" },
  { label: "韓国名" },
  { label: "氏名" },
  { label: "時給①", red: true },
  { label: "出勤時間①", red: true },
  { label: "支給額①" },
  { label: "時給②", red: true },
  { label: "出勤時間②", red: true },
  { label: "支給額②" },
  { label: "前月調整額" },
  { label: "残業手当" },
  { label: "週末手当" },
  { label: "特別手当" },
  { label: "通勤課税" },
  { label: "通勤非課税", red: true },
  { label: "課税計" },
  { label: "支給額合計" },
  { label: "健康保険" },
  { label: "介護保険" },
  { label: "厚生年金" },
  { label: "雇用保険" },
  { label: "社会保険計" },
  { label: "源泉所得税" },
  { label: "住民税" },
  { label: "年末調整" },
  { label: "控除合計" },
  { label: "総支給額" },
  { label: "差引支給額" },
  { label: "出勤日数", red: true },
  { label: "有給日数" },
  { label: "欠勤日数" },
  { label: "残業時間" },
  { label: "週末出勤日数" },
  { label: "週末出勤時間" },
  { label: "支払方法" },
  { label: "封入確認" },
  { label: "支給確認" },
  { label: "備考" },
  { label: "備考2" },
  { label: "合計" },
  { label: "人数" },
];

/** 원천세 칸(W) — 甲 · 乙 은 국세청 표를 보는 수식(엔진과 같은 규칙), 丙 · 손 덮어쓰기 · 표 밖 고액은 값. */
export function withholdingFormula(row: PrepRow, r: number, taxYear: number): string | undefined {
  if (row.withholding == null || row.withholdingOverridden) return undefined;
  const cls = row.withholdingClass;
  if (cls !== "kou" && cls !== "otsu") return undefined;
  const table = withholdingTable(taxYear);
  if (!table) return undefined;
  const t = sheetRef(taxSheetName(taxYear));
  const first = TAX_FIRST_ROW;
  const last = first + table.monthly.length - 1;
  const upper = table.monthly[table.monthly.length - 1][1];
  const basis = `(P${r}-V${r})`;
  const col = cls === "otsu" ? "L" : colLetter(3 + Math.min(Math.max(row.dependents, 0), 7));
  const lookup = `INDEX(${t}!$${col}$${first}:$${col}$${last},MATCH(${basis},${t}!$B$${first}:$B$${last},1))`;
  const below = cls === "otsu" ? `ROUNDDOWN(MAX(0,${basis})*3.063%,0)` : "0";
  return `IF(${basis}<${table.otsuFlatBelow},${below},IF(${basis}>=${upper},${row.withholding},${lookup}))`;
}

function inputSheet(name: string, title: string, rows: readonly PrepRow[], taxYear: number): ModelSheet {
  const b = new SheetBuilder(name, INPUT_WIDTHS, {
    orientation: "landscape",
    fitToWidth: true,
    fitToHeight: true,
    margins: { left: 0, right: 0.16, top: 0.39, bottom: 0.2 },
  });
  b.merge("A1:AL1", title, { font: { size: 12, bold: true }, fill: TITLE_FILL, align: left });
  b.height(1, 18.95).height(2, 14.45);
  INPUT_HEADS.forEach((h, i) => b.set(`${colLetter(i)}2`, h.label, st.head(i >= 39 ? 9 : 8, h.red ? RED : undefined)));

  const end = Math.max(3, rows.length + 2);
  rows.forEach((row, i) => {
    const r = i + 3;
    b.height(r, 14.45);
    const seg1 = row.segments[0];
    const seg2 = row.segments.length === 2 ? row.segments[1] : null;
    const rest = row.segments.slice(1);
    const restMinutes = rest.reduce((s, x) => s + x.paidMinutes, 0);
    const restPay = rest.reduce((s, x) => s + x.pay, 0);
    const taxable = row.taxable;
    const social = row.employmentInsurance;
    const deduction = social + (row.withholding ?? 0) + row.yearEndAdjustment;

    b.set(`A${r}`, i + 1, st.cell());
    b.set(`B${r}`, row.name, st.cell());
    b.set(`C${r}`, row.nameKatakana ?? "", st.cell());
    b.set(`D${r}`, seg1?.rate ?? null, st.cell(YEN));
    b.set(`E${r}`, seg1 ? minutesToDays(seg1.paidMinutes) : null, st.cell(HOURS));
    b.set(`F${r}`, seg1?.pay ?? "", st.cell(YEN), `IF(OR(D${r}="",E${r}=""),"",ROUND(D${r}*E${r}*24,0))`);
    if (seg2) {
      b.set(`G${r}`, seg2.rate, st.cell(YEN));
      b.set(`H${r}`, minutesToDays(seg2.paidMinutes), st.cell(HOURS));
      b.set(`I${r}`, seg2.pay, st.cell(YEN), `IF(OR(G${r}="",H${r}=""),"",ROUND(G${r}*H${r}*24,0))`);
    } else if (rest.length > 1) {
      // 시급 ③ 이상 — ② 칸에 나머지 구간 합(시급은 비우고 備考에 구간 메모).
      b.set(`G${r}`, null, st.cell(YEN));
      b.set(`H${r}`, minutesToDays(restMinutes), st.cell(HOURS));
      b.set(`I${r}`, restPay, st.cell(YEN));
    } else {
      b.set(`G${r}`, null, st.cell(YEN));
      b.set(`H${r}`, null, st.cell(HOURS));
      b.set(`I${r}`, "", st.cell(YEN), `IF(OR(G${r}="",H${r}=""),"",ROUND(G${r}*H${r}*24,0))`);
    }
    b.set(`J${r}`, blankZero(row.prevAdjustmentTaxable), st.cell(YEN));
    b.set(`K${r}`, blankZero(row.overtime), st.cell(YEN));
    b.set(`L${r}`, blankZero(row.weekend), st.cell(YEN));
    b.set(`M${r}`, blankZero(row.special), st.cell(YEN));
    b.set(`N${r}`, null, st.cell(YEN));
    b.set(`O${r}`, blankZero(row.commute), st.cell(YEN));
    b.set(`P${r}`, taxable, st.cell(YEN), `IF(AND(B${r}="",C${r}=""),"",SUM(F${r},I${r},J${r}:N${r}))`);
    b.set(`Q${r}`, row.gross, st.cell(YEN), `IF(AND(B${r}="",C${r}=""),"",SUM(F${r},I${r},J${r}:O${r}))`);
    for (const c of ["R", "S", "T"]) b.set(`${c}${r}`, null, st.cell(YEN));
    b.set(`U${r}`, blankZero(social), st.cell(YEN));
    b.set(`V${r}`, social, st.cell(YEN), `IF(AND(B${r}="",C${r}=""),"",SUM(R${r}:U${r}))`);
    const wf = withholdingFormula(row, r, taxYear);
    b.set(`W${r}`, row.withholding ?? "", st.cell(YEN), wf);
    b.set(`X${r}`, null, st.cell(YEN));
    b.set(`Y${r}`, blankZero(row.yearEndAdjustment), st.cell(YEN));
    b.set(`Z${r}`, deduction, st.cell(YEN), `IF(AND(B${r}="",C${r}=""),"",SUM(V${r}:Y${r}))`);
    b.set(`AA${r}`, row.gross, st.cell(YEN), `IF(AND(B${r}="",C${r}=""),"",Q${r})`);
    if (row.net == null) b.set(`AB${r}`, "", st.cell(YEN));
    else b.set(`AB${r}`, row.net, st.cell(YEN), `IF(AND(B${r}="",C${r}=""),"",CEILING(Q${r}-Z${r},10))`);
    b.set(`AC${r}`, row.workDays, st.cell("0"));
    for (const c of ["AD", "AE", "AG"]) b.set(`${c}${r}`, null, st.cell("0"));
    for (const c of ["AF", "AH"]) b.set(`${c}${r}`, null, st.cell(HOURS));
    b.set(`AI${r}`, methodLabel(row), st.cell());
    b.set(`AJ${r}`, null, st.cell());
    b.set(`AK${r}`, null, st.cell());
    b.set(`AL${r}`, rowNote(row), st.cell(undefined, 8, left));
    b.set(`AM${r}`, classLabel(row), { ...st.cell(undefined, 8, left), font: { size: 8, color: RED } });
  });

  // 오른쪽 합계(AN · AO) — 원본처럼 3~6행.
  const sum = (col: string, values: number[]) => ({ v: values.reduce((s, x) => s + x, 0), f: `SUM(${col}3:${col}${end})` });
  const totals = [
    { label: "総支給額", ...sum("AA", rows.map((r) => r.gross)) },
    { label: "差引支給額", ...sum("AB", rows.map((r) => r.net ?? 0)) },
    { label: "源泉所得税", ...sum("W", rows.map((r) => r.withholding ?? 0)) },
    { label: "入力人数", v: rows.length, f: `SUMPRODUCT(--(((B3:B${end}<>"")+(C3:C${end}<>""))>0))` },
  ];
  totals.forEach((t, i) => {
    b.set(`AN${i + 3}`, t.label, st.cell(undefined, 9, left));
    b.set(`AO${i + 3}`, t.v, st.cell(YEN, 9, left), t.f);
  });

  const s = b.sheet;
  s.freeze = { rows: 2, cols: 2 };
  s.autoFilter = `A2:AO${end}`;
  s.hiddenCols = [29, 30, 31, 32, 33]; // AD~AH — 알바는 비어 있는 칸(명세서엔 그대로 나옴)
  s.checkLists = rows.map((_, i) => `AJ${i + 3}`).concat(rows.map((_, i) => `AK${i + 3}`));
  s.tabColor = "375623";
  return s;
}

// ── 명세서(28행 블록, 한 장에 2명) ──

const SLIP_WIDTHS = [3, 7.5, 7.5, 7.5, 7.5, 7.5, 7.5, 7.5, 7.5, 9.25, 8.5, 8.5];
const SLIP_LABEL: CellStyle = { font: { size: 8, bold: true }, fill: HEAD_FILL, border: "all", align: center, numFmt: YEN };
const SLIP_VALUE = (numFmt = YEN): CellStyle => ({ font: { size: 8 }, fill: "FFFFFF", border: "all", align: center, numFmt });
const SLIP_PLAIN: CellStyle = { font: { size: 8 }, fill: "FFFFFF", border: "all", align: center };

type SlipCell = { range: string; label?: string; ref?: string; value?: CellValue; f?: string; numFmt?: string };

function slipSheet(name: string, inputName: string, rows: readonly PrepRow[], settings: SettingsValues): ModelSheet {
  const b = new SheetBuilder(name, SLIP_WIDTHS, { orientation: "portrait", fitToWidth: true });
  const inp = sheetRef(inputName);
  const set = sheetRef(SHEET.settings);
  const breaks: number[] = [];

  rows.forEach((row, n) => {
    const o = n * 28; // 블록 시작 = o + 1
    const R = (k: number) => o + k;
    const ir = n + 3; // 입력 시트 행
    const ref = (col: string) => `${inp}!${col}${ir}`;
    for (let k = 1; k <= 28; k++) b.height(R(k), 13.5);

    // 머리
    b.merge(`A${R(1)}:D${R(2)}`, "給与明細書", SLIP_PLAIN);
    b.merge(`E${R(1)}:G${R(1)}`, settings.month, SLIP_PLAIN, `${set}!B4`);
    b.merge(`H${R(1)}:J${R(1)}`, `支給日： ${settings.payday}`, SLIP_PLAIN, `"支給日： "&${set}!B5`);
    b.merge(`K${R(1)}:L${R(1)}`, "検印", SLIP_PLAIN);
    for (const c of ["E", "F", "G", "H", "I", "J"]) b.set(`${c}${R(2)}`, null, SLIP_PLAIN);
    b.merge(`K${R(2)}:L${R(4)}`, null, SLIP_PLAIN);
    b.merge(`A${R(3)}:B${R(3)}`, "韓国名", SLIP_PLAIN);
    b.merge(`C${R(3)}:D${R(3)}`, row.name, SLIP_PLAIN, ref("B"));
    b.merge(`E${R(3)}:F${R(3)}`, "氏名", SLIP_PLAIN);
    b.merge(`G${R(3)}:J${R(3)}`, row.nameKatakana ?? "", SLIP_PLAIN, ref("C"));
    b.merge(`A${R(4)}:J${R(4)}`, settings.company, { ...SLIP_PLAIN, font: { size: 8, bold: true } }, `${set}!B6`);

    const seg2 = row.segments.length === 2 ? row.segments[1] : null;
    const restPay = row.segments.slice(1).reduce((s, x) => s + x.pay, 0);
    const restMinutes = row.segments.slice(1).reduce((s, x) => s + x.paidMinutes, 0);
    const deduction = row.employmentInsurance + (row.withholding ?? 0) + row.yearEndAdjustment;
    const v = (x: CellValue | undefined): CellValue => (x == null ? "" : x);
    const net = row.net;
    const transfer = methodLabel(row) === "振込";

    const pairs = (labelRow: number, cells: SlipCell[]) => {
      for (const c of cells) {
        const [a, z] = c.range.split(":");
        const lr = `${a}${R(labelRow)}${z ? `:${z}${R(labelRow)}` : ""}`;
        const vr = `${a}${R(labelRow + 1)}${z ? `:${z}${R(labelRow + 1)}` : ""}`;
        b.merge(lr, c.label ?? null, SLIP_LABEL);
        if (c.ref) b.merge(vr, c.value ?? "", SLIP_VALUE(c.numFmt), c.f ?? ref(c.ref));
        else b.merge(vr, null, SLIP_VALUE(c.numFmt));
      }
    };

    // 支給
    b.merge(`A${R(6)}:A${R(11)}`, "支\n給", SLIP_PLAIN);
    pairs(6, [
      { range: "B:C", label: "時給①", ref: "D", value: v(row.segments[0]?.rate) },
      { range: "D:E", label: "時給②", ref: "G", value: v(seg2?.rate) },
      { range: "F:H", label: "前月調整額", ref: "J", value: v(blankZero(row.prevAdjustmentTaxable)) },
      { range: "I:L", label: "残業手当", ref: "K", value: v(blankZero(row.overtime)) },
    ]);
    pairs(8, [
      { range: "B:C", label: "通勤課税", ref: "N", value: "" },
      { range: "D:E", label: "通勤非課税", ref: "O", value: v(blankZero(row.commute)) },
      { range: "F:H", label: "週末手当", ref: "L", value: v(blankZero(row.weekend)) },
      { range: "I:L", label: "特別手当", ref: "M", value: v(blankZero(row.special)) },
    ]);
    pairs(10, [
      { range: "B:C", label: "支給額①", ref: "F", value: v(row.segments[0]?.pay) },
      { range: "D:E", label: "支給額②", ref: "I", value: row.segments.length > 1 ? restPay : "" },
      { range: "F:H", label: "課税対象額", ref: "P", value: row.taxable },
      { range: "I:L", label: "総支給額", ref: "AA", value: row.gross },
    ]);

    // 控除
    b.merge(`A${R(13)}:A${R(18)}`, "控\n除", SLIP_PLAIN);
    pairs(13, [
      { range: "B:C", label: "健康保険", ref: "R", value: "" },
      { range: "D:E", label: "介護保険", ref: "S", value: "" },
      { range: "F:G", label: "厚生年金", ref: "T", value: "" },
      { range: "H:I", label: "雇用保険", ref: "U", value: v(blankZero(row.employmentInsurance)) },
      { range: "J", label: "社会保険計", ref: "V", value: row.employmentInsurance },
      { range: "K:L", label: "課税対象額", ref: "P", value: row.taxable },
    ]);
    pairs(15, [
      { range: "B:C", label: "源泉所得税", ref: "W", value: v(row.withholding) },
      { range: "D:E", label: "住民税", ref: "X", value: "" },
      { range: "F:G" },
      { range: "H:I" },
      { range: "J" },
      { range: "K:L" },
    ]);
    pairs(17, [
      { range: "B:C" },
      { range: "D:E" },
      { range: "F:G" },
      { range: "H:I", label: "年末調整", ref: "Y", value: v(blankZero(row.yearEndAdjustment)) },
      { range: "J", label: "控除計", ref: "Z", value: deduction },
      { range: "K:L", label: "控除合計", ref: "Z", value: deduction },
    ]);

    // 勤怠 — 有給日数 칸은 비움(시급제 연차는 급여 밖, 문서 39 §11-7)
    b.merge(`A${R(20)}:A${R(23)}`, "勤\n怠", SLIP_PLAIN);
    pairs(20, [
      { range: "B:C", label: "出勤日数", ref: "AC", value: row.workDays, numFmt: "0" },
      { range: "D:E" },
      { range: "F:G", label: "欠勤日数", ref: "AE", value: "", numFmt: "0" },
      { range: "H:I", label: "出勤時間①", ref: "E", value: row.segments[0] ? minutesToDays(row.segments[0].paidMinutes) : "", numFmt: HOURS },
      {
        range: "J:L",
        label: "出勤時間②",
        ref: "H",
        value: row.segments.length > 1 ? minutesToDays(restMinutes) : "",
        numFmt: HOURS,
      },
    ]);
    pairs(22, [
      { range: "B:C", label: "残業時間", ref: "AF", value: "", numFmt: HOURS },
      { range: "D:E", label: "週末出勤日数", ref: "AG", value: "", numFmt: "0" },
      { range: "F:G", label: "週末出勤時間", ref: "AH", value: "", numFmt: HOURS },
      { range: "H:I" },
      { range: "J:L" },
    ]);

    // 記事
    b.merge(`A${R(25)}:A${R(26)}`, "記\n事", SLIP_PLAIN);
    pairs(25, [
      { range: "B:D", label: "支払方法", ref: "AI", value: methodLabel(row) },
      {
        range: "E:G",
        label: "給与振込",
        ref: "AI",
        value: transfer ? v(net) : 0,
        f: `IF(${ref("AI")}="振込",${ref("AB")},0)`,
      },
      {
        range: "H:I",
        label: "現金支給額",
        ref: "AI",
        value: transfer ? 0 : v(net),
        f: `IF(${ref("AI")}="現金",${ref("AB")},0)`,
      },
      { range: "J:L", label: "差引支給額", ref: "AB", value: v(net) },
    ]);

    b.merge(`A${R(28)}:L${R(28)}`, "※ 切り取り線", {
      font: { size: 8, color: "808080" },
      border: { top: "dotted" },
      align: center,
    });
    if (n % 2 === 1 && n < rows.length - 1) breaks.push(R(28));
  });

  const s = b.sheet;
  s.showGridLines = false;
  s.rowBreaks = breaks;
  s.tabColor = "375623";
  s.maxCol = SLIP_WIDTHS.length;
  return s;
}

// ── 설정 · 안내 ──

type SettingsValues = { month: string; payday: string; company: string; title: string };

function settingsSheet(input: PayrollBookInput, cash: number, transfer: number): { sheet: ModelSheet; values: SettingsValues } {
  const values: SettingsValues = {
    month: jpMonth(input.ym),
    payday: jpDate(input.paydayDate),
    company: input.companyName,
    title: payrollTitle(input.ym, input.paydayDate),
  };
  const b = new SheetBuilder(SHEET.settings, [18, 28, 62, 8], { orientation: "portrait" });
  b.merge("A1:D1", "アルバイト給与管理 設定（Foldy で作成）", st.title(14));
  b.height(1, 22.5).height(3, 15.95);
  ["項目", "値", "説明", ""].forEach((h, i) => b.set(`${colLetter(i)}3`, h, st.head(10)));
  const body = (r: number, a: string, v: CellValue, c: string, f?: string, h = 14.45) => {
    b.height(r, h);
    b.set(`A${r}`, a, st.cell(undefined, 9, left));
    b.set(`B${r}`, v, st.cell(undefined, 9, left), f);
    b.set(`C${r}`, c, st.cell(undefined, 9, left));
    b.set(`D${r}`, null, st.cell(undefined, 9, left));
  };
  body(4, "支給年月", values.month, "明細・社長確認用に表示");
  body(5, "支給日", values.payday, "明細・社長確認用に表示");
  body(6, "会社名", values.company, "明細に表示");
  body(7, "現金人数", cash, "現金入力_50名の人数（Foldy の給与準備から）");
  body(8, "振込人数", transfer, "振込入力_50名の人数（Foldy の給与準備から）");
  body(
    9,
    "給与タイトル",
    values.title,
    "社長確認用タイトル",
    'MID(B4,FIND("年",B4)+2,FIND("月",B4)-FIND("年",B4)-2)&"月アルバイト給与("&MID(B5,FIND("年",B5)+2,FIND("月",B5)-FIND("年",B5)-2)&"/"&MID(B5,FIND("月",B5)+1,FIND("日",B5)-FIND("月",B5)-1)&"支給)"',
  );
  body(10, "使い方", "数字は現金入力_50名・振込入力_50名で直す", "直すと明細・社長確認表・支給確認一覧に自動で反映。行・列は削除しないでください", undefined, 29.1);
  body(11, "時間入力", "53:32", "半角コロンで入力。時間セルは [h]:mm 設定済み");
  const s = b.sheet;
  s.freeze = { rows: 3, cols: 0 };
  return { sheet: s, values };
}

function guideSheet(values: SettingsValues): ModelSheet {
  const b = new SheetBuilder(SHEET.guide, [12, 80], { orientation: "portrait" });
  b.merge("A1:B1", "印刷方法・毎月の使い方", { font: { size: 14, bold: true, color: "FFFFFF" }, fill: "1F4E78", align: { h: "center" } });
  b.height(1, 17.25);
  const items: [string, string][] = [
    ["1", "このファイルは Foldy の「給与準備」から作りました。数字を直すときは、できるだけ Foldy で直して作り直してください。"],
    ["2", "支給年月・支給日・会社名は「設定」シートにあります。"],
    ["3", "数字は「現金入力_50名」「振込入力_50名」で直します。直すと明細・社長確認表・支給確認一覧に自動で反映されます。"],
    ["4", "時間は 53:32 のように半角コロンで入力します。24時間超でも表示されます。"],
    ["5", "明細は「現金_明細印刷」「振込_明細印刷」から印刷してください。"],
    ["6", "各印刷シートは A4・縦・1ページの幅に合わせる設定、1ページに2名分、中央に切り取り線があります。"],
    ["7", "切る前に右上の「検印」欄へ社長印・確認印を押してください。"],
    ["8", "差引支給額は10円単位切上げです。"],
    ["注意", "数式が入っているため、列・行・シートを削除するとエラーになります。"],
    ["今回設定", `支給年月：${values.month}　／　支給日：${values.payday}`],
  ];
  items.forEach(([k, text], i) => {
    const r = i + 3;
    b.set(`A${r}`, k, { font: { name: "Meiryo", size: 10, bold: true }, fill: "D9EAF7", align: { h: "center", v: "middle" } });
    b.set(`B${r}`, text, { font: { name: "Meiryo", size: 10 }, align: { v: "top", wrap: true } });
    if (text.length > 48) b.height(r, 27);
  });
  const s = b.sheet;
  s.hidden = true;
  return s;
}

// ── 사장 확인표 ──

function ownerSheet(cash: readonly PrepRow[], transfer: readonly PrepRow[], title: string): ModelSheet {
  const b = new SheetBuilder(SHEET.owner, [8, 5, 12, 18.5, 18, 14, 12.875, 14.5, 6.25], {
    orientation: "portrait",
    fitToWidth: true,
    margins: { left: 0.75, right: 0.35, top: 0.98, bottom: 0.2 },
  });
  b.merge("A1:H1", title, { ...st.title(14), fill: undefined }, `${sheetRef(SHEET.settings)}!B9`);
  b.height(1, 22.5).height(2, 21.6).height(3, 33.95).height(4, 11.1).height(5, 24);
  b.set("G2", "専務", { font: { name: "Meiryo UI", size: 11, bold: true }, border: "all", align: { h: "center" } });
  b.set("H2", "社長", { font: { name: "Meiryo UI", size: 11, bold: true }, border: "all", align: { h: "center" } });
  b.set("G3", null, { border: "all" });
  b.set("H3", null, { border: "all" });
  ["時給", "No", "韓国名", "氏名", "内容", "金額(税込)", "支払方法", "出勤日数", "区分"].forEach((h, i) =>
    b.set(`${colLetter(i)}5`, h, st.head(9)),
  );

  let r = 6;
  const section = (rows: readonly PrepRow[], inputName: string, label: string, method: "振込" | "現金", totalLabel: string) => {
    const inp = sheetRef(inputName);
    b.merge(`A${r}:H${r}`, `${label}（${rows.length}名）`, st.head(9), `"${label}（"&${inp}!AO6&"名）"`);
    b.height(r, 21.6);
    r += 1;
    const first = r;
    rows.forEach((row, i) => {
      const ir = i + 3;
      const note = rowNote(row);
      const days = `${row.workDays}日${note ? ` / ${note}` : ""}`;
      b.height(r, 15.95);
      b.set(`A${r}`, row.segments[0]?.rate ?? "", st.cell(YEN, 9), `${inp}!D${ir}`);
      b.set(`B${r}`, i + 1, st.cell(undefined, 9), `${inp}!A${ir}`);
      b.set(`C${r}`, row.name, st.cell(undefined, 9), `${inp}!B${ir}`);
      b.set(`D${r}`, row.nameKatakana ?? "", st.cell(undefined, 9), `${inp}!C${ir}`);
      b.set(`E${r}`, "給与支給", st.cell(undefined, 9));
      b.set(`F${r}`, row.net ?? "", st.cell(YEN, 9), `${inp}!AB${ir}`);
      b.set(`G${r}`, method, st.cell(undefined, 9));
      b.set(
        `H${r}`,
        days,
        st.cell(undefined, 9),
        `${inp}!AC${ir}&"日"&IF(${inp}!AL${ir}<>""," / "&${inp}!AL${ir},"")`,
      );
      b.set(`I${r}`, classLabel(row), st.cell(undefined, 9), `${inp}!AM${ir}`);
      r += 1;
    });
    const last = r - 1;
    const total = rows.reduce((s, x) => s + (x.net ?? 0), 0);
    b.merge(`A${r}:E${r}`, totalLabel, st.total());
    b.set(`F${r}`, total, st.total(YEN), rows.length > 0 ? `SUM(F${first}:F${last})` : undefined);
    b.set(`G${r}`, null, st.total());
    b.set(`H${r}`, null, st.total());
    b.height(r, 29.1);
    const totalRow = r;
    r += 2;
    return { totalRow, total };
  };

  const t = section(transfer, SHEET.transferInput, "振込アルバイト", "振込", "振込合計");
  const c = section(cash, SHEET.cashInput, "現金手渡アルバイト", "現金", "現金合計");
  const sumRow = (label: string, value: number, f: string, fill?: string) => {
    const style: CellStyle = { font: { size: 9, bold: true }, fill: fill ?? "FFFFFF", border: "all", align: center };
    b.merge(`E${r}:F${r}`, label, style);
    b.set(`G${r}`, value, { ...style, numFmt: YEN }, f);
    b.height(r, 18.95);
    r += 1;
  };
  sumRow("振込合計", t.total, `F${t.totalRow}`);
  sumRow("現金合計", c.total, `F${c.totalRow}`);
  sumRow("総合計", t.total + c.total, `G${r - 2}+G${r - 1}`, TOTAL_FILL);

  const s = b.sheet;
  s.freeze = { rows: 5, cols: 0 };
  s.showGridLines = false;
  return s;
}

// ── 지급 확인 목록 ──

function checkSheet(cash: readonly PrepRow[], transfer: readonly PrepRow[]): ModelSheet {
  const b = new SheetBuilder(SHEET.check, [8, 9.625, 12, 18.5, 8.5, 12, 10, 10.125, 15.875, 12.25], {
    orientation: "portrait",
    fitToWidth: true,
    margins: { left: 0.55, right: 0.55, top: 0.98, bottom: 0.98 },
  });
  b.merge("A1:J1", "支給確認一覧（封入・振込・支給チェック）", st.title(13));
  b.height(1, 21).height(3, 14.45);
  ["区分", "No", "韓国名", "氏名", "出勤日数", "差引支給額", "支払方法", "封入確認", "本人確認", "備考"].forEach((h, i) =>
    b.set(`${colLetter(i)}3`, h, st.head(9)),
  );
  let r = 4;
  const checks: string[] = [];
  const add = (rows: readonly PrepRow[], inputName: string) => {
    const inp = sheetRef(inputName);
    rows.forEach((row, i) => {
      const ir = i + 3;
      b.height(r, 18.95);
      const m = methodLabel(row);
      b.set(`A${r}`, m, st.cell(undefined, 9), `${inp}!AI${ir}`);
      b.set(`B${r}`, i + 1, st.cell(undefined, 9), `${inp}!A${ir}`);
      b.set(`C${r}`, row.name, st.cell(undefined, 9), `${inp}!B${ir}`);
      b.set(`D${r}`, row.nameKatakana ?? "", st.cell(undefined, 9), `${inp}!C${ir}`);
      b.set(`E${r}`, row.workDays, st.cell(undefined, 9), `${inp}!AC${ir}`);
      b.set(`F${r}`, row.net ?? "", st.cell(YEN, 9), `${inp}!AB${ir}`);
      b.set(`G${r}`, m, st.cell(undefined, 9), `${inp}!AI${ir}`);
      b.set(`H${r}`, null, st.cell(undefined, 9));
      b.set(`I${r}`, null, st.cell(undefined, 9));
      b.set(`J${r}`, rowNote(row), st.cell(undefined, 9, left), `${inp}!AL${ir}`);
      checks.push(`H${r}`, `I${r}`);
      r += 1;
    });
  };
  add(cash, SHEET.cashInput);
  add(transfer, SHEET.transferInput);
  const last = Math.max(4, r - 1);
  r += 1;
  const tSum = transfer.reduce((s, x) => s + (x.net ?? 0), 0);
  const cSum = cash.reduce((s, x) => s + (x.net ?? 0), 0);
  b.set(`A${r}`, "振込合計", st.total());
  b.set(`B${r}`, tSum, st.total(YEN), `SUMIF(A4:A${last},"振込",F4:F${last})`);
  b.set(`A${r + 1}`, "現金合計", st.total());
  b.set(`B${r + 1}`, cSum, st.total(YEN), `SUMIF(A4:A${last},"現金",F4:F${last})`);
  b.set(`A${r + 2}`, "総合計", st.total());
  b.set(`B${r + 2}`, tSum + cSum, st.total(YEN), `SUM(B${r}:B${r + 1})`);
  for (const k of [r, r + 1, r + 2]) b.height(k, 14.45);
  const s = b.sheet;
  s.freeze = { rows: 3, cols: 0 };
  s.checkLists = checks;
  return s;
}

// ── 세금표 ──

/** 세금표 시트에서 月額表 데이터가 시작하는 행. */
export const TAX_FIRST_ROW = 10;

function taxSheet(taxYear: number): ModelSheet | null {
  const table = withholdingTable(taxYear);
  if (!table) return null;
  const mincho = "ＭＳ 明朝";
  const b = new SheetBuilder(taxSheetName(taxYear), [6, 10.375, 10.375, 9.25, 9.25, 9.25, 9.25, 9.25, 9.25, 9.25, 9.625, 13.375], {
    orientation: "portrait",
    fitToWidth: true,
  });
  const head: CellStyle = { font: { name: mincho, size: 11 }, border: "all", align: { h: "center", v: "middle" } };
  const kouHead: CellStyle = { ...head, fill: "FFFF00" };
  const num: CellStyle = { font: { name: "ＭＳ Ｐゴシック", size: 11 }, border: { left: "thin", right: "thin" }, numFmt: YEN };

  b.merge("B1:L1", `給与所得の源泉徴収税額表（令和${reiwaYear(taxYear)}年分）`, {
    font: { name: "ＭＳ Ｐゴシック", size: 14 },
    align: { h: "center", v: "middle" },
  });
  b.merge("B2:L2", "月　額　表", { font: { name: "ＭＳ Ｐゴシック", size: 14, bold: true }, align: { h: "center", v: "middle" } });
  b.height(1, 30).height(2, 30);
  b.merge("B3:C5", "その月の社会保険料等控除後の給与等の金額", { ...head, align: { h: "center", v: "middle", wrap: true } });
  b.merge("D3:K3", "甲", kouHead);
  b.merge("D4:K4", "扶養親族等の数", kouHead);
  for (let d = 0; d <= 7; d++) b.set(`${colLetter(3 + d)}5`, `${d}  人`, d === 0 ? kouHead : head);
  b.merge("L3:L5", "乙", head);
  b.set("B6", "以  上", head);
  b.set("C6", "未  満", head);
  b.merge("D6:K6", "税額", kouHead);
  b.set("L6", "税  額", head);
  for (let r = 3; r <= 6; r++) b.height(r, 22.5);
  for (let c = 1; c <= 11; c++) b.set(`${colLetter(c)}7`, "円", { font: { name: mincho, size: 8 }, border: "all", align: { h: "right" } });

  // 첫 줄 — 「N円未満」(甲 0 · 乙 3.063%)
  b.height(8, 40);
  b.set("B8", table.otsuFlatBelow, num);
  b.set("C8", "円未満", num);
  for (let d = 0; d <= 7; d++) b.set(`${colLetter(3 + d)}8`, 0, d === 0 ? { ...num, fill: "FFFF00" } : num);
  b.set("L8", "その月の社会保険料等控除後の給与等の金額の3.063％に相当する金額", {
    ...num,
    font: { name: "ＭＳ Ｐゴシック", size: 9 },
    align: { h: "left", v: "top", wrap: true },
  });

  table.monthly.forEach((row, i) => {
    const r = TAX_FIRST_ROW + i;
    b.set(`A${r}`, i + 1, { font: { name: "ＭＳ Ｐゴシック", size: 11 }, numFmt: "0" });
    row.forEach((value, c) => b.set(`${colLetter(1 + c)}${r}`, value, c === 2 ? { ...num, fill: "FFFF00" } : num));
  });
  const lastRow = TAX_FIRST_ROW + table.monthly.length - 1;
  for (let c = 1; c <= 11; c++) {
    const addr = `${colLetter(c)}${lastRow}`;
    const cell = b.sheet.cells.get(addr)!;
    cell.s = { ...cell.s, border: { left: "thin", right: "thin", bottom: "thin" } };
  }
  b.set(
    `B${lastRow + 1}`,
    `${table.monthly[table.monthly.length - 1][1].toLocaleString("en-US")}円以上は国税庁の税額表の計算式で求めた額（Foldy の計算と同じ）`,
    { font: { name: "ＭＳ Ｐゴシック", size: 9 } },
  );

  // 日額表 丙欄 — 丙 사람의 원천세는 근무한 날마다 이 표로 계산(값으로 들어감).
  const dStart = lastRow + 3;
  b.merge(`B${dStart}:D${dStart}`, "日額表（丙欄）", { font: { name: "ＭＳ Ｐゴシック", size: 12, bold: true }, align: { h: "left" } });
  b.set(`B${dStart + 1}`, "以  上", head);
  b.set(`C${dStart + 1}`, "未  満", head);
  b.set(`D${dStart + 1}`, "丙", head);
  b.set(`B${dStart + 2}`, table.dailyHei[0][0], num);
  b.set(`C${dStart + 2}`, "円未満", num);
  b.set(`D${dStart + 2}`, 0, num);
  table.dailyHei.forEach((row, i) => {
    const r = dStart + 3 + i;
    row.forEach((value, c) => b.set(`${colLetter(1 + c)}${r}`, value, num));
  });
  const s = b.sheet;
  s.freeze = { rows: 7, cols: 0 };
  return s;
}

// ── 묶기 ──

export function buildPayrollBook(input: PayrollBookInput): ModelSheet[] {
  const byName = (a: PrepRow, b: PrepRow) => a.name.localeCompare(b.name, "ko");
  const cash = input.rows.filter((r) => r.paymentMethod === "cash").sort(byName);
  // 지급 방식이 아직 없는 사람은 이체 쪽에 둔다(확인 필요로 이미 걸려 있음).
  const transfer = input.rows.filter((r) => r.paymentMethod !== "cash").sort(byName);
  const { sheet: settings, values } = settingsSheet(input, cash.length, transfer.length);
  const sheets: ModelSheet[] = [
    guideSheet(values),
    settings,
    inputSheet(SHEET.cashInput, "現金入力　※ここを直すと、明細・社長確認表・支給確認一覧へ自動反映", cash, input.taxYear),
    inputSheet(SHEET.transferInput, "振込入力　※ここを直すと、明細・社長確認表・支給確認一覧へ自動反映", transfer, input.taxYear),
    ownerSheet(cash, transfer, values.title),
    slipSheet(SHEET.cashSlip, SHEET.cashInput, cash, values),
    slipSheet(SHEET.transferSlip, SHEET.transferInput, transfer, values),
    checkSheet(cash, transfer),
  ];
  const tax = taxSheet(input.taxYear);
  if (tax) sheets.push(tax);
  return sheets;
}

/** `新アルバイト給与管理YYYYMMDD.xlsx`(지급일). */
export function payrollBookFilename(paydayDate: string): string {
  return `新アルバイト給与管理${paydayDate.replace(/-/g, "")}.xlsx`;
}
