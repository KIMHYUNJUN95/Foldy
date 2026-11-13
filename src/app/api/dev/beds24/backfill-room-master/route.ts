import { NextResponse, type NextRequest } from "next/server";
import { requestMatchesSecret } from "@/lib/api-secret";
import { backfillBeds24RoomMaster } from "@/lib/beds24/properties-room-master-sync";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

function ensureDevOnly(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (process.env.ENABLE_LOCAL_DEV_TOOLS !== "true") {
    console.warn("[dev/beds24-room-master] gate not enabled");
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const host = request.nextUrl.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    console.warn(`[dev/beds24-room-master] blocked non-local host: ${host}`);
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return null;
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
    console.warn("[dev/beds24-room-master] webhook secret not configured");
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

  try {
    const supabase = getSupabaseServiceClient();
    // `?propertyId=343112` 또는 `?propertyId=343112,280663` — 지정하면 그 건물만 동기화한다.
    // 새 건물 하나를 채우려다 다른 건물까지 건드리지 않기 위해서다.
    const propertyIdsParam = request.nextUrl.searchParams.get("propertyId");
    const externalPropertyIds = propertyIdsParam
      ? propertyIdsParam.split(",").map((id) => id.trim()).filter(Boolean)
      : undefined;

    const result = await backfillBeds24RoomMaster(supabase, {
      organizationId: organizationIdParam ?? undefined,
      externalPropertyIds,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("[dev/beds24-room-master] failed", error);
    return NextResponse.json({ ok: false, error: "backfill_failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
