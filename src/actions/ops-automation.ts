"use server";

import { revalidatePath } from "next/cache";
import { getAdminSessionForApi } from "@/lib/admin-session";
import { getDictionary } from "@/lib/i18n";
import { canEnableAutomation } from "@/lib/automation/enable-guard";
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
import { AUTOMATION_JOB_KIND, isAutomationJobKey, isAutomationLocale, type AutomationJobKey } from "@/lib/automation/jobs";
import { buildPreview, sendJobNow } from "@/lib/automation/runner";
import { automationBuildingLabel, type AlertCard } from "@/lib/automation/messages";
import { computeNextWake } from "@/lib/automation/schedule";
import { mergeAutomationSave, parseSaveFields, type AutomationSaveFields } from "@/lib/automation/save-merge";
import { canAccessOpsAdmin } from "@/lib/ops-admin";
import { getAutomationLiveData, type AutomationLiveData } from "@/lib/automation/console-data";
import { hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isYmd } from "@/lib/tokyo-date";
import { changed } from "@/actions/cleaning-assign-guards";
import { checkAddExtraRoom, removeExtraRoom } from "@/lib/cleaning-assign/extra-room";
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

/** `room_locked` — 청소 중 · 끝남 · 미룸 · 처리 끝 방이라 더할 수 없음. `room_in_use` — 배정 · 기록이 있는 방이라 뺄 수 없음(문서 45 A16). */
type Fail = { ok: false; error: "forbidden" | "invalid" | "conflict" | "not_found" | "save_failed" | "no_destination" | "no_sample" | "room_locked" | "room_in_use" };

async function viewer() {
  // 화면을 옮기지 않고 「권한 없음」만 돌려준다 — 모바일 판매 캘린더 · 자동화도 같은 액션을 부른다.
  const auth = await getAdminSessionForApi();
  if (!auth.ok) return null;
  const { session } = auth;
  if (!canAccessOpsAdmin(session)) return null;
  return session;
}

async function manager() {
  // 화면을 옮기지 않고 「권한 없음」만 돌려준다 — 모바일 판매 캘린더 · 자동화도 같은 액션을 부른다.
  const auth = await getAdminSessionForApi();
  if (!auth.ok) return null;
  const { session } = auth;
  if (!canAccessOpsAdmin(session) || !session.capabilities.includes("automation.manage")) return null;
  return session;
}

// ── 보기 ────────────────────────────────────────────────────────────────

/**
 * 관제실 실시간 갱신(PC · 모바일, 2026-11-18) — 페이지와 같은 문(`ops_admin.access` + 관리 웹 + 조직)을 다시 본다.
 * 우리 DB 만 읽는다(크레딧 · Beds24 · Slack 없음). 언어는 세션에서만 — 화면이 넘기지 않는다.
 */
export async function loadAutomationLive(): Promise<{ ok: true; data: AutomationLiveData } | { ok: false; error: "forbidden" | "failed" }> {
  const session = await viewer();
  if (!session || !hasOrganizationContext(session)) return { error: "forbidden", ok: false };
  try {
    return { data: await getAutomationLiveData(session, session.user.preferredLanguage), ok: true };
  } catch (error) {
    console.error("[automation] live load failed", error instanceof Error ? error.message : error);
    return { error: "failed", ok: false };
  }
}

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
    // 건물 제목 · 순서는 Slack 청소 명단과 같게(「오쿠보A」, 다카다노바바 → 오쿠보 → 스테이아리).
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

