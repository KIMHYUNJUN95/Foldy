import { cache } from "react";
import type { Capability, CapabilityEffect } from "@/config/capabilities";
import { defaultBottomNavTabIds } from "@/config/navigation";
import type { AppMode } from "@/config/routes";
import { defaultsToAdminSurface } from "@/config/roles";
import type { Role } from "@/config/roles";
import { computeCapabilities, isActiveOverrideRow } from "@/lib/capabilities-server";
import { getDictionary, type Locale } from "@/lib/i18n";
import type { ProfileGender } from "@/lib/onboarding";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export type OrganizationSummary = {
  id: string;
  name: string;
};

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  birthDate: string | null;
  gender: ProfileGender | null;
  phoneNumber: string;
  preferredLanguage: Locale;
  role: Role;
  preferredMode: AppMode;
  bottomNavTabs: string[];
  // Per-user override for the daily-report generator. Combined with the role check in
  // `canGenerateDailyReport`; see profiles.can_generate_report.
  canGenerateReport: boolean;
};

export type AppSession = {
  organization: OrganizationSummary;
  user: SessionUser;
  /**
   * 이 사용자가 **지금 실제로 가진** 권한 키(역할 부여 + 개인 부여 − 개인 차단).
   *
   * 서버가 한 번 계산해 실어 보낸다. 클라이언트(사이드바 등)는 스스로 계산하지 않고 이 목록만
   * 본다 — 계산이 두 벌이면 반드시 갈라진다.
   *
   * 설계: `docs/engineering/14-permission-architecture.md` §5
   */
  capabilities: readonly Capability[];
};

export function hasOrganizationContext(session: AppSession) {
  return session.organization.id !== "platform";
}

type ActiveMembership = {
  organization_id: string;
  role: Role;
  /** 임베드로 함께 읽는다 — 별도 왕복을 없애려는 것이다. */
  organizations: { id: string; name: string } | null;
};

type OverrideRow = {
  organization_id: string;
  permission_key: string;
  effect: string;
  expires_at: string | null;
};

type CurrentProfile = {
  birth_date: string | null;
  gender: ProfileGender | null;
  name: string;
  phone_number: string;
  preferred_language: Locale;
};

type CurrentOrganization = {
  id: string;
  name: string;
};

type ActivePlatformAdmin = {
  role: Role;
};

export const mockSession: AppSession = {
  organization: {
    id: "org_stayops_internal",
    name: "Foldy Internal",
  },
  user: {
    id: "user_sarah_jenkins",
    name: "Sarah Jenkins",
    email: "sarah.jenkins@example.com",
    birthDate: "1992-03-14",
    phoneNumber: "+81 90-0000-0000",
    gender: "female",
    preferredLanguage: "ko",
    role: "office_admin",
    preferredMode: "admin",
    bottomNavTabs: [...defaultBottomNavTabIds],
    canGenerateReport: true,
  },
  capabilities: [],
};

function isMissingEnvError(error: unknown) {
  return error instanceof Error && error.message.startsWith("Missing required");
}

function isAuthError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AuthApiError" ||
      error.name === "AuthSessionMissingError" ||
      error.name === "AuthRetryableFetchError" ||
      ("status" in error && typeof (error as { status: unknown }).status === "number"))
  );
}

