import { NextResponse, type NextRequest } from "next/server";
import { syncOrganizationReviews } from "@/lib/beds24/reviews-sync";
import { isBeds24SyncPaused } from "@/lib/beds24/sync-control";
import { recordReviewSyncDone } from "@/lib/beds24/reviews-sync-manual";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requestMatchesSecret } from "@/lib/api-secret";

// Production collection trigger for Beds24 external reviews (Airbnb / Booking.com).
//
// Reviews have no webhook, so they are the one Beds24 read path that must be pulled on a
// schedule (see docs/engineering/01-beds24-integration.md → "External Reviews"). Both Beds24
// endpoints require a unit parameter, so one cycle costs (Airbnb-linked room types) +
// (Booking-linked properties) requests plus pagination. That is why the routine schedule is
// once a day with a 30-day window, and the deep sweep is opt-in via `?full=1`.
//
// Driven once a day by GitHub Actions (.github/workflows/beds24-reviews-sync.yml — not Vercel Cron).
// Can also be triggered manually with the Beds24 webhook secret. Staff can collect on demand from
// the 외부 리뷰 screen («지금 가져오기», src/app/mobile/complaints/review-sync-actions.ts), which runs
// the same function and window. Collection is a pure upsert on (organization_id, provider,
// external_review_id), so re-running is harmless.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 한 번의 호출이 처리할 최대 대상 수 (2026-08-07).
 *
 * **이 값이 있어야 하는 이유:** 한 주기는 71개 대상을 순차 호출해 실측 126초가 걸린다. Vercel
 * Hobby 의 함수 상한은 60초라 전량 처리는 구조적으로 불가능했고, 실제로 스케줄 실행이
 * `504 FUNCTION_INVOCATION_TIMEOUT` 으로 매번 죽어 리뷰가 한 건도 수집되지 않았다.
 * 대상 하나가 대략 1.5~2초이므로 12개면 30초 안팎 — 상한의 절반이라 지연에도 여유가 있다.
 *
 * 호출부는 `nextOffset`/`nextOrganizationId` 가 null 이 될 때까지 반복해서 부른다. 총 Beds24
 * 호출 수는 쪼개기 전과 **동일**하다(대상 수가 곧 호출 수) — 크레딧이 늘지 않는다.
 */
const DEFAULT_TARGET_LIMIT = 12;
const MAX_TARGET_LIMIT = 40;

/** 정기 실행 창. 하루 1회 주기(08:05 도쿄, GitHub Actions)라 짧게 잡아 페이지네이션을 줄인다. */
// Booking.com 전용 창(Airbnb는 `from`이 없어 항상 전량이 온다). 30일인 이유: 리뷰는 체크아웃
// 며칠 뒤에 달리고 `last_change_timestamp`가 있는 걸 보면 수정도 되므로, 7일 창은 늦게 달린
// 리뷰를 놓칠 수 있다. UPSERT라 겹쳐 받아도 무해하다.
const ROUTINE_SINCE_DAYS = 30;
/** 초기 도입/복구용 전량 수집 창. */
// `?full=1` — 초기 도입/복구용 6개월(180일). 첫 예약이 2026-04-22이라 영업 이력 자체가 약 3.5개월
// 이므로 6개월이면 사실상 전량을 덮는다. Airbnb에는 적용되지 않는다 — 날짜 파라미터가 없고 최대
// 50건이 전량으로 오며, 여기에 기간 컷을 걸면 상한 탓에 다시 못 가져올 데이터를 버리게 된다.
const FULL_SINCE_DAYS = 180;

