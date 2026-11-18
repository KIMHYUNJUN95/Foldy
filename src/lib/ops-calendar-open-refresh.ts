import "server-only";
import { after } from "next/server";
import { userCreditActor, withBeds24CreditScope } from "@/lib/beds24/credit-ledger";
import { refreshOpsCalendarRates } from "@/lib/beds24/rates-refresh";
import { kickPriceJobWorker } from "@/lib/beds24/price-job-kick";
import { hasPendingPriceJobs } from "@/lib/beds24/price-job-queue";
import type { OpsCalendarData } from "@/lib/ops-calendar";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * 판매 캘린더를 **열 때** 응답 뒤에 도는 일 — 데스크톱(`/admin/ops/calendar`)과 모바일(`/mobile/ops/calendar`)이
 * 같은 규칙을 쓰도록 한 곳에 둔다(2026-10-01, 모바일 판매 캘린더).
 *
 * 1. 대기 중인 가격 · 최소숙박 작업이 있으면 먼저 보낸다(접수 직후 깨우기가 실패한 작업).
 * 2. **보고 있는 창이 낡았으면** 그 건물 · 그 창만 Beds24 에서 당긴다. 신선도는 보이는 객실로 재고(`ratesSyncedAt`),
 *    고른 건물 중 하나라도 Beds24 id 가 없으면 당기지 않는다 — 넓히면 「낡음 → 당김 → 신호 → 새로고침 → 낡음」
 *    무한 루프가 다시 돈다(`docs/product/33-calendar-write-features.md`).
 *
 * 크레딧 기록의 「누가」는 화면을 연 사람이다(`opener`) — 열지 않았으면 당기지 않았다.
 */
export function scheduleOpsCalendarOpenRefresh(
  organizationId: string,
  data: OpsCalendarData,
  opener: { id: string; name?: string | null },
) {
  const firstVisibleDate = data.days.at(0)?.date;
  const lastVisibleDate = data.days.at(-1)?.date;
  if (!firstVisibleDate || !lastVisibleDate) return;
  const selectedExternalIds = data.selectedProperties
    .map((name) => data.propertyExternalIds[name])
    .filter((id): id is string => Boolean(id));
  const canRefresh = data.ratesRefreshable && selectedExternalIds.length === data.selectedProperties.length;
  after(async () => {
    const supabase = getSupabaseServiceClient();
    if (await hasPendingPriceJobs(supabase)) await kickPriceJobWorker(supabase);
    if (!canRefresh) return;
    await withBeds24CreditScope({ actor: userCreditActor(opener), organizationId }, () =>
      refreshOpsCalendarRates({
        externalPropertyIds: selectedExternalIds.length > 0 ? selectedExternalIds : undefined,
        organizationId,
        supabase,
        syncedAt: data.ratesSyncedAt,
        window: { from: firstVisibleDate, to: lastVisibleDate },
      }),
    );
  });
}
