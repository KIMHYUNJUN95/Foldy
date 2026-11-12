"use server";

/**
 * 손님 메시지 「받는 통로」 확인 — PC 설정 탭 · PC/모바일 목록 위 「받는 통로 멈춤」 줄이 같이 쓴다(공용 액션, 문서 CLAUDE.md `src/actions`).
 * docs/product/47-guest-messaging.md §6-2
 *
 * - 권한: `guest_messages.manage` 만(아니면 redirect 없이 `forbidden`). 조직은 세션에서.
 * - `checkGuestMessagesNow()`: 보정 조회 **한 번**(계정 한 번 읽기). 크레딧 · 쿨다운 · 멈춤 판단은 보정 조회가 그대로 한다.
 *   누르기 간격 1분 — 마지막으로 누른 시각을 `settings.lastManualCheckAt` 에 남긴다(조회가 실패해도 남아 연타로 크레딧이 나가지 않게).
 *   확인 + 기록은 DB 함수 `guest_message_claim_manual_check` 한 번(줄 잠금) — 동시에 눌러도 조회는 한 번.
 */

import { revalidatePath } from "next/cache";
import { reconcileGuestMessages, type ReconcileSkip, type ReconcileStop } from "@/lib/guest-messages/reconcile";
import { RECONCILE_NOW_INTERVAL_MS } from "@/lib/guest-messages/settings-model";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export type CheckNowErrorKey = "forbidden" | "too_soon" | "failed";

export type CheckNowResult =
  | { ok: true; pages: number; fetched: number; added: number; skipped: ReconcileSkip | null; stoppedEarly: ReconcileStop | null }
  | { ok: false; errorKey: CheckNowErrorKey };

async function manageGate(): Promise<{ ok: true; organizationId: string } | { ok: false; errorKey: "forbidden" }> {
  const session = await getCurrentAppSession().catch(() => null);
  if (!session || !hasOrganizationContext(session)) return { ok: false, errorKey: "forbidden" };
  if (!session.capabilities.includes("guest_messages.manage")) return { ok: false, errorKey: "forbidden" };
  return { ok: true, organizationId: session.organization.id };
}

export async function checkGuestMessagesNow(): Promise<CheckNowResult> {
  const access = await manageGate();
  if (!access.ok) return access;
  const db = getSupabaseServiceClient();
  const now = new Date();
  try {
    // 확인 + 기록을 DB 함수 한 번에(줄 잠금) — 두 사람이 동시에 눌러도 한 번만 조회한다.
    const claimed = await db.rpc("guest_message_claim_manual_check", {
      p_organization_id: access.organizationId,
      p_now: now.toISOString(),
      p_interval_seconds: Math.round(RECONCILE_NOW_INTERVAL_MS / 1000),
    });
    if (claimed.error) throw new Error(claimed.error.message);
    if (claimed.data !== true) return { ok: false, errorKey: "too_soon" };

    const result = await reconcileGuestMessages([access.organizationId], { supabase: db });
    const counts = result.organizations[access.organizationId] ?? { inserted: 0, merged: 0 };
    revalidatePath("/admin/messages");
    revalidatePath("/mobile/messages");
    return {
      ok: true,
      pages: result.pages,
      fetched: result.fetched,
      added: counts.inserted,
      skipped: result.skipped,
      stoppedEarly: result.stoppedEarly,
    };
  } catch (error) {
    console.error("[guest-messages] check now failed", error instanceof Error ? error.message : "unknown");
    return { ok: false, errorKey: "failed" };
  }
}
