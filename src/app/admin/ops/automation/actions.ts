"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/admin-session";
import { getDictionary } from "@/lib/i18n";
import { listAutomationChannels } from "@/lib/automation/channels";
import {
  AUTOMATION_BUILDING_ORDER,
  loadAssignees,
  loadAssigneesForModel,
  loadCleaningRoomOptions,
  loadCleaningListModel,
  loadDestinations,
  loadJobs,
  loadPropertyLabeler,
  withLocalizedCodes,
} from "@/lib/automation/data";
import {
  AUTOMATION_JOB_KIND,
  CHANNEL_KEY_PATTERN,
  isAutomationJobKey,
  isAutomationLocale,
  isHhmm,
  parseLocales,
  parseSettings,
  parseWeekdays,
  type AutomationDestination,
  type AutomationJobKey,
  type AutomationSettings,
} from "@/lib/automation/jobs";
import { buildPreview, sendJobNow } from "@/lib/automation/runner";
import { automationBuildingLabel, type AlertCard } from "@/lib/automation/messages";
import { computeNextWake } from "@/lib/automation/schedule";
import { canAccessOpsAdmin } from "@/lib/ops-admin";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isYmd } from "@/lib/tokyo-date";
import type { Json } from "@/types/database";

/**
 * 자동화 관제실 서버 액션.
 *
 * 도메인 계약: docs/product/36-automation-control.md 「권한」
 *
 * - 보기(미리보기 · 담당자 명단 · 원문) = `ops_admin.access`.
 * - 바꾸기 · 보내기(설정 저장 · 발송 토글 · 지금 보내기 · 정정본 · 담당자 이름) = **`automation.manage`** — 개인 부여만.
 *   service-role 로 쓰므로 **매번 다시 확인한다**(CLAUDE.md §6 — 화면에서 버튼을 감춘 것은 막은 게 아니다).
 *
 * 실패 사유는 코드로만 돌려준다 — 문구는 화면이 사전에서 고른다(ko/ja/en).
 */

type Fail = { ok: false; error: "forbidden" | "invalid" | "not_found" | "save_failed" | "no_destination" | "no_sample" };

async function viewer() {
  const session = await requireAdminSession();
  if (!canAccessOpsAdmin(session)) return null;
  return session;
}

async function manager() {
  const session = await requireAdminSession();
  if (!canAccessOpsAdmin(session) || !session.capabilities.includes("automation.manage")) return null;
  return session;
}

// ── 보기 ────────────────────────────────────────────────────────────────

export async function previewAutomationMessage(input: {
  jobKey: string;
  date: string;
  locale: string;
}): Promise<{ ok: true; text: string; sampleId: string | null; card: AlertCard | null } | Fail> {
  const session = await viewer();
  if (!session) return { error: "forbidden", ok: false };
  if (!isAutomationJobKey(input.jobKey) || !isAutomationLocale(input.locale) || !isYmd(input.date)) {
    return { error: "invalid", ok: false };
  }
  try {
    const preview = await buildPreview(getSupabaseServiceClient(), session.organization.id, input.jobKey, {
      date: input.date,
      locale: input.locale,
    });
    return { card: preview.card ?? null, ok: true, sampleId: preview.sampleId, text: preview.text };
  } catch (error) {
    console.error("[automation] preview failed", error instanceof Error ? error.message : error);
    return { error: "save_failed", ok: false };
  }
}

export async function loadAutomationRunMessage(runId: string): Promise<{ ok: true; text: string } | Fail> {
  const session = await viewer();
  if (!session) return { error: "forbidden", ok: false };
  const result = await getSupabaseServiceClient()
    .from("automation_runs")
    .select("message")
    .eq("organization_id", session.organization.id)
    .eq("id", String(runId ?? ""))
    .maybeSingle();
  if (result.error || !result.data) return { error: "not_found", ok: false };
  return { ok: true, text: result.data.message ?? "" };
}

