import { AdminShell } from "@/components/shell/admin-shell";
import { AnnouncementsConsole } from "@/components/admin/announcements/announcements-console";
import { adminNavigation, getNavigationLabel } from "@/config/navigation";
import { getAdminAnnouncements } from "@/lib/admin-announcements";
import { getAnnouncementDictionary } from "@/lib/announcement-i18n";
import { requireAdminPageSession } from "@/lib/admin-page-auth";

// 공지 관리 콘솔 — 게시 중/초안/보관 탭 + 한 줄 요약 + 목록 + 우측 상세 패널(읽음 명단) + 작성 화면(화이트 리디자인 2026-10-15).
// 모바일 공지의 배포·감사 관리 표면. AdminShell 이 사이드바/탑바를 소유한다.
// 참고: docs/product/11-announcement-workflow.md → "Admin Dashboard Management Console".
export default async function AdminAnnouncementsPage() {
  const session = await requireAdminPageSession({
    nextPath: "/admin/announcements",
  });
  const locale = session.user.preferredLanguage;
  const data = await getAdminAnnouncements(session);
  const navItem = adminNavigation.find((item) => item.id === "announcements");
  const title = navItem
    ? getNavigationLabel(navItem, locale)
    : getAnnouncementDictionary(locale).title;

  return (
    <AdminShell activeItem="announcements" title={title}>
      <AnnouncementsConsole locale={locale} data={data} />
    </AdminShell>
  );
}
