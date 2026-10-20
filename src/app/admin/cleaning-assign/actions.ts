"use server";

import { revalidatePath } from "next/cache";
import { loadCleaningRoomOptions } from "@/lib/automation/data";
import { getCleaningOperatingDateKey } from "@/lib/cleaning";
import { addDays, isDateKey, isMonthKey, minutesToLabel, timeToMinutes } from "@/lib/cleaning-assign/day-state";
import {
  computeDaySuggestions,
  computeMonthSuggestions,
  loadFieldMembers,
  loadMonthBoard,
  type MonthBoard,
} from "@/lib/cleaning-assign/data";
import { loadAssignDayRooms } from "@/lib/cleaning-assign/rooms";
import { FLAG_THRESHOLD_OPTIONS, isAssignRuleKey, normalizeAssignRules, TRAINEE_CHECK_STEP, type AssignRule } from "@/lib/cleaning-assign/rules";
import { getCurrentAppSession, hasOrganizationContext, type AppSession } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * 청소 배정 — 관리자 서버 액션(`cleaning.assign`). 모든 쓰기는 service-role, 권한은 여기서 다시 본다(CLAUDE.md §6).
 *
 * **방 하나씩 저장한다** — 하루를 통째로 덮어쓰는 저장이 없다. 같은 사람을 같은 방에 두 번 넣는 것은 DB 유일 제약이 막고,
 * 이미 바뀐 것을 또 바꾸려 하면 `conflict` 를 돌려준다(화면이 「방금 다른 담당자가 바꿨어요」 + 새로 불러오기).
 * docs/product/37-cleaning-shift-assignment.md 「4-2-f」
 */

export type AssignFail = { ok: false; reason: "forbidden" | "invalid" | "conflict" | "error" };
export type AssignOk<T = object> = { ok: true } & T;

const PATHS = ["/admin/cleaning-assign", "/admin/cleaning-assign/settings", "/mobile/shift", "/mobile/shift/today"];

function revalidate() {
  for (const path of PATHS) revalidatePath(path);
}

async function assigner(): Promise<AppSession | null> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return null;
  if (!session.capabilities.includes("cleaning.assign")) return null;
  return session;
}

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** 지난날 · 너무 먼 날은 배정하지 않는다(어제까지는 기록 정리용으로 허용). */
function isEditableDate(date: string): boolean {
  const today = getCleaningOperatingDateKey();
  return isDateKey(date) && date >= addDays(today, -1) && date <= addDays(today, 120);
}

async function isFieldMember(organizationId: string, userId: string): Promise<boolean> {
  const members = await loadFieldMembers(getSupabaseServiceClient(), organizationId);
  return members.some((member) => member.userId === userId);
}

/** 신청이 없으면 「관리자가 넣음」 신청을 만든다 · 취소된 날이면 살린다. */
async function ensureApplication(organizationId: string, userId: string, date: string, actorId: string) {
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

// ── 방 하나씩 넣고 빼기 ─────────────────────────────────────────────────────────────────────────

export async function assignToRoom(input: { date: string; roomKey: string; userId: string }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isEditableDate(input.date) || !isUuid(input.userId) || typeof input.roomKey !== "string") return { ok: false, reason: "invalid" };
  const organizationId = session.organization.id;
  const supabase = getSupabaseServiceClient();
  const [rooms, member] = await Promise.all([loadAssignDayRooms(supabase, organizationId, input.date), isFieldMember(organizationId, input.userId)]);
  const room = rooms.find((item) => item.roomKey === input.roomKey);
  if (!room || !member) return { ok: false, reason: "invalid" };
  const result = await supabase.from("cleaning_assignments").insert({
    created_by: session.user.id,
    organization_id: organizationId,
    property_name: room.propertyName,
    room_key: room.roomKey,
    room_label: room.roomLabel,
    user_id: input.userId,
    work_date: input.date,
  });
  if (result.error) {
    if (result.error.code === "23505") return { ok: false, reason: "conflict" };
    console.error("[cleaning-assign] assign failed", { code: result.error.code });
    return { ok: false, reason: "error" };
  }
  await ensureApplication(organizationId, input.userId, input.date, session.user.id);
  revalidate();
  return { ok: true };
}

