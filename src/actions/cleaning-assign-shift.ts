"use server";

import { isDateKey } from "@/lib/cleaning-assign/day-state";
import { planCancelDay } from "@/lib/cleaning-assign/room-rules";
import { loadDaySessionRows } from "@/lib/cleaning-assign/rooms";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  guardAssignAction,
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

/**
 * 그날 일정 취소(출근 전 당일 취소 등 · 취소 요청 수락 포함). 문서 45 A7:
 * 그날 청소 중이면 막고(`busy` — 「청소 중인 방이 있어요」), 끝낸 방의 배정은 남기고, 시작하지 않은 방만 미배정으로 돌린다.
 * 끝낸 방을 지우면 그 사람 기록과 방 상태(`roomShareState` 필요한 수)가 틀어진다.
 */
export async function cancelPersonDay(input: { date: string; userId: string }): Promise<AssignOk | AssignFail> {
  return guardAssignAction("cancelPersonDay", () => cancelPersonDayBody(input));
}

async function cancelPersonDayBody(input: { date: string; userId: string }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isEditableDate(input.date) || !isUuid(input.userId)) return { ok: false, reason: "invalid" };
  const supabase = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  // 서비스 키로 쓰므로 조직 소속을 직접 본다 — 다른 조직 사람의 취소 줄을 우리 조직으로 만들지 않게.
  if (!(await isFieldMember(organizationId, input.userId))) return { ok: false, reason: "invalid" };
  const [sessions, assignments] = await Promise.all([
    loadDaySessionRows(supabase, organizationId, input.date, input.userId),
    supabase.from("cleaning_assignments").select("id, room_key, property_name, room_label").eq("organization_id", organizationId).eq("work_date", input.date).eq("user_id", input.userId),
  ]);
  if (assignments.error) return { ok: false, reason: "error" };
  const plan = planCancelDay(
    (assignments.data ?? []).map((row) => ({ id: row.id, propertyName: row.property_name, roomKey: row.room_key, roomLabel: row.room_label })),
    sessions,
    input.userId,
  );
  if (plan.blocked) return { ok: false, reason: "busy" };
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
    const inserted = await supabase.from("cleaning_shift_applications").insert({
      cancelled_at: now,
      cancelled_by: session.user.id,
      created_by: session.user.id,
      organization_id: organizationId,
      source: "admin",
      user_id: input.userId,
      work_date: input.date,
    });
    if (inserted.error) return { ok: false, reason: "error" };
  }
  if (plan.removeIds.length > 0) {
    const removed = await supabase.from("cleaning_assignments").delete().eq("organization_id", organizationId).in("id", plan.removeIds);
    if (removed.error) return { ok: false, reason: "error" };
  }
  await changed(session.organization.id);
  return { ok: true };
}

export async function resolveCancelRequest(input: { date: string; userId: string; accept: boolean }): Promise<AssignOk | AssignFail> {
  return guardAssignAction("resolveCancelRequest", () => resolveCancelRequestBody(input));
}

async function resolveCancelRequestBody(input: { date: string; userId: string; accept: boolean }): Promise<AssignOk | AssignFail> {
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
  return guardAssignAction("toggleApplicationForUser", () => toggleApplicationForUserBody(input));
}

async function toggleApplicationForUserBody(input: { date: string; userId: string }): Promise<AssignOk<{ applied: boolean }> | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isEditableDate(input.date) || !isUuid(input.userId)) return { ok: false, reason: "invalid" };
  const supabase = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  const existing = await supabase
    .from("cleaning_shift_applications")
    .select("user_id, cancelled_at")
    .eq("organization_id", organizationId)
    .eq("user_id", input.userId)
    .eq("work_date", input.date)
    .maybeSingle();
  if (existing.error) return { ok: false, reason: "error" };
  // 관리자가 취소한 날 — 줄을 지우면 취소가 풀리고 다음 누름에 새 신청이 생긴다. 「다시 넣기」만 푼다(2026-11-02).
  if (existing.data?.cancelled_at) return { ok: false, reason: "cancelled" };
  if (existing.data) {
    const rooms = await supabase.from("cleaning_assignments").select("id").eq("organization_id", organizationId).eq("user_id", input.userId).eq("work_date", input.date).limit(1);
    if (rooms.error) return { ok: false, reason: "error" };
    if ((rooms.data ?? []).length > 0) return { ok: false, reason: "conflict" };
    const removed = await supabase.from("cleaning_shift_applications").delete().eq("organization_id", organizationId).eq("user_id", input.userId).eq("work_date", input.date);
    if (removed.error) return { ok: false, reason: "error" };
    await changed(session.organization.id);
    return { applied: false, ok: true };
  }
  if (!(await isFieldMember(organizationId, input.userId))) return { ok: false, reason: "invalid" };
  if (!(await ensureApplication(organizationId, input.userId, input.date, session.user.id))) return { ok: false, reason: "error" };
  await changed(session.organization.id);
  return { applied: true, ok: true };
}
