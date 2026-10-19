import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getDeviceSurfaceFromHeaders } from "@/lib/mobile-device";
import {
  defaultPathForSurface,
  isAdminSurfacePath,
  normalizeNextPathForSurface,
} from "@/lib/surface-routing";
import type { Database } from "@/types/database";

const authRoutePrefixes = ["/admin", "/mobile", "/account"];
const supabaseCallbackParams = [
  "code",
  "error",
  "error_code",
  "error_description",
];

function isProtectedPath(pathname: string) {
  return authRoutePrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isAuthPage(pathname: string) {
  return pathname === "/auth/login" || pathname.startsWith("/auth/login/");
}

function isBlockedAuthState(request: NextRequest) {
  return request.nextUrl.searchParams.get("view") === "blocked";
}

/**
 * Password-reset links land on /auth/login with a recovery SESSION (authenticated),
 * so the user must NOT be bounced to /onboarding before they can set a new password.
 * The login page renders this state; the middleware must let it through too.
 */
function isPasswordRecoveryState(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  return params.get("view") === "email" && params.get("mode") === "new_password";
}

function buildLoginRedirect(request: NextRequest) {
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/auth/login";
  redirectUrl.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return redirectUrl;
}

/**
 * 이 요청이 «엉뚱한 경로로 떨어진 Supabase 콜백» 인가.
 *
 * Supabase 가 OAuth/매직링크 결과를 잘못된 경로(사이트 루트 등)로 돌려보내는 경우를 `/auth/callback`
 * 으로 다시 보내주기 위한 판정이다.
 *
 * 진짜 Supabase 콜백은 `code`(성공) 또는 `error_description`/`error_code`(실패)를 반드시 함께
 * 싣는다. **`error` 하나만으로는 콜백으로 보지 않는다** — 앱이 스스로 `?error=` 를 쓴다
 * (로그인 실패 `/auth/login?...&error=invalid_credentials`, 관리자 설정 · 모바일 등록 화면의
 * `?error=save_failed` 등). 예전에는 그 URL 이 콜백으로 오인돼 `/auth/callback` → 원래 화면으로
 * 돌아가면서 **오류 파라미터가 지워졌고**, 사용자는 실패 안내 없이 화면만 다시 보게 됐다
 * (로그인 2026-09-04, 그 밖의 화면 2026-10-19 발견). `/auth/callback` 도 `error` 단독은 쓰지 않는다.
 */
export function isMisroutedSupabaseCallback(
  pathname: string,
  params: URLSearchParams,
) {
  if (pathname === "/auth/callback") return false;
  return (
    params.has("code") || params.has("error_code") || params.has("error_description")
  );
}

function buildAuthCallbackRedirect(request: NextRequest) {
  const callbackUrl = request.nextUrl.clone();
  const nextUrl = request.nextUrl.clone();

  callbackUrl.pathname = "/auth/callback";
  supabaseCallbackParams.forEach((param) => nextUrl.searchParams.delete(param));

  if (!callbackUrl.searchParams.has("next")) {
    callbackUrl.searchParams.set(
      "next",
      `${nextUrl.pathname}${nextUrl.search}` || "/",
    );
  }

  return callbackUrl;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const surface = getDeviceSurfaceFromHeaders(request.headers);

  if (isMisroutedSupabaseCallback(pathname, request.nextUrl.searchParams)) {
    return NextResponse.redirect(buildAuthCallbackRedirect(request));
  }

  if (surface === "mobile" && isAdminSurfacePath(pathname)) {
    const mobileUrl = request.nextUrl.clone();
    mobileUrl.pathname = "/mobile";
    mobileUrl.search = "";
    return NextResponse.redirect(mobileUrl);
  }

  let response = NextResponse.next({
    request,
  });

  if (!isProtectedPath(pathname) && !isAuthPage(pathname)) {
    return response;
  }

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );

          response = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(({ name, options, value }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // `getClaims()` — 접근 토큰 서명을 여기서 검증한다(ES256 공개키 캐시). 만료가 가까우면 갱신해
  // 쿠키를 다시 쓴다. 예전 `getUser()` 는 요청마다 Auth 서버에 왕복했다(2026-10-16 성능 점검).
  const { data: claimsData } = await supabase.auth.getClaims();
  const user = claimsData?.claims?.sub ? { id: claimsData.claims.sub } : null;

  if (isProtectedPath(pathname) && !user) {
    return NextResponse.redirect(buildLoginRedirect(request));
  }

  if (isAuthPage(pathname) && user) {
    if (isBlockedAuthState(request) || isPasswordRecoveryState(request)) {
      return response;
    }
    // Preserve `next` and `lang` so the onboarding page (or login page's own
    // server-side check) can redirect to the correct destination once the user
    // is confirmed to be fully onboarded.
    const next = normalizeNextPathForSurface(
      request.nextUrl.searchParams.get("next"),
      surface,
      surface === "mobile" ? defaultPathForSurface(surface) : "",
    );
    const lang = request.nextUrl.searchParams.get("lang") || "";
    const onboardingUrl = request.nextUrl.clone();
    onboardingUrl.pathname = "/onboarding";
    onboardingUrl.search = "";
    if (next) onboardingUrl.searchParams.set("next", next);
    if (lang) onboardingUrl.searchParams.set("lang", lang);
    return NextResponse.redirect(onboardingUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/",
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
