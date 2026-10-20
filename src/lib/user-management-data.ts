import "server-only";

import { isOrgTopAdmin, type Role } from "@/config/roles";
import { CAPABILITY_KEYS, canBeDenied, capabilityPolicy, evaluateCapability } from "@/config/capabilities";
import { resolveCapabilities } from "@/lib/capabilities-server";
import { getDictionary } from "@/lib/i18n";
import { listMemberOverrides } from "@/lib/permission-overrides-server";
import { loadMemberHistory, type MemberHistoryItem } from "@/lib/user-audit";
import type { AppSession } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getOrgTeams } from "@/lib/teams";
import { isDeveloper } from "@/lib/user-management-access";
import { canChangeTarget, removesLastOwner, targetLock } from "@/lib/user-management-guard";
import type { Database } from "@/types/database";

/**
 * 사용자 관리 화면 데이터 — 대시보드 `/admin/users` 와 모바일 `/mobile/users` 가 같이 읽는다(2026-10-20 모바일 추가 때 페이지에서 뺐다).
 * 판정(보호 대상 · 마지막 대표 · 권한 줄)은 서버 액션과 같은 식이다 — 화면은 막힌 이유를 보여 주기만 하고 최종 판단은 액션이 한다.
 * docs/product/17-user-profile-directory.md
 */

type MembershipRow = Database["public"]["Tables"]["memberships"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

export type DirectoryMemberVM = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  status: string;
  joinedAt: string | null;
  isSelf: boolean;
  isDeveloper: boolean;
  teamKind: string | null;
};

export type PermRowVM = {
  kind: "cap";
  key: string;
  label: string;
  /** 서버가 계산한 최종값(역할 + 부여 − 차단). */
  on: boolean;
  source: "role" | "grant" | "deny" | "off";
  expires: string | null;
  overrideId: string | null;
  canToggle: boolean;
  /** 켤 때 기한을 묻는다(`asksExpiry` — 무기한도 고를 수 있다). */
  needsExpiry: boolean;
};

export type MemberPanelVM = {
  member: {
    membershipId: string;
    name: string;
    email: string;
    phone: string;
    role: string;
    status: string;
    joinedAt: string | null;
    isSelf: boolean;
    isDeveloper: boolean;
    teamId: string | null;
    reportAccess: boolean;
    payrollAdmin: boolean;
    leaveApprover: boolean;
  };
  teams: { id: string; name: string; kind: string }[];
  perms: PermRowVM[];
  canManagePermissions: boolean;
  isDeveloperViewer: boolean;
  /** 이 사람을 바꿀 수 없는 이유 — 대표급(owner·전무) 또는 개발자 계정. 바꿀 수 있으면 null. */
  lock: "top" | "dev" | null;
  /** 조직의 마지막 활성 owner — 역할 변경 · 비활성 · 삭제가 막힌다. */
  lastOwner: boolean;
  /** 다른 조직 멤버십이 있다(상태 무관) — 삭제해도 로그인 계정은 남는다. */
  otherOrgs: boolean;
  /** 다른 조직에 활성 멤버십이 있다 — 비활성으로 바꿔도 로그인은 막히지 않는다. */
  otherOrgsActive: boolean;
  /** 최근 변경(audit_logs, 최신 10개) — 2026-10-20 권한 정리 ④. */
  history: MemberHistoryItem[];
};

/** 지금 쓸 수 있는 초대코드 수(켜져 있고 · 기한 전 · 남은 횟수 있음) — 탭 숫자. */
export function countUsableInvites(rows: { expires_at: string | null; max_uses: number; used_count: number; is_active: boolean }[]): number {
  const now = Date.now();
  return rows.filter(
    (invite) => invite.is_active && invite.used_count < invite.max_uses && (!invite.expires_at || new Date(invite.expires_at).getTime() > now),
  ).length;
}

/** 이메일은 auth.admin.listUsers 에서(페이지를 다 돈다 — 빠지는 이메일이 없게). */
async function fetchAllEmails(ids: string[]): Promise<Map<string, string>> {
  const service = getSupabaseServiceClient();
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const PAGE_SIZE = 50;
  let page = 1;
  while (true) {
    const { data } = await service.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    for (const user of data.users ?? []) {
      if (ids.includes(user.id)) map.set(user.id, user.email ?? "");
    }
    if ((data.users ?? []).length < PAGE_SIZE) break;
    page += 1;
  }
  return map;
}