export async function unassignFromRoom(input: { date: string; roomKey: string; userId: string }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isEditableDate(input.date) || !isUuid(input.userId) || typeof input.roomKey !== "string") return { ok: false, reason: "invalid" };
  const result = await getSupabaseServiceClient()
    .from("cleaning_assignments")
    .delete()
    .eq("organization_id", session.organization.id)
    .eq("work_date", input.date)
    .eq("room_key", input.roomKey)
    .eq("user_id", input.userId)
    .select("id");
  if (result.error) {
    console.error("[cleaning-assign] unassign failed", { code: result.error.code });
    return { ok: false, reason: "error" };
  }
  if ((result.data ?? []).length === 0) return { ok: false, reason: "conflict" };
  revalidate();
  return { ok: true };
}

/** 제안대로 넣기 · 고정 인력 먼저 넣기 — 제안은 서버가 다시 계산한다. 이미 들어간 줄은 건너뛴다(동시에 눌러도 겹치지 않음). */
export async function applyDaySuggestions(input: { date: string; onlyFixed?: boolean }): Promise<AssignOk<{ added: number }> | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isEditableDate(input.date)) return { ok: false, reason: "invalid" };
  const organizationId = session.organization.id;
  const supabase = getSupabaseServiceClient();
  const suggestions = await computeDaySuggestions(supabase, organizationId, input.date, Boolean(input.onlyFixed));
  if (suggestions.length === 0) return { added: 0, ok: true };
  const result = await supabase
    .from("cleaning_assignments")
    .upsert(
      suggestions.map((s) => ({
        created_by: session.user.id,
        organization_id: organizationId,
        property_name: s.propertyName,
        room_key: s.roomKey,
        room_label: s.roomLabel,
        user_id: s.userId,
        work_date: input.date,
      })),
      { ignoreDuplicates: true, onConflict: "organization_id,work_date,room_key,user_id" },
    )
    .select("id");
  if (result.error) {
    console.error("[cleaning-assign] apply suggestions failed", { code: result.error.code });
    return { ok: false, reason: "error" };
  }
  revalidate();
  return { added: (result.data ?? []).length, ok: true };
}

// ── 사람 — 대신 넣기 · 그날 일정 취소 · 취소 요청 처리 · 그날 출근 시각 ──────────────────────────

export async function addApplicantForDay(input: { date: string; userId: string }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isEditableDate(input.date) || !isUuid(input.userId)) return { ok: false, reason: "invalid" };
  if (!(await isFieldMember(session.organization.id, input.userId))) return { ok: false, reason: "invalid" };
  await ensureApplication(session.organization.id, input.userId, input.date, session.user.id);
  revalidate();
  return { ok: true };
}

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
  revalidate();
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
  revalidate();
  return { ok: true };
}

export async function setDayStartTime(input: { date: string; userId: string; time: string | null }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  const minutes = input.time === null ? null : timeToMinutes(input.time);
  if (!isEditableDate(input.date) || !isUuid(input.userId) || (input.time !== null && minutes === null)) return { ok: false, reason: "invalid" };
  await ensureApplication(session.organization.id, input.userId, input.date, session.user.id);
  const result = await getSupabaseServiceClient()
    .from("cleaning_shift_applications")
    .update({ start_time: minutes === null ? null : `${minutesToLabel(minutes).padStart(5, "0")}:00`, updated_at: new Date().toISOString() })
    .eq("organization_id", session.organization.id)
    .eq("user_id", input.userId)
    .eq("work_date", input.date);
  if (result.error) return { ok: false, reason: "error" };
  revalidate();
  return { ok: true };
}

// ── 방 — 직접 추가 · 미루기 · 처리 끝 ───────────────────────────────────────────────────────────

