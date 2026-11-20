import { AdminShell } from "@/components/shell/admin-shell";
import { AnnouncementsConsole } from "@/components/admin/announcements/announcements-console";
import { adminNavigation, getNavigationLabel } from "@/config/navigation";
import { getAdminAnnouncements } from "@/lib/admin-announcements";
import { getAnnouncementDictionary } from "@/lib/announcement-i18n";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { hasOrganizationContext } from "@/lib/session";

// 공지 관리 콘솔 — 게시 중/초안/보관 탭 + 한 줄 요약 + 목록 + 우측 상세 패널(읽음 명단) + 작성 화면(화이트 리디자인 2026-10-15).
// 모바일 공지의 배포·감사 관리 표면. AdminShell 이 사이드바/탑바를 소유한다.
// `?id=<공지>` 로 들어오면 그 공지를 패널로 연다(예전 상세 주소 `/admin/announcements/[id]` 가 여기로 넘어온다, 2026-11-20).
// 패널은 콘솔이 주소(useSearchParams)를 직접 따라간다 — 여기서 `?id` 를 읽지 않는다(2차).
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
      <AnnouncementsConsole
        locale={locale}
        data={data}
        currentOrgId={hasOrganizationContext(session) ? session.organization.id : null}
      />
    </AdminShell>
  );
}
