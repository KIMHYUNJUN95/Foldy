import { NextResponse } from "next/server";

import { CONTRACT_VERSION } from "@/lib/contract/schema";
import { isCronAuthorized } from "@/lib/cron-auth";
import { runRetention } from "@/lib/retention/run";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// 매일 도쿄 04:00 보존 기간 지난 자료 지우기(16 §3 · 43 §8-14). pg_cron(202611260007)이 POST 로 부른다 — sync-stays 와 같은 인증.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: Request) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "unauthorized", contract_version: CONTRACT_VERSION }, { status: 401 });
  }
  try {
    const result = await runRetention(createCheckinServiceClient());
    return NextResponse.json({ ok: true, result, contract_version: CONTRACT_VERSION });
  } catch (error) {
    console.error("[retention]", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "retention_failed", contract_version: CONTRACT_VERSION }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
