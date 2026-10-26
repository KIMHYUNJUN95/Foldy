import { NextResponse, type NextRequest } from "next/server";
import { hasPendingPriceJobs } from "@/lib/beds24/price-job-queue";
import { runNextPriceJob, type PriceJobOutcome } from "@/lib/beds24/price-job-worker";
import { priceWebhookRunLockName, refreshBeds24Property } from "@/lib/beds24/price-webhook";
import { isBeds24SyncPaused } from "@/lib/beds24/sync-control";
import { acquireBeds24Lock, getBeds24Cooldown, releaseBeds24Lock } from "@/lib/beds24/sync-locks";
import {
  BEDS24_TICK_LOCK,
  DEFERRED_REFRESH_MAX_ATTEMPTS,
  decideBeds24Tick,
} from "@/lib/beds24/tick-plan";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { safeEqualSecret } from "@/lib/api-secret";

/**
 * Beds24 틱 — 쿨다운이 풀리면 멈춘 일을 이어받는다.
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md 「쿨다운이 풀리면 1분 안에 이어서 보낸다 ·
 * 미뤄 둔 웹훅 재조회」
 *
 * Supabase pg_cron 이 매 분 `beds24_tick_if_needed()` 를 돌리고, **할 일이 있을 때만** pg_net 으로
 * 여기를 부른다(`supabase/migrations/202609300004_beds24_tick_cron.sql`). 토큰은 Vault 에 있고
 * `beds24_tick_token_ok()` 로 대조만 한다 — 새 환경변수가 없다. 사람이 손으로 부를 때를 위해
 * 워커와 같은 `CRON_SECRET` / `BEDS24_WEBHOOK_SECRET` 도 받는다.
 *
 * 한 번에 한 가지만 한다(`decideBeds24Tick`) — 가격 작업이 남았으면 작업, 없으면 미뤄 둔 건물
 * 재조회. 남은 것은 다음 틱(1분 뒤)이 이어받는다.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_JOBS_PER_RUN = 5;
const MAX_RUNTIME_MS = 45_000;
const MAX_REFRESHES_PER_RUN = 10;
/** 라우트 수명(60초)과 같다 — 도는 동안 SQL 이 「busy」로 건너뛴다. */
const TICK_LOCK_TTL_MS = 60_000;
/** 웹훅의 건물 락과 같은 수명. */
const REFRESH_LOCK_TTL_MS = 55_000;

/** 토큰은 헤더로만 받는다 — 쿼리에 실으면 접근 로그에 남는다. */
function resolveProvidedSecret(request: NextRequest) {
  const fromBearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const fromHeader = request.headers.get("x-beds24-webhook-secret")?.trim();
  return fromBearer || fromHeader || null;
}

async function authorize(
  request: NextRequest,
  supabase: ReturnType<typeof getSupabaseServiceClient>,
): Promise<boolean> {
  const provided = resolveProvidedSecret(request);
  if (!provided) return false;

  const cronSecret = process.env.CRON_SECRET?.trim();
  const webhookSecret = process.env.BEDS24_WEBHOOK_SECRET?.trim();
  if (cronSecret && safeEqualSecret(provided, cronSecret)) return true;
  if (webhookSecret && safeEqualSecret(provided, webhookSecret)) return true;

  const checked = await supabase.rpc("beds24_tick_token_ok", { p_token: provided });
  if (checked.error) {
    console.error("[beds24/tick] token check failed", { code: checked.error.code });
    return false;
  }
  return checked.data === true;
}

type DeferredRow = {
  external_property_id: string;
  organization_id: string;
  attempts: number;
};

type RefreshOutcome =
  | { externalPropertyId: string; result: "refreshed"; rows: number }
  | { externalPropertyId: string; result: "yielded"; reason: "cooldown" | "price_job" }
  | { externalPropertyId: string; result: "failed"; attempts: number }
  | { externalPropertyId: string; result: "busy" };

