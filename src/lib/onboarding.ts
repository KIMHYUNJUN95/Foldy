import type { User } from "@supabase/supabase-js";
import { cache } from "react";
import type { Role } from "@/config/roles";
import { defaultsToAdminSurface } from "@/config/roles";
import { isLocale, type Locale } from "@/lib/i18n";
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

type ProfileRow = {
  id: string;
  name: string;
  birth_date: string | null;
  gender: ProfileGender | null;
  phone_number: string;
  preferred_language: Locale;
  last_used_organization_id: string | null;
};

type MembershipRow = {
  organization_id: string;
  role: Role;
  status: string;
};

type PlatformAdminRow = {
  role: Role;
};

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

  const [{ data: profileResult, error: profileError }, { count: platformAdminCount }] =
    await Promise.all([
      service
        .from("profiles")
        .select(
          "id, name, birth_date, gender, phone_number, preferred_language, last_used_organization_id",
        )
        .eq("id", user.id)
        .maybeSingle(),
      service.from("platform_admins").select("id", { count: "exact", head: true }),
    ]);

  let profile = profileResult as ProfileRow | null;
  if (profileError) {
    const { data: fallbackProfile } = await service
      .from("profiles")
      .select(
        "id, name, birth_date, phone_number, preferred_language, last_used_organization_id",
      )
      .eq("id", user.id)
      .maybeSingle();
    profile = fallbackProfile
      ? ({ ...(fallbackProfile as Omit<ProfileRow, "gender">), gender: null } as ProfileRow)
      : null;
  }
  const canClaimPlatformAdmin = (platformAdminCount ?? 0) === 0;

  const [{ data: platformAdminResult }, { data: membershipResults }] =
    await Promise.all([
      service
        .from("platform_admins")
        .select("role")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle(),
      service
        .from("memberships")
        .select("organization_id, role, status")
        .eq("user_id", user.id)
        .neq("status", "invited")
        .order("joined_at", { ascending: false, nullsFirst: false }),
    ]);

  const platformAdmin = platformAdminResult as PlatformAdminRow | null;
  const memberships = (membershipResults ?? []) as MembershipRow[];
  const activeMemberships = memberships.filter((m) => m.status === "active");

  if (!profile) {
    return {
      status: "needs_profile",
      canClaimPlatformAdmin,
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

  if (!isProfileComplete && !platformAdmin?.role && activeMemberships.length === 0) {
    return {
      status: "needs_profile",
      canClaimPlatformAdmin,
      user,
    };
  }

  if (platformAdmin?.role) {
    return {
      status: "ready",
      redirectTo: getDefaultRouteForRole(platformAdmin.role),
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
    canClaimPlatformAdmin,
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
