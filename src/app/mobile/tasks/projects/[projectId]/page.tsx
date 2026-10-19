import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { SplitList } from "@/components/shell/split-list";
import { ProjectDetailView } from "@/components/tasks/project-detail-view";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getProjectDetail } from "@/lib/projects";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getShareableUsers } from "@/lib/tasks";

type PageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectDetailPage({ params }: PageProps) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, { projectId }] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    params,
  ]);

  if (state.status === "unauthenticated") {
    redirect(
      `/auth/login?next=${encodeURIComponent(`/mobile/tasks/projects/${projectId}`)}`,
    );
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const locale = session.user.preferredLanguage;
  const dict = getDictionary(locale);
  const [project, shareableUsers, navBadges] = await Promise.all([
    getProjectDetail(session, projectId),
    getShareableUsers(session),
    navBadgesPromise,
  ]);

  // Not a participant (or missing project) → back to the Projects tab.
  if (!project) {
    redirect("/mobile/tasks?view=projects");
  }

  return (
    <MobileShell activeItem="tasks" badges={navBadges} title={dict.tasks.title} split>
      <SplitList detail="tasks">
        <ProjectDetailView
          buildingLabels={dict.cleaning.buildingLabels}
          copy={dict.tasks}
          currentUserId={session.user.id}
          locale={locale}
          project={project}
          shareableUsers={shareableUsers}
        />
      </SplitList>
    </MobileShell>
  );
}
