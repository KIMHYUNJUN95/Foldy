import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { postToAutomationChannel } from "@/lib/automation/channels";
import { collectHealthAlerts, type HealthAlert } from "@/lib/automation/health";
import { reservationShortcutPath } from "@/lib/reservation-shortcut";
import {
  AUTOMATION_BUILDING_ORDER,
  checkReservationGate,
  cleaningRoomCode,
  loadAssignees,
  loadCleaningListModel,
  loadDailyReportReservations,
  loadDestinations,
  loadJobs,
  loadPropertyLabeler,
  toStoredJob,
  withLocalizedCodes,
  type StoredJob,
} from "@/lib/automation/data";
import {
  AUTOMATION_JOB_KIND,
  type AutomationDestination,
  type AutomationJobKey,
  type AutomationLocale,
} from "@/lib/automation/jobs";
import {
  alertCardBlocks,
  alertCardText,
  automationBuildingLabel,
  buildCleaningListMessage,
  buildFailureAlertText,
  buildHealthAlertText,
  buildDailyReportMessage,
  buildReservationAlertCard,
  cleaningStructureKey,
  computeDailyStats,
  dailySnapshotOf,
  fill,
  isFreshCancellation,
  isSameDayBookingSince,
  sameSnapshot,
  type AlertCard,
  type AutomationFailure,
  type CleaningListModel,
  type DailySnapshot,
  type DailyStats,
} from "@/lib/automation/messages";
import {
  AUTOMATION_RESERVATION_SELECT,
  toAutomationReservation,
  type AutomationReservation,
} from "@/lib/automation/reservation-fields";
import {
  claimConflictKind,
  isScheduledRunDone,
  latestSentByTarget,
  planFollowUpTargets,
  targetKey,
  type SentRunRow,
} from "@/lib/automation/delivery-state";
import { computeNextWake, hhmmToMinutes, isPastRetryDeadline, isScheduledSendDue, tokyoClock } from "@/lib/automation/schedule";
import { acquireBeds24Lock, releaseBeds24Lock } from "@/lib/beds24/sync-locks";
import { getDictionary } from "@/lib/i18n";
import { getCanonicalPropertyName, getDisplayRoomLabel, getCanonicalRoomLabel } from "@/lib/room-label-normalization";
import { postSlackText } from "@/lib/slack-notify";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import { ymdShift } from "@/lib/tokyo-date";
import type { Database, Json } from "@/types/database";

/**
 * 자동화 실행기 — 1분 틱 · 지금 보내기 · 정정본이 전부 여기를 지난다.
 *
 * 도메인 계약: docs/product/36-automation-control.md
 *
 * - **받는 곳 × 언어마다 한 통**, 한 통마다 실행 기록 한 줄(`automation_runs`).
 * - 정시 · 이벤트 발송은 `dedupe_key` 로 **먼저 줄을 잡고 나서** 보낸다 — 두 틱이 겹치거나 중간에 죽었다 다시 돌아도
 *   같은 것을 두 번 보내지 않는다(저쪽 취소 · 당일예약 알림은 중복 방지가 없었다).
 * - 실패는 실패 알림으로 모은다(`notifyAutomationFailure`).
 */

type Client = SupabaseClient<Database>;

const TICK_LOCK = "automation_tick";
const TICK_LOCK_TTL_MS = 60_000;
const CANCEL_FRESH_MS = 24 * 60 * 60 * 1000;

export type RunTrigger = "scheduled" | "retry" | "manual" | "event" | "correction" | "resend";

function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

function appBaseUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel}` : null;
}

// ── 한 통 보내기 + 기록 ─────────────────────────────────────────────────

type Delivery = {
  organizationId: string;
  jobKey: AutomationJobKey;
  destination: AutomationDestination;
  locale: AutomationLocale;
  text: string;
  trigger: RunTrigger;
  targetDate: string | null;
  meta?: Record<string, unknown>;
  dedupeKey?: string | null;
  actorId?: string | null;
  /** Slack 카드(취소 · 당일예약) — 있으면 `text` 대신 이것을 보낸다. `text` 는 실행 기록 원문으로 남는다. */
  slack?: SlackPayload;
};

/** Slack 로 보내는 모양 — `text` = 알림 한 줄, `blocks` = 카드. */
export type SlackPayload = { text: string; blocks: Array<Record<string, unknown>> };

type DeliveryResult = "sent" | "failed" | "duplicate" | "in_flight";

async function deliver(supabase: Client, item: Delivery): Promise<DeliveryResult> {
  const base = {
    actor_id: item.actorId ?? null,
    channel_key: item.destination.channelKey,
    job_key: item.jobKey,
    locale: item.locale,
    message: item.text,
    message_hash: hashOf(item.text),
    // 카드는 meta 에 남겨 실패 재시도가 같은 카드를 다시 보낸다.
    meta: (item.slack ? { ...(item.meta ?? {}), slack: item.slack } : (item.meta ?? {})) as Json,
    organization_id: item.organizationId,
    target_date: item.targetDate,
    trigger: item.trigger,
  };

  // 줄을 먼저 잡는다(`sending` 실패로) → 보낸 뒤 결과로 고친다. 이미 있으면 다른 틱이 처리했거나 아직 보내는 중이다.
  const claimed = await supabase
    .from("automation_runs")
    .insert({ ...base, dedupe_key: item.dedupeKey ?? null, reason: "sending", status: "failed" })
    .select("id")
    .single();
  if (claimed.error) {
    if (claimed.error.code === "23505" && item.dedupeKey) {
      // 「보내는 중」으로 남은 줄(함수가 죽었을 수도)을 「이미 보냄」으로 치면 정시 발송이 그 한 통을 빼고 오늘을 끝낸다.
      const holder = await supabase
        .from("automation_runs")
        .select("status")
        .eq("organization_id", item.organizationId)
        .eq("dedupe_key", item.dedupeKey)
        .maybeSingle();
      return claimConflictKind(holder.data?.status);
    }
    console.error("[automation] run claim failed", { code: claimed.error.code, job: item.jobKey });
    return "failed";
  }

  let sent = item.slack
    ? await postToAutomationChannel(item.destination.channelKey, item.slack.text, item.slack.blocks)
    : await postToAutomationChannel(item.destination.channelKey, item.text);
  // 안전망 — Slack 이 카드 모양을 거절하면(400 · invalid_blocks 등) 같은 알림을 **글 모양으로 바로 다시** 보낸다.
  // 카드 모양 문제로 알림 자체가 안 나가는 일이 없게(2026-10-07 사용자 요구 「문제없이 발송」).
  if (item.slack && !sent.ok && sent.reason === "http_400") {
    console.warn("[automation] card rejected — sending as text", { job: item.jobKey });
    sent = await postToAutomationChannel(item.destination.channelKey, item.text);
  }
  await supabase
    .from("automation_runs")
    .update(
      sent.ok
        ? { reason: null, status: "sent" }
        : {
            // 실패하면 중복 방지 키를 **놓아 준다** — 안 그러면 재시도가 이 줄에 막혀 「이미 처리됨」이 되고 한 통도 안 나간 채
            // 오늘 일이 끝난다(2026-10-07 디버깅에서 발견). 원래 키는 meta 에 남겨 이벤트 재시도가 그 키로 다시 잡는다.
            dedupe_key: item.dedupeKey ? failedDedupeKey(item.dedupeKey, claimed.data.id) : null,
            meta: { ...(item.meta ?? {}), ...(item.slack ? { slack: item.slack } : {}), retryKey: item.dedupeKey ?? null } as Json,
            reason: sent.reason,
            status: "failed",
          },
    )
    .eq("id", claimed.data.id);
  return sent.ok ? "sent" : "failed";
}

function failedDedupeKey(dedupeKey: string, runId: string): string {
  return `${dedupeKey}#failed#${runId}`;
}