export type AssigneeRoomView = {
  roomKey: string;
  propertyName: string;
  code: string;
  label: string;
  section: "cleaning" | "setting";
  kind: "turnover" | "no_checkin" | "setting" | "extra";
  guestName: string | null;
  pax: number | null;
  /** 직접 더한 방(`extra`)의 메모. */
  note: string | null;
  names: string;
  /** 그날 마지막으로 보낸 명단에 들어간 이름(발송 뒤 바뀜 표시). 보낸 적 없으면 null. */
  sentNames: string | null;
};

/** 「청소 방 추가」에서 고를 방 — 건물 묶음(Slack 명단 순서 · 제목). */
export type CleaningRoomOptionGroup = { propertyName: string; label: string; rooms: Array<{ roomKey: string; code: string }> };

export async function loadAssigneeBoard(
  date: string,
  locale: string,
): Promise<{ ok: true; rooms: AssigneeRoomView[]; sent: boolean; roomOptions: CleaningRoomOptionGroup[] } | Fail> {
  const session = await viewer();
  if (!session) return { error: "forbidden", ok: false };
  if (!isYmd(date) || !isAutomationLocale(locale)) return { error: "invalid", ok: false };
  const supabase = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  try {
    const jobs = await loadJobs(supabase, organizationId);
    const [model, labeler, lastSent, options] = await Promise.all([
      loadCleaningListModel(supabase, organizationId, date, jobs.cleaning_list.settings.excludedProperties),
      loadPropertyLabeler(supabase, organizationId),
      supabase
        .from("automation_runs")
        .select("meta")
        .eq("organization_id", organizationId)
        .eq("job_key", "cleaning_list")
        .eq("target_date", date)
        .eq("status", "sent")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      loadCleaningRoomOptions(supabase, organizationId),
    ]);
    // 청소 배정이 있는 방은 배정한 이름(Slack 명단과 같은 값 — docs/product/37).
    const names = await loadAssigneesForModel(supabase, organizationId, date, model);
    const label = (name: string) => labeler(name, locale);
    // 건물 제목 · 순서는 Slack 청소 명단과 같게(「오쿠보A (B동)」, 다카다노바바 → 오쿠보 → 스테이아리).
    const messageCopy = getDictionary(locale).automationMessages;
    const headerLabel = (name: string) => automationBuildingLabel(messageCopy, "cleaning", name, label);
    const orderOf = (name: string) => {
      const index = AUTOMATION_BUILDING_ORDER.indexOf(name);
      return index < 0 ? AUTOMATION_BUILDING_ORDER.length : index;
    };
    const localized = withLocalizedCodes(model, label);
    const sentMeta = (lastSent.data?.meta ?? null) as { names?: Record<string, string> } | null;
    const sentNames = sentMeta?.names ?? null;
    const rooms: AssigneeRoomView[] = [
      ...localized.cleaning.map((room) => ({ ...room, section: "cleaning" as const })),
      ...localized.setting.map((room) => ({ ...room, section: "setting" as const })),
    ]
      .sort(
        (a, b) =>
          orderOf(a.propertyName) - orderOf(b.propertyName) ||
          a.propertyName.localeCompare(b.propertyName) ||
          a.code.localeCompare(b.code, "ko", { numeric: true }),
      )
      .map((room) => ({
        code: room.code,
        guestName: room.guestName,
        kind: room.kind,
        label: headerLabel(room.propertyName),
        names: names.get(room.roomKey) ?? "",
        note: room.note ?? null,
        pax: room.pax,
        propertyName: room.propertyName,
        roomKey: room.roomKey,
        section: room.section,
        sentNames: sentNames ? (sentNames[room.roomKey] ?? "") : null,
      }));
    const excludedBuildings = new Set(jobs.cleaning_list.settings.excludedProperties);
    const groups = new Map<string, CleaningRoomOptionGroup>();
    for (const option of options) {
      if (!AUTOMATION_BUILDING_ORDER.includes(option.propertyName) || excludedBuildings.has(option.propertyName)) continue;
      const group = groups.get(option.propertyName) ?? { label: headerLabel(option.propertyName), propertyName: option.propertyName, rooms: [] };
      group.rooms.push({ code: option.code || label(option.propertyName), roomKey: option.roomKey });
      groups.set(option.propertyName, group);
    }
    const roomOptions = [...groups.values()]
      .sort((a, b) => orderOf(a.propertyName) - orderOf(b.propertyName))
      .map((group) => ({ ...group, rooms: group.rooms.sort((a, b) => a.code.localeCompare(b.code, "ko", { numeric: true })) }));
    return { ok: true, roomOptions, rooms, sent: !!sentNames };
  } catch (error) {
    console.error("[automation] assignee board failed", error instanceof Error ? error.message : error);
    return { error: "save_failed", ok: false };
  }
}