export type UserDirectory = {
  members: DirectoryMemberVM[];
  memberships: MembershipRow[];
  profileMap: Map<string, Pick<ProfileRow, "id" | "name" | "phone_number" | "can_generate_report">>;
  emailMap: Map<string, string>;
  devIds: Set<string>;
};

/** 멤버 목록(이 조직, 플랫폼 세션이면 전체). */
export async function loadUserDirectory(session: AppSession): Promise<UserDirectory> {
  const service = getSupabaseServiceClient();
  const membershipQuery = service
    .from("memberships")
    .select("id, organization_id, user_id, role, status, joined_at, created_at, updated_at, team_id")
    .order("created_at", { ascending: false });
  const { data: membershipData } =
    session.organization.id === "platform" ? await membershipQuery : await membershipQuery.eq("organization_id", session.organization.id);
  const memberships = (membershipData ?? []) as MembershipRow[];
  const userIds = [...new Set(memberships.map((membership) => membership.user_id))];

  const [{ data: profileData }, emailMap] = await Promise.all([
    userIds.length > 0
      ? service.from("profiles").select("id, name, phone_number, can_generate_report").in("id", userIds)
      : Promise.resolve({ data: [] }),
    fetchAllEmails(userIds),
  ]);
  const profileMap = new Map(
    ((profileData ?? []) as Pick<ProfileRow, "id" | "name" | "phone_number" | "can_generate_report">[]).map((profile) => [profile.id, profile]),
  );

  // Platform developers are shown as "개발자" regardless of their org role.
  const { data: paData } =
    userIds.length > 0
      ? await service.from("platform_admins").select("user_id").in("user_id", userIds).eq("is_active", true)
      : { data: [] as { user_id: string }[] };
  const devIds = new Set(((paData ?? []) as { user_id: string }[]).map((row) => row.user_id));

  // Team kind (현장/사무실) per membership, resolved from the org's teams.
  const orgIds = [...new Set(memberships.map((membership) => membership.organization_id))];
  const { data: teamData } =
    orgIds.length > 0 ? await service.from("teams").select("id, kind").in("organization_id", orgIds) : { data: [] as { id: string; kind: string }[] };
  const teamKindById = new Map(((teamData ?? []) as { id: string; kind: string }[]).map((team) => [team.id, team.kind]));

  const members: DirectoryMemberVM[] = memberships.map((membership) => {
    const profile = profileMap.get(membership.user_id);
    return {
      membershipId: membership.id,
      userId: membership.user_id,
      name: profile?.name ?? "",
      email: emailMap.get(membership.user_id) ?? "",
      phone: profile?.phone_number ?? "",
      role: membership.role,
      status: membership.status,
      joinedAt: membership.joined_at,
      isSelf: membership.user_id === session.user.id,
      isDeveloper: devIds.has(membership.user_id),
      teamKind: membership.team_id ? teamKindById.get(membership.team_id) ?? null : null,
    };
  });
  return { members, memberships, profileMap, emailMap, devIds };
}

