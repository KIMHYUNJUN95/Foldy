import "server-only";

import { cache } from "react";
import type { Role } from "@/config/roles";
import type { Locale } from "@/lib/i18n";
import type { ProfileGender } from "@/lib/onboarding";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

// 세션(`getCurrentAppSession`)과 온보딩 판정(`getOnboardingState`)이 같은 사용자 행(profiles · platform_admins ·
// memberships · 개인 권한)을 각자 — 하나는 사용자 클라이언트로, 하나는 service 로 — 읽어 페이지마다 약 9쿼리가
// 들었다. 요청당 한 번(4쿼리 · 한 단)으로 접는다.
//
// service 로 읽는 이유: 온보딩은 멤버십이 정지 · 제거된 사람도 판정해야 하고(RLS 로는 안 보인다), 개인 권한 표는
// 정책이 없어 service 로만 읽힌다. 모든 쿼리는 `user_id`(검증된 토큰 · Auth 서버가 준 id)로만 거른다.
// 사용자 클라이언트로 읽던 세션 쪽 행(내 프로필 · 내 활성 멤버십과 그 조직 · 내 플랫폼 관리자 행)은 RLS 로도
// 본인에게 보이던 것이라 결과가 같다.

export type IdentityProfileRow = {
  id: string;
  name: string;
  birth_date: string | null;
  gender: ProfileGender | null;
  phone_number: string;
  preferred_language: Locale;
  last_used_organization_id: string | null;
  /** 마이그레이션 전 프로젝트에서는 없을 수 있다 — 없으면 기본값. */
  bottom_nav_tabs?: string[] | null;
  can_generate_report?: boolean | null;
  /** 국적 + 이름 세 가지(2026-10-22, 마이그레이션 202610220006) — 없으면 null. */
  nationality?: string | null;
  name_ko?: string | null;
  name_ja?: string | null;
  name_en?: string | null;
  name_katakana?: string | null;
};

export type IdentityMembershipRow = {
  organization_id: string;
  role: Role;
  status: string;
  joined_at: string | null;
  organizations: { id: string; name: string } | null;
};

export type IdentityOverrideRow = {
  organization_id: string;
  permission_key: string;
  effect: string;
  expires_at: string | null;
};

export type IdentityRows = {
  profile: IdentityProfileRow | null;
  platformAdminRole: Role | null;
  /** `invited` 를 뺀 모든 멤버십. 정렬은 쓰는 쪽이 정한다. */
  memberships: IdentityMembershipRow[];
  overrides: IdentityOverrideRow[];
};

const PROFILE_FULL =
  "id, name, birth_date, gender, phone_number, preferred_language, last_used_organization_id, bottom_nav_tabs, can_generate_report, nationality, name_ko, name_ja, name_en, name_katakana";
// 예전 두 읽기의 방어용 대체 — 컬럼이 아직 없는 프로젝트(마이그레이션 전)에서도 세션이 열리게 한다.
const PROFILE_FALLBACK = "id, name, birth_date, phone_number, preferred_language, last_used_organization_id";

export const getIdentityRows = cache(async (userId: string): Promise<IdentityRows> => {
  const service = getSupabaseServiceClient();
  const [profileRes, platformAdminRes, membershipRes, overrideRes] = await Promise.all([
    service.from("profiles").select(PROFILE_FULL).eq("id", userId).maybeSingle(),
    service
      .from("platform_admins")
      .select("role")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle(),
    service
      .from("memberships")
      .select("organization_id, role, status, joined_at, organizations(id, name)")
      .eq("user_id", userId)
      .neq("status", "invited"),
    service
      .from("membership_permission_overrides")
      .select("organization_id, permission_key, effect, expires_at")
      .eq("user_id", userId)
      .is("revoked_at", null),
  ]);

  let profile = profileRes.data as IdentityProfileRow | null;
  if (profileRes.error) {
    const { data: fallbackProfile } = await service
      .from("profiles")
      .select(PROFILE_FALLBACK)
      .eq("id", userId)
      .maybeSingle();
    profile = fallbackProfile
      ? ({ ...(fallbackProfile as Omit<IdentityProfileRow, "gender">), gender: null } as IdentityProfileRow)
      : null;
  }

  return {
    profile,
    platformAdminRole: ((platformAdminRes.data as { role: Role } | null)?.role ?? null),
    memberships: (membershipRes.data ?? []) as unknown as IdentityMembershipRow[],
    overrides: (overrideRes.data ?? []) as IdentityOverrideRow[],
  };
});

/** `joined_at` 순서(값 없는 행은 방향과 무관하게 맨 뒤) — 예전 `.order("joined_at", { nullsFirst: false })` 와 같다. */
export function sortMembershipsByJoinedAt(
  rows: IdentityMembershipRow[],
  direction: "asc" | "desc",
): IdentityMembershipRow[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (a.joined_at === b.joined_at) return 0;
    if (a.joined_at === null) return 1;
    if (b.joined_at === null) return -1;
    return (Date.parse(a.joined_at) - Date.parse(b.joined_at)) * sign;
  });
}
