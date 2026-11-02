import "server-only";

import { NextResponse } from "next/server";

import { CONTRACT_VERSION } from "../contract/schema";

// 손님 API 공통 — 응답 모양(모든 응답에 contract_version, 16 §4) · 캐시 금지 · IP.
export function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(
    { ...body, contract_version: CONTRACT_VERSION },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function serverError(tag: string, error: unknown) {
  // 문구에 손님 정보는 없다(표 이름 · DB 메시지뿐). 서버 로그로만 남긴다.
  console.error(`[${tag}]`, error instanceof Error ? error.message : error);
  return json({ ok: false, error: "server_error" }, 500);
}
