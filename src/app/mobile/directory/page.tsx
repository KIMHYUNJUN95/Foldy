import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { DirectoryView, type DirectoryPerson } from "@/components/directory/directory-view";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { displayRoleKey, fetchPlatformDeveloperIds } from "@/lib/platform-developers";
import type { Database } from "@/types/database";

type MembershipRow = Database["public"]["Tables"]["memberships"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

const ROLE_ORDER: Record<string, number> = {
  developer_super_admin: 0,
  owner: 1,
  senior_managing_director: 2,
  office_admin: 3,
  cs_staff: 4,
  field_manager: 5,
  staff: 6,
  part_time_staff: 7,
};

export default async function MobileDirectoryPage() {
  const [state, session] = await Promise.all([getOnboardingState(), getCurrentAppSession()]);

  if (state.status === "unauthenticated") {
    redirect("/auth/login?next=/mobile/directory");
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const copy = dictionary.mobile.directory;
  const roles = dictionary.roles as Record<string, string>;

  const service = getSupabaseServiceClient();
  const { data: membershipData } = await service
    .from("memberships")
    .select("id, user_id, role, status, joined_at, team_id")
    .eq("organization_id", session.organization.id)
    .in("status", ["active", "invited"]);

  const memberships = (membershipData ?? []) as Pick<MembershipRow, "id" | "user_id" | "role" | "status" | "joined_at" | "team_id">[];
  const userIds = memberships.map((m) => m.user_id);
  const teamIds = [...new Set(memberships.map((m) => m.team_id).filter((id): id is string => Boolean(id)))];

  const [{ data: profileData }, { data: teamData }, devIds] = await Promise.all([
    userIds.length > 0 ? service.from("profiles").select("id, name, phone_number").in("id", userIds) : Promise.resolve({ data: [] }),
    teamIds.length > 0 ? service.from("teams").select("id, kind").in("id", teamIds) : Promise.resolve({ data: [] }),
    fetchPlatformDeveloperIds(userIds),
  ]);

  const profileMap = new Map(((profileData ?? []) as Pick<ProfileRow, "id" | "name" | "phone_number">[]).map((p) => [p.id, p]));
  const teamKind = new Map(((teamData ?? []) as { id: string; kind: string }[]).map((team) => [team.id, team.kind]));

  const people: DirectoryPerson[] = memberships
    .map((m) => {
      const profile = profileMap.get(m.user_id);
      return {
        membershipId: m.id,
        name: profile?.name ?? "—",
        role: m.role,
        roleLabel: roles[displayRoleKey(m.role, m.user_id, devIds)] ?? m.role,
        teamKind: m.team_id ? teamKind.get(m.team_id) ?? null : null,
        phone: profile?.phone_number ?? "",
        joinedAt: m.joined_at,
        isSelf: m.user_id === session.user.id,
      };
    })
    .sort((a, b) => (ROLE_ORDER[a.role] ?? 99) - (ROLE_ORDER[b.role] ?? 99) || a.name.localeCompare(b.name, locale));

  const navBadges = await getMobileNavBadges();

  return (
    // 화이트 리디자인(2026-10-14): 폰 = 역할 묶음 목록, 폴드 = 한 줄에 번호까지, 태블릿 가로 = 목록 + 프로필 칸.
    <MobileShell activeItem="directory" badges={navBadges} split title={copy.title}>
      <DirectoryView
        people={people}
        orgName={session.organization.name}
        locale={locale}
        copy={{
          title: copy.title,
          searchPlaceholder: copy.searchPlaceholder,
          empty: copy.empty,
          call: copy.call,
          noPhoneLong: copy.noPhoneLong,
          groupLead: copy.groupLead,
          groupField: copy.groupField,
          groupPart: copy.groupPart,
          groupOther: copy.groupOther,
          me: copy.me,
          copyNumber: copy.copyNumber,
          copied: copy.copied,
          copyFailed: copy.copyFailed,
          labelPhone: copy.labelPhone,
          labelRole: copy.labelRole,
          labelTeam: copy.labelTeam,
          labelJoined: copy.labelJoined,
          teamField: copy.teamField,
          teamOffice: copy.teamOffice,
          pickHint: copy.pickHint,
          clear: copy.clear,
          countUnit: copy.countUnit,
        }}
      />
    </MobileShell>
  );
}
