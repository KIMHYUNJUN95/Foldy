import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { postSlackText } from "@/lib/slack-notify";
import { requestMatchesSecret } from "@/lib/api-secret";

/**
 * 리뷰 수집이 «조용히 멈췄는지» 점검한다.
 *
 * 존재 이유
 * ---------------
 * 2026-08-06~07, 리뷰 수집 크론이 **한 번도 성공한 적이 없는데 이틀간 아무도 몰랐다.**
 * 워크플로는 빨간불이었고 DB 는 비어가고 있었지만 알아챌 장치가 없었다.
 *
 * **점검은 수집 밖에 있어야 한다.** 수집이 안 도는 것이 문제인데 수집이 스스로 알릴 수는 없다.
 * 그래서 하루 4회 안정적으로 도는 reconcile 워크플로가 이 엔드포인트를 부른다.
 *
 * 새 테이블이 없는 이유
 * ----------------
 * `external_reviews_set_updated_at` 트리거가 **upsert 마다** `updated_at` 을 갱신한다. 수집은
 * 받아온 리뷰를 전부 다시 upsert 하므로, 한 주기라도 성공하면 그 조직의 `max(updated_at)` 이 그 시각으로
 * 움직인다. 즉 «마지막으로 수집이 테이블에 닿은 시각»을 실행 로그 테이블 없이 알 수 있다.
 * 새 스키마를 추가하는 비용보다 이쪽이 싸고, 무엇보다 **이미 검증된 신호**다(같은 방법으로
 * 이번 장애를 진단했다).
 *
 * 인증은 `/api/beds24/reconcile` 과 같은 규약이다.
 */

export const dynamic = "force-dynamic";

/** 이 일수를 넘게 수집이 테이블에 닿지 않으면 알린다. 하루 1회 주기라 2일은 «두 번 걸렀다» 는 뜻이다. */
const STALE_AFTER_DAYS = 2;

/** `CRON_SECRET` Bearer 하나, 없으면 404. 웹훅 비밀값은 받지 않는다(2026-11-13). */
function authorize(request: NextRequest): { ok: true } | { ok: false; status: number } {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return { ok: false, status: 404 };
  return requestMatchesSecret(request, [cronSecret]) ? { ok: true } : { ok: false, status: 403 };
}

async function handle(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.status === 404 ? "not_found" : "forbidden" },
      { status: auth.status },
    );
  }

  // **조직마다** 마지막으로 수집이 닿은 시각을 본다(2026-11-10). 예전엔 표 전체의 max(updated_at) 하나라, 한 조직만
  // 수집돼도 다른 조직이 멈춘 것을 알 수 없었다. 리뷰가 한 건도 없는 조직은 판단하지 않는다(갓 도입).
  const supabase = getSupabaseServiceClient();
  const { data: orgRows, error: orgError } = await supabase.from("organizations").select("id").eq("status", "active");
  if (orgError) {
    console.error("[beds24/reviews-sync/health] organization query failed", orgError.message);
    return NextResponse.json({ ok: false, error: "query_failed" }, { status: 500 });
  }
  const organizations: Array<{ organizationId: string; lastTouched: string | null; ageDays: number | null; stale: boolean }> = [];
  for (const org of (orgRows ?? []) as Array<{ id: string }>) {
    const { data, error } = await supabase
      .from("external_reviews")
      .select("updated_at")
      .eq("organization_id", org.id)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (error) {
      console.error("[beds24/reviews-sync/health] query failed", error.message);
      return NextResponse.json({ ok: false, error: "query_failed" }, { status: 500 });
    }
    const touched = (data?.[0] as { updated_at: string } | undefined)?.updated_at ?? null;
    const age = touched ? Math.floor((Date.now() - new Date(touched).getTime()) / 86_400_000) : null;
    organizations.push({ organizationId: org.id, lastTouched: touched, ageDays: age, stale: age !== null && age >= STALE_AFTER_DAYS });
  }

  const staleOrgs = organizations.filter((org) => org.stale);
  const stale = staleOrgs.length > 0;
  // 응답 모양은 예전과 같다(`stale` · `ageDays` · `lastTouched`) — 가장 오래 멈춘 조직 기준. 조직별은 `organizations`.
  const worst = [...staleOrgs].sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0))[0] ?? null;
  const lastTouched = worst?.lastTouched ?? organizations.map((o) => o.lastTouched).filter(Boolean).sort().at(-1) ?? null;
  const ageDays = worst?.ageDays ?? (lastTouched ? Math.floor((Date.now() - new Date(lastTouched).getTime()) / 86_400_000) : null);

  let notified: string | null = null;
  if (stale) {
    // i18n-ignore-start — 사전을 쓰지 않는 이유: 이 문구는 화면이 아니라 **운영 Slack 채널**로
    // 나간다. 크론 컨텍스트에는 «보는 사람»이 없어 로케일을 고를 근거가 없고, 채널 하나로만
    // 가므로 조직 운영 언어(한국어)로 고정하는 것이 맞다. UI 카피가 아니다.
    const result = await postSlackText(
      [
        ":rotating_light: *Foldy — 외부 리뷰 수집이 멈춘 것 같습니다*",
        `멈춘 조직 ${staleOrgs.length}곳 · 가장 오래된 마지막 수집: ${lastTouched} (약 ${ageDays}일 전)`,
        "GitHub Actions → “Beds24 external review sync” 실행 이력을 확인해 주세요.",
      ].join("\n"),
    );
    // i18n-ignore-end
    notified = result.ok ? "sent" : result.reason;
  }

  // 200 으로 두는 이유: 이 엔드포인트의 실패와 «수집이 멈췄다» 는 사실은 다른 것이다.
  // 호출부(워크플로)가 `stale` 을 보고 빨간불을 낼지 정한다.
  return NextResponse.json({
    ok: true,
    stale,
    lastTouched,
    ageDays,
    staleAfterDays: STALE_AFTER_DAYS,
    organizations,
    notified,
  });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
