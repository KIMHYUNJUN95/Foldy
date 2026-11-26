import { NextResponse, type NextRequest } from "next/server";
import { requestMatchesSecret } from "@/lib/api-secret";
import { purgeDisposedLostItems } from "@/lib/lost-found-purge";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

// 분실물 자동 삭제 — 폐기 후 도쿄 기준 90일 지난 행과 그 사진(docs/product/09 「자동 삭제」).
// 예전엔 pg_cron 의 SQL 이 행만 지워 사진이 저장소에 남았다. Storage API 가 필요해 여기로 옮겼다(2026-11-26).
// Vercel Cron 이 하루 한 번 부른다(vercel.json). CRON_SECRET 으로 인증해 익명 호출자가 트리거할 수 없다.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  try {
    const result = await purgeDisposedLostItems(getSupabaseServiceClient());
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[lost-found/purge] failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "purge_failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