/**
 * 보내는 도중에 함수가 죽으면(시간 초과 · 배포 교체) 줄이 「보내는 중」(`reason = sending`)으로 남아 키를 쥔 채 재시도를 막는다.
 * 틱마다 오래된 것을 「중단됨」 실패로 바꾸고 키를 놓는다 — 정시 발송은 다음 재시도가, 이벤트는 실패분 재시도가 다시 보낸다.
 * 키를 쥐는 발송은 틱(`maxDuration` 60초) 안에서만 일어나므로 5분이 지난 「보내는 중」은 살아 있는 함수의 것일 수 없다.
 */
const STUCK_CLAIM_MS = 5 * 60 * 1000;

async function releaseStuckClaims(supabase: Client, now: Date): Promise<void> {
  const stuck = await supabase
    .from("automation_runs")
    .select("id, dedupe_key, meta")
    .eq("status", "failed")
    .eq("reason", "sending")
    .lt("created_at", new Date(now.getTime() - STUCK_CLAIM_MS).toISOString())
    .limit(100);
  for (const row of stuck.data ?? []) {
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    await supabase
      .from("automation_runs")
      .update({
        dedupe_key: row.dedupe_key ? failedDedupeKey(row.dedupe_key, row.id) : null,
        meta: { ...meta, retryKey: row.dedupe_key ?? null } as Json,
        reason: "interrupted",
      })
      .eq("id", row.id)
      .eq("reason", "sending");
  }
}

/** 이벤트 알림(취소 · 당일예약) 실패분 재시도 — 최근 이만큼 안의 실패만, 한 알림당 이 횟수까지. */
const EVENT_RETRY_WINDOW_MS = 2 * 60 * 60 * 1000;
const EVENT_RETRY_MAX_ATTEMPTS = 3;

/**
 * 이벤트 알림 실패분을 다시 보낸다. 커서는 이미 지나갔으므로 훑기로는 다시 안 잡힌다 — 실패한 줄의 원문 · 받는 곳 · 언어로
 * 그대로 다시 보낸다. 원래 키(`meta.retryKey`)로 잡으므로 다른 틱과 겹쳐도 한 번만, 성공하면 그 키가 「보냄」이 된다.
 * 같은 알림은 `EVENT_RETRY_MAX_ATTEMPTS` 번까지(웹훅이 아예 죽었을 때 매 분 두드리지 않게).
 */
