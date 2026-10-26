// 근태 — 확정분만 대상인 급여 내보내기 (13단계).
//
// 확정된 급여만 내보내는 권한 필요 기능 (owner / attendance_payroll_admin) — 월 일괄 또는
// 개인별. 초안 / 재개 / 미해결 / 미확정 스냅샷은 절대 포함하지 않는다. 내보낼 때마다
// `attendance_export_logs` 감사 행을 남긴다.
//
// 구버전 / 대체됨 (2026-07-03): 실제 최종 내보내기는 관리자 급여 검토 페이지의 월별 + 사용자별 **Excel 통합문서
// + PDF** 이다 (attendance-payroll-workbook.ts, attendance-payroll-report.ts,
// attendance-user-payroll-export.ts 참고). 이 CSV 경로는 하위 호환 기반(구조화된 행
// + 감사 로그)으로 남겨 두었고 개발용 테스트 라우트에서는 여전히 실행되지만, 대시보드 UI 에는 연결되어 있지 않다.
// 깔끔한 구조화 CSV(UTF-8 BOM 이라 Excel 에서 한국어가 정상으로 열림)를 만들며 열이 1:1로 대응한다
// 문서화된 확정 스냅샷 필드에 맞춘다. 행 빌더는 직렬화기와 분리해 둔다.

import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { attendanceCan } from "@/lib/attendance-review";
import { monthFirstDay } from "@/lib/attendance-finalization";

type Service = ReturnType<typeof getSupabaseServiceClient>;
const TZ = "Asia/Tokyo";

export type ExportScope = "monthly_bulk" | "single_user";

export type PayrollExportResult =
  | { ok: true; filename: string; csv: string; logId: string; rowCount: number; snapshotIds: string[] }
  | { ok: false; reason: "forbidden" | "invalid" | "not_finalized" | "empty" | "error" };

type FinalizedSnapshotRow = {
  id: string;
  user_id: string;
  target_month: string;
  total_paid_minutes: number;
  gross_amount: number;
  rate_breakdown: unknown;
  finalized_by_user_id: string | null;
  finalized_at: string | null;
};

type ExportRow = {
  targetMonth: string; // YYYY-MM
  userName: string;
  userId: string;
  paidMinutes: number;
  paidHm: string; // "H:MM"
  grossAmount: number;
  rateBreakdown: string;
  finalizedBy: string;
  finalizedAt: string;
};