// ── 바꾸기 · 보내기 (automation.manage) ──────────────────────────────────────

export type SaveJobInput = {
  jobKey: string;
  sendTime: string;
  retryUntil: string;
  weekdays: number[];
  settings: AutomationSettings;
  destinations: AutomationDestination[];
};

function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) out[key] = { after: after[key], before: before[key] };
  }
  return out;
}

async function writeLog(organizationId: string, jobKey: AutomationJobKey, actorId: string, changes: Record<string, unknown>) {
  if (Object.keys(changes).length === 0) return;
  await getSupabaseServiceClient()
    .from("automation_setting_logs")
    .insert({ actor_id: actorId, changes: changes as Json, job_key: jobKey, organization_id: organizationId });
}

export async function saveAutomationJob(input: SaveJobInput): Promise<{ ok: true } | Fail> {
  const session = await manager();
  if (!session) return { error: "forbidden", ok: false };
  if (!isAutomationJobKey(input.jobKey) || !isHhmm(input.sendTime) || !isHhmm(input.retryUntil)) return { error: "invalid", ok: false };
  if (input.retryUntil < input.sendTime) return { error: "invalid", ok: false };
  const jobKey = input.jobKey;
  const weekdays = parseWeekdays(input.weekdays);
  const settings = parseSettings(input.settings);

  const known = new Set(listAutomationChannels().map((channel) => channel.key));
  const destinations: AutomationDestination[] = [];
  for (const item of Array.isArray(input.destinations) ? input.destinations : []) {
    const channelKey = String(item?.channelKey ?? "");
    const locales = parseLocales(item?.locales);
    if (!CHANNEL_KEY_PATTERN.test(channelKey) || !known.has(channelKey)) return { error: "invalid", ok: false };
    if (locales.length > 0) destinations.push({ channelKey, locales });
  }

  const supabase = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  const [jobs, currentDestinations] = await Promise.all([loadJobs(supabase, organizationId), loadDestinations(supabase, organizationId)]);
  const current = jobs[jobKey];
  const now = new Date();
  const nextWake = computeNextWake(
    {
      enabled: current.enabled,
      lastDoneOn: current.lastDoneOn,
      recheckEveryMinutes: settings.resend.debounceMinutes,
      recheckUntil: settings.resend.enabled ? settings.resend.until : null,
      retryUntil: input.retryUntil,
      sendTime: input.sendTime,
      weekdays,
    },
    now,
  );

  const upsert = await supabase.from("automation_jobs").upsert(
    {
      job_key: jobKey,
      next_wake_at: AUTOMATION_JOB_KIND[jobKey] === "scheduled" ? (nextWake?.toISOString() ?? null) : null,
      organization_id: organizationId,
      retry_until: input.retryUntil,
      send_time: input.sendTime,
      settings: settings as unknown as Json,
      updated_at: now.toISOString(),
      updated_by: session.user.id,
      weekdays,
    },
    { onConflict: "organization_id,job_key" },
  );
  if (upsert.error) {
    console.error("[automation] save job failed", { code: upsert.error.code });
    return { error: "save_failed", ok: false };
  }

  // 받는 곳: **새 것을 먼저 넣고(upsert) 빠진 것만 지운다.** 예전처럼 다 지우고 넣으면 넣기가 실패했을 때 받는 곳이 통째로
  // 사라져 다음 발송이 「받는 곳 없음」으로 건너뛴다.
  if (destinations.length > 0) {
    const upserted = await supabase.from("automation_destinations").upsert(
      destinations.map((item) => ({ channel_key: item.channelKey, job_key: jobKey, locales: item.locales, organization_id: organizationId })),
      { onConflict: "organization_id,job_key,channel_key" },
    );
    if (upserted.error) return { error: "save_failed", ok: false };
  }
  const dropped = currentDestinations[jobKey]
    .map((item) => item.channelKey)
    .filter((channelKey) => !destinations.some((item) => item.channelKey === channelKey));
  if (dropped.length > 0) {
    const removed = await supabase
      .from("automation_destinations")
      .delete()
      .eq("organization_id", organizationId)
      .eq("job_key", jobKey)
      .in("channel_key", dropped);
    if (removed.error) return { error: "save_failed", ok: false };
  }

  await writeLog(
    organizationId,
    jobKey,
    session.user.id,
    diff(
      { destinations: currentDestinations[jobKey], retryUntil: current.retryUntil, sendTime: current.sendTime, settings: current.settings, weekdays: current.weekdays },
      { destinations, retryUntil: input.retryUntil, sendTime: input.sendTime, settings, weekdays },
    ),
  );
  revalidatePath("/admin/ops/automation");
  return { ok: true };
}

