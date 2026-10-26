"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { generateDailyReport } from "@/actions/task-report";

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

  // 보내는 중이면 바꾸지 않는다(곧 끝난다).
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
