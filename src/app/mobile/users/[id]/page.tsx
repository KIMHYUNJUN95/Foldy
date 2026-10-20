import { notFound } from "next/navigation";
import { MobileMemberDetail } from "@/components/mobile/users/mobile-member-detail";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { loadMemberPanel, loadUserDirectory } from "@/lib/user-management-data";
import { requireMobileUserManagement } from "../gate";

/**
 * 모바일 사용자 관리 — 멤버 상세(2026-10-20, 시안 ④ ~ ⑩). 폰 · 폴드는 이 화면으로 넘어오고(뒤로 = 화면 스와이프), 태블릿 가로는
 * 목록 오른쪽 칸에 이 화면이 그대로 열린다. 데이터 · 판정은 대시보드 패널과 같다.
 */
export default async function MobileMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const navBadgesPromise = getMobileNavBadges();
  const session = await requireMobileUserManagement(`/mobile/users/${id}`);
  const directory = await loadUserDirectory(session);
  const [panel, navBadges] = await Promise.all([loadMemberPanel(session, directory, id), navBadgesPromise]);
  if (!panel) notFound();
  const locale = session.user.preferredLanguage;
  return (
    <MobileShell activeItem="users" badges={navBadges} title={getDictionary(locale).admin.users.console.mDetailTitle}>
      <MobileMemberDetail key={panel.member.membershipId} panel={panel} locale={locale} actorRole={session.user.role} />
    </MobileShell>
  );
}
