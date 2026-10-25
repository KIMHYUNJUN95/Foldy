"use server";

import { getCurrentAppSession, hasOrganizationContext, type AppSession } from "@/lib/session";
import { buildAdminExportMeta, type AdminExportMeta } from "@/lib/admin-export-meta";
import type { AdminReportExportResult, AdminWorkbookExportResult } from "@/lib/admin-export-result";
import { buildAdminTableReportHtml } from "@/lib/admin-table-report";
import { buildAdminTableWorkbookBase64, type AdminTableSheet } from "@/lib/admin-table-workbook";
import { fillCopy } from "@/lib/payroll-settings-i18n";
import { getPayrollPrepCopy } from "@/lib/payroll-prep-i18n";
import { payrollPrepAvailable } from "@/lib/payroll-prep";
import { getPayrollPrep } from "@/lib/payroll-prep-server";
import { formatPrepMonth, formatPrepTime } from "@/components/admin/attendance/payroll-prep/prep-format";

// 급여 준비 표 내보내기 — Excel + PDF 한 쌍(CLAUDE.md 4b). 권한 payroll.view, 로케일은 서버에서 정한다.

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

async function buildSheet(
  session: AppSession,
  meta: AdminExportMeta,
  ym: string,
): Promise<{ sheet: AdminTableSheet; count: number } | "forbidden" | "empty"> {
  const data = await getPayrollPrep(session, ym);
  if (!data.canView) return "forbidden";
  if (data.rows.length === 0) return "empty";
  const copy = getPayrollPrepCopy(meta.locale);
  const money = new Intl.NumberFormat(meta.localeTag);
  const num = (n: number | null) => (n == null ? "—" : money.format(n));
  const methodLabel = (m: string | null) => (m === "transfer" ? copy.transfer : m === "cash" ? copy.cash : "—");
  const t = data.totals;

  const sheet: AdminTableSheet = {
    sheetName: copy.stepPrep,
    title: fillCopy(copy.title, { month: formatPrepMonth(ym, meta.localeTag) }),
    colNoLabel: meta.shared.colNo,
    totalLabel: meta.shared.exportTotalLabel,
    columns: [
      { key: "name", label: copy.colName, width: 18, printWidth: 15 },
      { key: "method", label: copy.filterLabel, width: 10, printWidth: 8 },
      { key: "hours", label: copy.colHours, width: 9, printWidth: 8, bold: true },
      { key: "base", label: copy.colBasePay, width: 13, printWidth: 12, bold: true },
      { key: "adj", label: copy.colAdjustments, width: 13, printWidth: 11, bold: true },
      { key: "commute", label: copy.colCommute, width: 11, printWidth: 10, bold: true },
      { key: "gross", label: copy.colGross, width: 13, printWidth: 12, bold: true },
      { key: "tax", label: copy.colWithholding, width: 11, printWidth: 10, bold: true },
      { key: "net", label: copy.colNet, width: 13, printWidth: 12, bold: true },
    ],
    rows: data.rows.map((r) => ({
      name: r.name,
      method: methodLabel(r.paymentMethod),
      hours: formatPrepTime(r.paidMinutes),
      base: num(r.basePay),
      adj: r.adjustments === 0 ? "—" : num(r.adjustments),
      commute: num(r.commute),
      gross: num(r.gross),
      tax: num(r.withholding),
      net: num(r.net),
    })),
    totals: {
      name: fillCopy(copy.people, { n: t.people }),
      hours: formatPrepTime(t.paidMinutes),
      base: num(t.basePay),
      adj: num(t.adjustments),
      commute: num(t.commute),
      gross: num(t.gross),
      tax: num(t.withholding),
      net: num(t.net),
    },
  };
  return { sheet, count: data.rows.length };
}

type Resolved =
  | { ok: true; meta: AdminExportMeta; sheet: AdminTableSheet; count: number }
  | { ok: false; reason: "forbidden" | "empty" | "error" };

async function resolve(ym: string): Promise<Resolved> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  if (typeof ym !== "string" || !YM_RE.test(ym) || !payrollPrepAvailable(ym)) return { ok: false, reason: "error" };
  const meta = buildAdminExportMeta(session);
  const built = await buildSheet(session, meta, ym);
  if (typeof built === "string") return { ok: false, reason: built };
  return { ok: true, meta, ...built };
}

export async function exportPayrollPrepWorkbook(ym: string): Promise<AdminWorkbookExportResult> {
  try {
    const r = await resolve(ym);
    if (!r.ok) return { ok: false, reason: r.reason };
    const base64 = await buildAdminTableWorkbookBase64({
      orgName: r.meta.orgName,
      generatedLabel: r.meta.generatedLabel,
      sheets: [r.sheet],
    });
    return { ok: true, filename: `payroll-prep_${ym.replace("-", "")}.xlsx`, base64, rowCount: r.count };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function exportPayrollPrepReport(ym: string): Promise<AdminReportExportResult> {
  try {
    const r = await resolve(ym);
    if (!r.ok) return { ok: false, reason: r.reason };
    const html = buildAdminTableReportHtml({
      orgName: r.meta.orgName,
      generatedLabel: r.meta.generatedLabel,
      printLabel: r.meta.shared.exportPrint,
      localeTag: r.meta.localeTag,
      sheets: [r.sheet],
    });
    return { ok: true, html, rowCount: r.count };
  } catch {
    return { ok: false, reason: "error" };
  }
}
