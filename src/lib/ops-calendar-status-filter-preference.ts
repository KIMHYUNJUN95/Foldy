import "server-only";

import { after } from "next/server";
import {
  parseOpsStatusFilter,
  resolveOpsStatusFilter,
  type OpsStatusFilter,
} from "@/lib/ops-calendar-status-filter";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * 판매 캘린더 「예약 표시」 필터 기억 — **사용자마다**, 대시보드 · 모바일 공용(2026-11-26).
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md 「예약 표시 — 상태 필터」
 *
 * `ops-calendar-mode-preference.ts`(30일 · 월간 기억)와 같은 방식이다.
 * - 주소에 `show=` 가 있으면 그 값으로 열고, 그게 이 사람의 저장값이 된다(응답 뒤 `after()` — 본인 행만, service-role).
 *   필터 팝오버의 링크는 늘 `show=` 를 달고 간다(기본으로 되돌리기도 `show=confirmed`) — 따로 저장 버튼이 없다.
 * - 주소에 없으면 저장값, 그것도 없으면 기본(확정만). 예전 `cancelled=1` 링크는 확정 + 취소.
 * - 칸이 아직 없는 DB(마이그레이션 202611260002 전)여도 화면은 기본으로 그냥 열린다 — 읽기 오류는 기본, 쓰기 오류는 버린다.
 */
export async function resolveOpsCalendarStatusFilter(
  userId: string,
  params: { show?: string; cancelled?: string },
): Promise<OpsStatusFilter> {
  const explicit = parseOpsStatusFilter(params.show);
  if (explicit) {
    after(async () => {
      try {
        await getSupabaseServiceClient()
          .from("profiles")
          .update({ ops_calendar_status_filter: explicit })
          .eq("id", userId);
      } catch {
        // 기억 못 해도 이번 화면은 그대로다.
      }
    });
    return explicit;
  }
  const legacyCancelled = params.cancelled === "1";
  let saved: unknown = null;
  if (!legacyCancelled) {
    try {
      const { data, error } = await getSupabaseServiceClient()
        .from("profiles")
        .select("ops_calendar_status_filter")
        .eq("id", userId)
        .maybeSingle();
      if (!error) saved = data?.ops_calendar_status_filter ?? null;
    } catch {
      saved = null;
    }
  }
  return resolveOpsStatusFilter({ legacyCancelled, saved, url: undefined });
}
