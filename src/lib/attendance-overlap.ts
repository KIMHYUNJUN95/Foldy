// 같은 사람의 근무 시간 겹침 — 관리자 수동 추가 · 직접 수정 · 복구 · 정정 승인이 저장 전에 거른다(2026-10-19).
// 겹친 두 세션이 둘 다 급여에 들어가면 같은 시간이 두 번 지급된다. 무효(`invalid`) 세션은 급여에 안 들어가므로 보지 않는다.

import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

type Service = ReturnType<typeof getSupabaseServiceClient>;

export type OverlapCandidate = {
  clockInAt: string;
  /** null = 아직 퇴근 전(끝이 열려 있음). */
  clockOutAt: string | null;
};

export type OverlapExisting = {
  id: string;
  status: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
};

function endMs(clockOutAt: string | null, status: string, startMs: number): number {
  if (clockOutAt) return new Date(clockOutAt).getTime();
  // 근무 중 세션은 끝이 열려 있다. 퇴근 없이 넘어간(abandoned) 세션은 끝을 모르므로 출근 시각 한 점으로 본다 —
  // 끝없는 구간으로 보면 그 뒤로는 수동 추가가 전부 막힌다.
  return status === "open" || status === "reopened" ? Number.POSITIVE_INFINITY : startMs;
}

/** [출근, 퇴근) 이 겹치는 첫 기존 세션. 맞닿기만 한 것(앞 퇴근 = 뒤 출근)은 겹침이 아니다. */
export function findOverlappingSession<T extends OverlapExisting>(
  candidate: OverlapCandidate,
  existing: readonly T[],
  excludeSessionId?: string | null,
): T | null {
  const start = new Date(candidate.clockInAt).getTime();
  const end = candidate.clockOutAt ? new Date(candidate.clockOutAt).getTime() : Number.POSITIVE_INFINITY;
  for (const s of existing) {
    if (s.id === excludeSessionId || s.status === "invalid" || !s.clock_in_at) continue;
    const otherStart = new Date(s.clock_in_at).getTime();
    const otherEnd = endMs(s.clock_out_at, s.status, otherStart);
    const overlaps =
      otherEnd === otherStart
        ? start <= otherStart && otherStart < end
        : start < otherEnd && otherStart < end;
    if (overlaps) return s;
  }
  return null;
}

/** 그 사람의 다른 유효 세션 중 후보 구간과 겹치는 것이 있는가(읽기 실패면 null). 조직 범위로만 읽는다. */
export async function hasOverlappingSession(
  service: Service,
  organizationId: string,
  userId: string,
  candidate: OverlapCandidate,
  excludeSessionId?: string | null,
): Promise<boolean | null> {
  let closed = service
    .from("attendance_sessions")
    .select("id, status, clock_in_at, clock_out_at")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .neq("status", "invalid")
    .gt("clock_out_at", candidate.clockInAt);
  if (candidate.clockOutAt) closed = closed.lt("clock_in_at", candidate.clockOutAt);
  const [closedRes, unclosedRes] = await Promise.all([
    closed.limit(20),
    // 퇴근이 비어 있는 세션(근무 중 · 퇴근 없이 넘어감)은 위 조건에 안 걸린다 — 사람마다 몇 개 안 된다.
    service
      .from("attendance_sessions")
      .select("id, status, clock_in_at, clock_out_at")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .neq("status", "invalid")
      .is("clock_out_at", null)
      .limit(200),
  ]);
  if (closedRes.error || unclosedRes.error) return null;
  const rows = [...(closedRes.data ?? []), ...(unclosedRes.data ?? [])] as OverlapExisting[];
  return findOverlappingSession(candidate, rows, excludeSessionId) != null;
}
