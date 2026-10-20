"use server";

import { revalidatePath } from "next/cache";
import { getCleaningOperatingDateKey } from "@/lib/cleaning";
import { addDays, isDateKey } from "@/lib/cleaning-assign/day-state";
import { getCurrentAppSession, hasOrganizationContext, type AppSession } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * 내 시프트 — 알바 서버 액션(`cleaning.work`, 본인 것만). 날짜를 누르면 신청, 다시 누르면 취소.
 * **배정된 날은 스스로 취소할 수 없다** — 「취소 요청」이 관리자에게 간다. 지난날은 바꿀 수 없다.
 * docs/product/37-cleaning-shift-assignment.md 「4-1」
 */

export type ShiftFail = { ok: false; reason: "forbidden" | "invalid" | "assigned" | "cancelled" | "past" | "error" };

const PATHS = ["/mobile/shift", "/mobile/shift/today", "/admin/cleaning-assign"];

async function worker(): Promise<AppSession | null> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return null;
  if (!session.capabilities.includes("cleaning.work")) return null;
  return session;
}

/** 신청할 수 있는 날 — 오늘부터 다다음 달 말까지(약 90일). */
function isOpenDate(date: string): boolean {
  const today = getCleaningOperatingDateKey();
  return isDateKey(date) && date >= today && date <= addDays(today, 92);
}

export async function toggleMyShift(input: { date: string }): Promise<{ ok: true; applied: boolean } | ShiftFail> {
  const session = await worker();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isDateKey(input.date)) return { ok: false, reason: "invalid" };
  if (!isOpenDate(input.date)) return { ok: false, reason: "past" };
  const supabase = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  const userId = session.user.id;
  const [existing, rooms] = await Promise.all([
    supabase.from("cleaning_shift_applications").select("cancelled_at").eq("organization_id", organizationId).eq("user_id", userId).eq("work_date", input.date).maybeSingle(),
    supabase.from("cleaning_assignments").select("id").eq("organization_id", organizationId).eq("user_id", userId).eq("work_date", input.date).limit(1),
  ]);
  if ((rooms.data ?? []).length > 0) return { ok: false, reason: "assigned" };
  // 관리자가 취소한 날 — 지우면 다시 눌러 신청할 수 있게 되므로 막는다(다시 넣는 것은 관리자가).
  if (existing.data?.cancelled_at) return { ok: false, reason: "cancelled" };
  if (existing.data) {
    const del = await supabase.from("cleaning_shift_applications").delete().eq("organization_id", organizationId).eq("user_id", userId).eq("work_date", input.date);
    if (del.error) return { ok: false, reason: "error" };
    for (const path of PATHS) revalidatePath(path);
    return { applied: false, ok: true };
  }
  const insert = await supabase.from("cleaning_shift_applications").insert({ created_by: userId, organization_id: organizationId, source: "self", user_id: userId, work_date: input.date });
  if (insert.error) {
    // 두 번 눌러 이미 들어간 경우 — 신청된 상태가 맞다.
    if (insert.error.code === "23505") return { applied: true, ok: true };
    return { ok: false, reason: "error" };
  }
  for (const path of PATHS) revalidatePath(path);
  return { applied: true, ok: true };
}

/** 배정된 날 취소 요청(관리자 확인 대기) · 요청 거두기. */
export async function requestShiftCancel(input: { date: string; note?: string; withdraw?: boolean }): Promise<{ ok: true } | ShiftFail> {
  const session = await worker();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isDateKey(input.date)) return { ok: false, reason: "invalid" };
  if (input.date < getCleaningOperatingDateKey()) return { ok: false, reason: "past" };
  const note = String(input.note ?? "").trim().slice(0, 200);
  const result = await getSupabaseServiceClient()
    .from("cleaning_shift_applications")
    .update(
      input.withdraw
        ? { cancel_request_note: null, cancel_requested_at: null, updated_at: new Date().toISOString() }
        : { cancel_request_note: note || null, cancel_requested_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    )
    .eq("organization_id", session.organization.id)
    .eq("user_id", session.user.id)
    .eq("work_date", input.date)
    .select("user_id");
  if (result.error) return { ok: false, reason: "error" };
  if ((result.data ?? []).length === 0) return { ok: false, reason: "invalid" };
  for (const path of PATHS) revalidatePath(path);
  return { ok: true };
}
