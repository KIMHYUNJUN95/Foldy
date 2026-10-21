"use server";

import { revalidatePath } from "next/cache";
import { syncOrganizationReviews } from "@/lib/beds24/reviews-sync";
import {
  getReviewSyncStatus,
  ownsReviewSyncRun,
  recordReviewSyncDone,
  REVIEW_SYNC_ROUTINE_SINCE_DAYS,
  REVIEW_SYNC_RUN_TTL_MS,
  REVIEW_SYNC_SLICE,
  reviewSyncRunLockName,
} from "@/lib/beds24/reviews-sync-manual";
import { isBeds24SyncPaused } from "@/lib/beds24/sync-control";
import { acquireBeds24Lock, getBeds24Cooldown, releaseBeds24Lock } from "@/lib/beds24/sync-locks";
import { canWriteComplaint } from "@/lib/complaints";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * 외부 리뷰 「지금 가져오기」의 **한 조각** (2026-10-02, 사용자 요청) — 대시보드 · 모바일 공용.
 *
 * 도메인 계약: `docs/product/25-complaint-workflow.md` → 「지금 가져오기 (수동 수집)」
 *
 * 한 바퀴(약 70곳)는 60초 함수 상한에 안 들어가 **화면이 이어 부른다**: 첫 호출(`runId: null`)이 잠금을 잡고
 * 조각 하나를 돌리고, 돌려받은 `runId` · `nextOffset` 으로 끝날 때까지 다시 부른다. 정기 수집과 같은 함수 ·
 * 같은 창(Booking.com 30일)이라 결과도 같다 — UPSERT 라 겹쳐 돌아도 무해하다.
 *
 * 권한은 **서버에서 다시 본다**(버튼은 편의) — 컴플레인 작성 권한(`canWriteComplaint`). 실패 사유는 코드로만
 * 돌려준다 — 문구는 화면이 사전에서 고른다(ko/ja/en).
 */
export type ReviewSyncStepResult =
  | {
      ok: true;
      runId: string;
      done: boolean;
      nextOffset: number | null;
      /** 지금까지 처리한 대상 수 / 전체 — 화면의 진행률. */
      processed: number;
      total: number;
      upserted: number;
    }
  | {
      ok: false;
      error: "forbidden" | "paused" | "cooldown" | "too_soon" | "busy" | "lost" | "credits" | "failed";
      /** `cooldown` · `too_soon` — 이 시각 이후 다시 누를 수 있다(ISO). */
      retryAt?: string | null;
    };

export async function syncReviewsNowStep(input: { runId: string | null; offset: number }): Promise<ReviewSyncStepResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session) || !canWriteComplaint(session)) {
    return { error: "forbidden", ok: false };
  }
  if (isBeds24SyncPaused()) return { error: "paused", ok: false };

  const organizationId = session.organization.id;
  const supabase = getSupabaseServiceClient();

  // 크레딧은 계정 단위다 — 다른 경로가 429 를 맞아 쉬는 중이면 여기서도 쉰다.
  const cooldown = await getBeds24Cooldown(supabase);
  if (cooldown.active) return { error: "cooldown", ok: false, retryAt: cooldown.until };

  let runId = input.runId;
  if (!runId) {
    const status = await getReviewSyncStatus(supabase, organizationId);
    if (status.availableAt) return { error: "too_soon", ok: false, retryAt: status.availableAt };
    const lock = await acquireBeds24Lock(supabase, reviewSyncRunLockName(organizationId), session.user.id, REVIEW_SYNC_RUN_TTL_MS);
    if (!lock.acquired) return { error: lock.reason === "busy" ? "busy" : "failed", ok: false };
    runId = lock.lockId;
  } else if (!(await ownsReviewSyncRun(supabase, organizationId, runId))) {
    // 잠금이 만료됐거나(화면이 너무 오래 멈췄다) 남이 잡았다 — 이어 부르지 않는다.
    return { error: "lost", ok: false };
  }

  const offset = Number.isInteger(input.offset) && input.offset > 0 ? input.offset : 0;
  const release = () => releaseBeds24Lock(supabase, reviewSyncRunLockName(organizationId), runId);

  let result: Awaited<ReturnType<typeof syncOrganizationReviews>>;
  try {
    result = await syncOrganizationReviews({
      limit: REVIEW_SYNC_SLICE,
      offset,
      organizationId,
      sinceDays: REVIEW_SYNC_ROUTINE_SINCE_DAYS,
    });
  } catch (error) {
    console.error("[complaints/review-sync] step failed", { error, offset, organizationId });
    await release();
    return { error: "failed", ok: false };
  }

  // 크레딧이 바닥나기 전에 멈췄다 — 여기까지 받은 것은 남는다. 다음 정기 수집이 이어받는다.
  if (result.stoppedEarly) {
    await release();
    if (result.upserted > 0) revalidateReviewSurfaces();
    return { error: "credits", ok: false };
  }

  const done = result.nextOffset === null;
  if (done) {
    await recordReviewSyncDone(supabase, { by: "manual", organizationId, upserted: result.upserted });
    await release();
    revalidateReviewSurfaces();
  }

  return {
    done,
    nextOffset: result.nextOffset,
    ok: true,
    processed: result.nextOffset ?? result.totalTargets,
    runId,
    total: result.totalTargets,
    upserted: result.upserted,
  };
}

function revalidateReviewSurfaces() {
  revalidatePath("/admin/complaints");
  revalidatePath("/mobile/complaints");
}
