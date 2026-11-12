import { NextResponse, type NextRequest } from "next/server";
import { requestMatchesSecret } from "@/lib/api-secret";
import { isBeds24SyncPaused } from "@/lib/beds24/sync-control";
import { BACKFILL_MAX_PAGES_PER_CALL, backfillGuestMessageHistory, isBackfillFailure } from "@/lib/guest-messages/backfill";

// 손님 메시지 과거 가져오기 — docs/product/47-guest-messaging.md 「과거 메시지 가져오기」.
//
// 한 번 부르면 그 조직 기준으로 최대 `pages` 페이지(기본 10)를 읽고 커서를 남긴다. 다시 부르면 이어 받는다.
// **정기 실행에 넣지 않는다** — 사람이(또는 관리 화면의 서버 액션이) 필요할 때 부른다.
// 인가: `Authorization: Bearer <CRON_SECRET>` 만. CRON_SECRET 이 없으면 닫힌 채(404).
// 쿼리: organizationId(필수 — 실수로 모든 조직을 훑지 않게) · mode=measure(재기만) · restart=1(1페이지부터 다시) · pages=1~20.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorize(request: NextRequest): { ok: true } | { ok: false; status: number } {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return { ok: false, status: 404 };
  if (requestMatchesSecret(request, [cronSecret])) return { ok: true };
  return { ok: false, status: 403 };
}

function isUuid(value: string | null) {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function handle(request: NextRequest) {
  // 인가가 먼저 — 멈춤 여부도 인가된 호출에만 알려 준다.
  const auth = authorize(request);
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
