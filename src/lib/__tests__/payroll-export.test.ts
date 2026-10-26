import { writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { buildPrepRow, EMPTY_PREP_MANUAL, type PrepRow, type PrepRowInput } from "@/lib/payroll-prep";
import { EMPTY_MEMBER_PAYROLL_SETTING } from "@/lib/payroll-settings-rules";
import { withholdingTable } from "@/lib/withholding-tax";
import {
  buildPayrollBook,
  payrollBookFilename,
  payrollTitle,
  rowNote,
  SHEET,
  TAX_FIRST_ROW,
  taxSheetName,
  withholdingFormula,
} from "@/lib/payroll-export/payroll-book";
import { buildTaxAccountantBook, taxAccountantFilename } from "@/lib/payroll-export/tax-accountant-book";
import { buildSheetsHtml } from "@/lib/payroll-export/render-html";

vi.mock("server-only", () => ({}));

/** 알바 급여 P4 — 급여 엑셀 · 세무사 엑셀 · 인쇄 HTML(docs/product/39 §6). 사람 · 금액은 가짜. */
function input(over: Partial<PrepRowInput>): PrepRowInput {
  return {
    userId: "u",
    name: "가명",
    setting: { ...EMPTY_MEMBER_PAYROLL_SETTING, paymentMethod: "transfer", withholdingClass: "kou" },
    nameKatakana: "カメイ",
    hireDate: "2026-01-01",
    today: "2026-11-02",
    finalized: true,
    paidMinutes: 0,
    workDays: 0,
    rateSegments: [],
    dailyTaxable: [],
    allowanceRegular: 0,
    allowanceSpecial: 0,
    commuteApproved: 0,
    manual: null,
    taxYear: 2026,
    ym: "2026-10",
    insuranceRates: {},
    ...over,
  };
}

function sample(): PrepRow[] {
  const kou = buildPrepRow(
    input({
      userId: "a",
      name: "가나다",
      nameKatakana: "カナダ",
      paidMinutes: 160 * 60,
      workDays: 20,
      rateSegments: [
        { rate: 1200, paidMinutes: 100 * 60 },
        { rate: 1250, paidMinutes: 60 * 60 },
      ],
      allowanceSpecial: 3000,
      commuteApproved: 9000,
      manual: { ...EMPTY_PREP_MANUAL, prevAdjustment: -1200, prevAdjustmentYm: "2026-08", overtime: 2000 },
      kintai: {
        absentDays: 1,
        overtimeMinutes: 210,
        weekendDays: 6,
        weekendMinutes: 48 * 60,
        recordedMinutes: 158 * 60 + 30,
        recordedDays: 19,
        notes: "打刻修正 1件（10/14）",
      },
    }),
  );
  const otsu = buildPrepRow(
    input({
      userId: "b",
      name: "라마바",
      nameKatakana: "ラマバ",
      setting: { ...EMPTY_MEMBER_PAYROLL_SETTING, paymentMethod: "cash", withholdingClass: "otsu" },
      paidMinutes: 50 * 60,
      workDays: 8,
      rateSegments: [{ rate: 1300, paidMinutes: 50 * 60 }],
      kintai: {
        absentDays: 0,
        overtimeMinutes: 0,
        weekendDays: 2,
        weekendMinutes: 12 * 60,
        recordedMinutes: 50 * 60,
        recordedDays: 8,
        notes: "",
      },
    }),
  );
  const three = buildPrepRow(
    input({
      userId: "c",
      name: "사아자",
      nameKatakana: "サアジャ",
      paidMinutes: 90 * 60,
      workDays: 12,
      rateSegments: [
        { rate: 1200, paidMinutes: 30 * 60 },
        { rate: 1250, paidMinutes: 30 * 60 },
        { rate: 1300, paidMinutes: 30 * 60 },
      ],
    }),
  );
  return [kou, otsu, three];
}

const book = () =>
  buildPayrollBook({ ym: "2026-10", paydayDate: "2026-11-10", companyName: "テスト株式会社", taxYear: 2026, rows: sample() });

describe("payroll book", () => {
  it("시트 10장(원본과 같은 순서) · 이름 · 파일 이름", () => {
    const names = book().map((s) => s.name);
    expect(names).toEqual([
      SHEET.guide,
      SHEET.settings,
      SHEET.cashInput,
      SHEET.transferInput,
      SHEET.workCheck,
      SHEET.owner,
      SHEET.cashSlip,
      SHEET.transferSlip,
      SHEET.check,
      "令和8源泉税表",
    ]);
    expect(payrollBookFilename("2026-11-10")).toBe("新アルバイト給与管理20261110.xlsx");
    expect(taxAccountantFilename("2026-11-10")).toBe("アルバイト給与一覧20261110(税理士用).xlsx");
    expect(payrollTitle("2026-10", "2026-11-10")).toBe("10月アルバイト給与(11/10支給)");
  });

  it("입력 시트 — 수식 칸에 엔진 값이 미리 들어 있다", () => {
    const transfer = book().find((s) => s.name === SHEET.transferInput)!;
    const rows = sample().filter((r) => r.paymentMethod !== "cash").sort((a, b) => a.name.localeCompare(b.name, "ko"));
    rows.forEach((row, i) => {
      const r = i + 3;
      expect(transfer.cells.get(`P${r}`)).toMatchObject({ v: row.taxable });
      expect(transfer.cells.get(`Q${r}`)).toMatchObject({ v: row.gross });
      expect(transfer.cells.get(`AB${r}`)?.v).toBe(row.net);
      expect(transfer.cells.get(`AB${r}`)?.f).toBe(`IF(AND(B${r}="",C${r}=""),"",CEILING(Q${r}-Z${r},10))`);
      // 엑셀 끝처리: CEILING(Q−Z, 10) == 엔진 실수령
      const z = transfer.cells.get(`Z${r}`)!.v as number;
      expect(Math.ceil((row.gross - z) / 10) * 10).toBe(row.net);
    });
    // 시급 ③ — ② 칸에 나머지 합 + 備考 메모
    const three = rows.find((r) => r.segments.length === 3)!;
    const r3 = rows.indexOf(three) + 3;
    expect(transfer.cells.get(`I${r3}`)?.v).toBe(three.segments[1].pay + three.segments[2].pay);
    expect(String(transfer.cells.get(`AL${r3}`)?.v)).toContain("時給②以降");
  });

  it("備考 — 前月調整額은 「N月分」", () => {
    expect(rowNote(sample()[0])).toContain("8月分");
  });

  it("원천세 수식(甲 · 乙)이 찾는 칸 == 엔진 값 — 여러 금액", () => {
    const table = withholdingTable(2026)!;
    for (const amount of [80000, 88000, 105000, 150000, 233333, 300000, 512345]) {
      for (const cls of ["kou", "otsu"] as const) {
        const row = buildPrepRow(
          input({
            setting: { ...EMPTY_MEMBER_PAYROLL_SETTING, paymentMethod: "transfer", withholdingClass: cls },
            paidMinutes: 60,
            workDays: 1,
            rateSegments: [{ rate: amount, paidMinutes: 60 }],
          }),
        );
        const f = withholdingFormula(row, 3, 2026);
        expect(f).toBeDefined();
        const basis = row.taxable - row.employmentInsurance;
        let lookup: number;
        if (basis < table.otsuFlatBelow) lookup = cls === "otsu" ? Math.floor(basis * 0.03063) : 0;
        else {
          const idx = table.monthly.findLastIndex((x) => x[0] <= basis);
          lookup = table.monthly[idx][cls === "otsu" ? 10 : 2];
        }
        expect(lookup, `${cls} ${amount}`).toBe(row.withholding);
      }
    }
    expect(TAX_FIRST_ROW).toBe(10);
    expect(taxSheetName(2027)).toBe("令和9源泉税表");
  });

  it("丙 · 손 덮어쓰기는 값만", () => {
    const hei = buildPrepRow(
      input({
        setting: { ...EMPTY_MEMBER_PAYROLL_SETTING, paymentMethod: "cash", withholdingClass: "hei" },
        paidMinutes: 480,
        workDays: 1,
        rateSegments: [{ rate: 1200, paidMinutes: 480 }],
        dailyTaxable: [9600],
      }),
    );
    expect(withholdingFormula(hei, 3, 2026)).toBeUndefined();
  });

  it("세무사 엑셀 — 구분별 블록 · 합계", () => {
    const [sheet] = buildTaxAccountantBook({ ym: "2026-10", rows: sample() });
    expect(sheet.name).toBe("2026.10月分");
    expect(sheet.cells.get("A1")?.v).toBe("甲欄アルバイト");
    const texts = [...sheet.cells.values()].map((c) => c.v);
    expect(texts).toContain("乙欄アルバイト");
    expect(texts).not.toContain("丙欄アルバイト");
  });

  it("세무사 엑셀 — 원천세 구분 없는 사람도 빠지지 않고 「区分未設定」 블록에", () => {
    const rows = rich();
    const [sheet] = buildTaxAccountantBook({ ym: "2026-10", rows });
    const texts = [...sheet.cells.values()].map((c) => c.v);
    expect(texts).toContain("区分未設定アルバイト");
    expect(texts).toContain("マ");
    expect(texts.filter((v) => typeof v === "string" && ["カ", "ナ", "ダ", "ラ", "マ", "バ", "サ", "ア", "ジャ"].includes(v))).toHaveLength(rows.length);
  });

  it("엑셀 파일 — exceljs 로 다시 읽어도 수식 · 값 · 병합이 그대로", async () => {
    const { renderWorkbookBase64 } = await import("@/lib/payroll-export/render-xlsx");
    const b64 = await renderWorkbookBase64(book());
    const out = process.env.PAYROLL_EXPORT_OUT;
    if (out) {
      writeFileSync(`${out}/payroll.xlsx`, Buffer.from(b64, "base64"));
      writeFileSync(
        `${out}/tax.xlsx`,
        Buffer.from(await renderWorkbookBase64(buildTaxAccountantBook({ ym: "2026-10", rows: sample() })), "base64"),
      );
      const sheets = book();
      const pick = [SHEET.owner, SHEET.check, SHEET.cashSlip, SHEET.transferSlip].map((n) => sheets.find((s) => s.name === n)!);
      writeFileSync(`${out}/payroll.html`, buildSheetsHtml({ title: "t", sheets: pick, printLabel: "Print", lang: "ja" }));
    }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(b64, "base64") as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet(SHEET.transferInput)!;
    const ab3 = ws.getCell("AB3").value as ExcelJS.CellFormulaValue;
    expect(ab3.formula).toContain("CEILING");
    expect(typeof ab3.result).toBe("number");
    expect(ws.getColumn("AE").hidden).toBe(false);
    expect(wb.getWorksheet(SHEET.guide)!.state).toBe("hidden");
    const wc = wb.getWorksheet(SHEET.workCheck)!;
    expect(wc.state).toBe("hidden");
    expect((wc.getCell("F3").value as ExcelJS.CellFormulaValue).formula).toBe("N(現金入力_50名!E3)+N(現金入力_50名!H3)");
    expect(wc.getCell("K3").dataValidation?.formulae).toEqual(['"未,済"']);
    const slip = wb.getWorksheet(SHEET.transferSlip)!;
    expect(slip.getCell("A1").isMerged).toBe(true);
    expect(slip.getCell("D2").border?.bottom?.style).toBe("thin");
  });

  it("근태 칸 — 입력 시트 AE~AH 와 명세서 勤怠, 有給日数는 빈칸", () => {
    const sheets = book();
    const transfer = sheets.find((s) => s.name === SHEET.transferInput)!;
    // 이체 쪽 이름순: 가나다(근태 있음) → 사아자(근태 없음 = 옛 스냅샷)
    expect(transfer.cells.get("AD3")?.v ?? null).toBeNull();
    expect(transfer.cells.get("AE3")?.v).toBe(1);
    expect(transfer.cells.get("AF3")?.v).toBeCloseTo(210 / 1440);
    expect(transfer.cells.get("AG3")?.v).toBe(6);
    expect(transfer.cells.get("AH3")?.v).toBeCloseTo((48 * 60) / 1440);
    expect(transfer.cells.get("AE4")?.v ?? null).toBeNull();
    expect(transfer.hiddenCols ?? []).toEqual([]);
    const slip = sheets.find((s) => s.name === SHEET.transferSlip)!;
    const html = buildSheetsHtml({ title: "t", sheets: [slip], printLabel: "Print", lang: "ja" });
    expect(html).toContain("3:30");
    expect(html).toContain("48:00");
  });

  it("勤務表チェック用 — 본인 기록 ↔ 급여 입력, 차이는 빨강 · 「未」, 같으면 「済」", () => {
    const wc = book().find((s) => s.name === SHEET.workCheck)!;
    expect(wc.hidden).toBe(true);
    // 현금(라마바, 차이 없음) → 이체(가나다 +1:30 · 사아자 근태 없음)
    expect(wc.cells.get("A3")?.v).toBe("現金");
    expect(wc.cells.get("G3")?.v).toBe("0:00");
    expect(wc.cells.get("K3")?.v).toBe("済");
    expect(wc.cells.get("G3")?.s?.fill).toBeUndefined();
    expect(wc.cells.get("A4")?.v).toBe("振込");
    expect(wc.cells.get("G4")?.v).toBe("+1:30");
    expect(wc.cells.get("G4")?.s?.fill).toBe("FCE4D6");
    expect(wc.cells.get("J4")?.v).toBe(1);
    expect(wc.cells.get("K4")?.v).toBe("未");
    expect(wc.cells.get("L4")?.v).toBe("打刻修正 1件（10/14）");
    expect(wc.cells.get("E5")?.v ?? null).toBeNull();
    expect(wc.cells.get("K5")?.v ?? null).toBeNull();
    // 합계 — 확인 끝 1 / 3, 시간 차이 1
    expect(wc.cells.get("E7")?.v).toBe("1 / 3");
    expect(wc.cells.get("E8")?.v).toBe(1);
    expect(wc.condFormats?.map((c) => c.range)).toEqual(["G3:G5", "J3:J5"]);
    const html = buildSheetsHtml({ title: "t", sheets: [wc], printLabel: "Print", lang: "ja" });
    expect(html).toContain("+1:30");
    expect(html).toContain("+1");
  });

  it("인쇄 HTML — 명세서 2명마다 쪽 나눔", () => {
    const slip = book().find((s) => s.name === SHEET.transferSlip)!;
    const html = buildSheetsHtml({ title: "t", sheets: [slip], printLabel: "Print", lang: "ja" });
    expect(html).toContain("給与明細書");
    expect(html).toContain('colspan="4"');
  });
});

/** 여러 경우를 섞은 가짜 9명 — 고용보험 · 연말정산 · 원천세 직접 · 丙 · 구분 없음 · 부양 2명 · 교통비 조정 · 고액 · 마이너스 조정. */
function rich(): PrepRow[] {
  const s = (over: Partial<typeof EMPTY_MEMBER_PAYROLL_SETTING>) => ({
    ...EMPTY_MEMBER_PAYROLL_SETTING,
    paymentMethod: "transfer" as const,
    withholdingClass: "kou" as const,
    ...over,
  });
  const seg = (rate: number, minutes: number) => ({ rate, paidMinutes: minutes });
  const rates = { "2026": 5.5 };
  return [
    buildPrepRow(input({ userId: "1", name: "가", nameKatakana: "カ", setting: s({ employmentInsurance: true }), insuranceRates: rates, paidMinutes: 9000, workDays: 21, rateSegments: [seg(1300, 9000)], commuteApproved: 12000 })),
    buildPrepRow(input({ userId: "2", name: "나", nameKatakana: "ナ", setting: s({ dependents: 2, employmentInsurance: true }), insuranceRates: rates, paidMinutes: 10000, workDays: 22, rateSegments: [seg(1500, 10000)], manual: { ...EMPTY_PREP_MANUAL, yearEndAdjustment: -4321 } })),
    buildPrepRow(input({ userId: "3", name: "다", nameKatakana: "ダ", setting: s({ withholdingClass: "otsu", paymentMethod: "cash" }), paidMinutes: 6000, workDays: 15, rateSegments: [seg(1200, 6000)], manual: { ...EMPTY_PREP_MANUAL, prevAdjustment: 1500, prevAdjustmentKind: "commute", prevAdjustmentYm: "2026-09" } })),
    buildPrepRow(input({ userId: "4", name: "라", nameKatakana: "ラ", setting: s({ withholdingClass: "hei", paymentMethod: "cash" }), paidMinutes: 960, workDays: 2, rateSegments: [seg(1200, 960)], dailyTaxable: [9600, 9600] })),
    buildPrepRow(input({ userId: "5", name: "마", nameKatakana: "マ", setting: s({ withholdingClass: null }), paidMinutes: 3000, workDays: 8, rateSegments: [seg(1200, 3000)] })),
    buildPrepRow(input({ userId: "6", name: "바", nameKatakana: "バ", paidMinutes: 6000, workDays: 15, rateSegments: [seg(1250, 6000)], manual: { ...EMPTY_PREP_MANUAL, withholdingOverride: 777, withholdingOverrideReason: "x" } })),
    buildPrepRow(input({ userId: "7", name: "사", nameKatakana: "サ", paidMinutes: 30000, workDays: 25, rateSegments: [seg(3000, 30000)] })),
    buildPrepRow(input({ userId: "8", name: "아", nameKatakana: "ア", paidMinutes: 7333, workDays: 17, rateSegments: [seg(1201, 2333), seg(1251, 3000), seg(1301, 2000)], allowanceRegular: 3000, allowanceSpecial: 1500, manual: { ...EMPTY_PREP_MANUAL, prevAdjustment: -2500, prevAdjustmentYm: "2026-08", overtime: 1000, memo: "메모" } })),
    buildPrepRow(input({ userId: "9", name: "자", nameKatakana: "ジャ", setting: s({ withholdingClass: "otsu" }), paidMinutes: 7777, workDays: 18, rateSegments: [seg(1333, 7777)] })),
  ];
}

describe("rich sample", () => {
  it("입력 시트 값 — P · Q · V · Z 가 칸 합과 같고 AB == CEILING(Q−Z)", () => {
    const rows = rich();
    const sheets = buildPayrollBook({ ym: "2026-10", paydayDate: "2026-11-10", companyName: "テスト", taxYear: 2026, rows });
    for (const name of [SHEET.cashInput, SHEET.transferInput]) {
      const sh = sheets.find((x) => x.name === name)!;
      const n = (a: string) => {
        const v = sh.cells.get(a)?.v;
        return typeof v === "number" ? v : 0;
      };
      for (let r = 3; r <= sh.maxRow; r++) {
        if (!sh.cells.get(`B${r}`)?.v) continue;
        const p = n(`F${r}`) + n(`I${r}`) + ["J", "K", "L", "M", "N"].reduce((a, c) => a + n(`${c}${r}`), 0);
        expect(n(`P${r}`), `${name} P${r}`).toBe(p);
        expect(n(`Q${r}`), `${name} Q${r}`).toBe(p + n(`O${r}`));
        expect(n(`V${r}`)).toBe(["R", "S", "T", "U"].reduce((a, c) => a + n(`${c}${r}`), 0));
        expect(n(`Z${r}`)).toBe(["V", "W", "X", "Y"].reduce((a, c) => a + n(`${c}${r}`), 0));
        const ab = sh.cells.get(`AB${r}`)!;
        if (ab.v !== "") expect(ab.v).toBe(Math.ceil((n(`Q${r}`) - n(`Z${r}`)) / 10) * 10);
      }
    }
    const out = process.env.PAYROLL_EXPORT_OUT;
    if (out) {
      return import("@/lib/payroll-export/render-xlsx").then(async ({ renderWorkbookBase64 }) => {
        writeFileSync(`${out}/rich.xlsx`, Buffer.from(await renderWorkbookBase64(sheets), "base64"));
        writeFileSync(`${out}/rich-tax.xlsx`, Buffer.from(await renderWorkbookBase64(buildTaxAccountantBook({ ym: "2026-10", rows })), "base64"));
        writeFileSync(`${out}/rich.html`, buildSheetsHtml({ title: "t", sheets: sheets.filter((x) => [SHEET.owner, SHEET.check, SHEET.cashSlip, SHEET.transferSlip].includes(x.name as never)), printLabel: "Print", lang: "ja" }));
      });
    }
  });
});

describe("P5 — 결재 도장 · 지급 확인", () => {
  it("결재 도장은 사장 확인표 G3 · H3, 지급 체크는 지급 확인 목록 「済」", () => {
    const rows = sample();
    const cash = rows.find((r) => r.paymentMethod === "cash")!;
    const transfer = rows.find((r) => r.paymentMethod === "transfer")!;
    const sheets = buildPayrollBook({
      ym: "2026-10",
      paydayDate: "2026-11-10",
      companyName: "テスト株式会社",
      taxYear: 2026,
      rows,
      stamps: { senmu: null, president: { name: "가명", at: "2026-11-05T01:00:00Z" } },
      checks: {
        [cash.userId]: { envelope: true, received: true, transfer: false },
        [transfer.userId]: { envelope: false, received: false, transfer: true },
      },
    });
    const owner = sheets.find((s) => s.name === SHEET.owner)!;
    expect(owner.cells.get("G3")?.v ?? null).toBeNull();
    expect(owner.cells.get("H3")?.v).toBe("가명\n11/5");
    const check = sheets.find((s) => s.name === SHEET.check)!;
    const rowOf = (name: string) =>
      [...check.cells.entries()].find(([k, c]) => k.startsWith("C") && c.v === name)![0].slice(1);
    const cr = rowOf(cash.name);
    const tr = rowOf(transfer.name);
    expect(check.cells.get(`H${cr}`)?.v).toBe("済");
    expect(check.cells.get(`I${cr}`)?.v).toBe("済");
    expect(check.cells.get(`H${tr}`)?.v).toBe("済");
    expect(check.cells.get(`I${tr}`)?.v ?? null).toBeNull();
  });
});
