import { NextResponse, type NextRequest } from "next/server";
import { requestMatchesSecret } from "@/lib/api-secret";
import { buildRoomRatesWindow, syncBeds24RoomRates } from "@/lib/beds24/room-rates-sync";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * 객실 × 날짜별 요금·재고 백필 (로컬 개발 전용).
 *
 * ```
 * BEDS24_WEBHOOK_SECRET=… bash scripts/dev/beds24-backfill-rates.sh
 * # 기간을 직접 주려면
 * …/api/dev/beds24/backfill-rates?from=2026-09-01&to=2026-12-31
 * ```
 *
 * 기본 창은 **어제 ~ +12개월**(`buildRoomRatesWindow`). 판매 캘린더가 12개월 이상을 보기 때문이다.
 *
 * 읽기 전용이다 — Beds24 에 쓰지 않는다.
 */

function ensureDevOnly(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (process.env.ENABLE_LOCAL_DEV_TOOLS !== "true") {
    console.warn("[dev/beds24-rates] gate not enabled");
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const host = request.nextUrl.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    console.warn(`[dev/beds24-rates] blocked non-local host: ${host}`);
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return null;
}

function isUuid(value: string | null) {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isDate(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function handle(request: NextRequest) {
  const blocked = ensureDevOnly(request);
  if (blocked) return blocked;

  const requiredSecret = process.env.BEDS24_WEBHOOK_SECRET?.trim();
  if (!requiredSecret) {
    console.warn("[dev/beds24-rates] webhook secret not configured");
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // 상수 시간 비교 · 헤더 / Bearer / `?secret=` 중 하나라도 맞으면 통과(api-secret).
  if (!requestMatchesSecret(request, [requiredSecret], { headers: ["x-beds24-webhook-secret"], query: true })) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const organizationIdParam = request.nextUrl.searchParams.get("organizationId");
  if (organizationIdParam && !isUuid(organizationIdParam)) {
    return NextResponse.json({ error: "invalid_organization_id" }, { status: 400 });
  }

  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");
  const window =
    isDate(fromParam) && isDate(toParam) ? { from: fromParam, to: toParam } : buildRoomRatesWindow();

  try {
    const supabase = getSupabaseServiceClient();

    // 조직을 지정하지 않으면 활성 조직 전부를 돈다. 지금은 한 곳뿐이지만, 조직이 늘었을 때
    // 「하나만 되고 나머지는 조용히 안 됨」이 되지 않게 처음부터 목록으로 다룬다.
    const organizationIds = organizationIdParam
      ? [organizationIdParam]
      : await (async () => {
          const result = await supabase.from("organizations").select("id");
          if (result.error) throw new Error(result.error.message);
          return (result.data ?? []).map((row) => (row as { id: string }).id);
        })();

    const organizations = [];
    for (const organizationId of organizationIds) {
      const result = await syncBeds24RoomRates(organizationId, supabase, window);
      organizations.push({ organizationId, ...result });
    }

    return NextResponse.json({ ok: true, window, organizations });
  } catch (error) {
    console.error("[dev/beds24-rates] failed", error);
    return NextResponse.json({ ok: false, error: "backfill_failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
