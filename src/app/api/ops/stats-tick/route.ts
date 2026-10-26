import { NextResponse, type NextRequest } from "next/server";
import { processDirtyOpsStats } from "@/lib/ops-stats";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { safeEqualSecret } from "@/lib/api-secret";

/**
 * 객실 × 월 집계 틱 — dirty 달을 미리 계산해 둔다(화면을 열 때 기다리지 않게).
 *
 * 도메인 계약: docs/product/34-metrics-and-automation.md 「객실 × 월 집계 표」 · 마이그레이션 `202610080002`
 *
 * pg_cron 이 매 분 `ops_stats_tick_if_needed()` 를 돌리고 dirty 달이 있을 때만 부른다. 토큰은 Beds24 틱과 같다
 * (`beds24_tick_token_ok` 로 대조 — 새 비밀값 없음). 사람이 손으로 부를 때는 `CRON_SECRET` 도 받는다. 화면은 이 틱이 늦어도
 * 읽기 전에 dirty 달을 스스로 계산하므로 정확성은 이 틱에 기대지 않는다.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 한 번에 이만큼 달 — 한 달 계산이 1초 안팎이라 60초 안에 넉넉히 끝난다. */
const MONTHS_PER_RUN = 12;

function providedSecret(request: NextRequest) {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || null;
}

export async function POST(request: NextRequest) {
  const supabase = getSupabaseServiceClient();
  const provided = providedSecret(request);
  if (!provided) return NextResponse.json({ ok: false }, { status: 401 });
  const cronSecret = process.env.CRON_SECRET?.trim();
  let allowed = !!cronSecret && safeEqualSecret(provided, cronSecret);
  if (!allowed) {
    const checked = await supabase.rpc("beds24_tick_token_ok", { p_token: provided });
    allowed = !checked.error && checked.data === true;
  }
  if (!allowed) return NextResponse.json({ ok: false }, { status: 401 });

  try {
    const done = await processDirtyOpsStats(supabase, MONTHS_PER_RUN);
    return NextResponse.json({ done, ok: true });
  } catch (error) {
    console.error("[ops/stats-tick] failed", { message: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
