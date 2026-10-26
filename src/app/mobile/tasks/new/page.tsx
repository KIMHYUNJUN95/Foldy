import { redirect } from "next/navigation";
import { TaskCreateForm } from "@/components/tasks/task-create-form";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getShareableUsers } from "@/lib/tasks";

type PageProps = {
  searchParams: Promise<{
    date?: string;
    error?: string;
    title?: string;
    project?: string;
    section?: string;
    /** "1" 이면 지시 모드로 시작 — 모바일 "보낸 지시" 화면의 진입점이 붙여 보낸다. */
    directive?: string;
  }>;
};

export default async function MobileTaskNewPage({ searchParams }: PageProps) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/tasks/new")}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const locale = session.user.preferredLanguage;
  const dict = getDictionary(locale);
  const copy = dict.tasks;
  const defaultDate = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "") ? params.date! : null;
  // 빠른 추가에서 넘어온 제목 (길이 제한, 공백 제거)이라 전체 생성으로 올려도 유지된다.
  const defaultTitle = (params.title ?? "").trim().slice(0, 200) || undefined;
  const serverError = params.error ? copy.errors[params.error] ?? copy.errors.save_failed : null;
  // 프로젝트 할 일 생성: 프로젝트(와 선택적으로 구역)를 실어 createTask 가
  // 연결을 저장하고 저장 후 프로젝트로 돌아가게 한다. 뒤로 가기는 프로젝트 상세로 간다.
  const projectId = (params.project ?? "").trim() || undefined;
  const sectionId = (params.section ?? "").trim() || undefined;

  const [users, navBadges] = await Promise.all([
    getShareableUsers(session),
    navBadgesPromise,
  ]);

  return (
    <MobileShell activeItem="tasks" badges={navBadges} title={copy.newTask}>
      <TaskCreateForm
        buildingLabels={dict.cleaning.buildingLabels}
        copy={copy}
        defaultDate={defaultDate}
        defaultDirective={params.directive === "1"}
        defaultTitle={defaultTitle}
        headerTitle={copy.newTask}
        imgCopy={dict.requestImages}
        locale={locale}
        maxImages={projectId ? 20 : 5}
        organizationId={session.organization.id}
        projectId={projectId}
        sectionId={sectionId}
        serverError={serverError}
        users={users}
      />
    </MobileShell>
  );
}
