import { NextResponse, type NextRequest } from "next/server";
import { runAutoMessagePlanner } from "@/lib/guest-messages/auto-scheduler";
import { authorizeGuestMessagesCron } from "@/lib/guest-messages/cron-auth";
import { isGuestMessageSendEnabled, runGuestOutbox } from "@/lib/guest-messages/outbox-runner";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

// 손님 메시지 자동 안내 한 바퀴 — docs/product/47-guest-messaging.md §5-6.
//
// 조직마다: 계획(실행 줄 만들기 · 고치기) → 발송이 켜져 있으면(GUEST_MESSAGES_SEND_ENABLED=1) 보낼 시각이 된 줄을 큐에 넣고 →
// 기존 발송 작업 한 바퀴(직원 답장 먼저 · 자동 안내는 같은 POST 로 묶음 · 크레딧 선). Beds24 는 그 발송 작업만 부른다.
// 정기 실행은 Supabase pg_cron 5분(`202611130006_guest_messages_cron.sql`, **운영 미적용** — 켜 둔 규칙이 있을 때만 부름). vercel.json 에는 없다.
// 인가: `Authorization: Bearer <CRON_SECRET 또는 pg_cron 토큰>`(`authorizeGuestMessagesCron`). 둘 다 없으면 닫힌 채(404), 틀리면 403.
// `?organizationId=` 를 주면 그 조직만.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handle(request: NextRequest) {
  const auth = await authorizeGuestMessagesCron(request, getSupabaseServiceClient);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.status === 404 ? "not_found" : "forbidden" }, { status: auth.status });

  const only = request.nextUrl.searchParams.get("organizationId");
  if (only !== null && !UUID_RE.test(only)) return NextResponse.json({ ok: false, error: "invalid_organization" }, { status: 400 });

  const supabase = getSupabaseServiceClient();
  let organizationIds: string[];
  if (only) {
    organizationIds = [only];
  } else {
    const orgs = await supabase.from("organizations").select("id").eq("status", "active");
    if (orgs.error) {
      console.error("[guest-messages/auto] organization lookup failed", orgs.error.message);
      return NextResponse.json({ ok: false, error: "organization_lookup_failed" }, { status: 500 });
    }
    organizationIds = ((orgs.data ?? []) as Array<{ id: string }>).map((row) => row.id);
  }

  const sendEnabled = isGuestMessageSendEnabled();
  const results: Array<Record<string, unknown>> = [];
  for (const organizationId of organizationIds) {
    try {
      const plan = await runAutoMessagePlanner(supabase, organizationId, { enqueue: sendEnabled });
      const outbox = sendEnabled && plan.enqueued > 0 ? await runGuestOutbox(supabase, organizationId) : null;
      results.push({ organizationId, ...plan, outbox: outbox?.ran ? outbox : (outbox?.reason ?? null) });
    } catch (error) {
      console.error("[guest-messages/auto] run failed", error instanceof Error ? error.message : "unknown");
      results.push({ organizationId, error: "run_failed" });
    }
  }
  const failed = results.some((row) => row.error || (typeof row.writeErrors === "number" && row.writeErrors > 0));
  return NextResponse.json({ ok: !failed, sendEnabled, results }, { status: failed ? 207 : 200 });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