// Request-scoped memoization: the session is read on the layout AND the page AND inside
// getMobileNavBadges on every mobile render, and it's a multi-query waterfall. `cache()` collapses
// all calls within one server render pass into a single execution (it does NOT cache across requests).
export const getCurrentAppSession = cache(
  async (): Promise<AppSession | null> => {
  try {
    const supabase = await getSupabaseServerClient();
    // `getClaims()` 는 접근 토큰 서명을 **서버 안에서** 검증한다(이 프로젝트는 ES256 비대칭 키 —
    // 공개키 목록만 한 번 받아 캐시). 예전 `getUser()` 는 렌더마다 Auth 서버에 왕복했고(평균 174ms ·
    // 하루 1.9만 회), 미들웨어도 같은 왕복을 한 번 더 했다(2026-10-16 성능 점검).
    // 토큰이 곧 만료되면 먼저 갱신한다. 서명 · 만료가 틀리면 error 로 온다.
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    const claims = claimsData?.claims;

    if (claimsError || !claims?.sub) {
      return null;
    }
    const user = { id: claims.sub, email: typeof claims.email === "string" ? claims.email : undefined };

    // 이 읽기들은 `user.id` 에만 의존하므로 **한 배치로** 돈다. 모바일·어드민 모든 렌더가 지나는
    // 공통 경로라, 직렬 왕복을 줄이는 것이 첫 바이트에 가장 크게 듣는다.
    //
    // 2026-09-11 성능 점검에서 뒤따르던 두 단을 마저 접었다:
    // - **조직**은 멤버십에 임베드한다(`organizations(id, name)`). 예전에는 멤버십을 받은 뒤에야
    //   조직을 물어서 한 왕복이 더 들었다.
    // - **개인 부여·차단**은 조직을 몰라도 `user_id` 로 읽을 수 있다. 조직 필터는 아래에서 한다.
    //   권한을 세션에 실으면서 요청마다 왕복이 하나 늘어나 있었다(내가 얹은 것이다).
    //
    // 결과: `인증 → [5개 병렬]` 두 단. 예전에는 `인증 → [4개 병렬] → 조직 → 권한` 네 단이었다.
    const [profileRes, platformAdminRes, membershipRes, navRes, overrideRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, name, birth_date, gender, phone_number, preferred_language")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("platform_admins")
        .select("role")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle(),
      supabase
        .from("memberships")
        .select("organization_id, role, organizations(id, name)")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("joined_at", { ascending: true, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
      // Per-user bottom-bar customization + report-access flag, read defensively (these columns
      // may not exist on projects where the migration has not been applied).
      supabase
        .from("profiles")
        .select("bottom_nav_tabs, can_generate_report")
        .eq("id", user.id)
        .maybeSingle(),
      // 개인 부여·차단. 조직을 몰라도 읽을 수 있다(사용자당 조직이 한둘이라 행이 적다) —
      // 조직 필터는 아래에서 한다.
      //
      // **service-role 로 읽어야 한다.** 이 표에는 RLS 정책이 하나도 없고 RLS 는 켜져 있다 —
      // 즉 `authenticated` 로 읽으면 조용히 **0행**이 온다. 사용자 클라이언트로 읽었다가 개인
      // 부여가 통째로 무시돼, 권한을 받은 사람에게 메뉴가 안 뜨고 페이지도 막혔다
      // (2026-09-11 회귀 — 세션 워터폴을 접으면서 클라이언트를 잘못 바꿨다).
      //
      // 부여 자체는 서버 액션이 권한을 확인하고 쓰므로, 여기서 service-role 로 읽는 것은
      // 「내 세션의 내 권한을 계산한다」는 용도에 한정된다.
      getSupabaseServiceClient()
        .from("membership_permission_overrides")
        .select("organization_id, permission_key, effect, expires_at")
        .eq("user_id", user.id)
        .is("revoked_at", null),
    ]);

    let profile = profileRes.data as CurrentProfile | null;

    if (profileRes.error) {
      const { data: fallbackProfile, error: fallbackProfileError } = await supabase
        .from("profiles")
        .select("id, name, birth_date, phone_number, preferred_language")
        .eq("id", user.id)
        .maybeSingle();
      if (fallbackProfileError || !fallbackProfile) {
        return null;
      }
      profile = {
        ...(fallbackProfile as Omit<CurrentProfile, "gender">),
        gender: null,
      };
    }

    if (!profile) {
      return null;
    }

    const platformAdmin = platformAdminRes.data as ActivePlatformAdmin | null;
    const membership = membershipRes.data as ActiveMembership | null;

    if (!membership && !platformAdmin) {
      return null;
    }

    // 멤버십에 임베드해 함께 읽어 둔 조직. 별도 왕복이 없다.
    const organization = (membership?.organizations ?? null) as CurrentOrganization | null;

    const role = (platformAdmin?.role ?? membership?.role) as Role;
    const dictionary = getDictionary(profile.preferred_language);

    // 유효 권한 — 역할 부여 + 개인 부여 − 개인 차단. 클라이언트가 스스로 계산하지 않도록 서버가
    // 한 번 계산해 실어 보낸다(`docs/engineering/14-permission-architecture.md` §5).
    //
    // 조직 멤버십이 없으면(플랫폼 전용 계정) 개인 부여·차단이 붙을 자리가 없다. 그렇다고 비워 두면
    // **개발자에게 사이드바 메뉴가 사라진다** — 권한 통과는 역할만으로 성립하기 때문이다.
    // 그래서 그 경우에도 역할 기준으로 계산한다(부여·차단 없음).
    //
    // 실패해도 세션을 깨뜨리지 않는다 — 빈 목록은 「권한 없음」이고, 잘못 열어 주는 것보다 낫다.
    //
    // 행은 위 배치에서 이미 읽었다. 조직 스코프와 만료 판정만 여기서 한다.
    const activeOverrides = ((overrideRes.data ?? []) as OverrideRow[])
      .filter((row) => !membership || row.organization_id === membership.organization_id)
      .filter((row) => isActiveOverrideRow(row))
      // DB 의 text 컬럼이라 값이 무엇이든 올 수 있다. 모르는 값은 부여로 보지 않는다 —
      // 「차단이 오히려 권한을 주던」 실패(2026-09-10 감사 ①)와 같은 방향의 실수를 막는다.
      .map((row) => ({
        permission_key: row.permission_key,
        effect: (row.effect === "deny" ? "deny" : "grant") as CapabilityEffect,
      }));
    const capabilities = computeCapabilities(role, activeOverrides);

    // Applied from the concurrent read above; any error falls back to defaults rather than
    // breaking the session (the columns may not exist on un-migrated projects).
    let bottomNavTabs: string[] = [...defaultBottomNavTabIds];
    let canGenerateReport = false;
    const { data: navResult, error: navError } = navRes;
    if (!navError && navResult) {
      const raw = (navResult as { bottom_nav_tabs?: string[] | null })
        .bottom_nav_tabs;
      if (Array.isArray(raw) && raw.length > 0) {
        bottomNavTabs = raw;
      }
      canGenerateReport = Boolean(
        (navResult as { can_generate_report?: boolean | null }).can_generate_report,
      );
    }

    return {
      organization: organization ?? {
        id: "platform",
        name: dictionary.session.platformOrganization,
      },
      user: {
        id: user.id,
        name: profile.name,
        email: user.email ?? "",
        birthDate: profile.birth_date,
        gender: profile.gender,
        phoneNumber: profile.phone_number,
        preferredLanguage: profile.preferred_language,
        role,
        // Default landing surface (field roles → mobile even though they can also access admin).
        preferredMode: defaultsToAdminSurface(role) ? "admin" : "mobile",
        bottomNavTabs,
        canGenerateReport,
      },
      capabilities,
    };
  } catch (error) {
    if (isMissingEnvError(error) || isAuthError(error)) {
      return null;
    }

    throw error;
  }
  },
);