export async function addRoomForDay(input: { date: string; roomKey: string; note?: string; userIds?: string[] }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isEditableDate(input.date) || typeof input.roomKey !== "string") return { ok: false, reason: "invalid" };
  const organizationId = session.organization.id;
  const supabase = getSupabaseServiceClient();
  const option = (await loadCleaningRoomOptions(supabase, organizationId)).find((item) => item.roomKey === input.roomKey);
  if (!option) return { ok: false, reason: "invalid" };
  const note = String(input.note ?? "").trim().slice(0, 60);
  const extra = await supabase.from("cleaning_list_extra_rooms").upsert(
    {
      created_by: session.user.id,
      note: note || null,
      organization_id: organizationId,
      property_name: option.propertyName,
      room_key: option.roomKey,
      room_label: option.roomLabel,
      target_date: input.date,
    },
    { onConflict: "organization_id,target_date,room_key" },
  );
  if (extra.error) {
    console.error("[cleaning-assign] extra room failed", { code: extra.error.code });
    return { ok: false, reason: "error" };
  }
  const members = new Set((await loadFieldMembers(supabase, organizationId)).map((member) => member.userId));
  const userIds = [...new Set((input.userIds ?? []).filter((id) => isUuid(id) && members.has(id)))].slice(0, 5);
  if (userIds.length > 0) {
    const insert = await supabase.from("cleaning_assignments").upsert(
      userIds.map((userId) => ({
        created_by: session.user.id,
        organization_id: organizationId,
        property_name: option.propertyName,
        room_key: option.roomKey,
        room_label: option.roomLabel,
        user_id: userId,
        work_date: input.date,
      })),
      { ignoreDuplicates: true, onConflict: "organization_id,work_date,room_key,user_id" },
    );
    if (insert.error) return { ok: false, reason: "error" };
    for (const userId of userIds) await ensureApplication(organizationId, userId, input.date, session.user.id);
  }
  revalidate();
  return { ok: true };
}

/**
 * 못 한 방 · 오늘 방 처리 — `defer`(untilDate 까지 숨겼다가 그날 미배정 맨 위로) · `resolved`(청소가 필요 없게 됨, 처리 끝).
 * `originDate` = 원래 청소해야 했던 날(밀려 온 방이면 그날, 오늘 방이면 오늘).
 */
export async function holdRoom(input: { date: string; roomKey: string; originDate: string; kind: "defer" | "resolved"; untilDate?: string; reason?: string }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isEditableDate(input.date) || !isDateKey(input.originDate) || input.originDate > input.date) return { ok: false, reason: "invalid" };
  if (input.kind !== "defer" && input.kind !== "resolved") return { ok: false, reason: "invalid" };
  const until = input.kind === "defer" ? (input.untilDate ?? addDays(input.date, 1)) : null;
  if (until !== null && (!isDateKey(until) || until <= input.date || until > addDays(input.date, 60))) return { ok: false, reason: "invalid" };
  const organizationId = session.organization.id;
  const supabase = getSupabaseServiceClient();
  const room = (await loadAssignDayRooms(supabase, organizationId, input.date)).find((item) => item.roomKey === input.roomKey);
  if (!room) return { ok: false, reason: "invalid" };
  const reason = String(input.reason ?? "").trim().slice(0, 120);
  const result = await supabase.from("cleaning_room_holds").upsert(
    {
      created_by: session.user.id,
      kind: input.kind,
      organization_id: organizationId,
      origin_date: input.originDate,
      property_name: room.propertyName,
      reason: reason || null,
      room_key: room.roomKey,
      room_label: room.roomLabel,
      until_date: until,
    },
    { onConflict: "organization_id,room_key,origin_date" },
  );
  if (result.error) {
    console.error("[cleaning-assign] hold failed", { code: result.error.code });
    return { ok: false, reason: "error" };
  }
  // 미루거나 끝낸 방의 오늘 배정은 뺀다(다른 날 다시 뜰 때 새로 배정).
  await supabase.from("cleaning_assignments").delete().eq("organization_id", organizationId).eq("work_date", input.date).eq("room_key", room.roomKey);
  revalidate();
  return { ok: true };
}

