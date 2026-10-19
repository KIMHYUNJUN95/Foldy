import type { User } from "@supabase/supabase-js";
import { cache } from "react";
import type { Role } from "@/config/roles";
import { defaultsToAdminSurface } from "@/config/roles";
import { isLocale, type Locale } from "@/lib/i18n";
import { getIdentityRows, sortMembershipsByJoinedAt } from "@/lib/identity-rows";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

export type ProfileGender = Database["public"]["Enums"]["profile_gender"];

export type ProfileSnapshot = {
  id: string;
  name: string;
  birthDate: string | null;
  gender: ProfileGender | null;
  phoneNumber: string;
  preferredLanguage: Locale;
};

export type MembershipSnapshot = {
  organizationId: string;
  role: Role;
};

export type OnboardingState =
  | {
      status: "unauthenticated";
      user: null;
    }
  | {
      status: "needs_profile";
      canClaimPlatformAdmin: boolean;
      user: User;
    }
  | {
      status: "needs_membership";
      canClaimPlatformAdmin: boolean;
      profile: ProfileSnapshot;
      user: User;
    }
  | {
      status: "suspended";
      user: User;
      profile: ProfileSnapshot;
    }
  | {
      status: "removed";
      user: User;
      profile: ProfileSnapshot;
    }
  | {
      status: "disabled";
      user: User;
      email: string;
    }
  | {
      status: "ready";
      redirectTo: string;
      user: User;
    };

export function isValidPhone(phone: string): boolean {
  const trimmed = phone.trim();
  if (!trimmed) return false;
  if (!/^[\d\s\+\-\(\)]+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

export function isValidBirthDate(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return false;
  const birthDate = new Date(trimmed);
  return !Number.isNaN(birthDate.getTime()) && birthDate < new Date();
}

const PROFILE_GENDER_VALUES: ProfileGender[] = ["female", "male"];

export function isProfileGender(value: string): value is ProfileGender {
  return PROFILE_GENDER_VALUES.includes(value as ProfileGender);
}

export function getDefaultRouteForRole(role: Role) {
  // Default landing (field roles → /mobile even though they can also access /admin).
  return defaultsToAdminSurface(role) ? "/admin" : "/mobile";
}

// 한 렌더 안에서 레이아웃 · 페이지 · 어드민 가드가 각자 부르므로 `cache()` 로 한 번으로 접는다
// (요청을 넘어 캐시하지 않는다). 여기만은 `getUser()` 를 유지한다 — 계정 정지(`banned_until`)는
// Auth 서버의 최신 사용자 정보에만 있다(2026-10-16 성능 점검).
export const getOnboardingState = cache(async (): Promise<OnboardingState> => {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      status: "unauthenticated",
      user: null,
    };
  }

  const service = getSupabaseServiceClient();
  const disabledUntil = (user as User & { banned_until?: string | null })
    .banned_until;
  if (disabledUntil) {
    const bannedUntilDate = new Date(disabledUntil);
    if (!Number.isNaN(bannedUntilDate.getTime()) && bannedUntilDate > new Date()) {
      return {
        status: "disabled",
        user,
        email: user.email ?? "",
      };
    }
  }

  // 프로필 · 플랫폼 관리자 · 멤버십은 세션과 같이 쓰는 한 배치(요청당 한 번)에서 온다. 세션이 먼저 시작해 두면
  // 여기서는 `getUser()` 왕복만 기다린다.
  const identity = await getIdentityRows(user.id);
  const profile = identity.profile;
  const platformAdminRole = identity.platformAdminRole;
  const memberships = sortMembershipsByJoinedAt(identity.memberships, "desc");
  const activeMemberships = memberships.filter((m) => m.status === "active");

  // 「처음 쓰는 사람이 플랫폼 관리자를 가져갈 수 있는가」는 준비가 안 된 경우에만 화면에 쓰인다 — 그때만 센다.
  const countCanClaimPlatformAdmin = async () => {
    const { count } = await service
      .from("platform_admins")
      .select("id", { count: "exact", head: true });
    return (count ?? 0) === 0;
  };

  if (!profile) {
    return {
      status: "needs_profile",
      canClaimPlatformAdmin: await countCanClaimPlatformAdmin(),
      user,
    };
  }

  const isProfileComplete =
    !!profile.name?.trim() &&
    !!profile.birth_date &&
    isValidBirthDate(profile.birth_date) &&
    !!profile.phone_number?.trim() &&
    isValidPhone(profile.phone_number) &&
    isLocale(profile.preferred_language);

  const profileSnapshot: ProfileSnapshot = {
    id: profile.id,
    name: profile.name,
    birthDate: profile.birth_date,
    gender: profile.gender,
    phoneNumber: profile.phone_number,
    preferredLanguage: profile.preferred_language,
  };

  if (!isProfileComplete && !platformAdminRole && activeMemberships.length === 0) {
    return {
      status: "needs_profile",
      canClaimPlatformAdmin: await countCanClaimPlatformAdmin(),
      user,
    };
  }

  if (platformAdminRole) {
    return {
      status: "ready",
      redirectTo: getDefaultRouteForRole(platformAdminRole),
      user,
    };
  }

  if (activeMemberships.length > 0) {
    const lastUsedOrgId = profile.last_used_organization_id;
    const preferred =
      (lastUsedOrgId
        ? activeMemberships.find((m) => m.organization_id === lastUsedOrgId)
        : null) ?? activeMemberships[0];

    return {
      status: "ready",
      redirectTo: getDefaultRouteForRole(preferred.role),
      user,
    };
  }

  const suspended = memberships.find((m) => m.status === "suspended");
  if (suspended) {
    return { status: "suspended", user, profile: profileSnapshot };
  }

  const removed = memberships.find((m) => m.status === "removed");
  if (removed) {
    return { status: "removed", user, profile: profileSnapshot };
  }

  return {
    status: "needs_membership",
    canClaimPlatformAdmin: await countCanClaimPlatformAdmin(),
    profile: profileSnapshot,
    user,
  };
});

export async function setLastUsedOrganization(
  userId: string,
  organizationId: string,
): Promise<void> {
  const service = getSupabaseServiceClient();
  await service
    .from("profiles")
    .update({ last_used_organization_id: organizationId })
    .eq("id", userId);
}