export async function setAutomationEnabled(jobKey: string, enabled: boolean): Promise<{ ok: true } | Fail> {
  const session = await manager();
  if (!session) return { error: "forbidden", ok: false };
  if (!isAutomationJobKey(jobKey)) return { error: "invalid", ok: false };
  const supabase = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  const jobs = await loadJobs(supabase, organizationId);
  const current = jobs[jobKey];
  const now = new Date();
  const nextWake =
    AUTOMATION_JOB_KIND[jobKey] === "scheduled"
      ? computeNextWake(
          {
            ...current,
            enabled,
            recheckEveryMinutes: current.settings.resend.debounceMinutes,
            recheckUntil: current.settings.resend.enabled ? current.settings.resend.until : null,
          },
          now,
        )
      : null;
  const result = await supabase.from("automation_jobs").upsert(
    {
      enabled,
      // 이벤트형은 켠 순간부터 본다 — 켜기 전에 바뀐 예약으로 알림이 몰려 가지 않게.
      ...(AUTOMATION_JOB_KIND[jobKey] === "event" && enabled ? { event_cursor: now.toISOString() } : {}),
      // 꺼짐 → 켜짐일 때만 켠 시각을 새로 적는다 — 취소 · 당일예약 알림은 이 뒤에 생긴 일만 보낸다.
      ...(enabled && !current.enabled ? { enabled_at: now.toISOString() } : {}),
      job_key: jobKey,
      next_wake_at: nextWake?.toISOString() ?? null,
      organization_id: organizationId,
      retry_until: current.retryUntil,
      send_time: current.sendTime,
      settings: current.settings as unknown as Json,
      updated_at: now.toISOString(),
      updated_by: session.user.id,
      weekdays: current.weekdays,
    },
    { onConflict: "organization_id,job_key" },
  );
  if (result.error) {
    console.error("[automation] toggle failed", { code: result.error.code });
    return { error: "save_failed", ok: false };
  }
  await writeLog(organizationId, jobKey, session.user.id, { enabled: { after: enabled, before: current.enabled } });
  revalidatePath("/admin/ops/automation");
  return { ok: true };
}

export async function sendAutomationNow(input: {
  jobKey: string;
  date: string;
  correction?: boolean;
}): Promise<{ ok: true; sent: number; failed: number } | Fail> {
  const session = await manager();
  if (!session) return { error: "forbidden", ok: false };
  if (!isAutomationJobKey(input.jobKey) || !isYmd(input.date)) return { error: "invalid", ok: false };
  try {
    const result = await sendJobNow(getSupabaseServiceClient(), session.organization.id, input.jobKey, {
      actorId: session.user.id,
      correction: input.jobKey === "cleaning_list" && !!input.correction,
      date: input.date,
    });
    if (result.reason) return { error: result.reason, ok: false };
    revalidatePath("/admin/ops/automation");
    return { failed: result.failed, ok: true, sent: result.sent };
  } catch (error) {
    console.error("[automation] send now failed", error instanceof Error ? error.message : error);
    return { error: "save_failed", ok: false };
  }
}

