"use client";

import { LiveRefresh } from "@/components/shared/live-refresh";

/**
 * 콘솔 실시간 갱신 — 테이블 하나짜리 (2026-10-15, 연차 승인부터).
 *
 * 2026-10-29 부터 공용 `LiveRefresh`(`src/components/shared/live-refresh.tsx`)의 한 줄 래퍼다 — 신호만 받고
 * `router.refresh()`, 디바운스 · 숨은 탭 · 끊김 따라잡기는 그쪽 규칙을 따른다. 여러 테이블이면 `LiveRefresh` 를 직접 쓴다.
 */
export function AdminLiveRefresh({ table, organizationId }: { table: string; organizationId: string }) {
  return <LiveRefresh sources={[{ table, filter: `organization_id=eq.${organizationId}` }]} />;
}
