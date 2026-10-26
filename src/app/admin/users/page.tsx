import { redirect } from "next/navigation";
import { AdminShell } from "@/components/shell/admin-shell";
import { UsersConsole } from "@/components/admin/users/users-console";
import { requireAdminSession } from "@/lib/admin-session";
import { actorCanOpenUserManagement } from "@/lib/user-management-access";
import { getDictionary } from "@/lib/i18n";
import { countDocsPeople, loadMemberPanel, loadUsableInviteCount, loadUserDirectory } from "@/lib/user-management-data";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * 사용자 — 화이트 리디자인(2026-10-14, 시안 Users-PC · UsersGrant-PC · UsersDeact-PC).
 * 목록 + 오른쪽 패널(`?member=<membershipId>`). 예전 `/admin/users/[id]` 프로필 화면은 이 패널로 합쳤다
 * (그 주소는 여기로 넘긴다). 패널 데이터는 고른 사람 것만 서버에서 읽는다. 데이터 읽기는 모바일 `/mobile/users` 와
 * 같은 `src/lib/user-management-data.ts`. docs/product/17-user-profile-directory.md
 */
export default async function AdminUsersPage({ searchParams }: PageProps) {
  const session = await requireAdminSession();
  // 사용자 관리는 기본적으로 개발자 전용이며, 개발자가 `user.manage` 로 위임할 수 있다.
  if (!(await actorCanOpenUserManagement(session.user.id, session.user.role))) {
    redirect("/admin");
  }
  const params = (await searchParams) ?? {};
  const selectedParam = Array.isArray(params.member) ? params.member[0] : params.member;
  const dictionary = getDictionary(session.user.preferredLanguage);

  const [directory, inviteCount] = await Promise.all([loadUserDirectory(session), loadUsableInviteCount(session)]);
  const panel = selectedParam ? await loadMemberPanel(session, directory, selectedParam) : null;

  return (
    <AdminShell activeItem="users" title={dictionary.admin.users.title}>
      <UsersConsole
        members={directory.members}
        panel={panel}
        selectedId={panel ? panel.member.membershipId : null}
        locale={session.user.preferredLanguage}
        actorRole={session.user.role}
        inviteCount={inviteCount}
        docsCount={directory.canViewIdDocs ? countDocsPeople(directory.members) : null}
      />
    </AdminShell>
  );
}
