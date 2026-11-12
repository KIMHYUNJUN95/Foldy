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
const TASK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string | string[] }>;
}) {
  // `?task=<id>` — 손님 메시지의 업무 줄 등이 넘겨 준다. 로그인으로 돌아와도 남게 nextPath 에 싣는다(uuid 꼴일 때만).
  const query = await searchParams;
  const taskRaw = Array.isArray(query?.task) ? query.task[0] : query?.task;
  const taskParam = taskRaw && TASK_ID_RE.test(taskRaw) ? taskRaw : null;
  const session = await requireAdminPageSession({
    nextPath: taskParam ? `/admin/tasks?task=${taskParam}` : "/admin/tasks",
  });
  const locale = session.user.preferredLanguage;
  const data = await getAdminTasksData(session);
  // 내가 볼 수 있는 작업이면 그 상세 칸을 열고 시작한다(아니면 무시).
  const initialTaskId = taskParam && data.tasks.some((t) => t.id === taskParam) ? taskParam : null;
  const navItem = adminNavigation.find((item) => item.id === "recurring-work");
  const title = navItem ? getNavigationLabel(navItem, locale) : "Todoist";

  return (
    <AdminShell activeItem="recurring-work" title={title}>
      <LiveRefresh sources={taskLiveSources(session.organization.id, session.user.id)} />
      <AdminTasksConsole
        locale={locale}
        data={data}
        organizationId={session.organization.id}
        initialTaskId={initialTaskId}
      />
    </AdminShell>
  );
}