/** 고른 사람의 상세(패널) — 목록에 없는 멤버십이면 null. */
export async function loadMemberPanel(session: AppSession, directory: UserDirectory, membershipId: string): Promise<MemberPanelVM | null> {
  const selected = directory.memberships.find((membership) => membership.id === membershipId);
  if (!selected) return null;
  const service = getSupabaseServiceClient();
  const dictionary = getDictionary(session.user.preferredLanguage);
  const { profileMap, emailMap, devIds } = directory;

  const isSuperAdmin = session.user.role === "developer_super_admin";
  const canManagePermissions = isOrgTopAdmin(session.user.role) || isSuperAdmin;
  const profile = profileMap.get(selected.user_id);
  const isSelf = selected.user_id === session.user.id;
  const keys = dictionary.admin.users.console.keys;

  const targetLevel = targetLock({ role: selected.role, isDeveloper: devIds.has(selected.user_id) });
  const actorStanding = {
    isDeveloper: isDeveloper(session.user.role),
    topAdminInOrg: isOrgTopAdmin(session.user.role) && selected.organization_id === session.organization.id,
  };
  const lock = canChangeTarget(actorStanding, targetLevel) ? null : targetLevel;

  const [{ data: flagData }, teams, overrides, effective, ownerCount, otherOrgCounts, history] = await Promise.all([
    service.from("memberships").select("attendance_payroll_admin, leave_approver_role").eq("id", selected.id).maybeSingle(),
    getOrgTeams(selected.organization_id),
    canManagePermissions && !isSelf ? listMemberOverrides(selected.organization_id, selected.user_id) : Promise.resolve([]),
    canManagePermissions && !isSelf
      ? resolveCapabilities({ organizationId: selected.organization_id, userId: selected.user_id, role: selected.role })
      : Promise.resolve([]),
    selected.role === "owner" && selected.status === "active"
      ? service
          .from("memberships")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", selected.organization_id)
          .eq("role", "owner")
          .eq("status", "active")
          .then(({ count }) => count ?? 0)
      : Promise.resolve(0),
    service
      .from("memberships")
      .select("status")
      .eq("user_id", selected.user_id)
      .neq("organization_id", selected.organization_id)
      .then(({ data }) => {
        const rows = (data ?? []) as { status: string }[];
        return { any: rows.length, active: rows.filter((row) => row.status === "active").length };
      }),
    loadMemberHistory(selected.organization_id, selected.id),
  ]);
  const lastOwner = removesLastOwner({ target: selected, change: { delete: true }, activeOwnerCount: ownerCount });
  const flags = flagData as Pick<MembershipRow, "attendance_payroll_admin" | "leave_approver_role"> | null;

  // 한 목록 안에서 「역할로 받음 · 개인 부여 · 개인 차단 · 꺼짐」을 줄마다 한 줄 글로 보여 준다. 판정식(역할 + 부여 − 차단)은
  // 서버가 계산한 최종값(`resolveCapabilities`)을 그대로 쓴다 — 화면이 따로 계산하면 언젠가 어긋난다.
  const perms: PermRowVM[] = [];
  if (canManagePermissions && !isSelf && !lock) {
    for (const key of CAPABILITY_KEYS) {
      const policy = capabilityPolicy(key);
      if (policy.systemOnly) continue;
      if (policy.developerOnly && !isSuperAdmin) continue;
      const fromRole = evaluateCapability({ capability: key, role: selected.role, granted: false, denied: false });
      const grant = overrides.find((override) => override.key === key && override.effect === "grant");
      const deny = overrides.find((override) => override.key === key && override.effect === "deny");
      const on = effective.includes(key);
      const source: PermRowVM["source"] = deny ? "deny" : grant ? "grant" : fromRole ? "role" : "off";
      const canToggle =
        source === "grant" || source === "deny"
          ? true
          : source === "role"
            ? policy.individualDeny && canBeDenied(selected.role as Role)
            : policy.individualGrant;
      if (source === "off" && !policy.individualGrant) continue;
      perms.push({
        kind: "cap",
        key,
        label: keys[key]?.label ?? key,
        on,
        source,
        expires: (deny ?? grant)?.expires ?? null,
        overrideId: (deny ?? grant)?.id ?? null,
        canToggle,
        needsExpiry: policy.asksExpiry,
      });
    }
  }

  return {
    member: {
      membershipId: selected.id,
      name: profile?.name ?? "",
      email: emailMap.get(selected.user_id) ?? "",
      phone: profile?.phone_number ?? "",
      role: selected.role,
      status: selected.status,
      joinedAt: selected.joined_at,
      isSelf,
      isDeveloper: devIds.has(selected.user_id),
      teamId: selected.team_id ?? null,
      reportAccess: profile?.can_generate_report ?? false,
      payrollAdmin: flags?.attendance_payroll_admin ?? false,
      leaveApprover: flags?.leave_approver_role != null,
    },
    teams,
    perms,
    canManagePermissions,
    isDeveloperViewer: isSuperAdmin,
    lock,
    lastOwner,
    otherOrgs: otherOrgCounts.any > 0,
    otherOrgsActive: otherOrgCounts.active > 0,
    history,
  };
}

/** 탭 숫자 — 이 조직에서 지금 쓸 수 있는 초대코드 수(플랫폼 세션이면 null). */
export async function loadUsableInviteCount(session: AppSession): Promise<number | null> {
  if (session.organization.id === "platform") return null;
  const { data } = await getSupabaseServiceClient()
    .from("invite_codes")
    .select("expires_at, max_uses, used_count, is_active")
    .eq("organization_id", session.organization.id);
  return countUsableInvites((data ?? []) as { expires_at: string | null; max_uses: number; used_count: number; is_active: boolean }[]);
}
