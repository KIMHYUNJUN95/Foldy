import { MobileUsersList } from "@/components/mobile/users/mobile-users-list";
import { MobileShell } from "@/components/shell/mobile-shell";
import { SplitList } from "@/components/shell/split-list";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { countDocsPeople, loadUsableInviteCount, loadUserDirectory } from "@/lib/user-management-data";
import { requireMobileUserManagement } from "./gate";

/**
 * 모바일 사용자 관리 — 멤버 목록(2026-10-20, 시안 「사용자 관리 · 모바일 시안」 ①). 데스크톱 `/admin/users` 와 같은 데이터 · 같은 문.
 * 태블릿 가로는 목록 + 상세 칸(`SplitList`). docs/product/17-user-profile-directory.md 「모바일 사용자 관리」
 */
export default async function MobileUsersPage() {
  const navBadgesPromise = getMobileNavBadges();
  const session = await requireMobileUserManagement("/mobile/users");
  const [directory, inviteCount, navBadges] = await Promise.all([loadUserDirectory(session), loadUsableInviteCount(session), navBadgesPromise]);
  const locale = session.user.preferredLanguage;
  return (
    <MobileShell activeItem="users" badges={navBadges} title={getDictionary(locale).admin.users.title} split>
      <SplitList detail="users">
        <MobileUsersList
          members={directory.members}
          inviteCount={inviteCount}
          docsCount={directory.canViewIdDocs ? countDocsPeople(directory.members) : null}
          locale={locale}
        />
      </SplitList>
    </MobileShell>
  );
}
