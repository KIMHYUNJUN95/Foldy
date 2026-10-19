import { redirect } from "next/navigation";
import { TasksWorkspace } from "@/components/tasks/tasks-workspace";
import { MobileShell } from "@/components/shell/mobile-shell";
import { SplitList } from "@/components/shell/split-list";
import { getFieldActivities } from "@/lib/field-activity";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getVisibleProjects } from "@/lib/projects";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import {
  getOccurrenceOrders,
  getOccurrenceStates,
  getShareableUsers,
  getTaskCompletions,
  getVisibleTasks,
  tokyoToday,
} from "@/lib/tasks";

type PageProps = {
  // `created` 는 서버 액션의 성공 리다이렉트가 싣는 값이고, 소비는 **클라이언트**에서 한다
  // (`TasksWorkspace` 가 `useSearchParams` 로 읽어 빠른 추가 입력을 비우고 URL 에서 털어낸다).
  searchParams: Promise<{ view?: string; created?: string; moveError?: string }>;
};

const VIEWS = [
  "today",
  "tomorrow",
  "inbox",
  "projects",
  "instr",
  "completed",
  "calendar",
] as const;

export default async function MobileTasksPage({ searchParams }: PageProps) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/tasks")}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const locale = session.user.preferredLanguage;
  const dict = getDictionary(locale);
  // 2026-07-30 "공유함"(sent) 탭이 "지시"(instr)로 재구성됐다. 예전 링크·북마크·되돌아오기 쿼리가
  // 아직 `view=sent` 를 실어 오므로 조용히 새 키로 넘긴다.
  const rawView = params.view === "sent" ? "instr" : (params.view ?? "");
  const initialView = VIEWS.includes(rawView as (typeof VIEWS)[number])
    ? (rawView as (typeof VIEWS)[number])
    : "today";

  const [
    allVisible,
    projects,
    shareableUsers,
    navBadges,
    occurrenceStates,
    occurrenceOrders,
    completions,
    fieldActivities,
  ] = await Promise.all([
    getVisibleTasks(session),
    getVisibleProjects(session),
    getShareableUsers(session),
    navBadgesPromise,
    getOccurrenceStates(session),
    getOccurrenceOrders(session),
    getTaskCompletions(session),
    getFieldActivities({
      organizationId: session.organization.id,
      userId: session.user.id,
      locale,
    }),
  ]);
  // Project tasks live only in the Projects tab; the Completed tab still surfaces project
  // completions via its filter, so those are passed separately.
  const tasks = allVisible.filter((t) => !t.projectId);
  // 완료·기록 탭은 완료 **로그** 기준이다(반복 완료는 행 status 를 건드리지 않는다 — getTaskCompletions
  // 주석 참고). 그래서 status=completed 뿐 아니라 로그에 완료가 찍힌 프로젝트 작업도 함께 넘겨야
  // 반복 프로젝트 작업의 완료가 목록에서 빠지지 않는다.
  const completedTaskIds = new Set(completions.map((c) => c.taskId));
  const projectCompletedTasks = allVisible.filter(
    (t) => t.projectId && (t.status === "completed" || completedTaskIds.has(t.id)),
  );

  return (
    <MobileShell activeItem="tasks" badges={navBadges} title={dict.tasks.title} split>
      <SplitList detail="tasks">
        <TasksWorkspace
          buildingLabels={dict.cleaning.buildingLabels}
          completions={completions}
          fieldActivities={fieldActivities}
          copy={dict.tasks}
          currentUserId={session.user.id}
          initialView={initialView}
          locale={locale}
          moveError={params.moveError}
          occurrenceOrders={occurrenceOrders}
          occurrenceStates={occurrenceStates}
          projectCompletedTasks={projectCompletedTasks}
          projects={projects}
          shareableUsers={shareableUsers}
          tasks={tasks}
          today={tokyoToday()}
        />
      </SplitList>
    </MobileShell>
  );
}
