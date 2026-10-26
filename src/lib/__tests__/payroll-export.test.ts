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
  it("시트 9장 · 이름 · 파일 이름", () => {
    const names = book().map((s) => s.name);
    expect(names).toEqual([
      SHEET.guide,
      SHEET.settings,
      SHEET.cashInput,
      SHEET.transferInput,
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
    expect(ws.getColumn("AD").hidden).toBe(true);
    expect(wb.getWorksheet(SHEET.guide)!.state).toBe("hidden");
    const slip = wb.getWorksheet(SHEET.transferSlip)!;
    expect(slip.getCell("A1").isMerged).toBe(true);
    expect(slip.getCell("D2").border?.bottom?.style).toBe("thin");
  });

  it("인쇄 HTML — 명세서 2명마다 쪽 나눔", () => {
    const slip = book().find((s) => s.name === SHEET.transferSlip)!;
    const html = buildSheetsHtml({ title: "t", sheets: [slip], printLabel: "Print", lang: "ja" });
    expect(html).toContain("給与明細書");
    expect(html).toContain('colspan="4"');
  });
});
