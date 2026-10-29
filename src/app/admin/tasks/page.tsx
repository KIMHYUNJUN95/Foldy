import { AdminShell } from "@/components/shell/admin-shell";
import { AdminTasksConsole } from "@/components/admin/tasks/admin-tasks-console";
import { LiveRefresh } from "@/components/shared/live-refresh";
import { taskLiveSources } from "@/lib/live-sources";
import { adminNavigation, getNavigationLabel } from "@/config/navigation";
import { getAdminTasksData } from "@/lib/admin-tasks";
import { requireAdminPageSession } from "@/lib/admin-page-auth";

// 어드민 Todoist 콘솔 — 데스크톱 워크스페이스(모바일 코어 패리티 + 업무 지시).
// AdminShell 이 사이드바/탑바를 소유하고, 그 안에 Todoist 콘솔(서브내비 + 뷰 + 상세/팝오버)을 렌더한다.
// docs/product/28-admin-todoist-console.md 참고.
export default async function AdminTasksPage() {
  const session = await requireAdminPageSession({ nextPath: "/admin/tasks" });
  const locale = session.user.preferredLanguage;
  const data = await getAdminTasksData(session);
  const navItem = adminNavigation.find((item) => item.id === "recurring-work");
  const title = navItem ? getNavigationLabel(navItem, locale) : "Todoist";

  return (
    <AdminShell activeItem="recurring-work" title={title}>
      <LiveRefresh sources={taskLiveSources(session.organization.id, session.user.id)} />
      <AdminTasksConsole locale={locale} data={data} organizationId={session.organization.id} />
    </AdminShell>
  );
}