export type SaveJobInput = AutomationSaveFields & {
  jobKey: string;
  /** 화면 초안이 맞춰 본 서버 값 — 이것과 같은 칸은 「안 건드림」이라 저장 때 DB 값을 둔다. 믿지 않고 다시 읽는다.
   *  없으면(예전 탭) 초안 전체를 저장한다. */
  base?: AutomationSaveFields;
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

/**
 * 성공이면 `version` = 이 저장이 쓴 설정 줄 버전(`updated_at`) — 화면 초안이 이보다 옛 그림을 저장 전 값으로 버린다.
 * `saved` = 실제로 쓴 값: 지금 DB 값 위에 **내가 바꾼 칸만** 얹은 것(`mergeAutomationSave`, 2026-11-19).
 */
export async function saveAutomationJob(
  input: SaveJobInput,
): Promise<{ ok: true; version: string; saved: AutomationSaveFields } | Fail> {
  const session = await manager();
  if (!session) return { error: "forbidden", ok: false };
  if (!isAutomationJobKey(input.jobKey)) return { error: "invalid", ok: false };
  const jobKey = input.jobKey;
  const known = new Set(listAutomationChannels().map((channel) => channel.key));
  const draft = parseSaveFields(input, known);
  // 기준은 그 사이 연결이 끊긴 채널을 들 수 있다 — 모양만 본다. 기준을 안 보내는 예전 탭(배포 전 화면)은
  // 합치지 않고 예전처럼 초안 전체를 저장한다(`null`). 시각 순서는 합친 결과 한 곳에서만 본다.
  const base = input.base === undefined ? null : parseSaveFields(input.base, null);
  if (!draft || (input.base !== undefined && !base)) return { error: "invalid", ok: false };

  const supabase = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  const [jobs, currentDestinations] = await Promise.all([loadJobs(supabase, organizationId), loadDestinations(supabase, organizationId)]);
  const current = jobs[jobKey];
  const merged = base
    ? mergeAutomationSave({
        base,
        current: {
          destinations: currentDestinations[jobKey],
          retryUntil: current.retryUntil,
          sendTime: current.sendTime,
          settings: current.settings,
          weekdays: current.weekdays,
        },
        draft,
      })
    : draft;
  // 시각 순서는 합친 결과로만 본다. 내 초안만 틀렸으면 invalid, 내 값은 맞았는데 다른 사람이 방금 바꾼 칸과 합치니
  // 틀렸으면 conflict — 한쪽을 몰래 버리지 않고 아무것도 쓰지 않는다.
  if (merged.retryUntil < merged.sendTime) {
    return { error: draft.retryUntil < draft.sendTime ? "invalid" : "conflict", ok: false };
  }
  const { destinations, retryUntil, sendTime, settings, weekdays } = merged;
  // 켜져 있는 자동화를 받는 곳 0곳으로 저장하면 다음 발송이 조용히 건너뛴다 — 막고 이유를 알려 준다(끄지는 않는다).
  // 꺼진 것을 저장하거나 끄려고 저장하는 것은 그대로 된다.
  if (current.enabled && !canEnableAutomation(destinations, [...known]).ok) return { error: "no_destination", ok: false };
  const now = new Date();
  const nextWake = computeNextWake(
    {
      enabled: current.enabled,
      lastDoneOn: current.lastDoneOn,
      recheckEveryMinutes: settings.resend.debounceMinutes,
      recheckUntil: settings.resend.enabled ? settings.resend.until : null,
      retryUntil,
      sendTime,
      weekdays,
    },
    now,
  );

  const upsert = await supabase.from("automation_jobs").upsert(
    {
      job_key: jobKey,
      next_wake_at: AUTOMATION_JOB_KIND[jobKey] === "scheduled" ? (nextWake?.toISOString() ?? null) : null,
      organization_id: organizationId,
      retry_until: retryUntil,
      send_time: sendTime,
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
  //
  // 여기서 실패하면 **앞에서 바꾼 설정 줄과 받는 곳을 저장 전으로 되돌린다**(2026-10-26). 전에는 설정(시각 · 요일)만 바뀌고
  // 받는 곳은 옛것인 반쯤 저장된 상태가 남았는데, 화면은 「저장 실패」라 사람은 아무것도 안 바뀐 줄 알았다.
  const restore = async (step: string) => {
    console.error("[automation] save job failed — restoring", { jobKey, step });
    const jobRestored = current.stored
      ? await supabase
          .from("automation_jobs")
          .update({
            next_wake_at: current.nextWakeAt,
            retry_until: current.retryUntil,
            send_time: current.sendTime,
            settings: current.settings as unknown as Json,
            updated_at: current.updatedAt ?? now.toISOString(),
            weekdays: current.weekdays,
          })
          .eq("organization_id", organizationId)
          .eq("job_key", jobKey)
      : await supabase.from("automation_jobs").delete().eq("organization_id", organizationId).eq("job_key", jobKey);
    const previous = currentDestinations[jobKey];
    const destRestored =
      previous.length > 0
        ? await supabase.from("automation_destinations").upsert(
            previous.map((item) => ({ channel_key: item.channelKey, job_key: jobKey, locales: item.locales, organization_id: organizationId })),
            { onConflict: "organization_id,job_key,channel_key" },
          )
        : { error: null };
    const added = destinations.map((item) => item.channelKey).filter((key) => !previous.some((item) => item.channelKey === key));
    const addedRemoved =
      added.length > 0
        ? await supabase
            .from("automation_destinations")
            .delete()
            .eq("organization_id", organizationId)
            .eq("job_key", jobKey)
            .in("channel_key", added)
        : { error: null };
    if (jobRestored.error || destRestored.error || addedRemoved.error) {
      console.error("[automation] restore after failed save also failed", {
        dest: destRestored.error?.code ?? addedRemoved.error?.code ?? null,
        job: jobRestored.error?.code ?? null,
        jobKey,
      });
    }
  };
  if (destinations.length > 0) {
    const upserted = await supabase.from("automation_destinations").upsert(
      destinations.map((item) => ({ channel_key: item.channelKey, job_key: jobKey, locales: item.locales, organization_id: organizationId })),
      { onConflict: "organization_id,job_key,channel_key" },
    );
    if (upserted.error) {
      await restore("destinations_upsert");
      return { error: "save_failed", ok: false };
    }
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
    if (removed.error) {
      await restore("destinations_delete");
      return { error: "save_failed", ok: false };
    }
  }

  await writeLog(
    organizationId,
    jobKey,
    session.user.id,
    diff(
      { destinations: currentDestinations[jobKey], retryUntil: current.retryUntil, sendTime: current.sendTime, settings: current.settings, weekdays: current.weekdays },
      { destinations, retryUntil, sendTime, settings, weekdays },
    ),
  );
  revalidatePath("/admin/ops/automation");
  return { ok: true, saved: merged, version: now.toISOString() };
}

export async function setAutomationEnabled(jobKey: string, enabled: boolean): Promise<{ ok: true } | Fail> {
  const session = await manager();
  if (!session) return { error: "forbidden", ok: false };
  if (!isAutomationJobKey(jobKey)) return { error: "invalid", ok: false };
  const supabase = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  // 끌 때는 받는 곳을 읽지 않는다. 켤 때만 — 실제로 나갈 곳(연결된 채널 + 언어 체크)이 없으면 켤 수 없다.
  // 화면(확인 창)과 같은 판정(`canEnableAutomation`)을 서버가 다시 한다.
  const [jobs, destinations] = await Promise.all([loadJobs(supabase, organizationId), enabled ? loadDestinations(supabase, organizationId) : null]);
  if (destinations) {
    const guard = canEnableAutomation(destinations[jobKey], listAutomationChannels().map((channel) => channel.key));
    if (!guard.ok) return { error: guard.error, ok: false };
  }
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
  // **켜짐 관련 칸만** 고친다(2026-10-26). 전에는 위에서 읽은 줄 전체(보낼 시각 · 요일 · 설정)를 다시 써서, 그 사이 다른
  // 사람이 저장한 설정을 옛 값으로 덮었다. 줄이 아직 없을 때만(처음 켜기) 기본값으로 새로 넣는다.
  const toggled = {
    enabled,
    // 이벤트형은 켠 순간부터 본다 — 켜기 전에 바뀐 예약으로 알림이 몰려 가지 않게.
    ...(AUTOMATION_JOB_KIND[jobKey] === "event" && enabled ? { event_cursor: now.toISOString() } : {}),
    // 꺼짐 → 켜짐일 때만 켠 시각을 새로 적는다 — 취소 · 당일예약 알림은 이 뒤에 생긴 일만 보낸다.
    ...(enabled && !current.enabled ? { enabled_at: now.toISOString() } : {}),
    next_wake_at: nextWake?.toISOString() ?? null,
    updated_at: now.toISOString(),
    updated_by: session.user.id,
  };
  let result: { error: { code?: string } | null } = await supabase
    .from("automation_jobs")
    .update(toggled)
    .eq("organization_id", organizationId)
    .eq("job_key", jobKey)
    .select("job_key");
  const updatedRows = (result as { data?: unknown[] | null }).data ?? [];
  if (!result.error && updatedRows.length === 0) {
    const inserted = await supabase.from("automation_jobs").insert({
      ...toggled,
      job_key: jobKey,
      organization_id: organizationId,
      retry_until: current.retryUntil,
      send_time: current.sendTime,
      settings: current.settings as unknown as Json,
      weekdays: current.weekdays,
    });
    // 그 사이 다른 요청이 줄을 만들었으면(23505) 켜짐 칸만 다시 고친다.
    result =
      inserted.error?.code === "23505"
        ? await supabase.from("automation_jobs").update(toggled).eq("organization_id", organizationId).eq("job_key", jobKey)
        : inserted;
  }
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
 * 화면이 보낸 키를 그대로 믿지 않고 서버가 다시 찾는다. 더해도 되는지는 청소 배정 「+ 방 추가」와 같은 함수(`checkAddExtraRoom`, 문서 45 A16) —
 * 청소 중 · 끝난 방 · 미룬 방은 `room_locked`. 저장하면 열려 있는 청소 배정 화면에 신호를 보낸다(`changed`).
 */
export async function addCleaningExtraRoom(input: { date: string; roomKey: string; note?: string }): Promise<{ ok: true } | Fail> {
  const session = await manager();
  if (!session) return { error: "forbidden", ok: false };
  const note = String(input.note ?? "").trim().slice(0, 60);
  if (!isYmd(input.date)) return { error: "invalid", ok: false };
  const supabase = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  const checked = await checkAddExtraRoom(supabase, organizationId, input.date, String(input.roomKey ?? ""), null).catch((error: unknown) => {
    console.error("[automation] extra room check failed", error instanceof Error ? error.message : error);
    return null;
  });
  if (!checked) return { error: "save_failed", ok: false };
  if (!checked.ok) return { error: checked.reason === "stale" ? "room_locked" : "invalid", ok: false };
  const option = checked.option;
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
  await changed(organizationId);
  return { ok: true };
}

export async function removeCleaningExtraRoom(input: { date: string; roomKey: string }): Promise<{ ok: true } | Fail> {
  const session = await manager();
  if (!session) return { error: "forbidden", ok: false };
  const roomKey = String(input.roomKey ?? "").trim();
  if (!isYmd(input.date) || roomKey.length === 0 || roomKey.length > 80) return { error: "invalid", ok: false };
  const organizationId = session.organization.id;
  // 배정 · 기록 · 미룸이 있는 방은 빼지 않는다 — 빼면 배정이 「취소됨」 유령으로 남는다. 청소 배정에서 먼저 정리(문서 45 A16).
  const result = await removeExtraRoom(getSupabaseServiceClient(), organizationId, input.date, roomKey).catch((error: unknown) => {
    console.error("[automation] extra room remove failed", error instanceof Error ? error.message : error);
    return { ok: false as const, reason: "error" as const };
  });
  if (!result.ok) return { error: result.reason === "in_use" ? "room_in_use" : "save_failed", ok: false };
  await writeLog(organizationId, "cleaning_list", session.user.id, { [`extra:${input.date}:${roomKey}`]: { after: null, before: "+" } });
  await changed(organizationId);
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


