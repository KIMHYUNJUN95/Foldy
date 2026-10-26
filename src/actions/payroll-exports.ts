"use server";

import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { buildAdminExportMeta } from "@/lib/admin-export-meta";
import type { AdminReportExportResult, AdminWorkbookExportResult } from "@/lib/admin-export-result";
import { payrollPrepAvailable } from "@/lib/payroll-prep";
import { getPayrollPrep, type PayrollPrepData } from "@/lib/payroll-prep-server";
import { buildPayrollBook, payrollBookFilename, payrollTitle, SHEET } from "@/lib/payroll-export/payroll-book";
import { buildTaxAccountantBook, taxAccountantFilename } from "@/lib/payroll-export/tax-accountant-book";
import { renderWorkbookBase64 } from "@/lib/payroll-export/render-xlsx";
import { buildSheetsHtml } from "@/lib/payroll-export/render-html";

/**
 * 알바 급여 P4 — 급여 준비 값으로 만드는 출력 파일(PC 근태 › 급여 · 모바일 급여 준비가 같이 부른다 → src/actions).
 * - 급여 엑셀 `新アルバイト給与管理YYYYMMDD.xlsx` + PDF(사장 확인표 · 지급 확인 목록 · 명세서)
 * - 세무사 엑셀 `アルバイト給与一覧YYYYMMDD(税理士用).xlsx` + PDF
 * 권한 `payroll.view`. 막히면 redirect 대신 `forbidden`. 양식 글은 원래 엑셀대로 일본어(로케일과 무관),
 * 인쇄 버튼 글만 사용자 언어. docs/product/39 §6.
 */

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

type Loaded =
  | { ok: true; data: PayrollPrepData; printLabel: string }
  | { ok: false; reason: "forbidden" | "empty" | "error" };

async function load(ym: string): Promise<Loaded> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  if (typeof ym !== "string" || !YM_RE.test(ym) || !payrollPrepAvailable(ym)) return { ok: false, reason: "error" };
  const data = await getPayrollPrep(session, ym);
  if (!data.canView) return { ok: false, reason: "forbidden" };
  if (data.rows.length === 0) return { ok: false, reason: "empty" };
  return { ok: true, data, printLabel: buildAdminExportMeta(session).shared.exportPrint };
}

function bookOf(data: PayrollPrepData) {
  return buildPayrollBook({
    ym: data.ym,
    paydayDate: data.payday.date,
    companyName: data.companyName,
    taxYear: Number(data.payday.date.slice(0, 4)),
    rows: data.rows,
  });
}

export async function exportPayrollBookWorkbook(ym: string): Promise<AdminWorkbookExportResult> {
  try {
    const r = await load(ym);
    if (!r.ok) return r;
    const base64 = await renderWorkbookBase64(bookOf(r.data));
    return { ok: true, filename: payrollBookFilename(r.data.payday.date), base64, rowCount: r.data.rows.length };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** 인쇄용 — 사장 확인표 · 지급 확인 목록 · 명세서(현금 → 이체, 한 장에 2명). 입력 시트 · 세금표는 빼고. */
export async function exportPayrollBookReport(ym: string): Promise<AdminReportExportResult> {
  try {
    const r = await load(ym);
    if (!r.ok) return r;
    const sheets = bookOf(r.data);
    const order = [SHEET.owner, SHEET.check, SHEET.cashSlip, SHEET.transferSlip];
    const pick = order
      .map((name) => sheets.find((s) => s.name === name))
      .filter((s): s is NonNullable<typeof s> => !!s && s.cells.size > 0 && s.maxRow > 0);
    const html = buildSheetsHtml({
      title: payrollTitle(r.data.ym, r.data.payday.date),
      sheets: pick,
      printLabel: r.printLabel,
      lang: "ja",
    });
    return { ok: true, html, rowCount: r.data.rows.length };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function exportTaxAccountantWorkbook(ym: string): Promise<AdminWorkbookExportResult> {
  try {
    const r = await load(ym);
    if (!r.ok) return r;
    const base64 = await renderWorkbookBase64(buildTaxAccountantBook({ ym: r.data.ym, rows: r.data.rows }));
    return { ok: true, filename: taxAccountantFilename(r.data.payday.date), base64, rowCount: r.data.rows.length };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function exportTaxAccountantReport(ym: string): Promise<AdminReportExportResult> {
  try {
    const r = await load(ym);
    if (!r.ok) return r;
    const html = buildSheetsHtml({
      title: taxAccountantFilename(r.data.payday.date).replace(/\.xlsx$/, ""),
      sheets: buildTaxAccountantBook({ ym: r.data.ym, rows: r.data.rows }),
      printLabel: r.printLabel,
      lang: "ja",
    });
    return { ok: true, html, rowCount: r.data.rows.length };
  } catch {
    return { ok: false, reason: "error" };
  }
}
