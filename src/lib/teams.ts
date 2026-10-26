import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

export type TeamKind = Database["public"]["Enums"]["team_kind"];
export type TeamRow = Pick<
  Database["public"]["Tables"]["teams"]["Row"],
  "id" | "name" | "kind"
>;

/**
 * 조직의 팀 (현장/사무실 소속). 현장 우선, 그다음 이름순으로 정렬되어 종류별 묶음이
 * 배정 드롭다운과 필터에서 깔끔하게 읽힌다. 다른 모든 비즈니스 읽기처럼 조직 범위다.
 */
export async function getOrgTeams(organizationId: string): Promise<TeamRow[]> {
  const { data } = await getSupabaseServiceClient()
    .from("teams")
    .select("id, name, kind")
    .eq("organization_id", organizationId)
    .order("kind", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []) as TeamRow[];
}
