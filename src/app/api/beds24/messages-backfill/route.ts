import { after, NextResponse, type NextRequest } from "next/server";
import { isBeds24SyncPaused } from "@/lib/beds24/sync-control";
import { BACKFILL_MAX_PAGES_PER_CALL, backfillGuestMessageHistory, isBackfillFailure } from "@/lib/guest-messages/backfill";
import { authorizeGuestMessagesCron } from "@/lib/guest-messages/cron-auth";
import { copyGuestMessageMediaForOrganizations } from "@/lib/guest-messages/media-copy-server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

// 손님 메시지 과거 가져오기 — docs/product/47-guest-messaging.md 「과거 메시지 가져오기」.
//
// 한 번 부르면 그 조직 기준으로 최대 `pages` 페이지(기본 10)를 읽고 커서를 남긴다. 다시 부르면 이어 받는다.
// **정기 실행에 넣지 않는다** — 사람이(또는 관리 화면의 서버 액션이) 필요할 때 부른다.
// 인가: `Authorization: Bearer <CRON_SECRET 또는 pg_cron 토큰>`(`authorizeGuestMessagesCron` — 다른 손님 메시지 정기 라우트와 같다).
// 2026-11-13: CRON_SECRET 이 Vercel 에서 Sensitive 라 꺼낼 수 없어, 운영 가져오기는 SQL Editor 에서 잠깐 거는 pg_cron 잡(Vault 토큰)으로 부른다.
// 둘 다 없으면 닫힌 채(404), 틀린 값은 403.
// 쿼리: organizationId(필수 — 실수로 모든 조직을 훑지 않게) · mode=measure(재기만) · restart=1(1페이지부터 다시) · pages=1~20.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isUuid(value: string | null) {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function handle(request: NextRequest) {
  // 인가가 먼저 — 멈춤 여부도 인가된 호출에만 알려 준다.
  const auth = await authorizeGuestMessagesCron(request, getSupabaseServiceClient);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.status === 404 ? "not_found" : "forbidden" },
      { status: auth.status },
    );
  }
  if (isBeds24SyncPaused()) {
    return NextResponse.json({ ok: true, paused: true }, { status: 202 });
  }

  const params = request.nextUrl.searchParams;
  const organizationId = params.get("organizationId");
  if (!isUuid(organizationId)) {
    return NextResponse.json({ ok: false, error: "invalid_organization_id" }, { status: 400 });
  }
  const pagesParam = params.get("pages");
  const pages = pagesParam === null ? undefined : Number(pagesParam);
  if (pages !== undefined && (!Number.isInteger(pages) || pages < 1 || pages > BACKFILL_MAX_PAGES_PER_CALL)) {
    return NextResponse.json({ ok: false, error: "invalid_pages" }, { status: 400 });
  }
  const mode = params.get("mode") === "measure" ? "measure" : "run";

  try {
    const result = await backfillGuestMessageHistory(
      organizationId as string,
      { mode, restart: params.get("restart") === "1" },
      { maxPages: pages },
    );
    const failed = isBackfillFailure(result);
    // 이번에 들어온 Airbnb 사진 일부를 복사(47 §5-8) — 응답 뒤, 40초 안(가져오기 240초 + 이것 < 300초). 나머지는 사진 가져오기 라우트.
    if (result.imported > 0) {
      after(() =>
        copyGuestMessageMediaForOrganizations(getSupabaseServiceClient(), [organizationId as string], { limit: 20, budgetMs: 40_000 }),
      );
    }
    return NextResponse.json({ ok: !failed, result }, { status: failed ? 207 : 200 });
  } catch (error) {
    // 자세한 오류는 서버 로그에만 — 응답에는 정해진 코드만.
    console.error("[guest-messages/backfill] run failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "backfill_failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
