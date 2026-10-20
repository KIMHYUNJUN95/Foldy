import "server-only";

import { canGenerateDailyReport, type Role } from "@/config/roles";
import { hasPermissionOverride } from "@/lib/permission-overrides-server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/types/database";

/**
 * 업무일지 → Slack 보내기의 서버 공용 본체(2026-10-20 — 예약 보내기를 더하며 액션에서 뺐다).
 *
 * - `postDailyReportToSlack` — 웹훅 주소 확인 + 보내기. 지금 보내기(`sendDailyReportToSlack`)와 예약 틱(`/api/tasks/report-tick`)이
 *   같은 것을 쓴다. 웹훅 주소(`SLACK_DAILY_REPORT_WEBHOOK_URL`)는 서버에만 있고 로그에 절대 남기지 않는다.
 * - `canSendDailyReport` — 그 사람이 **지금도** 업무일지를 만들 수 있나(세션 없이, 예약 틱이 보낼 때 다시 본다).
 * - `logDailyReportSent` — 감사 기록(본문 · 주소는 남기지 않는다).
 * docs/product/18-todo-task-workflow.md 「Daily Report」 · 「업무일지 예약 보내기」
 */

export type SlackPostFailure = "not_configured" | "error";

export async function postDailyReportToSlack(text: string): Promise<{ ok: true } | { ok: false; reason: SlackPostFailure }> {
  const webhookUrl = process.env.SLACK_DAILY_REPORT_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    // `not_configured` 는 「값이 없다」와 「값이 이상하다」 둘 다에서 난다 — 두 경우를 갈라 남긴다(2026-08-05).
    console.warn("[report] slack webhook env is missing or empty");
    return { ok: false, reason: "not_configured" };
  }
  try {
    const endpoint = new URL(webhookUrl);
    if (endpoint.protocol !== "https:" || endpoint.hostname !== "hooks.slack.com") {
      // 호스트/프로토콜만 남긴다 — 경로에 토큰이 들어 있으므로 URL 전체는 절대 로그에 남기지 않는다.
      console.warn(`[report] slack webhook host rejected: ${endpoint.protocol}//${endpoint.hostname} (len=${webhookUrl.length})`);
      return { ok: false, reason: "not_configured" };
    }
  } catch {
    console.warn(`[report] slack webhook is not a valid URL (len=${webhookUrl.length})`);
    return { ok: false, reason: "not_configured" };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ text }),
      cache: "no-store",
    });
    if (!response.ok) {
      // Slack 이 거절한 이유는 본문에 온다(no_service / invalid_payload 등). 웹훅 URL 은 절대 로그에 남기지 않는다.
      const detail = await response.text().catch(() => "");
      console.warn(`[report] slack rejected: ${response.status} ${detail.slice(0, 200)}`);
      return { ok: false, reason: "error" };
    }
  } catch (error) {
    console.warn("[report] slack fetch failed:", error instanceof Error ? error.message : error);
    return { ok: false, reason: "error" };
  }
  return { ok: true };
}

/** 세션 없이 — 그 조직에서 활성 멤버이고, 역할이나 개인 지정으로 업무일지를 만들 수 있나. */
export async function canSendDailyReport(organizationId: string, userId: string): Promise<boolean> {
  const service = getSupabaseServiceClient();
  const [{ data: membership }, { data: profile }] = await Promise.all([
    service.from("memberships").select("role").eq("organization_id", organizationId).eq("user_id", userId).eq("status", "active").maybeSingle(),
    service.from("profiles").select("can_generate_report").eq("id", userId).maybeSingle(),
  ]);
  const role = (membership as { role: Role } | null)?.role;
  if (!role) return false;
  if (canGenerateDailyReport(role, Boolean((profile as { can_generate_report: boolean } | null)?.can_generate_report))) return true;
  return hasPermissionOverride(organizationId, userId, "can_generate_report");
}

/**
 * 감사 기록 — 본문은 넣지 않는다(운영 정보가 섞일 수 있다). 실패가 이미 전달된 Slack 메시지를 실패로 보이게 해서는 안 되므로 삼키지 않고 로그만.
 * `target_id` 는 uuid 칼럼 — 일지는 표 행이 아니라 비운다(2026-08-05 사고). 예약으로 보냈으면 `scheduled: true`.
 */
export async function logDailyReportSent(input: {
  organizationId: string;
  userId: string;
  date: string;
  characterCount: number;
  scheduled?: boolean;
}): Promise<void> {
  try {
    const audit = await getSupabaseServiceClient()
      .from("audit_logs")
      .insert({
        organization_id: input.organizationId,
        actor_user_id: input.userId,
        action: "task_daily_report_slack_sent",
        target_type: "daily_report",
        target_id: null,
        metadata: { date: input.date, character_count: input.characterCount, scheduled: Boolean(input.scheduled) } as Json,
      });
    if (audit.error) console.warn("[report] audit write failed:", audit.error.message);
  } catch (error) {
    console.warn("[report] audit write threw:", error instanceof Error ? error.message : error);
  }
}
