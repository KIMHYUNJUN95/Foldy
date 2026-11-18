import "server-only";

import { listAutomationChannels, type AutomationChannel } from "@/lib/automation/channels";
import { checkReservationGate, loadDestinations, loadJobs, loadPropertyLabeler, AUTOMATION_BUILDING_ORDER } from "@/lib/automation/data";
import {
  AUTOMATION_JOB_KEYS,
  AUTOMATION_JOB_KIND,
  type AutomationDestination,
  type AutomationJobKey,
  type AutomationJobKind,
  type AutomationSettings,
} from "@/lib/automation/jobs";
import { getBeds24CreditDetail } from "@/lib/beds24/credit-usage-read";
import type { Beds24CreditDetail } from "@/lib/beds24/credit-usage-types";
import type { Locale } from "@/lib/i18n";
import type { AppSession } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { tokyoToday, ymdShift } from "@/lib/tokyo-date";

/**
 * 자동화 관제실 화면 데이터 — `/admin/ops/automation`.
 *
 * 도메인 계약: docs/product/36-automation-control.md
 *
 * **호출부가 `ops_admin.access` 를 먼저 확인한다.** service-role 로 읽으므로 조직을 직접 건다.
 */

export type AutomationRunView = {
  id: string;
  createdAt: string;
  targetDate: string | null;
  channelKey: string | null;
  locale: string | null;
  trigger: string;
  status: "sent" | "skipped" | "failed";
  reason: string | null;
};

export type AutomationLogView = {
  id: string;
  createdAt: string;
  actorName: string | null;
  changes: Record<string, { before: unknown; after: unknown }>;
};

export type AutomationJobView = {
  jobKey: AutomationJobKey;
  kind: AutomationJobKind;
  enabled: boolean;
  sendTime: string;
  retryUntil: string;
  weekdays: number[];
  settings: AutomationSettings;
  nextWakeAt: string | null;
  /** 오늘 정시 발송을 끝낸 도쿄 날짜 — 켜기 · 저장 전 「지금 바로 나감」 경고에 쓴다. */
  lastDoneOn: string | null;
  destinations: AutomationDestination[];
  runs: AutomationRunView[];
  logs: AutomationLogView[];
};

export type AutomationPageData = {
  canManage: boolean;
  today: string;
  yesterday: string;
  jobs: AutomationJobView[];
  channels: AutomationChannel[];
  gate: { ok: boolean; ageMinutes: number | null };
  opsAlertConfigured: boolean;
  buildings: Array<{ name: string; label: string }>;
  /** Beds24 크레딧 칸 첫 값(「오늘」). 읽기 실패면 null — 화면이 오류 칸을 보인다. */
  credit: Beds24CreditDetail | null;
  /** 서버가 이 화면을 그린 시각(ms) — 크레딧 카운트다운의 첫 그림을 서버 · 브라우저가 같게. */
  renderedAt: number;
};

export async function getAutomationPageData(session: AppSession, locale: Locale): Promise<AutomationPageData> {
  const supabase = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  const now = new Date();
  const [jobs, destinations, runs, logs, gate, labeler, credit] = await Promise.all([
    loadJobs(supabase, organizationId),
    loadDestinations(supabase, organizationId),
    supabase
      .from("automation_runs")
      .select("id, job_key, created_at, target_date, channel_key, locale, trigger, status, reason")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("automation_setting_logs")
      .select("id, job_key, created_at, actor_id, changes")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(100),
    checkReservationGate(supabase, now),
    loadPropertyLabeler(supabase, organizationId),
    // 우리 DB 의 호출 기록만 읽는다(Beds24 를 부르지 않는다). 실패해도 관제실은 연다.
    getBeds24CreditDetail(organizationId, "today").catch(() => null),
  ]);

  const actorIds = [...new Set((logs.data ?? []).map((row) => row.actor_id).filter((id): id is string => !!id))];
  const actors = actorIds.length
    ? await supabase.from("profiles").select("id, name").in("id", actorIds)
    : { data: [] as Array<{ id: string; name: string }> };
  const actorName = new Map((actors.data ?? []).map((row) => [row.id, row.name]));

  const runsByJob = new Map<string, AutomationRunView[]>();
  for (const row of runs.data ?? []) {
    const list = runsByJob.get(row.job_key) ?? [];
    if (list.length >= 60) continue;
    list.push({
      channelKey: row.channel_key,
      createdAt: row.created_at,
      id: row.id,
      locale: row.locale,
      reason: row.reason,
      status: row.status as AutomationRunView["status"],
      targetDate: row.target_date,
      trigger: row.trigger,
    });
    runsByJob.set(row.job_key, list);
  }
  const logsByJob = new Map<string, AutomationLogView[]>();
  for (const row of logs.data ?? []) {
    const list = logsByJob.get(row.job_key) ?? [];
    if (list.length >= 10) continue;
    list.push({
      actorName: row.actor_id ? (actorName.get(row.actor_id) ?? null) : null,
      changes: (row.changes ?? {}) as AutomationLogView["changes"],
      createdAt: row.created_at,
      id: row.id,
    });
    logsByJob.set(row.job_key, list);
  }

  const today = tokyoToday();
  return {
    buildings: AUTOMATION_BUILDING_ORDER.map((name) => ({ label: labeler(name, locale), name })),
    canManage: session.capabilities.includes("automation.manage"),
    credit,
    renderedAt: now.getTime(),
    channels: listAutomationChannels(),
    gate: { ageMinutes: gate.ageMinutes, ok: gate.ok },
    jobs: AUTOMATION_JOB_KEYS.map((jobKey) => {
      const job = jobs[jobKey];
      return {
        destinations: destinations[jobKey],
        enabled: job.enabled,
        jobKey,
        kind: AUTOMATION_JOB_KIND[jobKey],
        lastDoneOn: job.lastDoneOn,
        logs: logsByJob.get(jobKey) ?? [],
        nextWakeAt: job.nextWakeAt,
        retryUntil: job.retryUntil,
        runs: runsByJob.get(jobKey) ?? [],
        sendTime: job.sendTime,
        settings: job.settings,
        weekdays: job.weekdays,
      };
    }),
    // 실패 알림이 어디로든 갈 수 있나 — 「실패 알림」 자동화가 켜져 있고 받는 곳이 있거나, 기존 운영 경보 채널이 있으면.
    opsAlertConfigured:
      (jobs.failure_alert.enabled && destinations.failure_alert.length > 0) || !!process.env.SLACK_OPS_ALERT_WEBHOOK_URL?.trim(),
    today,
    yesterday: ymdShift(today, -1),
  };
}