async function refreshDeferred(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  rows: DeferredRow[],
  startedAt: number,
): Promise<RefreshOutcome[]> {
  const outcomes: RefreshOutcome[] = [];
  for (const row of rows) {
    if (Date.now() - startedAt > MAX_RUNTIME_MS) break;
    const externalPropertyId = row.external_property_id;

    // 웹훅이 지금 이 건물을 읽고 있으면 넘긴다 — 그 읽기가 끝나며 이 줄을 지운다.
    const lockName = priceWebhookRunLockName(externalPropertyId);
    const lock = await acquireBeds24Lock(supabase, lockName, "beds24-tick", REFRESH_LOCK_TTL_MS);
    if (!lock.acquired) {
      outcomes.push({ externalPropertyId, result: "busy" });
      continue;
    }

    try {
      const refreshed = await refreshBeds24Property(
        supabase,
        row.organization_id,
        externalPropertyId,
        "tick",
      );
      if (refreshed.yielded) {
        // 쿨다운이 다시 켜졌거나 새 가격 작업이 들어왔다. 나머지도 똑같이 물러나므로 여기서 멈춘다.
        outcomes.push({ externalPropertyId, reason: refreshed.yielded, result: "yielded" });
        break;
      }
      if (refreshed.skipped.length === 0) {
        outcomes.push({ externalPropertyId, result: "refreshed", rows: refreshed.rows });
        continue;
      }

      const attempts = row.attempts + 1;
      const updated = await supabase
        .from("beds24_deferred_refreshes")
        .update({
          attempts,
          last_error: refreshed.skipped.join(",").slice(0, 500),
          reason: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("external_property_id", externalPropertyId);
      if (updated.error) {
        console.error("[beds24/tick] attempt count update failed", {
          code: updated.error.code,
          externalPropertyId,
        });
      }
      outcomes.push({ attempts, externalPropertyId, result: "failed" });
      // 429 로 실패했다면 쿨다운이 방금 켜졌다. 나머지 건물도 같은 벽에 부딪친다.
      if ((await getBeds24Cooldown(supabase)).active) break;
    } finally {
      await releaseBeds24Lock(supabase, lockName, lock.lockId);
    }
  }
  return outcomes;
}

async function handle(request: NextRequest) {
  if (isBeds24SyncPaused()) {
    return NextResponse.json({ ok: true, paused: true }, { status: 202 });
  }

  const supabase = getSupabaseServiceClient();
  if (!(await authorize(request, supabase))) {
    return NextResponse.json({ error: "forbidden", ok: false }, { status: 403 });
  }

  const tickLock = await acquireBeds24Lock(supabase, BEDS24_TICK_LOCK, "beds24-tick", TICK_LOCK_TTL_MS);
  if (!tickLock.acquired) {
    return NextResponse.json({ action: "busy", ok: true, reason: tickLock.reason });
  }

  const startedAt = Date.now();
  try {
    const [cooldown, pendingPriceJobs, deferredResult] = await Promise.all([
      getBeds24Cooldown(supabase),
      hasPendingPriceJobs(supabase),
      supabase
        .from("beds24_deferred_refreshes")
        .select("external_property_id, organization_id, attempts")
        .lt("attempts", DEFERRED_REFRESH_MAX_ATTEMPTS)
        .order("requested_at", { ascending: true })
        .limit(MAX_REFRESHES_PER_RUN),
    ]);
    if (deferredResult.error) {
      console.error("[beds24/tick] deferred refresh read failed", { code: deferredResult.error.code });
    }
    const deferredRows = (deferredResult.data ?? []) as DeferredRow[];

    const action = decideBeds24Tick({
      cooldownActive: cooldown.active,
      deferredRefreshes: deferredRows.length,
      pendingPriceJobs,
    });

    if (action === "run_price_jobs") {
      const outcomes: PriceJobOutcome[] = [];
      for (let index = 0; index < MAX_JOBS_PER_RUN; index += 1) {
        if (Date.now() - startedAt > MAX_RUNTIME_MS) break;
        const outcome = await runNextPriceJob(supabase);
        outcomes.push(outcome);
        // 비었거나 · 락 · 쿨다운이면 멈춘다. 쿨다운으로 되돌린 작업(`requeued`)도 — 다음 틱이
        // 쿨다운이 끝난 뒤 이어받는다.
        if (!outcome.ran || outcome.status === "requeued") break;
      }
      return NextResponse.json({ action, ok: true, outcomes });
    }

    if (action === "refresh_deferred") {
      const refreshes = await refreshDeferred(supabase, deferredRows, startedAt);
      return NextResponse.json({ action, ok: true, refreshes });
    }

    return NextResponse.json({
      action,
      ok: true,
      ...(action === "cooldown" ? { remainingSec: cooldown.remainingSec } : {}),
    });
  } catch (error) {
    console.error("[beds24/tick] failed", error);
    return NextResponse.json({ error: "tick_failed", ok: false }, { status: 500 });
  } finally {
    await releaseBeds24Lock(supabase, BEDS24_TICK_LOCK, tickLock.lockId);
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}
