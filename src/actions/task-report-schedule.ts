"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { stuckSendingOrFilter } from "@/lib/task-report-stuck";
import {
  generateDailyReport,
  sendDailyReportToSlack,
  type SlackSendFailureReason,
} from "@/actions/task-report";

/**
 * 업무일지 예약 보내기(2026-10-20, 시안 「업무일지 예약 보내기 · 시안」 A안).
 *
 * 시트에서 「보낼 시각」을 고르면 **그 순간의 본문**을 `task_report_schedules` 에 저장하고, 그 시각에 서버(`/api/tasks/report-tick`)가
 * Slack 으로 보낸다 — 앱이 꺼져 있어도. 한 사람 · 한 날짜에 살아 있는 예약은 하나라 다시 예약하면 이전 것을 취소하고 새로 넣는다.
 * 권한은 지금 보내기와 같다(`generateDailyReport` 가 다시 본다), 보낼 때 틱이 또 본다. docs/product/18-todo-task-workflow.md 「업무일지 예약 보내기」
 */

export type ReportScheduleStatus = "scheduled" | "sending" | "sent" | "failed" | "cancelled";
export type ReportScheduleView = {
  status: ReportScheduleStatus;
  sendAt: string;
  sentAt: string | null;
  error: string | null;
  /** 예약해 둔 본문 — 시트가 다시 열릴 때 그대로 보여 준다(본인 것만, `getReportSchedule` · 예약 직후). */
  body?: string;
};
export type ScheduleReportResult =
  | { ok: true; schedule: ReportScheduleView }
  | { ok: false; reason: "forbidden" | "empty" | "error" | "too_long" | "past" | "too_far" | "busy" };

/** 예약은 지금부터 1분 뒤 ~ 48시간 안. */
const MIN_LEAD_MS = 60_000;
const MAX_LEAD_MS = 48 * 3_600_000;

const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

type Row = { status: string; send_at: string; sent_at: string | null; error: string | null; body?: string };

function view(row: Row): ReportScheduleView {
  return { status: row.status as ReportScheduleStatus, sendAt: row.send_at, sentAt: row.sent_at, error: row.error, ...(row.body ? { body: row.body } : {}) };
}

async function me() {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return null;
  return session;
}

/**
 * 이 날짜에 10분 넘게 「보내는 중」인 행을 `failed`('stuck')로 푼다 — 틱과 같은 기준(`src/lib/task-report-stuck.ts`).
 * 지금 보내기가 도중에 멈춰 남은 행 때문에 그 날짜가 계속 `busy` 로 막히지 않게, 예약 · 지금 보내기 앞에서 먼저 부른다.
 */
async function releaseStuckSending(
  service: ReturnType<typeof getSupabaseServiceClient>,
  organizationId: string,
  userId: string,
  day: string,
) {
  const { error } = await service
    .from("task_report_schedules")
    .update({ status: "failed", error: "stuck" })
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .eq("report_date", day)
    .eq("status", "sending")
    .or(stuckSendingOrFilter(Date.now()));
  if (error) console.warn("[report-schedule] release stuck failed:", error.message);
}

/** 이 날짜의 최근 예약(취소된 것 빼고). 없으면 null. */
export async function getReportSchedule(date: string): Promise<ReportScheduleView | null> {
  const day = String(date ?? "").trim();
  const session = await me();
  if (!session || !isDay(day)) return null;
  const { data } = await getSupabaseServiceClient()
    .from("task_report_schedules")
    .select("status, send_at, sent_at, error, body")
    .eq("user_id", session.user.id)
    .eq("organization_id", session.organization.id)
    .eq("report_date", day)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? view(data as Row) : null;
}

/** 여러 날짜를 한 번에 — 투두 「완료 · 기록」 날짜 줄의 「19:00 예약」 · 「19:00 보냄」. */
export async function listReportSchedules(dates: string[]): Promise<Record<string, ReportScheduleView>> {
  const days = [...new Set((dates ?? []).map((d) => String(d).trim()).filter(isDay))].slice(0, 62);
  const session = await me();
  if (!session || days.length === 0) return {};
  const { data } = await getSupabaseServiceClient()
    .from("task_report_schedules")
    .select("report_date, status, send_at, sent_at, error, created_at")
    .eq("user_id", session.user.id)
    .eq("organization_id", session.organization.id)
    .in("report_date", days)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false });
  const out: Record<string, ReportScheduleView> = {};
  for (const row of (data ?? []) as (Row & { report_date: string })[]) {
    if (!out[row.report_date]) out[row.report_date] = view(row);
  }
  return out;
}