function hm(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function tokyoLabel(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** "¥1200×120분=¥2,400 | ¥1500×60분=¥1,500" from a snapshot's rate_breakdown jsonb. */
function formatRateBreakdown(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  return raw
    .map((seg) => {
      const r = seg as { rate?: number; paidMinutes?: number; gross?: number };
      const rate = Number(r.rate ?? 0).toLocaleString("ko-KR");
      const mins = Number(r.paidMinutes ?? 0);
      const gross = Number(r.gross ?? 0).toLocaleString("ko-KR");
      return `¥${rate}×${mins}분=¥${gross}`;
    })
    .join(" | ");
}

async function loadNames(service: Service, userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return map;
  const res = await service.from("profiles").select("id, name").in("id", ids);
  for (const r of (res.data ?? []) as { id: string; name: string }[]) map.set(r.id, r.name);
  return map;
}

async function buildRows(
  service: Service,
  snapshots: FinalizedSnapshotRow[],
): Promise<ExportRow[]> {
  const names = await loadNames(service, [
    ...snapshots.map((s) => s.user_id),
    ...snapshots.map((s) => s.finalized_by_user_id ?? ""),
  ]);
  return snapshots.map((s) => ({
    targetMonth: s.target_month.slice(0, 7),
    userName: names.get(s.user_id) ?? "—",
    userId: s.user_id,
    paidMinutes: s.total_paid_minutes,
    paidHm: hm(s.total_paid_minutes),
    grossAmount: Number(s.gross_amount),
    rateBreakdown: formatRateBreakdown(s.rate_breakdown),
    finalizedBy: s.finalized_by_user_id ? (names.get(s.finalized_by_user_id) ?? "—") : "",
    finalizedAt: tokyoLabel(s.finalized_at),
  }));
}

const CSV_HEADERS = [
  "대상월",
  "직원",
  "직원ID",
  "유급(분)",
  "유급시간",
  "총급여(원)",
  "시급구간",
  "확정자",
  "확정시각",
];

function csvCell(value: string | number): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** UTF-8 BOM 이 붙은 구조화 CSV (Excel 이 한국어를 읽도록). 최종 템플릿이 나올 때까지의 임시 형식. */
function toCsv(rows: ExportRow[]): string {
  const lines = [CSV_HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.targetMonth,
        r.userName,
        r.userId,
        r.paidMinutes,
        r.paidHm,
        r.grossAmount,
        r.rateBreakdown,
        r.finalizedBy,
        r.finalizedAt,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

/**
 * 확정분만 대상인 급여 내보내기를 실행한다. 권한은 여기서 강제한다 (owner / attendance_payroll_admin).
 * `monthly_bulk` 는 그 달의 확정된 모든 사용자-월 스냅샷을, `single_user` 는
 * 그 사용자-월의 확정 스냅샷 하나를 모은다. `attendance_export_logs` 감사 행을 남긴다.
 */
export async function runPayrollExport(
  service: Service,
  organizationId: string,
  actorId: string,
  params: { scope: ExportScope; ym: string; userId?: string },
): Promise<PayrollExportResult> {
  if (!(await attendanceCan(service, organizationId, actorId, "payroll.view"))) {
    return { ok: false, reason: "forbidden" };
  }
  if (!/^\d{4}-\d{2}$/.test(params.ym)) return { ok: false, reason: "invalid" };
  if (params.scope === "single_user" && !params.userId) return { ok: false, reason: "invalid" };

  const firstDay = monthFirstDay(params.ym);

  // 확정분만 — 초안/재개/대체된 것은 절대 포함하지 않는다.
  let query = service
    .from("attendance_month_snapshots")
    .select(
      "id, user_id, target_month, total_paid_minutes, gross_amount, rate_breakdown, finalized_by_user_id, finalized_at",
    )
    .eq("organization_id", organizationId)
    .eq("target_month", firstDay)
    .eq("status", "finalized");
  if (params.scope === "single_user") query = query.eq("user_id", params.userId as string);

  const res = await query.order("user_id", { ascending: true });
  if (res.error) return { ok: false, reason: "error" };
  const snapshots = (res.data ?? []) as FinalizedSnapshotRow[];

  if (snapshots.length === 0) {
    return { ok: false, reason: params.scope === "single_user" ? "not_finalized" : "empty" };
  }

  const rows = await buildRows(service, snapshots);
  const csv = toCsv(rows);
  const snapshotIds = snapshots.map((s) => s.id);
  const filename =
    params.scope === "single_user"
      ? `payroll_${params.ym}_${(params.userId as string).slice(0, 8)}.csv`
      : `payroll_${params.ym}_bulk.csv`;

  // 감사 행.
  const ins = (await service
    .from("attendance_export_logs")
    .insert({
      organization_id: organizationId,
      target_month: firstDay,
      export_scope: params.scope,
      user_id: params.scope === "single_user" ? (params.userId as string) : null,
      snapshot_ids: snapshotIds,
      exported_by_user_id: actorId,
      meta: { ym: params.ym, row_count: rows.length, filename, format: "csv" },
    })
    .select("id")
    .single()) as { data: { id: string } | null; error: { message: string } | null };
  if (ins.error || !ins.data) return { ok: false, reason: "error" };

  return { ok: true, filename, csv, logId: ins.data.id, rowCount: rows.length, snapshotIds };
}