/** 미루기 · 처리 끝 되돌리기. */
export async function releaseHold(input: { date: string; roomKey: string; originDate: string }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isDateKey(input.originDate) || typeof input.roomKey !== "string") return { ok: false, reason: "invalid" };
  const result = await getSupabaseServiceClient()
    .from("cleaning_room_holds")
    .delete()
    .eq("organization_id", session.organization.id)
    .eq("room_key", input.roomKey)
    .eq("origin_date", input.originDate);
  if (result.error) return { ok: false, reason: "error" };
  revalidate();
  return { ok: true };
}

// ── 월 보기 ──────────────────────────────────────────────────────────────────────────────────────

export async function previewMonthSuggestions(input: { ym: string }): Promise<AssignOk<{ board: MonthBoard; proposals: Array<{ workDate: string; userId: string; roomKey: string }>; openTotal: number; shortDays: string[] }> | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isMonthKey(input.ym)) return { ok: false, reason: "invalid" };
  const supabase = getSupabaseServiceClient();
  const today = getCleaningOperatingDateKey();
  const [board, result] = await Promise.all([
    loadMonthBoard(supabase, session.organization.id, input.ym),
    computeMonthSuggestions(supabase, session.organization.id, input.ym, today),
  ]);
  return {
    board,
    ok: true,
    openTotal: result.openTotal,
    proposals: result.suggestions.map((s) => ({ roomKey: s.roomKey, userId: s.userId, workDate: s.workDate })),
    shortDays: result.shortDays,
  };
}

export async function applyMonthSuggestions(input: { ym: string }): Promise<AssignOk<{ added: number }> | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isMonthKey(input.ym)) return { ok: false, reason: "invalid" };
  const supabase = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  const { suggestions } = await computeMonthSuggestions(supabase, organizationId, input.ym, getCleaningOperatingDateKey());
  if (suggestions.length === 0) return { added: 0, ok: true };
  const result = await supabase
    .from("cleaning_assignments")
    .upsert(
      suggestions.map((s) => ({
        created_by: session.user.id,
        organization_id: organizationId,
        property_name: s.propertyName,
        room_key: s.roomKey,
        room_label: s.roomLabel,
        user_id: s.userId,
        work_date: s.workDate,
      })),
      { ignoreDuplicates: true, onConflict: "organization_id,work_date,room_key,user_id" },
    )
    .select("id");
  if (result.error) {
    console.error("[cleaning-assign] apply month failed", { code: result.error.code });
    return { ok: false, reason: "error" };
  }
  revalidate();
  return { added: (result.data ?? []).length, ok: true };
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
    revalidate();
    return { applied: false, ok: true };
  }
  if (!(await isFieldMember(organizationId, input.userId))) return { ok: false, reason: "invalid" };
  await ensureApplication(organizationId, input.userId, input.date, session.user.id);
  revalidate();
  return { applied: true, ok: true };
}

// ── 배정 설정 ────────────────────────────────────────────────────────────────────────────────────

async function writeSettingLog(organizationId: string, actorId: string, changes: Record<string, unknown>) {
  await getSupabaseServiceClient().from("cleaning_assign_setting_logs").insert({ actor_id: actorId, changes: changes as never, organization_id: organizationId });
}

export async function saveAssignRules(input: { rules: AssignRule[] }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!Array.isArray(input.rules) || input.rules.some((rule) => !isAssignRuleKey(rule?.key))) return { ok: false, reason: "invalid" };
  const rules = normalizeAssignRules(input.rules);
  const supabase = getSupabaseServiceClient();
  const before = await supabase.from("cleaning_assign_settings").select("rules").eq("organization_id", session.organization.id).maybeSingle();
  const result = await supabase
    .from("cleaning_assign_settings")
    .upsert({ organization_id: session.organization.id, rules: rules as never, updated_at: new Date().toISOString(), updated_by: session.user.id }, { onConflict: "organization_id" });
  if (result.error) return { ok: false, reason: "error" };
  await writeSettingLog(session.organization.id, session.user.id, { after: rules, area: "rules", before: before.data?.rules ?? null });
  revalidate();
  return { ok: true };
}