export async function scheduleDailyReport(date: string, editedText: string, sendAtIso: string): Promise<ScheduleReportResult> {
  const day = String(date ?? "").trim();
  const text = String(editedText ?? "").trim();
  if (!isDay(day) || !text) return { ok: false, reason: "error" };
  if (text.length > 40_000) return { ok: false, reason: "too_long" };
  const sendAt = Date.parse(String(sendAtIso ?? ""));
  if (!Number.isFinite(sendAt)) return { ok: false, reason: "error" };
  const now = Date.now();
  if (sendAt < now + MIN_LEAD_MS) return { ok: false, reason: "past" };
  if (sendAt > now + MAX_LEAD_MS) return { ok: false, reason: "too_far" };

  // 권한 · 빈 일지 — 지금 보내기와 같은 판정.
  const generated = await generateDailyReport(day);
  if (!generated.ok) return { ok: false, reason: generated.reason };

  const session = await me();
  if (!session) return { ok: false, reason: "forbidden" };
  const service = getSupabaseServiceClient();

  // 보내는 중이면 바꾸지 않는다(곧 끝난다). 10분 넘게 갇힌 것은 먼저 푼다.
  await releaseStuckSending(service, session.organization.id, session.user.id, day);
  const { data: active, error: activeError } = await service
    .from("task_report_schedules")
    .select("id, status")
    .eq("user_id", session.user.id)
    .eq("organization_id", session.organization.id)
    .eq("report_date", day)
    .in("status", ["scheduled", "sending"]);
  if (activeError) return { ok: false, reason: "error" };
  const activeRows = (active ?? []) as { id: string; status: string }[];
  if (activeRows.some((row) => row.status === "sending")) return { ok: false, reason: "busy" };

  // 살아 있는 예약이 있으면 **그 행을 고쳐 쓴다**(2026-10-26). 예전엔 «취소 → 새로 넣기» 두 단계라 넣기가
  // 실패하면 원래 예약까지 사라졌다. 「살아 있는 예약은 하나」 부분 유니크 인덱스 때문에 «넣고 나서 취소»는
  // 안 되므로, 한 번의 UPDATE 로 본문 · 시각만 바꾼다 — 실패해도 이전 예약은 그대로 남는다.
  // `status = scheduled` 조건으로, 그 사이 틱이 집어 가(sending) 바뀐 행은 건드리지 않는다.
  if (activeRows.length > 0) {
    const { data: updated, error: updateError } = await service
      .from("task_report_schedules")
      .update({ body: text, send_at: new Date(sendAt).toISOString(), error: null })
      .eq("id", activeRows[0].id)
      .eq("user_id", session.user.id)
      .eq("organization_id", session.organization.id)
      .eq("status", "scheduled")
      .select("status, send_at, sent_at, error, body")
      .maybeSingle();
    if (updateError) {
      console.warn("[report-schedule] update failed:", updateError.message);
      return { ok: false, reason: "error" };
    }
    if (!updated) return { ok: false, reason: "busy" };
    revalidatePath("/mobile/tasks");
    revalidatePath("/admin/tasks");
    return { ok: true, schedule: view(updated as Row) };
  }

  const { data, error } = await service
    .from("task_report_schedules")
    .insert({
      organization_id: session.organization.id,
      user_id: session.user.id,
      report_date: day,
      body: text,
      send_at: new Date(sendAt).toISOString(),
    })
    .select("status, send_at, sent_at, error, body")
    .single();
  if (error || !data) {
    // 부분 유니크(살아 있는 예약 하나) 위반 = 다른 창에서 방금 예약했다.
    if (error?.code === "23505") return { ok: false, reason: "busy" };
    console.warn("[report-schedule] insert failed:", error?.message);
    return { ok: false, reason: "error" };
  }
  revalidatePath("/mobile/tasks");
  revalidatePath("/admin/tasks");
  return { ok: true, schedule: view(data as Row) };
}

