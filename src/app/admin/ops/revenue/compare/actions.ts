"use server";

import { requireAdminSession } from "@/lib/admin-session";
import { buildAdminExportMeta, type AdminExportMeta } from "@/lib/admin-export-meta";
import { tokyoToday } from "@/lib/tokyo-date";
import type { AdminReportExportResult, AdminWorkbookExportResult } from "@/lib/admin-export-result";
import { buildAdminTableReportHtml } from "@/lib/admin-table-report";
import { buildAdminTableWorkbookBase64, type AdminTableSheet } from "@/lib/admin-table-workbook";
import { getDictionary } from "@/lib/i18n";
import { canAccessOpsAdmin } from "@/lib/ops-admin";
import { changePctOrNull } from "@/lib/ops-revenue-compare";

// 공용 계약(CLAUDE.md §4b): 버튼은 <AdminExportButtons>, 워크북은 buildAdminTableWorkbookBase64,
// 인쇄본은 buildAdminTableReportHtml — 같은 입력 형태. 로케일은 서버가 세션에서 정한다.
// 숫자는 화면이 합계에 넣은 건물 기준으로 넘기고(화면과 같은 숫자), 글자 모양은 여기서 만든다.

export type OpsCompareExportSide = { revenue: number; occupied: number; available: number };

export type OpsCompareExportPayload = {
  aLabel: string;
  bLabel: string;
  total: { a: OpsCompareExportSide; b: OpsCompareExportSide };
  rows: Array<{ name: string; a: OpsCompareExportSide; b: OpsCompareExportSide }>;
};

