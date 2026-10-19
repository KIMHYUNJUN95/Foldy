import { redirect } from "next/navigation";
import { TaskCreateForm } from "@/components/tasks/task-create-form";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { canEditTaskCore, getShareableUsers, getTaskDetail, tokyoDateOf } from "@/lib/tasks";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function MobileTaskEditPage({ params, searchParams }: PageProps) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, { id }, query] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    params,
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent(`/mobile/tasks/${id}/edit`)}`);
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
  const detailHref = `/mobile/tasks/${id}`;
  if (!canEditTaskCore(session, task)) {
    redirect(detailHref);
  }

  const locale = session.user.preferredLanguage;
  const dict = getDictionary(locale);
  const copy = dict.tasks;
  const serverError = query.error ? copy.errors[query.error] ?? copy.errors.save_failed : null;

  const [users, navBadges] = await Promise.all([
    getShareableUsers(session),
    navBadgesPromise,
  ]);

  return (
    <MobileShell activeItem="tasks" badges={navBadges} title={copy.editTask}>
      <TaskCreateForm
        buildingLabels={dict.cleaning.buildingLabels}
        copy={copy}
        defaultDate={null}
        headerTitle={copy.editTask}
        imgCopy={dict.requestImages}
        locale={locale}
        initial={{
          title: task.title,
          description: task.description ?? "",
          scheduled: task.scheduledDate ?? "",
          due: tokyoDateOf(task.dueAt) ?? "",
          time: task.timeLabel ?? "",
          duration: task.durationMinutes ?? 0,
          priority: task.priority,
          repeat: task.recurrenceRule ?? "",
          tags: task.tags,
          imageUrls: task.imageUrls,
        }}
        initialCtx={
          task.resolvedContext
            ? {
                propertyId: task.resolvedContext.propertyId,
                roomId: task.resolvedContext.roomId,
                propertyName: task.resolvedContext.propertyName,
                roomLabel: task.resolvedContext.roomLabel,
                reservationId: task.resolvedContext.reservationId,
                guestName: task.resolvedContext.guestName,
                channel: task.resolvedContext.channel,
                checkinDate: task.resolvedContext.checkinDate,
                checkoutDate: task.resolvedContext.checkoutDate,
              }
            : null
        }
        maxImages={task.projectId ? 20 : 5}
        mode="edit"
        organizationId={session.organization.id}
        serverError={serverError}
        taskId={task.id}
        users={users}
      />
    </MobileShell>
  );
}
