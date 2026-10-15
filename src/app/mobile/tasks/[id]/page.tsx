import { redirect } from "next/navigation";
import { TaskDetailView } from "@/components/tasks/task-detail-view";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { canEditTaskCore, getShareableUsers, getTaskDetail, taskAnchorDate } from "@/lib/tasks";
import { occurrenceStatesForTask } from "@/lib/task-occurrences";
import { isRecurringOccurrenceDate } from "@/lib/tasks-recurrence";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ occurrence?: string; view?: string }>;
};

export default async function MobileTaskDetailPage({ params, searchParams }: PageProps) {
  const [state, session, { id }, query] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    params,
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent(`/mobile/tasks/${id}`)}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const task = await getTaskDetail(session, id);
  if (!task) {
    redirect("/mobile/tasks");
  }

  const locale = session.user.preferredLanguage;
  const dict = getDictionary(locale);
  const candidateOccurrence = typeof query.occurrence === "string" ? query.occurrence : "";
  const matchesRule = isRecurringOccurrenceDate(
    task.recurrenceRule,
    taskAnchorDate(task),
    candidateOccurrence,
  );
  const [users, navBadges, occurrenceStates] = await Promise.all([
    getShareableUsers(session),
    getMobileNavBadges(),
    // 이 작업 한 건의 회차 상태만 읽어, 아래 두 값을 같은 결과에서 뽑는다. 조직 전체 회차 상태를
    // 끌어오면 날짜 한 건을 알려고 400일치 org 데이터를 읽게 된다.
    matchesRule ? occurrenceStatesForTask(task.id) : Promise.resolve(new Map<string, string>()),
  ]);
  // "Still open" — unchanged meaning relied on by the detail view's "이 날짜만 건너뛰기" gate.
  const occurrenceDate =
    matchesRule && !occurrenceStates.has(candidateOccurrence) ? candidateOccurrence : null;
  // 완료 버튼용: 이 회차가 실제로 "완료"로 기록됐을 때만 그 날짜를 넘긴다(건너뛰기/이동은 완료가
  // 아니므로 제외 — 그 경우 아래에서 회차 컨텍스트가 없는 것과 동일하게 취급된다).
  const completedOccurrenceDate =
    occurrenceStates.get(candidateOccurrence) === "completed" ? candidateOccurrence : null;
  const returnView = ["today", "tomorrow", "calendar"].includes(query.view ?? "")
    ? (query.view as "today" | "tomorrow" | "calendar")
    : "today";
  // 빵부스러기(「오늘 · 투두이스트」) — 어느 목록에서 열었는지. 모르면 「투두이스트」만.
  const crumbLabels: Record<string, string> = {
    today: dict.tasks.viewToday,
    tomorrow: dict.tasks.viewTomorrow,
    inbox: dict.tasks.viewInbox,
    projects: dict.tasks.viewProjects,
    instr: dict.tasks.viewInstr,
    completed: dict.tasks.viewCompleted,
    calendar: dict.tasks.viewCalendar,
  };
  const crumbView = crumbLabels[query.view ?? ""] ?? null;

  return (
    <MobileShell activeItem="tasks" badges={navBadges} title={dict.tasks.detailTitle}>
      <TaskDetailView
        buildingLabels={dict.cleaning.buildingLabels}
        canEditCore={canEditTaskCore(session, task)}
        copy={dict.tasks}
        completedOccurrenceDate={completedOccurrenceDate}
        crumbView={crumbView}
        currentUserId={session.user.id}
        imgCopy={dict.requestImages}
        locale={locale}
        occurrenceDate={occurrenceDate}
        returnView={returnView}
        task={task}
        users={users}
      />
    </MobileShell>
  );
}