function sheetsOf(payload: OpsCompareExportPayload, meta: AdminExportMeta): AdminTableSheet[] {
  const dict = getDictionary(meta.locale);
  const t = dict.opsRevenueCompare;
  const r = dict.opsRevenue;
  const tag = meta.localeTag;
  const yen = (v: number) => `¥${Math.round(v).toLocaleString(tag)}`;
  const n = (v: number) => Math.round(v).toLocaleString(tag);
  const occ = (s: OpsCompareExportSide) => (s.available > 0 ? (s.occupied / s.available) * 100 : null);
  const adr = (s: OpsCompareExportSide) => (s.occupied > 0 ? s.revenue / s.occupied : null);
  const revpar = (s: OpsCompareExportSide) => (s.available > 0 ? s.revenue / s.available : null);
  const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
  const change = (a: number | null, b: number | null) => {
    if (a === null || b === null) return r.newLabel;
    const d = changePctOrNull(a, b);
    return d === null ? r.newLabel : `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}%`;
  };
  const points = (a: number | null, b: number | null) =>
    a === null || b === null ? "—" : `${a - b >= 0 ? "+" : "−"}${Math.abs(a - b).toFixed(1)}${r.pointSuffix}`;
  const money = (v: number | null) => (v === null ? "—" : yen(v));
  const diff = (a: number | null, b: number | null) => (a === null || b === null ? "—" : `${a - b >= 0 ? "+" : "−"}${yen(Math.abs(a - b))}`);
  const { a, b } = payload.total;
  const summary = [
    { change: change(a.revenue, b.revenue), diff: diff(a.revenue, b.revenue), metric: r.kpiRevenue, va: yen(a.revenue), vb: yen(b.revenue) },
    { change: points(occ(a), occ(b)), diff: points(occ(a), occ(b)), metric: r.kpiOccupancy, va: pct(occ(a)), vb: pct(occ(b)) },
    { change: change(a.occupied, b.occupied), diff: `${a.occupied - b.occupied >= 0 ? "+" : "−"}${n(Math.abs(a.occupied - b.occupied))}`, metric: t.kpiNights, va: n(a.occupied), vb: n(b.occupied) },
    { change: change(adr(a), adr(b)), diff: diff(adr(a), adr(b)), metric: r.kpiAdr, va: money(adr(a)), vb: money(adr(b)) },
    { change: change(revpar(a), revpar(b)), diff: diff(revpar(a), revpar(b)), metric: r.kpiRevpar, va: money(revpar(a)), vb: money(revpar(b)) },
  ];
  const range = `A ${payload.aLabel} · B ${payload.bLabel}`;
  return [
    {
      colNoLabel: meta.shared.colNo,
      columns: [
        { key: "metric", label: t.colMetric, printWidth: 24, width: 26, bold: true },
        { key: "va", label: `A · ${payload.aLabel}`, printWidth: 20, width: 20, bold: true },
        { key: "vb", label: `B · ${payload.bLabel}`, printWidth: 20, width: 20 },
        { key: "diff", label: t.colDiff, printWidth: 18, width: 18 },
        { key: "change", label: r.colChange, printWidth: 12, width: 12 },
      ],
      rangeLabel: range,
      rows: summary,
      sheetName: t.sheetSummary,
      title: `${r.title} · ${t.title} · ${t.sheetSummary}`,
      totalLabel: meta.shared.exportTotalLabel,
    },
    {
      colNoLabel: meta.shared.colNo,
      columns: [
        { key: "name", label: r.colProperty, printWidth: 18, width: 24, bold: true },
        { key: "ra", label: `A ${r.colRevenue}`, printWidth: 14, width: 16, bold: true },
        { key: "rb", label: `B ${r.colRevenue}`, printWidth: 14, width: 16 },
        { key: "rc", label: r.colChange, printWidth: 9, width: 10 },
        { key: "oa", label: `A ${r.colOccupancy}`, printWidth: 9, width: 10 },
        { key: "ob", label: `B ${r.colOccupancy}`, printWidth: 9, width: 10 },
        { key: "aa", label: `A ${r.colAdr}`, printWidth: 11, width: 12 },
        { key: "ab", label: `B ${r.colAdr}`, printWidth: 11, width: 12 },
      ],
      rangeLabel: range,
      rows: payload.rows.map((row) => ({
        aa: money(adr(row.a)),
        ab: money(adr(row.b)),
        name: row.name,
        oa: pct(occ(row.a)),
        ob: pct(occ(row.b)),
        ra: row.a.revenue ? yen(row.a.revenue) : "—",
        rb: row.b.revenue ? yen(row.b.revenue) : "—",
        rc: row.a.revenue && row.b.revenue ? change(row.a.revenue, row.b.revenue) : row.b.revenue ? t.tagClosed : t.tagNew,
      })),
      sheetName: t.sheetProperties,
      title: `${r.title} · ${t.title} · ${t.sheetProperties}`,
      totalLabel: meta.shared.exportTotalLabel,
      totals: {
        aa: money(adr(a)),
        ab: money(adr(b)),
        name: "",
        oa: pct(occ(a)),
        ob: pct(occ(b)),
        ra: yen(a.revenue),
        rb: yen(b.revenue),
        rc: change(a.revenue, b.revenue),
      },
    },
  ];
}

async function requireCompareExport() {
  const session = await requireAdminSession();
  return canAccessOpsAdmin(session) ? session : null;
}

export async function exportOpsCompareWorkbook(payload: OpsCompareExportPayload): Promise<AdminWorkbookExportResult> {
  const session = await requireCompareExport();
  if (!session) return { ok: false, reason: "error" };
  if (payload.rows.length === 0) return { ok: false, reason: "empty" };
  try {
    const meta = buildAdminExportMeta(session);
    const base64 = await buildAdminTableWorkbookBase64({ generatedLabel: meta.generatedLabel, orgName: meta.orgName, sheets: sheetsOf(payload, meta) });
    return { base64, filename: `revenue_compare_${tokyoToday().replace(/-/g, "")}.xlsx`, ok: true, rowCount: payload.rows.length };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function exportOpsCompareReport(payload: OpsCompareExportPayload): Promise<AdminReportExportResult> {
  const session = await requireCompareExport();
  if (!session) return { ok: false, reason: "error" };
  if (payload.rows.length === 0) return { ok: false, reason: "empty" };
  try {
    const meta = buildAdminExportMeta(session);
    const html = buildAdminTableReportHtml({
      generatedLabel: meta.generatedLabel,
      localeTag: meta.localeTag,
      orgName: meta.orgName,
      printLabel: meta.shared.exportPrint,
      sheets: sheetsOf(payload, meta),
    });
    return { html, ok: true, rowCount: payload.rows.length };
  } catch {
    return { ok: false, reason: "error" };
  }
}