/**
 * 청소 명단에 방을 직접 더한다(연박 청소 등 — Hotelsmart 대신). 고를 수 있는 방은 활성 객실 카탈로그에 있는 것만 —
 * 화면이 보낸 키를 그대로 믿지 않고 서버가 다시 찾는다.
 */
export async function addCleaningExtraRoom(input: { date: string; roomKey: string; note?: string }): Promise<{ ok: true } | Fail> {
  const session = await manager();
  if (!session) return { error: "forbidden", ok: false };
  const note = String(input.note ?? "").trim().slice(0, 60);
  if (!isYmd(input.date)) return { error: "invalid", ok: false };
  const supabase = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  const option = (await loadCleaningRoomOptions(supabase, organizationId)).find((item) => item.roomKey === input.roomKey);
  if (!option) return { error: "invalid", ok: false };
  const result = await supabase.from("cleaning_list_extra_rooms").upsert(
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
  if (result.error) {
    console.error("[automation] extra room add failed", { code: result.error.code });
    return { error: "save_failed", ok: false };
  }
  await writeLog(organizationId, "cleaning_list", session.user.id, { [`extra:${input.date}:${option.roomKey}`]: { after: note || "+", before: null } });
  return { ok: true };
}

export async function removeCleaningExtraRoom(input: { date: string; roomKey: string }): Promise<{ ok: true } | Fail> {
  const session = await manager();
  if (!session) return { error: "forbidden", ok: false };
  const roomKey = String(input.roomKey ?? "").trim();
  if (!isYmd(input.date) || roomKey.length === 0 || roomKey.length > 80) return { error: "invalid", ok: false };
  const organizationId = session.organization.id;
  const result = await getSupabaseServiceClient()
    .from("cleaning_list_extra_rooms")
    .delete()
    .eq("organization_id", organizationId)
    .eq("target_date", input.date)
    .eq("room_key", roomKey);
  if (result.error) {
    console.error("[automation] extra room remove failed", { code: result.error.code });
    return { error: "save_failed", ok: false };
  }
  await writeLog(organizationId, "cleaning_list", session.user.id, { [`extra:${input.date}:${roomKey}`]: { after: null, before: "+" } });
  return { ok: true };
}

export async function saveCleaningAssignee(input: {
  date: string;
  roomKey: string;
  names: string;
}): Promise<{ ok: true } | Fail> {
  const session = await manager();
  if (!session) return { error: "forbidden", ok: false };
  const roomKey = String(input.roomKey ?? "").trim();
  const names = String(input.names ?? "")
    .split(/[,，、]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
  if (!isYmd(input.date) || roomKey.length === 0 || roomKey.length > 80 || names.length > 120) return { error: "invalid", ok: false };
  const supabase = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  const before = (await loadAssignees(supabase, organizationId, input.date)).get(roomKey) ?? "";
  if (before === names) return { ok: true };
  const result = names
    ? await supabase.from("cleaning_list_assignees").upsert(
        { assign_date: input.date, names, organization_id: organizationId, room_key: roomKey, updated_at: new Date().toISOString(), updated_by: session.user.id },
        { onConflict: "organization_id,assign_date,room_key" },
      )
    : await supabase
        .from("cleaning_list_assignees")
        .delete()
        .eq("organization_id", organizationId)
        .eq("assign_date", input.date)
        .eq("room_key", roomKey);
  if (result.error) {
    console.error("[automation] assignee save failed", { code: result.error.code });
    return { error: "save_failed", ok: false };
  }
  await writeLog(organizationId, "cleaning_list", session.user.id, { [`assignee:${input.date}:${roomKey}`]: { after: names, before } });
  return { ok: true };
}


