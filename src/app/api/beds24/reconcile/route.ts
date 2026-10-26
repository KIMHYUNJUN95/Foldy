import { NextResponse, type NextRequest } from "next/server";
import { backfillBeds24Reservations } from "@/lib/beds24/reservations-backfill";
import { isBeds24SyncPaused } from "@/lib/beds24/sync-control";
import { syncBeds24RoomBlocks, type RoomBlockSyncResult } from "@/lib/beds24/room-blocks-sync";
import { recordBeds24ReconciliationEvent } from "@/lib/beds24/webhook-events";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requestMatchesSecret } from "@/lib/api-secret";

// Production reconciliation safety net for Beds24 reservation ingestion.
//
// Webhooks remain the primary update path (see docs/planning/01-decision-log.md
// "Beds24 Webhook Strategy"). This endpoint is a low-frequency catch-up: it re-pulls
// the operational window (current month + next month) directly from the Beds24
// /bookings API and upserts anything missing, so a dropped/never-delivered webhook is
// healed on the next run instead of staying invisibly absent from the calendar.
//
// Driven daily by Vercel Cron (see vercel.json). Can also be triggered manually with
// the Beds24 webhook secret. This is NOT the dev-only backfill route — it is safe to
// run in production and is intentionally idempotent (pure upsert).

export const dynamic = "force-dynamic";
// Backfilling ~hundreds of rows in one window can exceed the default serverless
// timeout; allow up to 60s (Vercel Hobby-compatible ceiling).
export const maxDuration = 60;

/**
 * Authorize a reconciliation call. Accepts either:
 *  - Vercel Cron's `Authorization: Bearer <CRON_SECRET>` header, or
 *  - the Beds24 webhook secret (manual trigger via header/query).
 * If neither secret is configured server-side, the endpoint stays closed (404).
 */
function authorize(request: NextRequest): { ok: true } | { ok: false; status: number } {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const webhookSecret = process.env.BEDS24_WEBHOOK_SECRET?.trim();
  if (!cronSecret && !webhookSecret) {
    return { ok: false, status: 404 };
  }

  // 상수 시간 비교 · 보낸 후보(Bearer / 헤더 / 쿼리) 중 하나라도 맞으면 통과(2026-10-26, api-secret).
  if (
    requestMatchesSecret(request, [cronSecret, webhookSecret], {
      headers: ["x-beds24-webhook-secret"],
      query: true,
    })
  ) {
    return { ok: true };
  }
  return { ok: false, status: 403 };
}

function isUuid(value: string | null) {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function handle(request: NextRequest) {
  if (isBeds24SyncPaused()) {
    return NextResponse.json({ ok: true, paused: true }, { status: 202 });
  }

  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.status === 404 ? "not_found" : "forbidden" }, { status: auth.status });
  }

  const organizationIdParam = request.nextUrl.searchParams.get("organizationId");
  if (organizationIdParam && !isUuid(organizationIdParam)) {
    return NextResponse.json({ ok: false, error: "invalid_organization_id" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();

  try {
    const result = await backfillBeds24Reservations(supabase, {
      organizationId: organizationIdParam ?? undefined,
    });

    // 캘린더 블락도 같은 주기로 맞춘다. 블락은 웹훅이 아예 없어서(예약이 아니라 인벤토리
    // 오버라이드다) **이 경로가 유일한 입구다** — 예약처럼 「웹훅이 주 경로, 여기는 안전망」이
    // 아니라 여기서 안 가져오면 영영 안 들어온다.
    //
    // 예약 정합성과 성패를 묶지 않는다. 블락을 못 읽었다고 예약 결과까지 실패로 보고하면
    // 워크플로가 빨간불이 되어 「예약이 안 들어온다」는 진짜 신호가 묻힌다.
    let roomBlocks: RoomBlockSyncResult | null = null;
    try {
      roomBlocks = await syncBeds24RoomBlocks(supabase, {
        organizationId: organizationIdParam ?? undefined,
      });
    } catch (error) {
      console.error("[beds24/reconcile] room block sync failed", error);
      roomBlocks = null;
    }

    const httpStatus = result.partial ? 207 : 200;
    await recordBeds24ReconciliationEvent({
      supabase,
      httpStatus,
      result,
      organizationId: organizationIdParam ?? null,
    });

    return NextResponse.json(
      {
        ok: !result.partial,
        // 증분에서 0건은 **정상**이다(바뀐 게 없는 날). 창 훑기에서 0건이라야 이상 신호다.
        mode: result.partial
          ? "partial_failure"
          : result.fetchedRows > 0
            ? "success"
            : result.incremental
              ? "no_changes"
              : "no_data",
        ...result,
        roomBlocks,
      },
      { status: httpStatus },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "reconcile_failed";
    console.error("[beds24/reconcile] failed", error);
    await recordBeds24ReconciliationEvent({
      supabase,
      httpStatus: 500,
      result: {
        attempted: true,
        incremental: false,
        endpointTried: null,
        from: "",
        toExclusive: "",
        partial: true,
        failedPageUrl: null,
        fetchedRows: 0,
        upsertedRows: 0,
        cancelledUpsertedRows: 0,
        skippedRows: 0,
        recoveredRows: 0,
        skipped: ["reconcile_failed"],
        skippedReasons: [],
      },
      organizationId: organizationIdParam ?? null,
      errorMessage: message,
    });
    return NextResponse.json({ ok: false, error: "reconcile_failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
