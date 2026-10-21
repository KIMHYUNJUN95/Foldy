"use server";

import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { buildAdminExportMeta, type AdminExportMeta } from "@/lib/admin-export-meta";
import type { AdminReportExportResult, AdminWorkbookExportResult } from "@/lib/admin-export-result";
import { buildAdminTableReportHtml } from "@/lib/admin-table-report";
import { buildAdminTableWorkbookBase64, type AdminTableColumn, type AdminTableSheet } from "@/lib/admin-table-workbook";
import { getMonthlyPayView } from "@/lib/attendance-pay";
import { attendanceCan } from "@/lib/attendance-review";
import { fill, getCleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import { computeCompare, devText } from "@/lib/cleaning-assign/compare";
import { loadCompareRows } from "@/lib/cleaning-assign/data";
import { isMonthKey } from "@/lib/cleaning-assign/day-state";
import { FLAG_THRESHOLD_OPTIONS } from "@/lib/cleaning-assign/rules";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { yen } from "@/components/admin/cleaning-assign/format";

/**
 * 청소 월 비교표 내보내기 — Excel · PDF(공용 템플릿, CLAUDE.md §4b). 화면과 같은 계산(`computeCompare`)을 서버에서 다시 한다 —
 * 클라이언트가 보낸 숫자를 믿지 않는다. 배정 담당이면서 급여를 볼 수 있는 사람만(비교표 화면과 같은 기준).
 * docs/product/37-cleaning-shift-assignment.md 「4-4」
 */

type ExportInput = { ym: string; exclude: boolean; threshold: number };

const PATH = "/admin/cleaning-assign/compare";

async function buildSheet(input: ExportInput): Promise<{ meta: AdminExportMeta; sheet: AdminTableSheet } | "forbidden" | "invalid" | "empty"> {
  const session = await requireAdminPageSession({ nextPath: PATH });
  if (!session.capabilities.includes("cleaning.assign")) return "forbidden";
  const supabase = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  if (!(await attendanceCan(supabase, organizationId, session.user.id, "payroll.view"))) return "forbidden";
  if (!isMonthKey(input.ym) || !(FLAG_THRESHOLD_OPTIONS as readonly number[]).includes(input.threshold)) return "invalid";

  const meta = buildAdminExportMeta(session);
  const copy = getCleaningAssignCopy(meta.locale);
  const raw = await loadCompareRows(supabase, organizationId, input.ym, async (userId) => {
    const view = await getMonthlyPayView(organizationId, userId, input.ym, meta.locale);
    return { expectedGross: view.expectedGross, finalizedGross: view.finalization?.gross ?? null, totalPaidMinutes: view.finalization?.paidMinutes ?? view.totalPaidMinutes };
  });
  if (raw.length === 0) return "empty";
  const { avg, rows } = computeCompare(raw, Boolean(input.exclude));

  const signal = (row: (typeof rows)[number]) => {
    if (row.excluded === "trainee") return copy.sigTrainee;
    if (row.excluded === "staff") return copy.sigStaff;
    if (row.dev === null) return "";
    if (row.dev > input.threshold) return fill(copy.sigHigh, { n: row.dev });
    if (row.dev < -input.threshold) return fill(copy.sigLow, { n: Math.abs(row.dev) });
    return devText(row.dev);
  };

  const columns: AdminTableColumn[] = [
    { key: "name", label: copy.colName, width: 16, printWidth: 13, bold: true },
    { key: "days", label: copy.colDays, width: 9, printWidth: 7 },
    { key: "assigned", label: copy.colAssigned, width: 10, printWidth: 8 },
    { key: "cleaned", label: copy.colCleaned, width: 10, printWidth: 8 },
    { key: "hours", label: copy.colHours, width: 11, printWidth: 9 },
    { key: "pay", label: copy.colPay, width: 13, printWidth: 11 },
    { key: "perRoom", label: copy.colPerRoom, width: 13, printWidth: 11, bold: true },
    { key: "perMinutes", label: copy.colPerMinutes, width: 11, printWidth: 9 },
    { key: "signal", label: copy.colSignal, width: 30, printWidth: 22, wrap: true },
  ];

  return {
    meta,
    sheet: {
      sheetName: copy.compareTitle,
      title: copy.compareTitle,
      rangeLabel: `${input.ym} · ${copy.avgPerRoom} ${yen(avg)}`,
      colNoLabel: meta.shared.colNo,
      totalLabel: meta.shared.exportTotalLabel,
      columns,
      rows: rows.map((row) => ({
        assigned: String(row.assigned),
        cleaned: String(row.cleaned),
        days: fill(copy.daysUnit, { n: row.days }),
        hours: fill(copy.hoursUnit, { n: (row.paidMinutes / 60).toFixed(1) }),
        name: row.name,
        pay: yen(row.pay),
        perMinutes: row.perMinutes === null ? "" : `${row.perMinutes}${copy.minutesUnit}`,
        perRoom: row.perRoom === null ? "" : yen(row.perRoom),
        signal: signal(row),
      })),
    },
  };
}

export async function exportCompareWorkbook(input: ExportInput): Promise<AdminWorkbookExportResult> {
  try {
    const built = await buildSheet(input);
    if (built === "forbidden") return { ok: false, reason: "forbidden" };
    if (built === "invalid" || built === "empty") return { ok: false, reason: "empty" };
    const base64 = await buildAdminTableWorkbookBase64({ orgName: built.meta.orgName, generatedLabel: built.meta.generatedLabel, sheets: [built.sheet] });
    return { ok: true, filename: `cleaning-compare-${input.ym}.xlsx`, base64, rowCount: built.sheet.rows.length };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function exportCompareReport(input: ExportInput): Promise<AdminReportExportResult> {
  try {
    const built = await buildSheet(input);
    if (built === "forbidden") return { ok: false, reason: "forbidden" };
    if (built === "invalid" || built === "empty") return { ok: false, reason: "empty" };
    const html = buildAdminTableReportHtml({
      orgName: built.meta.orgName,
      generatedLabel: built.meta.generatedLabel,
      printLabel: built.meta.shared.exportPrint,
      localeTag: built.meta.localeTag,
      sheets: [built.sheet],
    });
    return { ok: true, html, rowCount: built.sheet.rows.length };
  } catch {
    return { ok: false, reason: "error" };
  }
}
