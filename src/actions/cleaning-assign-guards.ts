import "server-only";

import { revalidatePath } from "next/cache";
import { getCleaningOperatingDateKey } from "@/lib/cleaning";
import { addDays, isDateKey } from "@/lib/cleaning-assign/day-state";
import { loadFieldMembers } from "@/lib/cleaning-assign/data";
import { signalCleaningAssignChange } from "@/lib/cleaning-assign/live";
import { getCurrentAppSession, hasOrganizationContext, type AppSession } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * 청소 배정 서버 액션이 같이 쓰는 권한 · 검증 · 캐시 도우미(2026-10-26 — `/admin/cleaning-assign/actions.ts` 에서 옮김).
 *
 * **서버 액션 파일이 아니다**(`"use server"` 없음) — 여기 함수는 클라이언트가 직접 부를 수 없다. 관리자 액션
 * (`src/app/admin/cleaning-assign/actions.ts`)과 PC · 모바일이 같이 쓰는 액션(`src/actions/cleaning-assign-shift.ts`)이
 * 같은 검사를 쓰도록 한 곳에 둔다. 권한은 `cleaning.assign` 능력 — 없으면 `null`(redirect 하지 않는다 · CLAUDE.md).
 */

export type AssignFail = { ok: false; reason: "forbidden" | "invalid" | "conflict" | "error" };
export type AssignOk<T = object> = { ok: true } & T;

export const CLEANING_ASSIGN_PATHS = ["/admin/cleaning-assign", "/admin/cleaning-assign/settings", "/mobile/shift", "/mobile/shift/today", "/admin/cleaning", "/mobile/cleaning"];

export function revalidate() {
  for (const path of CLEANING_ASSIGN_PATHS) revalidatePath(path);
}

/** 배정 · 신청이 바뀜 — 화면 캐시를 비우고 열려 있는 PC · 모바일 화면에 실시간 신호. */
export async function changed(organizationId: string) {
  revalidate();
  await signalCleaningAssignChange(organizationId);
}

export async function assigner(): Promise<AppSession | null> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return null;
  if (!session.capabilities.includes("cleaning.assign")) return null;
  return session;
}

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** 지난날 · 너무 먼 날은 배정하지 않는다(어제까지는 기록 정리용으로 허용). */
export function isEditableDate(date: string): boolean {
  const today = getCleaningOperatingDateKey();
  return isDateKey(date) && date >= addDays(today, -1) && date <= addDays(today, 120);
}

export async function isFieldMember(organizationId: string, userId: string): Promise<boolean> {
  const members = await loadFieldMembers(getSupabaseServiceClient(), organizationId);
  return members.some((member) => member.userId === userId);
}

/** 신청이 없으면 「관리자가 넣음」 신청을 만든다 · 취소된 날이면 살린다. */
export async function ensureApplication(organizationId: string, userId: string, date: string, actorId: string) {
  const supabase = getSupabaseServiceClient();
  const existing = await supabase
    .from("cleaning_shift_applications")
    .select("cancelled_at")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("work_date", date)
    .maybeSingle();
  if (!existing.data) {
    await supabase.from("cleaning_shift_applications").insert({ created_by: actorId, organization_id: organizationId, source: "admin", user_id: userId, work_date: date });
  } else if (existing.data.cancelled_at) {
    await supabase
      .from("cleaning_shift_applications")
      .update({ cancel_request_note: null, cancel_requested_at: null, cancelled_at: null, cancelled_by: null, updated_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("work_date", date);
  }
}