export async function cancelDailyReportSchedule(date: string): Promise<{ ok: boolean }> {
  const day = String(date ?? "").trim();
  const session = await me();
  if (!session || !isDay(day)) return { ok: false };
  const { error } = await getSupabaseServiceClient()
    .from("task_report_schedules")
    .update({ status: "cancelled" })
    .eq("user_id", session.user.id)
    .eq("organization_id", session.organization.id)
    .eq("report_date", day)
    .eq("status", "scheduled");
  if (error) return { ok: false };
  revalidatePath("/mobile/tasks");
  revalidatePath("/admin/tasks");
  return { ok: true };
}

export type SendDailyReportNowResult = { ok: true } | { ok: false; reason: SlackSendFailureReason | "busy" };

/**
 * 「지금 보내기」 — 예약이 있어도 **먼저 보내고, 보낸 뒤에만** 예약을 거둔다(2026-10-28).
 *
 * 예전엔 화면이 «예약 취소 → 보내기» 순서로 따로 불러서, 보내기가 실패하면(웹훅 오류 · 권한) 예약까지 사라져
 * 일지가 아무 데도 안 나갔다. 순서를 서버 한 곳으로 모은다:
 *   1. 살아 있는 예약을 `sending` 으로 잡아 둔다 — 그 사이 틱(`/api/tasks/report-tick`)이 같은 예약을 또
 *      보내지 않게(틱은 `scheduled` 만 집어 간다). 이미 틱이 보내는 중이면 `busy`.
 *   2. 지금 본문을 Slack 으로 보낸다(`sendDailyReportToSlack` — 권한 · 빈 일지 · 길이 판정 그대로).
 *   3. 성공하면 잡아 둔 예약을 `cancelled` 로, 실패하면 `scheduled` 로 되돌려 예약이 그대로 살아 있게 한다.
 *   3에 닿기 전에 서버가 멈추면 행이 `sending` 으로 남는다 → 10분 뒤 `failed`('stuck')로 풀린다(2026-10-29).
 */
export async function sendDailyReportNow(date: string, editedText: string): Promise<SendDailyReportNowResult> {
  const day = String(date ?? "").trim();
  const session = await me();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!isDay(day)) return { ok: false, reason: "error" };
  const service = getSupabaseServiceClient();
  await releaseStuckSending(service, session.organization.id, session.user.id, day);

  // `claimed_at` 도 적는다 — 이 요청이 도중에 멈추면 틱 · 위 풀기가 10분 뒤 이 행을 풀 수 있게(2026-10-29).
  const { data: claimed, error: claimError } = await service
    .from("task_report_schedules")
    .update({ status: "sending", claimed_at: new Date().toISOString() })
    .eq("user_id", session.user.id)
    .eq("organization_id", session.organization.id)
    .eq("report_date", day)
    .eq("status", "scheduled")
    .select("id");
  if (claimError) {
    console.warn("[report-schedule] send-now claim failed:", claimError.message);
    return { ok: false, reason: "error" };
  }
  const claimedIds = ((claimed ?? []) as { id: string }[]).map((r) => r.id);
  if (claimedIds.length === 0) {
    // 잡은 예약이 없을 때, 틱이 이미 보내는 중이면 겹쳐 보내지 않는다.
    const { data: sending } = await service
      .from("task_report_schedules")
      .select("id")
      .eq("user_id", session.user.id)
      .eq("organization_id", session.organization.id)
      .eq("report_date", day)
      .eq("status", "sending")
      .limit(1);
    if ((sending ?? []).length > 0) return { ok: false, reason: "busy" };
  }

  const settle = async (status: "cancelled" | "scheduled") => {
    if (claimedIds.length === 0) return;
    const { error } = await service
      .from("task_report_schedules")
      .update({ status })
      .in("id", claimedIds)
      .eq("organization_id", session.organization.id)
      .eq("status", "sending");
    if (error) console.warn(`[report-schedule] send-now settle(${status}) failed:`, error.message);
  };

  let sent: Awaited<ReturnType<typeof sendDailyReportToSlack>>;
  try {
    sent = await sendDailyReportToSlack(day, editedText);
  } catch (error) {
    console.warn("[report-schedule] send-now failed:", error);
    sent = { ok: false, reason: "error" };
  }
  await settle(sent.ok ? "cancelled" : "scheduled");
  if (claimedIds.length > 0) {
    revalidatePath("/mobile/tasks");
    revalidatePath("/admin/tasks");
  }
  return sent;
}