/**
 * Authorize a review-collection call. Same contract as /api/beds24/reconcile:
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

function parseIntParam(value: string | null, fallback: number, max: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

function isTruthyFlag(value: string | null) {
  if (!value) return false;
  const flag = value.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes" || flag === "on";
}

async function resolveOrganizationIds(organizationId: string | null) {
  if (organizationId) return [organizationId];

  const supabase = getSupabaseServiceClient();
  const result = await supabase
    .from("organizations")
    .select("id")
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (result.error) {
    throw new Error(`reviews sync org query failed: ${result.error.message}`);
  }

  return ((result.data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

async function handle(request: NextRequest) {
  if (isBeds24SyncPaused()) {
    return NextResponse.json({ ok: true, paused: true }, { status: 202 });
  }

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

  const full = isTruthyFlag(request.nextUrl.searchParams.get("full"));
  const sinceDays = full ? FULL_SINCE_DAYS : ROUTINE_SINCE_DAYS;
  const offset = parseIntParam(request.nextUrl.searchParams.get("offset"), 0, Number.MAX_SAFE_INTEGER);
  const limit = parseIntParam(
    request.nextUrl.searchParams.get("limit"),
    DEFAULT_TARGET_LIMIT,
    MAX_TARGET_LIMIT,
  );

  let organizationIds: string[];
  try {
    organizationIds = await resolveOrganizationIds(organizationIdParam);
  } catch (error) {
    console.error("[beds24/reviews-sync] organization lookup failed", error);
    return NextResponse.json({ ok: false, error: "organization_lookup_failed" }, { status: 500 });
  }

  // 이어받기는 «한 호출 = 한 조직의 한 조각» 이다. `organizationId` 가 오면 그 조직부터,
  // 없으면 첫 조직부터 시작한다. 전량을 한 번에 돌지 않는 이유는 위 DEFAULT_TARGET_LIMIT 주석 참고.
  const startIndex = organizationIdParam ? organizationIds.indexOf(organizationIdParam) : 0;
  if (startIndex < 0) {
    return NextResponse.json({ ok: false, error: "unknown_organization" }, { status: 404 });
  }
  const currentOrganizationId = organizationIds[startIndex];
  if (!currentOrganizationId) {
    return NextResponse.json({ ok: true, done: true, mode: "no_organizations" }, { status: 200 });
  }

  let result;
  try {
    result = await syncOrganizationReviews({
      organizationId: currentOrganizationId,
      sinceDays,
      offset,
      limit,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "reviews_sync_failed";
    console.error("[beds24/reviews-sync] organization failed", currentOrganizationId, message);
    // 한 조직이 실패해도 나머지는 계속되어야 하므로, 다음 조직을 가리켜 돌려준다.
    // 실패 사실은 207 로 드러내 워크플로가 빨간불로 남긴다.
    const nextOrganizationId = organizationIds[startIndex + 1] ?? null;
    return NextResponse.json(
      {
        ok: false,
        done: nextOrganizationId === null,
        mode: "partial_failure",
        organizationId: currentOrganizationId,
        error: message,
        nextOrganizationId,
        nextOffset: nextOrganizationId === null ? null : 0,
      },
      { status: 207 },
    );
  }

  // 이 조직을 끝까지 돌았다 — 「지금 가져오기」 버튼의 「마지막 수집」 · 10분 잠금에 정기 수집도 넣는다
  // (`reviews-sync-manual.ts`). 크레딧이 바닥나 멈춘 경우는 끝난 것이 아니다.
  if (result.nextOffset === null && !result.stoppedEarly) {
    await recordReviewSyncDone(getSupabaseServiceClient(), {
      by: "schedule",
      organizationId: currentOrganizationId,
      upserted: result.upserted,
    });
  }

  // 이 조직에 남은 조각이 있으면 같은 조직을 이어서, 없으면 다음 조직의 0번부터.
  const moreInOrganization = result.nextOffset !== null;
  const nextOrganizationId = moreInOrganization
    ? currentOrganizationId
    : (organizationIds[startIndex + 1] ?? null);
  const nextOffset = moreInOrganization ? result.nextOffset : nextOrganizationId ? 0 : null;
  const done = nextOrganizationId === null;

  return NextResponse.json(
    {
      ok: true,
      done,
      mode: result.upserted > 0 ? "success" : "no_data",
      full,
      sinceDays,
      organizationId: currentOrganizationId,
      organizationCount: organizationIds.length,
      offset,
      limit,
      totalTargets: result.totalTargets,
      upserted: result.upserted,
      requests: result.requests,
      creditsRemaining: result.creditsRemaining,
      stoppedEarly: result.stoppedEarly,
      skipped: result.skipped,
      truncatedTargets: result.truncatedTargets,
      // 휴면으로 빼둔 룸타입. 조용히 줄면 «수집이 되고 있다»는 착각을 만든다.
      dormantTargets: result.dormantTargets,
      nextOrganizationId,
      nextOffset,
    },
    { status: 200 },
  );
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
