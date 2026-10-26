import { NextResponse, type NextRequest } from "next/server";
import { backfillBeds24Reservations } from "@/lib/beds24/reservations-backfill";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

function ensureDevOnly(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (process.env.ENABLE_LOCAL_DEV_TOOLS !== "true") {
    console.warn("[dev/beds24-reservations] gate not enabled");
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const host = request.nextUrl.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    console.warn(`[dev/beds24-reservations] blocked non-local host: ${host}`);
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return null;
}

function resolveSecret(request: NextRequest) {
  const fromHeader = request.headers.get("x-beds24-webhook-secret");
  const fromBearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const fromQuery = request.nextUrl.searchParams.get("secret");

  return fromHeader ?? fromBearer ?? fromQuery;
}

function isUuid(value: string | null) {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function handle(request: NextRequest) {
  const blocked = ensureDevOnly(request);
  if (blocked) return blocked;

  const requiredSecret = process.env.BEDS24_WEBHOOK_SECRET?.trim();
  if (!requiredSecret) {
    console.warn("[dev/beds24-reservations] webhook secret not configured");
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const providedSecret = resolveSecret(request);
  if (!providedSecret || providedSecret !== requiredSecret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const organizationIdParam = request.nextUrl.searchParams.get("organizationId");
  if (organizationIdParam && !isUuid(organizationIdParam)) {
    return NextResponse.json({ error: "invalid_organization_id" }, { status: 400 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "true";

  // 선택적 일회성 넓은 구간 (기본 이번 달+다음 달 구간이 닿지 않는 먼 미래 예약을 따라잡는 개발 전용 기능).
  // 두 경계 모두 올바른 YYYY-MM-DD 여야 하고 from < to 여야 한다.
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");
  if ((fromParam && !isoDate.test(fromParam)) || (toParam && !isoDate.test(toParam))) {
    return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  }
  if (fromParam && toParam && fromParam >= toParam) {
    return NextResponse.json({ error: "invalid_window" }, { status: 400 });
  }
  const windowOverride =
    fromParam && toParam ? { from: fromParam, toExclusive: toParam } : {};

  try {
    const supabase = getSupabaseServiceClient();
    const result = await backfillBeds24Reservations(supabase, {
      organizationId: organizationIdParam ?? undefined,
      dryRun,
      ...windowOverride,
    });

    const mode = result.partial
      ? "partial_failure"
      : result.fetchedRows > 0
        ? "success"
        : "no_data";

    return NextResponse.json({
      ok: !result.partial,
      mode,
      dryRun,
      ...result,
    });
  } catch (error) {
    console.error("[dev/beds24-reservations] failed", error);
    return NextResponse.json({ ok: false, error: "backfill_failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