async function retryFailedEventDeliveries(supabase: Client, organizationId: string, jobKey: AutomationJobKey, now: Date): Promise<number> {
  const failed = await supabase
    .from("automation_runs")
    .select("id, channel_key, locale, message, meta, target_date")
    .eq("organization_id", organizationId)
    .eq("job_key", jobKey)
    .eq("trigger", "event")
    .eq("status", "failed")
    .or("meta->>retried.is.null,meta->>retried.eq.false")
    .gte("created_at", new Date(now.getTime() - EVENT_RETRY_WINDOW_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(50);
  if (failed.error) {
    console.error("[automation] event retry read failed", { code: failed.error.code, job: jobKey });
    return 0;
  }
  const destinations = (await loadDestinations(supabase, organizationId))[jobKey];
  let resent = 0;
  for (const row of failed.data ?? []) {
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    const retryKey = typeof meta.retryKey === "string" ? meta.retryKey : null;
    const attempt = typeof meta.attempt === "number" ? meta.attempt : 1;
    if (!retryKey || meta.retried === true || !row.message || !row.locale || !row.channel_key) continue;
    // 이 줄은 재시도 대상에서 뺀다(성공이든 실패든 새 줄이 생긴다).
    await supabase.from("automation_runs").update({ meta: { ...meta, retried: true } as Json }).eq("id", row.id);
    if (attempt >= EVENT_RETRY_MAX_ATTEMPTS) continue;
    const destination = destinations.find((item) => item.channelKey === row.channel_key);
    if (!destination || !destination.locales.includes(row.locale as AutomationLocale)) continue;
    const slack = meta.slack && typeof meta.slack === "object" ? (meta.slack as SlackPayload) : undefined;
    const result = await deliver(supabase, {
      dedupeKey: retryKey,
      destination,
      jobKey,
      locale: row.locale as AutomationLocale,
      meta: { ...meta, attempt: attempt + 1, retried: false },
      slack,
      organizationId,
      targetDate: row.target_date,
      text: row.message,
      trigger: "event",
    });
    if (result === "sent") resent += 1;
  }
  return resent;
}

async function recordSkip(
  supabase: Client,
  organizationId: string,
  jobKey: AutomationJobKey,
  input: { trigger: RunTrigger; reason: string; targetDate: string | null; dedupeKey?: string | null; meta?: Record<string, unknown> },
) {
  const inserted = await supabase.from("automation_runs").insert({
    dedupe_key: input.dedupeKey ?? null,
    job_key: jobKey,
    meta: (input.meta ?? {}) as Json,
    organization_id: organizationId,
    reason: input.reason,
    status: "skipped",
    target_date: input.targetDate,
    trigger: input.trigger,
  });
  if (inserted.error && inserted.error.code !== "23505") {
    console.error("[automation] skip record failed", { code: inserted.error.code, job: jobKey });
  }
}

// ── 실패 알림 ────────────────────────────────────────────────────────────

/**
 * 실패 알림 — 「실패 알림」 자동화가 켜져 있고 받는 곳이 있으면 거기로(언어마다), 아니면 기존 운영 경보 채널
 * (`SLACK_OPS_ALERT_WEBHOOK_URL`)로. **업무 채널로 대신 보내지 않는다**(저쪽은 일일 → 청소 채널로 넘겼다).
 * 같은 제목 · 내용은 15분 동안 한 번(저쪽 `sync_alert_dedupe` 와 같은 창).
 */
export async function notifyAutomationFailure(
  supabase: Client,
  organizationId: string,
  failure: AutomationFailure,
): Promise<void> {
  const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
  const key = hashOf(JSON.stringify(failure));
  const today = tokyoClock(new Date()).date;
  try {
    const [jobs, destinations] = await Promise.all([loadJobs(supabase, organizationId), loadDestinations(supabase, organizationId)]);
    const job = jobs.failure_alert;
    const targets = destinations.failure_alert;
    if (job.enabled && targets.length > 0) {
      for (const destination of targets) {
        for (const locale of destination.locales) {
          const text = buildFailureAlertText(getDictionary(locale).automationMessages, failure, today);
          await deliver(supabase, {
            dedupeKey: `failure_alert:${key}:${bucket}:${destination.channelKey}:${locale}`,
            destination,
            jobKey: "failure_alert",
            locale,
            organizationId,
            targetDate: null,
            text,
            trigger: "event",
          });
        }
      }
      return;
    }
    await postSlackText(buildFailureAlertText(getDictionary("ko").automationMessages, failure, today));
  } catch (error) {
    console.error("[automation] failure alert failed", error instanceof Error ? error.message : error);
  }
}

// ── 시스템 경보(2026-10-08) ───────────────────────────────────────────────

/**
 * 시스템 경보 한 건 — 「실패 알림」 받는 곳으로(언어마다), 없으면 기존 운영 경보 채널. **사건 키당 한 번만**
 * (`automation_runs.dedupe_key = system:<key>:…`) — 같은 문제를 10분마다 다시 보내지 않는다. 받는 곳이 없어 아무 데도 못 보냈으면
 * 기록도 남기지 않는다 — 나중에 채널을 연결하면 아직 계속되는 문제는 그때 한 번 나간다.
 */
async function sendSystemAlert(supabase: Client, organizationId: string, alert: HealthAlert, now: Date): Promise<"sent" | "duplicate" | "failed" | "no_route"> {
  const today = tokyoClock(now).date;
  const [jobs, destinations] = await Promise.all([loadJobs(supabase, organizationId), loadDestinations(supabase, organizationId)]);
  const job = jobs.failure_alert;
  const targets = destinations.failure_alert;
  if (job.enabled && targets.length > 0) {
    let result: "sent" | "duplicate" | "failed" = "duplicate";
    for (const destination of targets) {
      for (const locale of destination.locales) {
        const text = buildHealthAlertText(getDictionary(locale).automationMessages, alert, today);
        const sent = await deliver(supabase, {
          dedupeKey: `system:${alert.key}:${destination.channelKey}:${locale}`,
          destination,
          jobKey: "failure_alert",
          locale,
          meta: { health: alert.kind },
          organizationId,
          targetDate: null,
          text,
          trigger: "event",
        });
        if (sent === "sent") result = "sent";
        else if (sent === "failed" && result !== "sent") result = "failed";
      }
    }
    return result;
  }
  // 기존 운영 경보 채널(SLACK_OPS_ALERT_WEBHOOK_URL) — 설정돼 있을 때만, 같은 사건은 한 번(줄을 먼저 잡는다).
  if (!process.env.SLACK_OPS_ALERT_WEBHOOK_URL?.trim()) return "no_route";
  const claimed = await supabase
    .from("automation_runs")
    .insert({ dedupe_key: `system:${alert.key}:ops`, job_key: "failure_alert", meta: { health: alert.kind } as Json, organization_id: organizationId, reason: "sending", status: "failed", trigger: "event" })
    .select("id")
    .single();
  if (claimed.error) return claimed.error.code === "23505" ? "duplicate" : "failed";
  const text = buildHealthAlertText(getDictionary("ko").automationMessages, alert, today);
  const posted = await postSlackText(text);
  await supabase
    .from("automation_runs")
    .update(posted.ok ? { message: text, reason: null, status: "sent" } : { message: text, reason: posted.reason, status: "failed" })
    .eq("id", claimed.data.id);
  return posted.ok ? "sent" : "failed";
}

/** 시스템 경보 점검 주기 — 1분 틱 중 10분마다(pg 함수도 이 분에 틱을 깨운다 — 202610080001). */
const HEALTH_EVERY_MINUTES = 10;

async function runHealthChecks(supabase: Client, organizationIds: string[], now: Date): Promise<string> {
  let sent = 0;
  for (const organizationId of organizationIds) {
    try {
      const alerts = await collectHealthAlerts(supabase, organizationId, now);
      for (const alert of alerts) if ((await sendSystemAlert(supabase, organizationId, alert, now)) === "sent") sent += 1;
    } catch (error) {
      console.error("[automation] health check failed", error instanceof Error ? error.message : error);
    }
  }
  return `health:${sent}`;
}

// ── 메시지 만들기(미리보기와 발송이 같은 함수) ───────────────────────────────

export type BuiltMessages = {
  targetDate: string | null;
  byLocale: Partial<Record<AutomationLocale, string>>;
  /** 취소 · 당일예약 카드(언어마다). 없으면 글로 보낸다. */
  slackByLocale?: Partial<Record<AutomationLocale, SlackPayload>>;
  meta: Record<string, unknown>;
};

async function buildDaily(
  supabase: Client,
  organizationId: string,
  job: StoredJob,
  reportDate: string,
  locales: AutomationLocale[],
  previous: DailySnapshot | null,
): Promise<{ built: BuiltMessages; stats: DailyStats }> {
  const [reservations, label] = await Promise.all([
    loadDailyReportReservations(supabase, organizationId, reportDate),
    loadPropertyLabeler(supabase, organizationId),
  ]);
  const stats = computeDailyStats({
    buildingOrder: AUTOMATION_BUILDING_ORDER,
    canonicalProperty: getCanonicalPropertyName,
    channels: job.settings.channels,
    excludedProperties: job.settings.excludedProperties,
    reportDate,
    reservations,
  });
  const byLocale: Partial<Record<AutomationLocale, string>> = {};
  for (const locale of locales) {
    const copy = getDictionary(locale).automationMessages;
    byLocale[locale] = buildDailyReportMessage({
      copy,
      locale,
      previous,
      propertyLabel: (name) => automationBuildingLabel(copy, "daily", name, (canonical) => label(canonical, locale)),
      stats,
    });
  }
  return { built: { byLocale, meta: { snapshot: dailySnapshotOf(stats) }, targetDate: reportDate }, stats };
}

async function buildCleaning(
  supabase: Client,
  organizationId: string,
  job: StoredJob,
  targetDate: string,
  locales: AutomationLocale[],
  correction: boolean,
): Promise<{ built: BuiltMessages; model: CleaningListModel }> {
  const [model, names, label] = await Promise.all([
    loadCleaningListModel(supabase, organizationId, targetDate, job.settings.excludedProperties),
    loadAssignees(supabase, organizationId, targetDate),
    loadPropertyLabeler(supabase, organizationId),
  ]);
  const byLocale: Partial<Record<AutomationLocale, string>> = {};
  for (const locale of locales) {
    const copy = getDictionary(locale).automationMessages;
    const plainLabel = (name: string) => label(name, locale);
    byLocale[locale] = buildCleaningListMessage({
      buildingOrder: AUTOMATION_BUILDING_ORDER,
      copy,
      correction,
      // 오쿠보 줄의 방 자리는 건물 이름 그대로(`*오쿠보A*`), 제목만 저쪽 이름(「오쿠보A (B동)」).
      model: withLocalizedCodes(model, plainLabel),
      names,
      propertyLabel: (name) => automationBuildingLabel(copy, "cleaning", name, plainLabel),
    });
  }
  return {
    built: {
      byLocale,
      meta: { dataIssues: model.dataIssues ?? [], names: Object.fromEntries(names), structureKey: hashOf(cleaningStructureKey(model)) },
      targetDate,
    },
    model,
  };
}

/** 정시 발송이 다루는 날 — 일일 리포트 = 어제, 청소 명단 = 오늘. */
export function scheduledTargetDate(jobKey: AutomationJobKey, now: Date): string {
  const today = tokyoClock(now).date;
  return jobKey === "daily_report" ? ymdShift(today, -1) : today;
}

/**
 * 화면 미리보기 — 보내지 않고 만들기만. 일일 리포트 · 청소 명단은 날짜, 이벤트형은 최근 예약 한 건으로.
 */
export async function buildPreview(
  supabase: Client,
  organizationId: string,
  jobKey: AutomationJobKey,
  input: { date: string; locale: AutomationLocale },
): Promise<{ text: string; targetDate: string | null; sampleId: string | null; card?: AlertCard }> {
  const jobs = await loadJobs(supabase, organizationId);
  const job = jobs[jobKey];
  if (jobKey === "daily_report") {
    const { built } = await buildDaily(supabase, organizationId, job, input.date, [input.locale], null);
    return { sampleId: null, targetDate: input.date, text: built.byLocale[input.locale] ?? "" };
  }
  if (jobKey === "cleaning_list") {
    const { built } = await buildCleaning(supabase, organizationId, job, input.date, [input.locale], false);
    return { sampleId: null, targetDate: input.date, text: built.byLocale[input.locale] ?? "" };
  }
  if (jobKey === "failure_alert") {
    const copy = getDictionary(input.locale).automationMessages;
    return { sampleId: null, targetDate: null, text: [fill(copy.failure.title, { title: copy.failure.sampleTitle }), copy.failure.sampleLine].join("\n") };
  }
  const sample = await latestEventSample(supabase, organizationId, jobKey);
  if (!sample) return { sampleId: null, targetDate: null, text: "" };
  const alert = await buildAlert(supabase, organizationId, jobKey, sample, input.locale);
  return { card: alert.card, sampleId: sample.id, targetDate: null, text: alert.text };
}

async function latestEventSample(
  supabase: Client,
  organizationId: string,
  jobKey: AutomationJobKey,
): Promise<AutomationReservation | null> {
  let query = supabase.from("reservations").select(AUTOMATION_RESERVATION_SELECT).eq("organization_id", organizationId);
  query = jobKey === "cancel_alert" ? query.eq("status", "cancelled") : query.eq("status", "confirmed");
  const result = await query.order("updated_at", { ascending: false }).limit(1);
  const row = (result.data as unknown as Record<string, unknown>[] | null)?.[0];
  return row ? toAutomationReservation(row) : null;
}

async function buildAlert(
  supabase: Client,
  organizationId: string,
  jobKey: AutomationJobKey,
  reservation: AutomationReservation,
  locale: AutomationLocale,
  labeler?: (name: string, locale: AutomationLocale) => string,
): Promise<{ card: AlertCard; text: string; slack: SlackPayload }> {
  const label = labeler ?? (await loadPropertyLabeler(supabase, organizationId));
  const canonical = getCanonicalPropertyName(reservation.propertyName);
  // 방 코드 — 청소 명단과 같은 이름(AA302 · K802 · T4 · 308). 오쿠보처럼 건물 = 방이면 없음(객실 칸을 뺀다).
  const room = cleaningRoomCode(canonical, getDisplayRoomLabel(canonical, getCanonicalRoomLabel(canonical, reservation.roomLabel))) ?? "";
  const base = appBaseUrl();
  const card = buildReservationAlertCard({
    copy: getDictionary(locale).automationMessages,
    kind: jobKey === "cancel_alert" ? "cancel" : "same_day",
    // 바로가기 — 받는 사람의 권한 · 기기를 보고 판매 캘린더(PC/폰)로 보내거나 「권한 없음」을 보여 준다(`/go/reservation`).
    openUrl: base ? `${base}${reservationShortcutPath(reservation.id)}` : null,
    propertyLabel: label(canonical, locale),
    reservation,
    roomLabel: room,
    today: tokyoClock(new Date()).date,
  });
  return { card, slack: { blocks: alertCardBlocks(card), text: card.notify }, text: alertCardText(card) };
}

// ── 시각형: 정시 · 재시도 · 변동 재전송 · 정정본 · 지금 보내기 ───────────────────

function allLocales(destinations: AutomationDestination[]): AutomationLocale[] {
  return [...new Set(destinations.flatMap((item) => item.locales))];
}

async function sendBuilt(
  supabase: Client,
  organizationId: string,
  jobKey: AutomationJobKey,
  destinations: AutomationDestination[],
  built: BuiltMessages,
  /** `plan` = 받는 곳 × 언어 → 중복 방지 꼬리(`planFollowUpTargets`). 있으면 거기 있는 곳에만 보낸다. */
  input: { trigger: RunTrigger; dedupeSuffix: string | null; plan?: Map<string, string>; actorId?: string | null },
): Promise<{ sent: number; failed: number; inFlight: number }> {
  let sent = 0;
  let failed = 0;
  let inFlight = 0;
  for (const destination of destinations) {
    for (const locale of destination.locales) {
      const text = built.byLocale[locale];
      if (!text) continue;
      const suffix = input.plan ? input.plan.get(targetKey(destination.channelKey, locale)) : input.dedupeSuffix;
      if (input.plan && !suffix) continue;
      const result = await deliver(supabase, {
        actorId: input.actorId,
        dedupeKey: suffix ? `${jobKey}:${built.targetDate}:${suffix}:${destination.channelKey}:${locale}` : null,
        destination,
        jobKey,
        locale,
        meta: built.meta,
        organizationId,
        slack: built.slackByLocale?.[locale],
        targetDate: built.targetDate,
        text,
        trigger: input.trigger,
      });
      if (result === "sent") sent += 1;
      if (result === "failed") failed += 1;
      if (result === "in_flight") inFlight += 1;
    }
  }
  return { failed, inFlight, sent };
}

/** 그날 **보낸** 줄 — 가장 최근 meta(재전송 메시지의 「변동」 기준) · 받는 곳 × 언어마다 마지막 줄(재전송 · 정정본 판정 기준). */
async function lastSentMeta(
  supabase: Client,
  organizationId: string,
  jobKey: AutomationJobKey,
  targetDate: string,
): Promise<{ meta: Record<string, unknown>; byTarget: Map<string, SentRunRow>; resendsToday: number } | null> {
  const result = await supabase
    .from("automation_runs")
    .select("id, channel_key, locale, meta, trigger, created_at")
    .eq("organization_id", organizationId)
    .eq("job_key", jobKey)
    .eq("target_date", targetDate)
    .eq("status", "sent")
    .order("created_at", { ascending: false })
    .limit(300);
  const rows = result.data ?? [];
  if (rows.length === 0) return null;
  const resendsToday = new Set(
    rows.filter((row) => row.trigger === "resend" || row.trigger === "correction").map((row) => row.created_at.slice(0, 16)),
  ).size;
  const byTarget = latestSentByTarget(
    rows.map((row) => ({ channel_key: row.channel_key, id: row.id, locale: row.locale, meta: (row.meta ?? {}) as Record<string, unknown> })),
  );
  return { byTarget, meta: (rows[0].meta ?? {}) as Record<string, unknown>, resendsToday };
}

function snapshotFrom(meta: Record<string, unknown>): DailySnapshot | null {
  const value = meta.snapshot as Partial<DailySnapshot> | undefined;
  if (!value || typeof value !== "object") return null;
  const n = (x: unknown) => (typeof x === "number" ? x : Number(x) || 0);
  return { mtdNew: n(value.mtdNew), revenue: n(value.revenue), totalCancel: n(value.totalCancel), totalNew: n(value.totalNew) };
}

async function updateJobState(
  supabase: Client,
  organizationId: string,
  jobKey: AutomationJobKey,
  patch: Database["public"]["Tables"]["automation_jobs"]["Update"],
) {
  const result = await supabase.from("automation_jobs").update(patch).eq("organization_id", organizationId).eq("job_key", jobKey);
  if (result.error) console.error("[automation] job state update failed", { code: result.error.code, job: jobKey });
}

async function runScheduledJob(supabase: Client, organizationId: string, job: StoredJob, now: Date): Promise<string> {
  const jobKey = job.jobKey;
  const today = tokyoClock(now).date;
  const targetDate = scheduledTargetDate(jobKey, now);
  const destinations = (await loadDestinations(supabase, organizationId))[jobKey];
  // 발송 시각 직후(틱 지연 1분까지)는 정시, 그 뒤는 재시도.
  const trigger: RunTrigger = tokyoClock(now).minutes <= hhmmToMinutes(job.sendTime) + 1 ? "scheduled" : "retry";
  const recheckUntil = job.settings.resend.enabled ? job.settings.resend.until : null;

  if (destinations.length === 0) {
    await recordSkip(supabase, organizationId, jobKey, { dedupeKey: `${jobKey}:${targetDate}:no_destination`, reason: "no_destination", targetDate, trigger });
    await updateJobState(supabase, organizationId, jobKey, {
      last_done_on: today,
      next_wake_at: computeNextWake({ ...job, lastDoneOn: today, recheckUntil: null }, now)?.toISOString() ?? null,
    });
    return "no_destination";
  }

  const gate = await checkReservationGate(supabase, now);
  if (!gate.ok) {
    const giveUp = isPastRetryDeadline(job, now);
    await recordSkip(supabase, organizationId, jobKey, {
      dedupeKey: `${jobKey}:${targetDate}:gate:${giveUp ? "final" : "first"}`,
      meta: { ageMinutes: gate.ageMinutes, lastSyncAt: gate.lastSyncAt },
      reason: "gate_stale",
      targetDate,
      trigger,
    });
    if (giveUp) {
      await notifyAutomationFailure(supabase, organizationId, { date: targetDate, jobKey, kind: "gate_stale", lastSyncAt: gate.lastSyncAt });
      await updateJobState(supabase, organizationId, jobKey, {
        last_done_on: today,
        next_wake_at: computeNextWake({ ...job, lastDoneOn: today, recheckUntil: null }, now)?.toISOString() ?? null,
      });
      return "gate_final";
    }
    await updateJobState(supabase, organizationId, jobKey, {
      next_wake_at: computeNextWake({ ...job, recheckUntil: null }, now, { retryAfterFailure: true })?.toISOString() ?? null,
    });
    return "gate_wait";
  }

  const locales = allLocales(destinations);
  const built =
    jobKey === "daily_report"
      ? (await buildDaily(supabase, organizationId, job, targetDate, locales, null)).built
      : (await buildCleaning(supabase, organizationId, job, targetDate, locales, false)).built;
  const result = await sendBuilt(supabase, organizationId, jobKey, destinations, built, { dedupeSuffix: "scheduled", trigger });
  // 청소 명단 — 필수 정보가 빠진 예약이 있으면 명단 끝 경고와 별도로 관리자에게도 알린다(정시 발송 한 번만).
  const issues = (built.meta.dataIssues as Array<{ code: string; bookingId: string }> | undefined) ?? [];
  if (jobKey === "cleaning_list" && issues.length > 0 && result.sent > 0) {
    await notifyAutomationFailure(supabase, organizationId, { date: targetDate, issues, kind: "data_issue" });
  }

  const done = isScheduledRunDone({ failed: result.failed, inFlight: result.inFlight, pastDeadline: isPastRetryDeadline(job, now) });
  if (result.failed > 0) {
    await notifyAutomationFailure(supabase, organizationId, { date: targetDate, failed: result.failed, jobKey, kind: "send_failed", sent: result.sent });
  }
  await updateJobState(supabase, organizationId, jobKey, {
    ...(done ? { last_done_on: today } : {}),
    next_wake_at:
      computeNextWake({ ...job, lastDoneOn: done ? today : job.lastDoneOn, recheckEveryMinutes: job.settings.resend.debounceMinutes, recheckUntil }, now, { retryAfterFailure: !done })?.toISOString() ?? null,
  });
  return done ? "sent" : "retry";
}

/** 보낸 뒤 확인 — 일일 리포트는 숫자가 바뀌면 변동 재전송, 청소 명단은 예약이 바뀌면 정정본. */
async function recheckJob(supabase: Client, organizationId: string, job: StoredJob, now: Date): Promise<string> {
  const jobKey = job.jobKey;
  const targetDate = scheduledTargetDate(jobKey, now);
  const resend = job.settings.resend;
  const next = () =>
    updateJobState(supabase, organizationId, jobKey, {
      next_wake_at: computeNextWake({ ...job, recheckEveryMinutes: resend.debounceMinutes, recheckUntil: resend.enabled ? resend.until : null }, now)?.toISOString() ?? null,
    });
  if (!resend.enabled) {
    await next();
    return "recheck_off";
  }
  const last = await lastSentMeta(supabase, organizationId, jobKey, targetDate);
  if (!last || last.resendsToday >= resend.maxPerDay) {
    await next();
    return last ? "resend_limit" : "nothing_sent";
  }
  const destinations = (await loadDestinations(supabase, organizationId))[jobKey];
  if (destinations.length === 0) {
    await next();
    return "no_destination";
  }
  const locales = allLocales(destinations);
  const targets = destinations.flatMap((destination) => destination.locales.map((locale) => ({ channelKey: destination.channelKey, locale })));

  if (jobKey === "daily_report") {
    const previous = snapshotFrom(last.meta);
    const { built, stats } = await buildDaily(supabase, organizationId, job, targetDate, locales, previous);
    const current = dailySnapshotOf(stats);
    const plan = planFollowUpTargets({
      differs: (meta) => {
        const sent = snapshotFrom(meta);
        return sent !== null && !sameSnapshot(sent, current);
      },
      fingerprint: hashOf(JSON.stringify(current)).slice(0, 12),
      latest: last.byTarget,
      prefix: "resend",
      targets,
    });
    if (plan.size === 0) {
      await next();
      return "unchanged";
    }
    await sendBuilt(supabase, organizationId, jobKey, destinations, built, { dedupeSuffix: null, plan, trigger: "resend" });
    await next();
    return "resent";
  }

  const { built } = await buildCleaning(supabase, organizationId, job, targetDate, locales, true);
  const structureKey = String(built.meta.structureKey);
  // 「마지막으로 보낸 내용과 다른가」 — 받는 곳 × 언어마다(한 곳만 못 받았으면 그곳만 다시).
  const plan = planFollowUpTargets({
    differs: (meta) => meta.structureKey !== structureKey,
    fingerprint: structureKey.slice(0, 12),
    latest: last.byTarget,
    prefix: "correction",
    targets,
  });
  if (plan.size === 0) {
    await next();
    return "unchanged";
  }
  // 묶어 보내기 — 바뀐 명단이 **한 번 더 확인할 때까지(확인 간격) 그대로면** 보낸다. 예약이 연달아 바뀌는 동안
  // 정정본을 여러 통 보내지 않고 한 통으로 모은다(2026-10-07 결정 — 하루 횟수 상한 대신).
  const pending = await supabase
    .from("automation_runs")
    .select("meta")
    .eq("organization_id", organizationId)
    .eq("job_key", jobKey)
    .eq("target_date", targetDate)
    .eq("status", "skipped")
    .eq("reason", "correction_pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const pendingKey = (pending.data?.meta as { structureKey?: string } | null)?.structureKey ?? null;
  if (pendingKey !== structureKey) {
    await recordSkip(supabase, organizationId, jobKey, {
      // 중복 방지 키 없음 — A → B → A 로 되돌아가도 A 를 다시 「대기」로 적어야 한다.
      dedupeKey: null,
      meta: { structureKey },
      reason: "correction_pending",
      targetDate,
      trigger: "correction",
    });
    await next();
    return "correction_pending";
  }
  await sendBuilt(supabase, organizationId, jobKey, destinations, built, { dedupeSuffix: null, plan, trigger: "correction" });
  await next();
  return "corrected";
}

/** 「지금 보내기」 · 「정정본 보내기」 — 발송 토글과 상관없이, 사람이 누른 그 자리에서. */
export async function sendJobNow(
  supabase: Client,
  organizationId: string,
  jobKey: AutomationJobKey,
  input: { actorId: string; date: string; correction?: boolean },
): Promise<{ sent: number; failed: number; reason?: "no_destination" | "no_sample" }> {
  const [jobs, destinationsByJob] = await Promise.all([loadJobs(supabase, organizationId), loadDestinations(supabase, organizationId)]);
  const job = jobs[jobKey];
  const destinations = destinationsByJob[jobKey];
  if (destinations.length === 0) return { failed: 0, reason: "no_destination", sent: 0 };
  const locales = allLocales(destinations);

  let built: BuiltMessages;
  if (jobKey === "daily_report") {
    built = (await buildDaily(supabase, organizationId, job, input.date, locales, null)).built;
  } else if (jobKey === "cleaning_list") {
    built = (await buildCleaning(supabase, organizationId, job, input.date, locales, !!input.correction)).built;
  } else if (jobKey === "failure_alert") {
    const byLocale: BuiltMessages["byLocale"] = {};
    for (const locale of locales) {
      const copy = getDictionary(locale).automationMessages;
      byLocale[locale] = [fill(copy.failure.title, { title: copy.failure.sampleTitle }), copy.failure.sampleLine].join("\n");
    }
    built = { byLocale, meta: { test: true }, targetDate: null };
  } else {
    const sample = await latestEventSample(supabase, organizationId, jobKey);
    if (!sample) return { failed: 0, reason: "no_sample", sent: 0 };
    const labeler = await loadPropertyLabeler(supabase, organizationId);
    const byLocale: BuiltMessages["byLocale"] = {};
    const slackByLocale: NonNullable<BuiltMessages["slackByLocale"]> = {};
    for (const locale of locales) {
      const alert = await buildAlert(supabase, organizationId, jobKey, sample, locale, labeler);
      byLocale[locale] = alert.text;
      slackByLocale[locale] = alert.slack;
    }
    built = { byLocale, meta: { reservationId: sample.id }, slackByLocale, targetDate: null };
  }
  return sendBuilt(supabase, organizationId, jobKey, destinations, built, {
    actorId: input.actorId,
    dedupeSuffix: null,
    trigger: input.correction ? "correction" : "manual",
  });
}

// ── 이벤트형: 취소 · 당일예약 ──────────────────────────────────────────────

/**
 * 커서 뒤에 바뀐 예약 중 **알림이 될 수 있는 것만** 골라 보낸다(2026-10-07 — 실시간이 제일 중요).
 *
 * - 웹훅 처리 코드는 건드리지 않는다 — 웹훅이든 정합성이든 예약 표가 바뀌면 1분 안에 여기서 잡힌다.
 * - **DB 에서 미리 거른다**(취소 = `cancelled`, 당일예약 = 오늘 입실 · 취소 아님). 예전에는 바뀐 예약을 전부 300건씩 훑어서,
 *   2026-10-07 11:30 경 예약 약 12,800건이 한꺼번에 다시 저장되자 그것을 다 훑는 15분 동안 그 사이 진짜 취소도 늦게 나갔다.
 * - **켠 시각 이후에 생긴 일만**(`enabledAt`): 취소 시각 · 예약 시각이 켠 뒤인 것. 켜기 전 일은 사람이 이미 손으로 알렸고,
 *   같은 일괄 저장으로 켜기 전 24시간 안의 취소 8건 · 당일예약 1건이 늦게 나간 적이 있다.
 * - 커서는 「지금 − 5분」까지만 민다 — 오래 걸리는 일괄 저장은 수정 시각이 저장 시작 시각이라 커밋이 늦게 보인다. 겹쳐 다시 본
 *   예약은 `dedupe_key`(예약 × 받는 곳 × 언어)가 두 번 보내지 않게 막는다.
 */
const EVENT_CURSOR_OVERLAP_MS = 5 * 60 * 1000;

async function scanEventJob(supabase: Client, organizationId: string, job: StoredJob, now: Date): Promise<string> {
  const jobKey = job.jobKey;
  const retried = await retryFailedEventDeliveries(supabase, organizationId, jobKey, now);
  const cursor = job.eventCursor ?? now.toISOString();
  const today = tokyoClock(now).date;
  const scanned = await readAllPages<Record<string, unknown>>((from, to) => {
    let query = supabase
      .from("reservations")
      .select(AUTOMATION_RESERVATION_SELECT)
      .eq("organization_id", organizationId)
      .gt("updated_at", cursor)
      .lte("updated_at", now.toISOString());
    query = jobKey === "cancel_alert" ? query.eq("status", "cancelled") : query.neq("status", "cancelled").eq("check_in_date", today);
    return query
      .order("updated_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
  });
  if (scanned.error) {
    console.error("[automation] event scan failed", { job: jobKey, message: scanned.error.message });
    return "scan_failed";
  }
  const rows = scanned.data.map(toAutomationReservation);
  const overlapCursor = new Date(now.getTime() - EVENT_CURSOR_OVERLAP_MS).toISOString();
  const nextCursor = Date.parse(overlapCursor) > Date.parse(cursor) ? overlapCursor : cursor;

  const excluded = new Set(job.settings.excludedProperties);
  const freshFloor = now.getTime() - CANCEL_FRESH_MS;
  const enabledMs = job.enabledAt ? Date.parse(job.enabledAt) : Number.NaN;
  const cancelSince = new Date(Number.isFinite(enabledMs) ? Math.max(enabledMs, freshFloor) : freshFloor).toISOString();
  const matches = rows.filter((row) => {
    if (excluded.has(getCanonicalPropertyName(row.propertyName))) return false;
    return jobKey === "cancel_alert" ? isFreshCancellation(row, cancelSince) : isSameDayBookingSince(row, today, job.enabledAt);
  });

  if (matches.length > 0) {
    const [destinations, labeler] = await Promise.all([
      loadDestinations(supabase, organizationId).then((all) => all[jobKey]),
      loadPropertyLabeler(supabase, organizationId),
    ]);
    // 이미 알린 예약 × 채널은 **언어와 상관없이** 다시 보내지 않는다(2026-10-08 — 채널 언어를 ja → ko 로 바꾼 뒤 같은 예약이 다시
    // 저장되자 한국어로 한 번 더 나갔다). 중복 방지 키는 언어까지 있어 그것만으로는 못 막는다. 이번 틱 이전의 이벤트 발송만 본다
    // (같은 순간 여러 언어로 나가는 것은 그대로, 「지금 보내기」 시험은 판단에서 뺀다).
    const alreadySent = await loadSentEventPairs(supabase, organizationId, jobKey, matches.map((item) => item.id), now);
    let failed = 0;
    for (const reservation of matches) {
      for (const destination of destinations) {
        if (alreadySent.has(`${reservation.id}|${destination.channelKey}`)) continue;
        for (const locale of destination.locales) {
          const alert = await buildAlert(supabase, organizationId, jobKey, reservation, locale, labeler);
          const result = await deliver(supabase, {
            dedupeKey: `${jobKey}:${reservation.id}:${destination.channelKey}:${locale}`,
            destination,
            jobKey,
            locale,
            meta: { reservationId: reservation.id },
            organizationId,
            slack: alert.slack,
            targetDate: null,
            text: alert.text,
            trigger: "event",
          });
          if (result === "failed") failed += 1;
        }
      }
    }
    if (failed > 0) {
      await notifyAutomationFailure(supabase, organizationId, { date: null, failed, jobKey, kind: "send_failed", sent: 0 });
    }
  }

  if (nextCursor !== job.eventCursor) await updateJobState(supabase, organizationId, jobKey, { event_cursor: nextCursor });
  if (rows.length === 0) return retried > 0 ? `idle:retried:${retried}` : "idle";
  return `scanned:${rows.length}:${matches.length}${retried > 0 ? `:retried:${retried}` : ""}`;
}

/** 이번 틱 전에 이벤트 알림으로 보낸 「예약 | 채널」 — 언어 무관 중복 방지. */
async function loadSentEventPairs(
  supabase: Client,
  organizationId: string,
  jobKey: AutomationJobKey,
  reservationIds: string[],
  now: Date,
): Promise<Set<string>> {
  const pairs = new Set<string>();
  if (reservationIds.length === 0) return pairs;
  const result = await supabase
    .from("automation_runs")
    .select("channel_key, rid:meta->>reservationId")
    .eq("organization_id", organizationId)
    .eq("job_key", jobKey)
    .eq("trigger", "event")
    .eq("status", "sent")
    .in("meta->>reservationId", reservationIds)
    .lt("created_at", now.toISOString());
  if (result.error) {
    // 읽지 못하면 막지 않는다 — 언어별 중복 방지 키는 그대로 있다.
    console.error("[automation] sent pair read failed", { code: result.error.code, job: jobKey });
    return pairs;
  }
  for (const row of (result.data ?? []) as unknown as Array<{ channel_key: string | null; rid: string | null }>) {
    if (row.rid && row.channel_key) pairs.add(`${row.rid}|${row.channel_key}`);
  }
  return pairs;
}

// ── 1분 틱 ────────────────────────────────────────────────────────────────

export type TickSummary = { status: "busy" | "done"; results: Array<{ organizationId: string; jobKey: string; result: string }> };

export async function runAutomationTick(supabase: Client, now = new Date()): Promise<TickSummary> {
  const lock = await acquireBeds24Lock(supabase, TICK_LOCK, "automation-tick", TICK_LOCK_TTL_MS);
  if (!lock.acquired) return { results: [], status: "busy" };
  const results: TickSummary["results"] = [];
  try {
    await releaseStuckClaims(supabase, now);
    const rows = await supabase.from("automation_jobs").select("*").eq("enabled", true);
    if (rows.error) throw new Error(rows.error.message);
    if (tokyoClock(now).minutes % HEALTH_EVERY_MINUTES === 0) {
      const organizationIds = [...new Set((rows.data ?? []).map((row) => row.organization_id))];
      results.push({ jobKey: "system_health", organizationId: organizationIds.join(","), result: await runHealthChecks(supabase, organizationIds, now) });
    }
    for (const row of rows.data ?? []) {
      const job = toStoredJob(row);
      const organizationId = row.organization_id;
      try {
        let result = "skip";
        if (AUTOMATION_JOB_KIND[job.jobKey] === "event") {
          if (job.jobKey !== "failure_alert") result = await scanEventJob(supabase, organizationId, job, now);
        } else if (isScheduledSendDue(job, now)) {
          result = await runScheduledJob(supabase, organizationId, job, now);
        } else if (job.nextWakeAt && Date.parse(job.nextWakeAt) <= now.getTime()) {
          result =
            job.lastDoneOn === tokyoClock(now).date
              ? await recheckJob(supabase, organizationId, job, now)
              : "rescheduled";
          if (result === "rescheduled") {
            await updateJobState(supabase, organizationId, job.jobKey, {
              next_wake_at:
                computeNextWake({ ...job, recheckEveryMinutes: job.settings.resend.debounceMinutes, recheckUntil: job.settings.resend.enabled ? job.settings.resend.until : null }, now)?.toISOString() ?? null,
            });
          }
        }
        results.push({ jobKey: job.jobKey, organizationId, result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[automation] job failed", { job: job.jobKey, message });
        results.push({ jobKey: job.jobKey, organizationId, result: "error" });
        await notifyAutomationFailure(supabase, organizationId, { error: message, jobKey: job.jobKey, kind: "error" });
        if (AUTOMATION_JOB_KIND[job.jobKey] === "scheduled") {
          await updateJobState(supabase, organizationId, job.jobKey, {
            next_wake_at: computeNextWake({ ...job, recheckUntil: null }, now, { retryAfterFailure: true })?.toISOString() ?? null,
          });
        }
      }
    }
  } finally {
    await releaseBeds24Lock(supabase, TICK_LOCK, lock.lockId);
  }
  return { results, status: "done" };
}
