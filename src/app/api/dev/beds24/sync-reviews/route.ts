import { NextResponse, type NextRequest } from "next/server";
import { syncOrganizationReviews } from "@/lib/beds24/reviews-sync";

// Beds24 외부 리뷰 수집을 위한 로컬 전용 트리거. 운영 크론(/api/beds24/reviews-sync)과 수집 경로는
// 같지만 한 조직으로 범위를 좁히고, 크론이 맡기 전에 첫 가져오기를 리허설할 수 있도록
// 호출자가 기간을 정할 수 있다.

function ensureDevOnly(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (process.env.ENABLE_LOCAL_DEV_TOOLS !== "true") {
    console.warn("[dev/beds24-sync-reviews] gate not enabled");
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const host = request.nextUrl.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    console.warn(`[dev/beds24-sync-reviews] blocked non-local host: ${host}`);
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

function isUuid(value: string | null): value is string {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseSinceDays(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) return "invalid";
  return parsed;
}

async function handle(request: NextRequest) {
  const blocked = ensureDevOnly(request);
  if (blocked) return blocked;

  const requiredSecret = process.env.BEDS24_WEBHOOK_SECRET?.trim();
  if (!requiredSecret) {
    console.warn("[dev/beds24-sync-reviews] webhook secret not configured");
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const providedSecret = resolveSecret(request);
  if (!providedSecret || providedSecret !== requiredSecret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const organizationId = request.nextUrl.searchParams.get("organizationId");
  if (!isUuid(organizationId)) {
    return NextResponse.json({ error: "invalid_organization_id" }, { status: 400 });
  }

  const sinceDays = parseSinceDays(request.nextUrl.searchParams.get("sinceDays"));
  if (sinceDays === "invalid") {
    return NextResponse.json({ error: "invalid_since_days" }, { status: 400 });
  }

  // 프로덕션과 같은 조각내기를 로컬에서 리허설할 수 있게 열어 둔다. 넘기지 않으면 종전대로
  // 전량을 한 번에 돈다(로컬엔 60초 상한이 없다).
  const rawOffset = Number(request.nextUrl.searchParams.get("offset") ?? "0");
  const rawLimit = request.nextUrl.searchParams.get("limit");
  const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  const limit = rawLimit !== null && Number.isInteger(Number(rawLimit)) ? Number(rawLimit) : undefined;

  try {
    const result = await syncOrganizationReviews({
      organizationId,
      sinceDays: sinceDays ?? undefined,
      offset,
      limit,
    });

    return NextResponse.json({ ok: true, organizationId, sinceDays: sinceDays ?? 90, ...result });
  } catch (error) {
    console.error("[dev/beds24-sync-reviews] failed", error);
    return NextResponse.json({ ok: false, error: "reviews_sync_failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