export async function saveFlagThreshold(input: { threshold: number }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!(FLAG_THRESHOLD_OPTIONS as readonly number[]).includes(input.threshold)) return { ok: false, reason: "invalid" };
  const result = await getSupabaseServiceClient()
    .from("cleaning_assign_settings")
    .upsert({ flag_threshold: input.threshold, organization_id: session.organization.id, updated_at: new Date().toISOString(), updated_by: session.user.id }, { onConflict: "organization_id" });
  if (result.error) return { ok: false, reason: "error" };
  revalidatePath("/admin/cleaning-assign/compare");
  return { ok: true };
}

/** 건물 하나의 고정 인력 전체를 바꾼다(순위 · 순서). 빈 목록이면 그 건물 고정 인력을 지운다. */
export async function saveFixedStaff(input: { propertyName: string; entries: Array<{ userId: string; tier: number }> }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  const propertyName = String(input.propertyName ?? "").trim();
  if (!propertyName || propertyName.length > 80 || !Array.isArray(input.entries) || input.entries.length > 60) return { ok: false, reason: "invalid" };
  const organizationId = session.organization.id;
  const supabase = getSupabaseServiceClient();
  const members = new Set((await loadFieldMembers(supabase, organizationId)).map((member) => member.userId));
  const seen = new Set<string>();
  const rows: Array<{ organization_id: string; property_name: string; user_id: string; tier: number; position: number }> = [];
  for (const entry of input.entries) {
    if (!isUuid(entry.userId) || !members.has(entry.userId) || seen.has(entry.userId)) return { ok: false, reason: "invalid" };
    if (!Number.isInteger(entry.tier) || entry.tier < 1 || entry.tier > 9) return { ok: false, reason: "invalid" };
    seen.add(entry.userId);
    rows.push({ organization_id: organizationId, position: rows.filter((row) => row.tier === entry.tier).length, property_name: propertyName, tier: entry.tier, user_id: entry.userId });
  }
  const before = await supabase.from("cleaning_fixed_staff").select("user_id, tier").eq("organization_id", organizationId).eq("property_name", propertyName);
  const del = await supabase.from("cleaning_fixed_staff").delete().eq("organization_id", organizationId).eq("property_name", propertyName);
  if (del.error) return { ok: false, reason: "error" };
  if (rows.length > 0) {
    const insert = await supabase.from("cleaning_fixed_staff").insert(rows);
    if (insert.error) return { ok: false, reason: "error" };
  }
  await writeSettingLog(organizationId, session.user.id, { after: rows.map((r) => ({ tier: r.tier, userId: r.user_id })), area: "fixed", before: before.data ?? [], propertyName });
  revalidate();
  return { ok: true };
}

export type StaffProfilePatch = {
  priority?: boolean;
  trainee?: boolean;
  trainer?: boolean;
  defaultStartTime?: string | null;
  memo?: string | null;
};

export async function saveStaffProfile(input: { userId: string; patch: StaffProfilePatch }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isUuid(input.userId) || !input.patch || typeof input.patch !== "object") return { ok: false, reason: "invalid" };
  const organizationId = session.organization.id;
  if (!(await isFieldMember(organizationId, input.userId))) return { ok: false, reason: "invalid" };
  const patch: Record<string, unknown> = {};
  if (typeof input.patch.priority === "boolean") patch.priority = input.patch.priority;
  if (typeof input.patch.trainer === "boolean") patch.trainer = input.patch.trainer;
  if (typeof input.patch.trainee === "boolean") {
    patch.trainee = input.patch.trainee;
    // 견습을 다시 켜면 확인 시점을 처음 값으로.
    if (input.patch.trainee) patch.trainee_check_at = 6;
  }
  if (input.patch.defaultStartTime !== undefined) {
    const minutes = input.patch.defaultStartTime === null ? null : timeToMinutes(input.patch.defaultStartTime);
    if (input.patch.defaultStartTime !== null && minutes === null) return { ok: false, reason: "invalid" };
    patch.default_start_time = minutes === null ? null : `${minutesToLabel(minutes).padStart(5, "0")}:00`;
  }
  if (input.patch.memo !== undefined) {
    const memo = String(input.patch.memo ?? "").trim().slice(0, 200);
    patch.memo = memo || null;
  }
  if (Object.keys(patch).length === 0) return { ok: false, reason: "invalid" };
  const result = await getSupabaseServiceClient()
    .from("cleaning_staff_profiles")
    .upsert({ organization_id: organizationId, updated_at: new Date().toISOString(), updated_by: session.user.id, user_id: input.userId, ...patch }, { onConflict: "organization_id,user_id" });
  if (result.error) {
    console.error("[cleaning-assign] profile save failed", { code: result.error.code });
    return { ok: false, reason: "error" };
  }
  await writeSettingLog(organizationId, session.user.id, { area: "staff", patch: Object.keys(patch).filter((key) => key !== "memo"), userId: input.userId });
  revalidate();
  return { ok: true };
}

