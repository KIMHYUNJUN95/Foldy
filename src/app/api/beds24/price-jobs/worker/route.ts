import { NextResponse, type NextRequest } from "next/server";
import { runNextPriceJob } from "@/lib/beds24/price-job-worker";
import { isBeds24SyncPaused } from "@/lib/beds24/sync-control";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requestMatchesSecret } from "@/lib/api-secret";

/**
 * 가격·최소숙박 작업 워커.
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md 「작업 큐」
 *
 * 두 곳에서 부른다.
 *
 * 1. **접수 직후** — 사람이 방금 누른 것은 몇 초 안에 나가야 한다
 * 2. **크론** — 접수 직후 호출이 실패하거나(네트워크·배포 중) 작업이 여럿 쌓였을 때의 안전망
 *
 * 한 번에 **최대 5개**까지 처리하고, 45초가 넘으면 남은 것은 다음 주기에 넘긴다 —
 * Hobby 플랜 상한(60초)에 걸려 중간에 잘리면 그 작업은 15분 뒤에야 회수된다.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 남은 작업이 있어도 여기서 멈춘다. 다음 호출이 이어받는다. */
const MAX_JOBS_PER_RUN = 5;
const MAX_RUNTIME_MS = 45_000;

/** `rates-sync` 와 같은 규칙 — 크론 시크릿 또는 Beds24 웹훅 시크릿. 둘 다 없으면 닫아 둔다. */
function authorize(request: NextRequest): { ok: true } | { ok: false; status: number } {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const webhookSecret = process.env.BEDS24_WEBHOOK_SECRET?.trim();
  if (!cronSecret && !webhookSecret) return { ok: false, status: 404 };

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

async function handle(request: NextRequest) {
  if (isBeds24SyncPaused()) {
    return NextResponse.json({ ok: true, paused: true }, { status: 202 });
  }

  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 404 ? "not_found" : "forbidden", ok: false },
      { status: auth.status },
    );
  }

  const startedAt = Date.now();
  const outcomes = [];
  try {
    const supabase = getSupabaseServiceClient();
    for (let index = 0; index < MAX_JOBS_PER_RUN; index += 1) {
      if (Date.now() - startedAt > MAX_RUNTIME_MS) break;
      const outcome = await runNextPriceJob(supabase);
      outcomes.push(outcome);
      // 큐가 비었거나, 락·쿨다운에 막혔으면 더 돌 이유가 없다.
      if (!outcome.ran) break;
    }
    return NextResponse.json({ ok: true, outcomes });
  } catch (error) {
    console.error("[beds24/price-jobs/worker] failed", error);
    return NextResponse.json({ error: "price_job_worker_failed", ok: false, outcomes }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
