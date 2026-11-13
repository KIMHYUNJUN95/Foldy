import { NextResponse, type NextRequest } from "next/server";
import { authorizeGuestMessagesCron } from "@/lib/guest-messages/cron-auth";
import { copyPendingGuestMessageMedia } from "@/lib/guest-messages/media-copy-server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

// 손님 메시지 사진 사본 따라잡기 — docs/product/47-guest-messaging.md §5-8, docs/engineering/07 「손님 메시지 사진 사본」.
//
// 한 번 부르면 그 조직의 `media_state = 'pending'` 메시지를 최대 `limit`(기본 25, 1~50)개 · 50초 안에서 복사한다.
// Airbnb 사진 서버(a0.muscache.com)만 부른다 — Beds24 크레딧 0. 다시 부르면 남은 것을 이어 한다.
// 정기 실행 없음 — 운영 따라잡기는 SQL Editor 에서 잠깐 거는 pg_cron 잡(07)으로 부르고, `remaining` 이 0 이면 잡을 지운다.
// 인가: `Authorization: Bearer <CRON_SECRET 또는 pg_cron 토큰>`(`authorizeGuestMessagesCron`). 둘 다 없으면 404, 틀리면 403.
// 쿼리: organizationId(필수) · limit.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isUuid(value: string | null) {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function handle(request: NextRequest) {
  const auth = await authorizeGuestMessagesCron(request, getSupabaseServiceClient);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.status === 404 ? "not_found" : "forbidden" }, { status: auth.status });
  }
  const params = request.nextUrl.searchParams;
  const organizationId = params.get("organizationId");
  if (!isUuid(organizationId)) {
    return NextResponse.json({ ok: false, error: "invalid_organization_id" }, { status: 400 });
  }
  const limitParam = params.get("limit");
  const limit = limitParam === null ? 25 : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return NextResponse.json({ ok: false, error: "invalid_limit" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();
  const result = await copyPendingGuestMessageMedia(supabase, organizationId as string, { limit, budgetMs: 50_000 });
  // 남은 수(다시 시도 시각이 안 된 것 포함) — 잡을 지울 때를 보려고.
  const remaining = await supabase
    .from("guest_messages")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId as string)
    .eq("media_state", "pending");
  if (remaining.error) console.error("[guest-messages/media-backfill] count failed", remaining.error.code ?? "unknown");
  return NextResponse.json({ ok: true, result, remaining: remaining.error ? null : (remaining.count ?? 0) });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
