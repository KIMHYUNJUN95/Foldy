import { NextResponse, type NextRequest } from "next/server";
import { canSendDailyReport, logDailyReportSent, postDailyReportToSlack } from "@/lib/daily-report-slack";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { safeEqualSecret } from "@/lib/api-secret";

/**
 * 업무일지 예약 보내기 틱(2026-10-20).
 *
 * Supabase pg_cron 이 매 분 `task_report_tick_if_needed()` 를 돌리고, **보낼 때가 된 예약이 있을 때만** pg_net 으로 여기를 부른다
 * (`supabase/migrations/202610200005_task_report_schedules.sql`). 토큰은 Vault 에 있고 `task_report_tick_token_ok()` 로 대조만 한다 —
 * 새 환경변수가 없다. 사람이 손으로 부를 때를 위해 `CRON_SECRET` 도 받는다.
 *
 * `claim_due_task_report_schedules` 가 원자적으로 'sending' 으로 바꾸며 가져가므로 틱이 겹쳐도 두 번 보내지 않는다. 보내기 전에 그 사람이
 * **지금도** 업무일지를 만들 수 있는지 다시 본다(그 사이 퇴사 · 비활성 · 역할 변경). docs/product/18-todo-task-workflow.md 「업무일지 예약 보내기」
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_PER_RUN = 20;

type Claimed = { id: string; organization_id: string; user_id: string; report_date: string; body: string };

async function authorize(request: NextRequest, supabase: ReturnType<typeof getSupabaseServiceClient>): Promise<boolean> {
  // 토큰은 헤더로만 받는다 — 쿼리에 실으면 접근 로그에 남는다.
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!provided) return false;
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret && safeEqualSecret(provided, cronSecret)) return true;
  const checked = await supabase.rpc("task_report_tick_token_ok", { p_token: provided });
  if (checked.error) {
    console.error("[report-tick] token check failed", { code: checked.error.code });
    return false;
  }
  return checked.data === true;
}

export async function POST(request: NextRequest) {
  const supabase = getSupabaseServiceClient();
  if (!(await authorize(request, supabase))) return NextResponse.json({ ok: false }, { status: 401 });

  const claimed = await supabase.rpc("claim_due_task_report_schedules", { p_limit: MAX_PER_RUN });
  if (claimed.error) {
    console.error("[report-tick] claim failed", { code: claimed.error.code });
    return NextResponse.json({ ok: false, error: "claim_failed" }, { status: 500 });
  }

  const rows = (claimed.data ?? []) as Claimed[];
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const finish = async (patch: { status: "sent" | "failed"; error?: string | null }) => {
      const { error } = await supabase
        .from("task_report_schedules")
        .update({ status: patch.status, error: patch.error ?? null, sent_at: patch.status === "sent" ? new Date().toISOString() : null })
        .eq("id", row.id)
        .eq("status", "sending");
      if (error) console.error("[report-tick] finish update failed", { id: row.id, code: error.code });
    };

    if (!(await canSendDailyReport(row.organization_id, row.user_id))) {
      failed += 1;
      await finish({ status: "failed", error: "forbidden" });
      continue;
    }
    const posted = await postDailyReportToSlack(row.body);
    if (!posted.ok) {
      failed += 1;
      await finish({ status: "failed", error: posted.reason });
      continue;
    }
    sent += 1;
    await finish({ status: "sent" });
    await logDailyReportSent({
      organizationId: row.organization_id,
      userId: row.user_id,
      date: row.report_date,
      characterCount: row.body.length,
      scheduled: true,
    });
  }

  return NextResponse.json({ ok: true, claimed: rows.length, sent, failed });
}
