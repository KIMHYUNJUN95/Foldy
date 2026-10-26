import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getOnboardingState } from "@/lib/onboarding";
import { sanitizeNextPath } from "@/lib/safe-redirect";
import { getDeviceSurfaceFromHeaders } from "@/lib/mobile-device";
import { normalizePathForSurface } from "@/lib/surface-routing";

function buildBlockedUrl(
  origin: string,
  mode: "suspended" | "removed" | "disabled",
  next: string,
  email: string,
) {
  const blockedUrl = new URL("/auth/login", origin);
  blockedUrl.searchParams.set("view", "blocked");
  blockedUrl.searchParams.set("mode", mode);
  if (next) blockedUrl.searchParams.set("next", next);
  if (email) blockedUrl.searchParams.set("email", email);
  return blockedUrl;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const surface = getDeviceSurfaceFromHeaders(request.headers);
  const code = url.searchParams.get("code");
  const errorDesc = url.searchParams.get("error_description");
  const rawNext = url.searchParams.get("next") || "";
  const safeNext =
    rawNext === "/" ? "" : normalizePathForSurface(sanitizeNextPath(rawNext), surface);

  // ── OAuth 제공자가 오류를 돌려준 경우 ──────────────────────────────────────
  if (errorDesc) {
    const loginUrl = new URL("/auth/login", url.origin);
    loginUrl.searchParams.set("error", errorDesc);
    if (safeNext) loginUrl.searchParams.set("next", safeNext);
    return NextResponse.redirect(loginUrl);
  }

  // ── PKCE / 매직링크 코드를 세션으로 교환 ─────────────────────────
  if (code) {
    const supabase = await getSupabaseServerClient();
    const { error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      const loginUrl = new URL("/auth/login", url.origin);
      loginUrl.searchParams.set("error", exchangeError.message);
      if (safeNext) loginUrl.searchParams.set("next", safeNext);
      return NextResponse.redirect(loginUrl);
    }
  }

  // ── 온보딩 상태를 서버에서 판정 ──────────────────────────────────
  // Google OAuth 신규 사용자 흐름의 주 관문: Google 로그인에 성공하면
  // 브라우저는 Foldy 프로필도 팀 멤버십도 없는 상태로 여기에 도착한다.
  // 방금 만들어진 세션으로 상태를 확인한다
  // (Supabase SSR 헬퍼가 세션을 변경 가능한 쿠키 저장소에 기록하므로
  // 같은 요청 주기의 이후 헬퍼가 읽을 수 있다).
  const state = await getOnboardingState();

  if (state.status === "unauthenticated") {
    // 코드 교환에 성공했다면 일어나지 않아야 하지만 방어적으로 막는다.
    const loginUrl = new URL("/auth/login", url.origin);
    if (safeNext) loginUrl.searchParams.set("next", safeNext);
    return NextResponse.redirect(loginUrl);
  }

  if (
    state.status === "needs_profile" ||
    state.status === "needs_membership"
  ) {
    // 온보딩으로 리다이렉트하되 원래 목적지를 보존해, 프로필을 완성하고
    // 팀에 합류한 뒤 올바른 곳으로 가도록 한다.
    const onboardingUrl = new URL("/onboarding", url.origin);
    if (safeNext) onboardingUrl.searchParams.set("next", safeNext);
    return NextResponse.redirect(onboardingUrl);
  }

  if (
    state.status === "suspended" ||
    state.status === "removed" ||
    state.status === "disabled"
  ) {
    const email =
      state.status === "disabled" ? state.email : state.user.email ?? "";
    return NextResponse.redirect(
      buildBlockedUrl(url.origin, state.status, safeNext, email),
    );
  }

  // state.status === "ready" — 프로필과 멤버십이 모두 완료됨.
  // 원래 `next` 목적지가 있으면 그대로 따르고, 없으면
  // `getOnboardingState` 가 주는 역할별 기본 경로를 쓴다.
  const dest = safeNext || normalizePathForSurface(state.redirectTo, surface);
  return NextResponse.redirect(new URL(dest, url.origin));
}
