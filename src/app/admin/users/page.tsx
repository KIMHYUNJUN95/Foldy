import { redirect } from "next/navigation";
import { AdminShell } from "@/components/shell/admin-shell";
import {
  UsersConsole,
  type DirectoryMemberVM,
  type MemberPanelVM,
  type PermRowVM,
} from "@/components/admin/users/users-console";
import { requireAdminSession } from "@/lib/admin-session";
import { actorCanOpenUserManagement, isDeveloper } from "@/lib/user-management-access";
import { canChangeTarget, removesLastOwner, targetLock } from "@/lib/user-management-guard";
import { isOrgTopAdmin, type Role } from "@/config/roles";
import { CAPABILITY_KEYS, canBeDenied, capabilityPolicy, evaluateCapability } from "@/config/capabilities";
import { getDictionary } from "@/lib/i18n";
import { listMemberOverrides } from "@/lib/permission-overrides-server";
import { resolveCapabilities } from "@/lib/capabilities-server";
import { getOrgTeams } from "@/lib/teams";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

type MembershipRow = Database["public"]["Tables"]["memberships"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

/** 지금 쓸 수 있는 초대코드 수(켜져 있고 · 기한 전 · 남은 횟수 있음) — 탭 숫자. */
function countUsableInvites(rows: { expires_at: string | null; max_uses: number; used_count: number; is_active: boolean }[]): number {
  const now = Date.now();
  return rows.filter(
    (invite) => invite.is_active && invite.used_count < invite.max_uses && (!invite.expires_at || new Date(invite.expires_at).getTime() > now),
  ).length;
}

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * 사용자 — 화이트 리디자인(2026-10-14, 시안 Users-PC · UsersGrant-PC · UsersDeact-PC).
 * 목록 + 오른쪽 패널(`?member=<membershipId>`). 예전 `/admin/users/[id]` 프로필 화면은 이 패널로 합쳤다
 * (그 주소는 여기로 넘긴다). 패널 데이터는 고른 사람 것만 서버에서 읽는다. docs/product/23-user-management.md
 */
export default async function AdminUsersPage({ searchParams }: PageProps) {
  const session = await requireAdminSession();
  // User management is developer-only by default; a developer may delegate via `manage_users`.
  if (!(await actorCanOpenUserManagement(session.user.id, session.user.role))) {
    redirect("/admin");
  }
  const params = (await searchParams) ?? {};
  const selectedParam = Array.isArray(params.member) ? params.member[0] : params.member;
  const dictionary = getDictionary(session.user.preferredLanguage);
  const service = getSupabaseServiceClient();

  const membershipQuery = service
    .from("memberships")
    .select("id, organization_id, user_id, role, status, joined_at, created_at, updated_at, team_id")
    .order("created_at", { ascending: false });

  const { data: membershipData } =
    session.organization.id === "platform"
      ? await membershipQuery
      : await membershipQuery.eq("organization_id", session.organization.id);
  const memberships = (membershipData ?? []) as MembershipRow[];
  const userIds = [...new Set(memberships.map((membership) => membership.user_id))];

  // Emails come from auth.admin.listUsers (paginated — iterate all pages so no email is missing).
  async function fetchAllEmails(ids: string[]): Promise<Map<string, string>> {
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

  const [{ data: profileData }, emailMap] = await Promise.all([
    userIds.length > 0
      ? service.from("profiles").select("id, name, phone_number, can_generate_report").in("id", userIds)
      : Promise.resolve({ data: [] }),
    fetchAllEmails(userIds),
  ]);
  const profileMap = new Map(
    ((profileData ?? []) as Pick<ProfileRow, "id" | "name" | "phone_number" | "can_generate_report">[]).map(
      (profile) => [profile.id, profile],
    ),
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
    orgIds.length > 0
      ? await service.from("teams").select("id, kind").in("organization_id", orgIds)
      : { data: [] as { id: string; kind: string }[] };
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

  // ── 고른 사람의 패널 ──
  const selected = selectedParam ? memberships.find((membership) => membership.id === selectedParam) : undefined;
  let panel: MemberPanelVM | null = null;
  if (selected) {
    const isSuperAdmin = session.user.role === "developer_super_admin";
    const canManagePermissions = isOrgTopAdmin(session.user.role) || isSuperAdmin;
    const profile = profileMap.get(selected.user_id);
    const isSelf = selected.user_id === session.user.id;
    const keys = dictionary.admin.users.console.keys;

    // 서버 액션과 같은 판정 — 화면은 막힌 이유를 보여 주기만 하고, 최종 판단은 액션이 한다.
    const targetLevel = targetLock({ role: selected.role, isDeveloper: devIds.has(selected.user_id) });
    const actorStanding = {
      isDeveloper: isDeveloper(session.user.role),
      topAdminInOrg: isOrgTopAdmin(session.user.role) && selected.organization_id === session.organization.id,
    };
    const lock = canChangeTarget(actorStanding, targetLevel) ? null : targetLevel;

    const [{ data: flagData }, teams, overrides, effective, ownerCount, otherOrgCounts] = await Promise.all([
      service
        .from("memberships")
        .select("attendance_payroll_admin, leave_approver_role")
        .eq("id", selected.id)
        .maybeSingle(),
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

    panel = {
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
    };
  }

  // 탭 숫자 — 지금 쓸 수 있는 초대코드(켜져 있고 · 기한 전 · 남은 횟수 있음).
  let inviteCount: number | null = null;
  if (session.organization.id !== "platform") {
    const { data: inviteData } = await service
      .from("invite_codes")
      .select("expires_at, max_uses, used_count, is_active")
      .eq("organization_id", session.organization.id);
    inviteCount = countUsableInvites(
      (inviteData ?? []) as { expires_at: string | null; max_uses: number; used_count: number; is_active: boolean }[],
    );
  }

  return (
    <AdminShell activeItem="users" title={dictionary.admin.users.title}>
      <UsersConsole
        members={members}
        panel={panel}
        selectedId={panel ? panel.member.membershipId : null}
        locale={session.user.preferredLanguage}
        actorRole={session.user.role}
        inviteCount={inviteCount}
      />
    </AdminShell>
  );
}
