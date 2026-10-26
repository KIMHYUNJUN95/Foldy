import { NextResponse, type NextRequest } from "next/server";

import { relinkReviewRooms } from "@/lib/beds24/review-room-relink";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requestMatchesSecret } from "@/lib/api-secret";

/**
 * 객실이 비어 있는 외부 리뷰를 **일회성으로 전량 재연결**한다.
 *
 * 상시 경로는 `syncOrganizationReviews` 안에서 매 주기 자동으로 돈다(45일 이내만 Beds24 조회).
 * 이 라우트는 그 나이 제한 없이 **과거 전량**을 한 번 훑기 위한 것이다 — 2026-08-07 기준
 * Booking 리뷰 165/253 이 객실 미연결이었고, 그중 128건은 체크인 2026-04-22 이전이라
 * `reservations` 백필 창 밖에 있었다.
 *
 * **같은 함수를 부른다.** 백필용 로직을 따로 만들지 않는 이유는 두 벌이 되는 순간 한쪽만
 * 고쳐지기 때문이다. 차이는 인자 두 개(`lookupMaxAgeDays: null`, 요청 상한)뿐이다.
 *
 * 크레딧: `apiReference` 40개를 한 요청에 실을 수 있어 실측 128건 = 4요청 = 4크레딧이었다.
 *
 * 인증은 `/api/beds24/reviews-sync` 와 같은 규약이다.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 일회성 백필의 요청 상한. 40건/요청이라 1,600건까지 한 번에 덮는다. */
const MAX_LOOKUP_REQUESTS = 40;

function authorize(request: NextRequest): { ok: true } | { ok: false; status: number } {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const webhookSecret = process.env.BEDS24_WEBHOOK_SECRET?.trim();
  if (!cronSecret && !webhookSecret) return { ok: false, status: 404 };

  // 상수 시간 비교 · 후보 중 하나라도 맞으면 통과(2026-10-26, api-secret).
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

  // `skipLookup=1` 이면 Beds24 를 부르지 않는다 — 크레딧 0으로 DB 안에서만 재연결한다.
  //
  // **`dryRun` 이라 부르지 않는다.** 이 경로도 DB 는 쓴다(예약 인덱스로 채울 수 있는 건 채운다).
  // `dryRun` 이라고 이름 붙이면 «아무것도 안 바뀐다»로 읽혀서, 미리보기인 줄 알고 눌렀다가
  // 실제로 데이터가 바뀌는 사고가 난다. 이름은 하는 일 그대로여야 한다.
  const skipLookup = /^(1|true|yes|on)$/i.test(request.nextUrl.searchParams.get("skipLookup") ?? "");

  let organizationIds: string[];
  if (organizationIdParam) {
    organizationIds = [organizationIdParam];
  } else {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from("organizations")
      .select("id")
      .eq("status", "active")
      .order("created_at", { ascending: true });
    if (error) {
      console.error("[beds24/reviews-sync/relink] organization lookup failed", error.message);
      return NextResponse.json({ ok: false, error: "organization_lookup_failed" }, { status: 500 });
    }
    organizationIds = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
  }

  const results = [];
  for (const organizationId of organizationIds) {
    const relink = await relinkReviewRooms({
      organizationId,
      // 나이 제한 없음 — 이 라우트의 존재 이유가 «과거 전량»이다.
      lookupMaxAgeDays: null,
      allowLookup: !skipLookup,
      maxLookupRequests: MAX_LOOKUP_REQUESTS,
    });
    results.push({ organizationId, ...relink });
  }

  return NextResponse.json({ ok: true, skipLookup, results });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
