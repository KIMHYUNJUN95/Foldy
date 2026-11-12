import { NextResponse, type NextRequest } from "next/server";
import { requestMatchesSecret } from "@/lib/api-secret";
import { isGuestMessageSendEnabled, runGuestOutbox } from "@/lib/guest-messages/outbox-runner";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

// 손님 메시지 발송 큐 한 바퀴 — docs/product/47-guest-messaging.md §4-1 · 2단계.
//
// 답장은 보내기 직후 `after()` 에서 바로 보낸다. 이 라우트는 **밀린 줄**(429 · 보내기 전 실패 뒤 다시 시도 시각이 된 줄)을 보내는 자리다.
// **아직 정기 실행에 넣지 않았다**(`vercel.json` 없음) — 발송을 켤 때(GUEST_MESSAGES_SEND_ENABLED=1) 주기를 정해 붙인다.
// 인가: `Authorization: Bearer <CRON_SECRET>` 만. CRON_SECRET 이 없으면 닫힌 채(404). 발송이 꺼져 있으면 아무것도 안 한다.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  if (!requestMatchesSecret(request, [cronSecret])) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if (!isGuestMessageSendEnabled()) return NextResponse.json({ ok: true, disabled: true }, { status: 202 });

  const supabase = getSupabaseServiceClient();
  const orgs = await supabase.from("organizations").select("id").eq("status", "active");
  if (orgs.error) {
    console.error("[guest-messages/outbox] organization lookup failed", orgs.error.message);
    return NextResponse.json({ ok: false, error: "organization_lookup_failed" }, { status: 500 });
  }
  const results: Array<{ organizationId: string; ran: boolean; error?: string }> = [];
  for (const { id } of (orgs.data ?? []) as Array<{ id: string }>) {
    try {
      const result = await runGuestOutbox(supabase, id);
      results.push({ organizationId: id, ran: result.ran });
    } catch (error) {
      console.error("[guest-messages/outbox] run failed", error instanceof Error ? error.message : "unknown");
      results.push({ organizationId: id, ran: false, error: "run_failed" });
    }
  }
  const failed = results.some((row) => row.error);
  return NextResponse.json({ ok: !failed, results }, { status: failed ? 207 : 200 });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
