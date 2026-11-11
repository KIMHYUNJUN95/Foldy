import { NextResponse, type NextRequest } from "next/server";
import { runAttendanceReminders } from "@/lib/notifications/attendance-reminders";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requestMatchesSecret } from "@/lib/api-secret";

// 예약 실행 근태 알림/이상 평가기(Step 14): 근무자 18:30 미종료 세션 알림
// (도쿄 날짜당 1회, 중복 제거) + 관리자용 미완료/오래된 세션 경고. 시간 기반이라 사용자 동작이
// 트리거하지 않으므로, 범위를 좁힌 예약 실행 경로다(/api/tasks/reminders 와 동일).
//
// CRON_SECRET 으로 인증해 익명 호출로는 실행할 수 없다. **아직 예약 실행되지 않는다** — vercel.json 의 크론에 없다
// (2026-11-11 결정: 알림은 개발 막바지에 전 기능을 한꺼번에 붙일 때 켠다). 그때까지 18:30 리마인더 · 관리자 「오래 열린
// 근무」 알림은 나가지 않는다. 문서 24 「근태 점검 1차 (2026-11-11)」.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorize(request: NextRequest): { ok: true } | { ok: false; status: number } {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return { ok: false, status: 404 };
  // 비교는 상수 시간 · 길이 무관(api-secret). **헤더(Authorization: Bearer)만** 받는다(2026-11-11) — 주소의 `?secret=` 은
  // 서버 · 프록시 기록에 남는다. Vercel 크론도 Bearer 헤더로 보낸다.
  if (!requestMatchesSecret(request, [cronSecret])) return { ok: false, status: 403 };
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
    const result = await runAttendanceReminders(getSupabaseServiceClient(), {
      organizationId: organizationIdParam ?? undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[attendance/reminders] failed", error);
    return NextResponse.json({ ok: false, error: "reminders_failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
