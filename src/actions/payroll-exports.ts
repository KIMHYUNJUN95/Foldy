"use server";

import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { buildAdminExportMeta } from "@/lib/admin-export-meta";
import type { AdminReportExportResult, AdminWorkbookExportResult } from "@/lib/admin-export-result";
import { payrollPrepAvailable } from "@/lib/payroll-prep";
import { getPayrollPrep, type PayrollPrepData } from "@/lib/payroll-prep-server";
import {
  buildPayrollBook,
  buildPayslipSheets,
  payrollBookFilename,
  payrollTitle,
  payslipFilename,
  SHEET,
} from "@/lib/payroll-export/payroll-book";
import { buildTaxAccountantBook, taxAccountantFilename } from "@/lib/payroll-export/tax-accountant-book";
import { renderWorkbookBase64 } from "@/lib/payroll-export/render-xlsx";
import { buildSheetsHtml } from "@/lib/payroll-export/render-html";

/**
 * 알바 급여 P4 — 급여 준비 값으로 만드는 출력 파일(PC 근태 › 급여 · 모바일 급여 준비가 같이 부른다 → src/actions).
 * - 급여 엑셀 `新アルバイト給与管理YYYYMMDD.xlsx` + PDF(사장 확인표 · 지급 확인 목록 · 명세서)
 * - 세무사 엑셀 `アルバイト給与一覧YYYYMMDD(税理士用).xlsx` + PDF
 * - 고른 사람 명세서만 `給与明細_YYYY年M月分_….xlsx` + PDF(PC 사람 패널 · 여러 명 고르기, 모바일 「명세서만 뽑기」)
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
    stamps: {
      senmu: data.round.senmu?.approvedAt
        ? { name: data.round.senmu.approvedByName, at: data.round.senmu.approvedAt }
        : null,
      president: data.round.president.approvedAt
        ? { name: data.round.president.approvedByName, at: data.round.president.approvedAt }
        : null,
    },
    checks: Object.fromEntries(
      Object.entries(data.round.checks).map(([userId, c]) => [
        userId,
        { envelope: Boolean(c.envelopeAt), received: Boolean(c.receivedAt), transfer: Boolean(c.transferredAt) },
      ]),
    ),
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

/** 고른 사람만 — 그 달 급여 준비에 있는 사람만 받는다(다른 조직 · 다른 달 사람 id 는 버림). */
async function loadPicked(ym: string, userIds: readonly string[]) {
  if (!Array.isArray(userIds) || userIds.length === 0 || userIds.length > 500) return { ok: false as const, reason: "error" as const };
  const r = await load(ym);
  if (!r.ok) return r;
  const want = new Set(userIds.filter((id): id is string => typeof id === "string"));
  const rows = r.data.rows.filter((row) => want.has(row.userId));
  if (rows.length === 0) return { ok: false as const, reason: "empty" as const };
  const sheets = buildPayslipSheets({
    ym: r.data.ym,
    paydayDate: r.data.payday.date,
    companyName: r.data.companyName,
    rows,
  });
  return { ok: true as const, data: r.data, rows, sheets, printLabel: r.printLabel };
}

export async function exportPayslipsWorkbook(ym: string, userIds: string[]): Promise<AdminWorkbookExportResult> {
  try {
    const r = await loadPicked(ym, userIds);
    if (!r.ok) return r;
    const base64 = await renderWorkbookBase64(r.sheets);
    return { ok: true, filename: payslipFilename(r.data.ym, r.rows), base64, rowCount: r.rows.length };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function exportPayslipsReport(ym: string, userIds: string[]): Promise<AdminReportExportResult> {
  try {
    const r = await loadPicked(ym, userIds);
    if (!r.ok) return r;
    const html = buildSheetsHtml({
      title: payslipFilename(r.data.ym, r.rows).replace(/\.xlsx$/, ""),
      sheets: r.sheets,
      printLabel: r.printLabel,
      lang: "ja",
    });
    return { ok: true, html, rowCount: r.rows.length };
  } catch {
    return { ok: false, reason: "error" };
  }
}
