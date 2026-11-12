import { NextResponse, type NextRequest } from "next/server";
import { isBeds24SyncPaused } from "@/lib/beds24/sync-control";
import { authorizeGuestMessagesCron } from "@/lib/guest-messages/cron-auth";
import { isReconcileFailure, reconcileGuestMessages } from "@/lib/guest-messages/reconcile";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

// 손님 메시지 보정 조회 트리거 — docs/product/47-guest-messaging.md §4-0-1.
//
// 한 번 부르면 Beds24 계정 전체를 **한 번** 읽어 예약마다 조직을 정해 넣는다(`reconcileGuestMessages`).
// 정기 실행은 Supabase pg_cron 15분(`202611130006_guest_messages_cron.sql`, **운영 미적용**). vercel.json 에는 없다.
// 인가: `Authorization: Bearer <CRON_SECRET 또는 pg_cron 토큰>`(`authorizeGuestMessagesCron`) — Beds24 웹훅 시크릿은 받지 않는다
// (웹훅 주소에 실려 다니는 값이라). 둘 다 없으면 닫힌 채(404).

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isUuid(value: string | null) {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function handle(request: NextRequest) {
  if (isBeds24SyncPaused()) {
    return NextResponse.json({ ok: true, paused: true }, { status: 202 });
  }
  const auth = await authorizeGuestMessagesCron(request, getSupabaseServiceClient);
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

  let organizationIds: string[];
  if (organizationIdParam) {
    organizationIds = [organizationIdParam];
  } else {
    const orgs = await getSupabaseServiceClient()
      .from("organizations")
      .select("id")
      .eq("status", "active")
      .order("created_at", { ascending: true });
    if (orgs.error) {
      console.error("[guest-messages/reconcile] organization lookup failed", orgs.error.message);
      return NextResponse.json({ ok: false, error: "organization_lookup_failed" }, { status: 500 });
    }
    organizationIds = ((orgs.data ?? []) as Array<{ id: string }>).map((row) => row.id);
  }

  try {
    const result = await reconcileGuestMessages(organizationIds);
    const failed = isReconcileFailure(result);
    return NextResponse.json({ ok: !failed, result }, { status: failed ? 207 : 200 });
  } catch (error) {
    // 자세한 오류는 서버 로그에만 — 응답에는 정해진 코드만.
    console.error("[guest-messages/reconcile] run failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "reconcile_failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