/** 「아직 견습인가요?」 — 견습 끝 / 계속 견습(2회 뒤 다시 묻기). */
export async function answerTraineeCheck(input: { userId: string; done: boolean; currentCount: number }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isUuid(input.userId) || !Number.isInteger(input.currentCount) || input.currentCount < 0) return { ok: false, reason: "invalid" };
  const patch = input.done ? { trainee: false } : { trainee_check_at: Math.min(99, input.currentCount + TRAINEE_CHECK_STEP) };
  const result = await getSupabaseServiceClient()
    .from("cleaning_staff_profiles")
    .upsert({ organization_id: session.organization.id, updated_at: new Date().toISOString(), updated_by: session.user.id, user_id: input.userId, ...patch }, { onConflict: "organization_id,user_id" });
  if (result.error) return { ok: false, reason: "error" };
  revalidate();
  return { ok: true };
}

/** 객실 보통 인원(큰 방 2명). */
export async function saveRoomHeadcount(input: { roomKey: string; headcount: number }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (typeof input.roomKey !== "string" || input.roomKey.length === 0 || input.roomKey.length > 80) return { ok: false, reason: "invalid" };
  if (!Number.isInteger(input.headcount) || input.headcount < 1 || input.headcount > 5) return { ok: false, reason: "invalid" };
  const organizationId = session.organization.id;
  const supabase = getSupabaseServiceClient();
  const options = await loadCleaningRoomOptions(supabase, organizationId);
  if (!options.some((option) => option.roomKey === input.roomKey)) return { ok: false, reason: "invalid" };
  const result =
    input.headcount === 1
      ? await supabase.from("cleaning_room_settings").delete().eq("organization_id", organizationId).eq("room_key", input.roomKey)
      : await supabase
          .from("cleaning_room_settings")
          .upsert({ organization_id: organizationId, room_key: input.roomKey, updated_at: new Date().toISOString(), updated_by: session.user.id, usual_headcount: input.headcount }, { onConflict: "organization_id,room_key" });
  if (result.error) return { ok: false, reason: "error" };
  await writeSettingLog(organizationId, session.user.id, { area: "room", headcount: input.headcount, roomKey: input.roomKey });
  revalidate();
  return { ok: true };
}

/** 내 메인 건물(하루 보기 처음 필터) — 본인 것만. */
export async function saveMyMainProperties(input: { properties: string[] }): Promise<AssignOk | AssignFail> {
  const session = await assigner();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!Array.isArray(input.properties) || input.properties.length > 20 || input.properties.some((p) => typeof p !== "string" || p.length > 80)) return { ok: false, reason: "invalid" };
  const result = await getSupabaseServiceClient()
    .from("cleaning_staff_profiles")
    .upsert({ main_properties: [...new Set(input.properties)], organization_id: session.organization.id, updated_at: new Date().toISOString(), user_id: session.user.id }, { onConflict: "organization_id,user_id" });
  if (result.error) return { ok: false, reason: "error" };
  revalidatePath("/admin/cleaning-assign");
  return { ok: true };
}
