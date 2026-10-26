import type { AppSession } from "@/lib/session";
import { getTimestampRange, type RequestDateFilter } from "@/lib/request-filters";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import type { MaintenanceStatus } from "@/lib/maintenance-constants";

export type MaintenanceReportRow =
  Database["public"]["Tables"]["maintenance_reports"]["Row"];

// 도메인 상수는 클라이언트 안전 모듈에 둔다 (이 모듈은 서버 Supabase 클라이언트를 끌어오고,
// 그러면 이를 쓰는 클라이언트 컴포넌트에 `next/headers` 가 딸려 온다). 기존 호출처를 위해 다시 내보낸다.
export {
  maintenanceCategories,
  maintenancePriorities,
  maintenanceStatuses,
  isMaintenanceCategory,
  isMaintenancePriority,
  isMaintenanceStatus,
  isMaintenanceTerminal,
  MAINTENANCE_AGING_HOURS,
  MAINTENANCE_RESOLUTION_IMAGE_LIMIT,
  type MaintenanceCategory,
  type MaintenancePriority,
  type MaintenanceStatus,
} from "@/lib/maintenance-constants";

export type MaintenanceReportWithReporter = MaintenanceReportRow & {
  reporter_name: string;
  /** 완료/무효를 실제로 처리한 사람. 아직 처리 전이면 null. */
  completed_by_name: string | null;
};

type ProfileName = { id: string; name: string };

type MaintenanceReportFilters = RequestDateFilter & {
  status?: MaintenanceStatus;
};

// 신고자 + 완료 처리자 이름을 한 번의 profiles 조회로 붙인다 (PostgREST join 대신 배치 조회 —
// 이 코드베이스의 기존 패턴).
async function attachNames(
  items: MaintenanceReportRow[],
): Promise<MaintenanceReportWithReporter[]> {
  if (items.length === 0) return [];
  const supabase = await getSupabaseServerClient();
  const ids = new Set<string>();
  for (const item of items) {
    ids.add(item.reported_by_user_id);
    if (item.completed_by) ids.add(item.completed_by);
  }
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, name")
    .in("id", [...ids]);
  const names = new Map(
    ((profiles ?? []) as ProfileName[]).map((p) => [p.id, p.name] as const),
  );
  return items.map((item) => ({
    ...item,
    reporter_name: names.get(item.reported_by_user_id) ?? "",
    completed_by_name: item.completed_by ? (names.get(item.completed_by) ?? null) : null,
  }));
}

export async function getOrgMaintenanceReports(
  session: AppSession,
  filters: MaintenanceReportFilters = {},
): Promise<MaintenanceReportWithReporter[]> {
  const supabase = await getSupabaseServerClient();
  const range = getTimestampRange(filters);
  let query = supabase
    .from("maintenance_reports")
    .select("*")
    .eq("organization_id", session.organization.id);
  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  if (range.from) {
    query = query.gte("created_at", range.from);
  }
  if (range.to) {
    query = query.lt("created_at", range.to);
  }
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return attachNames((data ?? []) as MaintenanceReportRow[]);
}

export async function getMaintenanceReportById(
  session: AppSession,
  id: string,
): Promise<MaintenanceReportWithReporter | null> {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase
    .from("maintenance_reports")
    .select("*")
    .eq("id", id)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (!data) return null;
  const [withNames] = await attachNames([data as MaintenanceReportRow]);
  return withNames ?? null;
}

export async function getMyMaintenanceReportById(
  session: AppSession,
  id: string,
): Promise<MaintenanceReportRow | null> {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase
    .from("maintenance_reports")
    .select("*")
    .eq("id", id)
    .eq("organization_id", session.organization.id)
    .eq("reported_by_user_id", session.user.id)
    .maybeSingle();
  return (data as MaintenanceReportRow | null) ?? null;
}

export async function getMyMaintenanceReports(
  session: AppSession,
  filters: RequestDateFilter = {},
): Promise<MaintenanceReportRow[]> {
  const supabase = await getSupabaseServerClient();
  const range = getTimestampRange(filters);
  let query = supabase
    .from("maintenance_reports")
    .select("*")
    .eq("organization_id", session.organization.id)
    .eq("reported_by_user_id", session.user.id);
  if (range.from) {
    query = query.gte("created_at", range.from);
  }
  if (range.to) {
    query = query.lt("created_at", range.to);
  }
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as MaintenanceReportRow[];
}
