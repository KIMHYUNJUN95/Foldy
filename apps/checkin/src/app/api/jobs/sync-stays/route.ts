import { NextResponse } from "next/server";

import { CONTRACT_VERSION } from "@/lib/contract/schema";
import { isCronAuthorized } from "@/lib/cron-auth";
import { createCheckinServiceClient } from "@/lib/supabase/service";
import { runSyncStays } from "@/lib/sync/run";

// 5분 크론(16 §4). Vercel Cron 은 GET 으로 부르므로 GET · POST 둘 다 받는다.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: Request) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "unauthorized", contract_version: CONTRACT_VERSION }, { status: 401 });
  }
  try {
    const result = await runSyncStays(createCheckinServiceClient());
    return NextResponse.json({ ok: true, result, contract_version: CONTRACT_VERSION });
  } catch (error) {
    // 오류 문구에 개인 정보는 없다(표 이름 · DB 메시지뿐). 서버 로그로만 남긴다.
    console.error("[sync-stays]", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "sync_failed", contract_version: CONTRACT_VERSION }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
