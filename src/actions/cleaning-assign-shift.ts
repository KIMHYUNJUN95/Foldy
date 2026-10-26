"use server";

import { isDateKey } from "@/lib/cleaning-assign/day-state";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  assigner,
  changed,
  ensureApplication,
  isEditableDate,
  isFieldMember,
  isUuid,
  type AssignFail,
  type AssignOk,
} from "@/actions/cleaning-assign-guards";

/**
 * 청소 배정 — PC(월 보기 · 사람 패널 · 하루 보기)와 모바일(사람별 시프트 달력)이 **같이** 부르는 서버 액션(2026-10-26 옮김).
 * `/mobile` 코드가 `src/app/admin/**` 액션을 가져오지 않도록 여기로 옮겼다(CLAUDE.md 「src/actions」). 권한은
 * `cleaning.assign` — 없으면 `forbidden` 결과(redirect 하지 않는다). docs/product/37-cleaning-shift-assignment.md 「4-6」
 */

/** 그날 일정 취소(출근 전 당일 취소 등) — 그 사람 방은 미배정으로 돌아가고 알바 화면엔 「배정 없음」. */
export async function cancelPersonDay(input: { date: string; userId: string }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isEditableDate(input.date) || !isUuid(input.userId)) return { ok: false, reason: "invalid" };
  const supabase = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  const now = new Date().toISOString();
  const update = await supabase
    .from("cleaning_shift_applications")
    .update({ cancelled_at: now, cancelled_by: session.user.id, updated_at: now })
    .eq("organization_id", organizationId)
    .eq("user_id", input.userId)
    .eq("work_date", input.date)
    .select("user_id");
  if (update.error) return { ok: false, reason: "error" };
  if ((update.data ?? []).length === 0) {
    await supabase.from("cleaning_shift_applications").insert({
      cancelled_at: now,
      cancelled_by: session.user.id,
      created_by: session.user.id,
      organization_id: organizationId,
      source: "admin",
      user_id: input.userId,
      work_date: input.date,
    });
  }
  await supabase.from("cleaning_assignments").delete().eq("organization_id", organizationId).eq("work_date", input.date).eq("user_id", input.userId);
  await changed(session.organization.id);
  return { ok: true };
}

export async function resolveCancelRequest(input: { date: string; userId: string; accept: boolean }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isDateKey(input.date) || !isUuid(input.userId)) return { ok: false, reason: "invalid" };
  if (input.accept) return cancelPersonDay({ date: input.date, userId: input.userId });
  const result = await getSupabaseServiceClient()
    .from("cleaning_shift_applications")
    .update({ cancel_request_note: null, cancel_requested_at: null, updated_at: new Date().toISOString() })
    .eq("organization_id", session.organization.id)
    .eq("user_id", input.userId)
    .eq("work_date", input.date);
  if (result.error) return { ok: false, reason: "error" };
  await changed(session.organization.id);
  return { ok: true };
}

/** 월 보기 칸 — 신청만 대신 넣기 / 빼기(배정 없는 날만). */
export async function toggleApplicationForUser(input: { date: string; userId: string }): Promise<AssignOk<{ applied: boolean }> | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isEditableDate(input.date) || !isUuid(input.userId)) return { ok: false, reason: "invalid" };
  const supabase = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  const existing = await supabase
    .from("cleaning_shift_applications")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", input.userId)
    .eq("work_date", input.date)
    .maybeSingle();
  if (existing.data) {
    const rooms = await supabase.from("cleaning_assignments").select("id").eq("organization_id", organizationId).eq("user_id", input.userId).eq("work_date", input.date).limit(1);
    if ((rooms.data ?? []).length > 0) return { ok: false, reason: "conflict" };
    await supabase.from("cleaning_shift_applications").delete().eq("organization_id", organizationId).eq("user_id", input.userId).eq("work_date", input.date);
    await changed(session.organization.id);
    return { applied: false, ok: true };
  }
  if (!(await isFieldMember(organizationId, input.userId))) return { ok: false, reason: "invalid" };
  await ensureApplication(organizationId, input.userId, input.date, session.user.id);
  await changed(session.organization.id);
  return { applied: true, ok: true };
}
