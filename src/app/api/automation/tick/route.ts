import { NextResponse, type NextRequest } from "next/server";
import { runAutomationTick } from "@/lib/automation/runner";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { safeEqualSecret } from "@/lib/api-secret";

/**
 * 자동화 틱 — 정시 발송 · 재시도 · 변동 재전송 · 정정본 · 취소/당일예약 알림.
 *
 * 도메인 계약: docs/product/36-automation-control.md 「실행 기반 — 1분 틱」
 *
 * Supabase pg_cron 이 매 분 `automation_tick_if_needed()` 를 돌리고, **할 일이 있을 때만** pg_net 으로 여기를 부른다
 * (`supabase/migrations/202610060003_automation_control.sql`). 토큰은 Vault 에 있고 `automation_tick_token_ok()` 로
 * 대조만 한다. 사람이 손으로 부를 때를 위해 `CRON_SECRET` 도 받는다.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function providedSecret(request: NextRequest) {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || null;
}

async function authorize(request: NextRequest, supabase: ReturnType<typeof getSupabaseServiceClient>): Promise<boolean> {
  const provided = providedSecret(request);
  if (!provided) return false;
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret && safeEqualSecret(provided, cronSecret)) return true;
  const checked = await supabase.rpc("automation_tick_token_ok", { p_token: provided });
  if (checked.error) {
    console.error("[automation/tick] token check failed", { code: checked.error.code });
    return false;
  }
  return checked.data === true;
}

export async function POST(request: NextRequest) {
  const supabase = getSupabaseServiceClient();
  if (!(await authorize(request, supabase))) {
    return NextResponse.json({ error: "unauthorized", ok: false }, { status: 401 });
  }
  try {
    const summary = await runAutomationTick(supabase);
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    console.error("[automation/tick] failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "tick_failed", ok: false }, { status: 500 });
  }
}
