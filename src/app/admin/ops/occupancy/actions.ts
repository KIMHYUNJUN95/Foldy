"use server";

import { requireAdminSession } from "@/lib/admin-session";
import { buildAdminExportMeta, type AdminExportMeta } from "@/lib/admin-export-meta";
import { tokyoToday } from "@/lib/tokyo-date";
import type { AdminReportExportResult, AdminWorkbookExportResult } from "@/lib/admin-export-result";
import { buildAdminTableReportHtml } from "@/lib/admin-table-report";
import { buildAdminTableWorkbookBase64, type AdminTableSheet } from "@/lib/admin-table-workbook";
import { getDictionary } from "@/lib/i18n";
import { canAccessOpsAdmin } from "@/lib/ops-admin";
import { occupancyGrade } from "@/lib/ops-occupancy";

// 공용 계약(CLAUDE.md §4b): 버튼은 <AdminExportButtons>, 워크북은 buildAdminTableWorkbookBase64,
// 인쇄본은 buildAdminTableReportHtml — 같은 입력 형태. 로케일은 서버가 세션에서 정한다.
// 숫자는 화면이 합계에 넣은 건물 기준으로 넘기고(화면과 같은 숫자), 글자 모양은 여기서 만든다.

export type OpsOccupancyExportRow = {
  name: string;
  occupied: number;
  available: number;
  /** 전년 같은 기간 가동률(%) — 없으면 `null`. */
  previousPct: number | null;
};

export type OpsOccupancyExportPayload = {
  rangeLabel: string;
  rows: OpsOccupancyExportRow[];
  total: OpsOccupancyExportRow;
  /** 「객실 × 월」 — 12달. 값은 가동률(%), 문 열기 전은 `null`. */
  roomMonthLabels: string[];
  roomRangeLabel: string;
  rooms: Array<{ name: string; values: Array<number | null> }>;
  /** 「앞으로 6달」 — 건물마다 달별 잡힌 판매 박 · 전체 박. */
  forwardMonthLabels: string[];
  forwardLabel: string;
  forward: Array<{ name: string; cells: Array<{ occupied: number; available: number }> }>;
  forwardTotal: Array<{ occupied: number; available: number }>;
};

function sheetsOf(payload: OpsOccupancyExportPayload, meta: AdminExportMeta): AdminTableSheet[] {
  const dict = getDictionary(meta.locale);
  const t = dict.opsOccupancy;
  const r = dict.opsRevenue;
  const tag = meta.localeTag;
  const n = (value: number) => value.toLocaleString(tag);
  const pctOf = (occupied: number, available: number) => (available > 0 ? (occupied / available) * 100 : null);
  const pct = (value: number | null) => (value === null ? "—" : `${value.toFixed(1)}%`);
  const gradeLabel = (value: number | null) => {
    if (value === null) return "—";
    return { excellent: t.gradeExcellent, fair: t.gradeFair, good: t.gradeGood, poor: t.gradePoor }[occupancyGrade(value)];
  };
  const line = (row: OpsOccupancyExportRow) => {
    const current = pctOf(row.occupied, row.available);
    const change =
      current === null || row.previousPct === null
        ? r.newLabel
        : `${current - row.previousPct >= 0 ? "+" : "−"}${Math.abs(current - row.previousPct).toFixed(1)}${r.pointSuffix}`;
    return {
      change,
      grade: gradeLabel(current),
      name: row.name,
      nights: `${n(row.occupied)} / ${n(row.available)}`,
      occupancy: pct(current),
      previous: pct(row.previousPct),
      vacant: n(Math.max(0, row.available - row.occupied)),
    };
  };
  const monthColumns = (labels: string[], prefix: string, total: number) =>
    labels.map((label, index) => ({ key: `${prefix}${index}`, label, printWidth: Math.floor(total / Math.max(1, labels.length)), width: 10 }));

  return [
    {
      colNoLabel: meta.shared.colNo,
      columns: [
        { key: "name", label: r.colProperty, printWidth: 22, width: 24, bold: true },
        { key: "occupancy", label: r.colOccupancy, printWidth: 12, width: 12, bold: true },
        { key: "nights", label: t.colNights, printWidth: 16, width: 16 },
        { key: "vacant", label: t.colVacant, printWidth: 10, width: 10 },
        { key: "previous", label: r.colLastYear, printWidth: 12, width: 12 },
        { key: "change", label: r.colChange, printWidth: 12, width: 12 },
        { key: "grade", label: t.colGrade, printWidth: 10, width: 10 },
      ],
      rangeLabel: payload.rangeLabel,
      rows: payload.rows.map(line),
      sheetName: t.sheetProperties,
      title: `${t.title} · ${t.sheetProperties}`,
      totalLabel: meta.shared.exportTotalLabel,
      totals: { ...line(payload.total), name: "" },
    },
    {
      colNoLabel: meta.shared.colNo,
      columns: [{ key: "name", label: r.colRoom, printWidth: 16, width: 26, bold: true }, ...monthColumns(payload.roomMonthLabels, "m", 84)],
      rangeLabel: payload.roomRangeLabel,
      rows: payload.rooms.map((room) => ({
        name: room.name,
        ...Object.fromEntries(room.values.map((value, index) => [`m${index}`, value === null ? "—" : `${Math.round(value)}%`])),
      })),
      sheetName: t.sheetRooms,
      title: `${t.title} · ${t.sheetRooms}`,
      totalLabel: meta.shared.exportTotalLabel,
    },
    {
      colNoLabel: meta.shared.colNo,
      columns: [{ key: "name", label: r.colProperty, printWidth: 22, width: 24, bold: true }, ...monthColumns(payload.forwardMonthLabels, "f", 78)],
      rangeLabel: payload.forwardLabel,
      rows: payload.forward.map((row) => ({
        name: row.name,
        ...Object.fromEntries(
          row.cells.map((cell, index) => [`f${index}`, `${pct(pctOf(cell.occupied, cell.available))} · ${n(Math.max(0, cell.available - cell.occupied))}`]),
        ),
      })),
      sheetName: t.sheetForward,
      title: `${t.title} · ${t.sheetForward} (${r.colOccupancy} · ${t.colVacant})`,
      totalLabel: meta.shared.exportTotalLabel,
      totals: Object.fromEntries(
        payload.forwardTotal.map((cell, index) => [`f${index}`, `${pct(pctOf(cell.occupied, cell.available))} · ${n(Math.max(0, cell.available - cell.occupied))}`]),
      ),
    },
  ];
}

async function requireOccupancyExport() {
  const session = await requireAdminSession();
  return canAccessOpsAdmin(session) ? session : null;
}

export async function exportOpsOccupancyWorkbook(payload: OpsOccupancyExportPayload): Promise<AdminWorkbookExportResult> {
  const session = await requireOccupancyExport();
  if (!session) return { ok: false, reason: "error" };
  if (payload.rows.length === 0) return { ok: false, reason: "empty" };
  try {
    const meta = buildAdminExportMeta(session);
    const base64 = await buildAdminTableWorkbookBase64({
      generatedLabel: meta.generatedLabel,
      orgName: meta.orgName,
      sheets: sheetsOf(payload, meta),
    });
    return {
      base64,
      filename: `occupancy_${tokyoToday().replace(/-/g, "")}.xlsx`,
      ok: true,
      rowCount: payload.rows.length,
    };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function exportOpsOccupancyReport(payload: OpsOccupancyExportPayload): Promise<AdminReportExportResult> {
  const session = await requireOccupancyExport();
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
