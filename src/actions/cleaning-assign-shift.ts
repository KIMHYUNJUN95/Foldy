"use server";

import { isDateKey } from "@/lib/cleaning-assign/day-state";
import { loadLiveAssignmentsOfDay } from "@/lib/cleaning-assign/live-day";
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

async function cancelPersonDayBody(input: { date: string; userId: string }, options: { onlyRequested?: boolean } = {}): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isEditableDate(input.date) || !isUuid(input.userId)) return { ok: false, reason: "invalid" };
  const supabase = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  // 서비스 키로 쓰므로 조직 소속을 직접 본다 — 다른 조직 사람의 취소 줄을 우리 조직으로 만들지 않게(대신 취소는 새 줄을 넣을 수 있다).
  // 수락(`onlyRequested`)은 우리 조직에 이미 있는 요청 줄만 바꾸고 새 줄을 넣지 않아 확인하지 않는다 — 그 사이 비활성이 된 알바의 요청도 받는다(2026-11-09 재리뷰).
  if (!options.onlyRequested && !(await isFieldMember(organizationId, input.userId))) return { ok: false, reason: "invalid" };
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
  let updateQuery = supabase
    .from("cleaning_shift_applications")
    .update({ cancelled_at: now, cancelled_by: session.user.id, updated_at: now })
    .eq("organization_id", organizationId)
    .eq("user_id", input.userId)
    .eq("work_date", input.date);
  // 취소 요청 수락(A15) — 쓰는 순간 요청이 살아 있고 아직 취소 안 된 줄만 바꾼다. 확인 뒤 쓰기 전에 알바가 거둬도(경쟁) 취소되지 않는다.
  if (options.onlyRequested) updateQuery = updateQuery.not("cancel_requested_at", "is", null).is("cancelled_at", null);
  const update = await updateQuery.select("user_id");
  if (update.error) return { ok: false, reason: "error" };
  // 바뀐 줄이 없으면 — 수락이면 요청이 이미 없다(`stale`, 배정도 지우지 않는다). 그냥 취소면 줄이 없던 사람이라 취소 줄을 새로 만든다.
  if ((update.data ?? []).length === 0 && options.onlyRequested) return { ok: false, reason: "stale" };
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
  // 수락은 요청이 아직 살아 있을 때만(문서 45 A15) — 알바가 그 사이 거뒀거나 이미 취소된 날이면 `stale`(새로 읽고 안내).
  // 확인을 따로 읽지 않고 쓰기 조건으로 막는다(읽은 뒤 쓰기 전에 거두는 경쟁도 막힘, 2026-11-09 리뷰). 마이그레이션 없음.
  if (input.accept) return cancelPersonDayBody({ date: input.date, userId: input.userId }, { onlyRequested: true });
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
    // 살아 있는 배정이 있으면 빼지 않는다 — 알바 「내 시프트」와 같은 서버 공용 판단(문서 45 C14). 유령 배정만 있으면 신청을 뺀다(배정 줄은 남김).
    const live = await loadLiveAssignmentsOfDay(supabase, organizationId, input.date, input.userId);
    if (live.length > 0) return { ok: false, reason: "conflict" };
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
