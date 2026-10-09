import { NextResponse, type NextRequest } from "next/server";
import { cleanupUnconfirmedSignups } from "@/lib/auth/unconfirmed-signup-cleanup";
import { runTaskReminders } from "@/lib/notifications/task-reminders";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

// Daily task-reminder evaluator for Todo / Shared Task (due-soon + overdue).
//
// These two notification types are inherently time-based — no user action triggers them —
// so they need a low-frequency scheduled evaluation. This endpoint is that narrowly-scoped
// path: it scans active tasks due today-or-earlier and fans out one deduped reminder per
// task per recipient. It is NOT a general scheduler/instance-generation engine; see
// `src/lib/notifications/task-reminders.ts` for the exact rules and dedupe strategy.
//
// Driven once daily by Vercel Cron (see vercel.json). Authorized with CRON_SECRET so it
// cannot be triggered by anonymous callers.
//
// 같은 하루 한 번에 「확인 안 된 오래된 가입 정리」도 돈다(2026-10-09) — 크론 칸을 하나 더 쓰지 않으려고 여기 붙였다.
// 알림과 서로 막지 않게 따로 감싼다(정리가 실패해도 알림 결과는 그대로 돌려준다).

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorize(request: NextRequest): { ok: true } | { ok: false; status: number } {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return { ok: false, status: 404 };
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.nextUrl.searchParams.get("secret") ??
    null;
  if (!provided) return { ok: false, status: 403 };
  if (provided !== cronSecret) return { ok: false, status: 403 };
  return { ok: true };
}

function isUuid(value: string | null) {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function handle(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.status === 404 ? "not_found" : "forbidden" },
      { status: auth.status },
    );
  }

  const organizationIdParam = request.nextUrl.searchParams.get("organizationId");
  if (organizationIdParam && !isUuid(organizationIdParam)) {
    return NextResponse.json({ ok: false, error: "invalid_organization_id" }, { status: 400 });
  }

  try {
    const service = getSupabaseServiceClient();
    const result = await runTaskReminders(service, {
      organizationId: organizationIdParam ?? undefined,
    });
    let signupCleanup: Awaited<ReturnType<typeof cleanupUnconfirmedSignups>> | { checked: false; error: string };
    try {
      signupCleanup = organizationIdParam ? { checked: false, error: "skipped_for_org_run" } : await cleanupUnconfirmedSignups(service);
    } catch (error) {
      console.error("[tasks/reminders] unconfirmed signup cleanup failed", error);
      signupCleanup = { checked: false, error: "cleanup_failed" };
    }
    return NextResponse.json({ ok: true, ...result, signupCleanup });
  } catch (error) {
    console.error("[tasks/reminders] failed", error);
    return NextResponse.json({ ok: false, error: "reminders_failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
