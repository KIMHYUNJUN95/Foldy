import { notFound, redirect } from "next/navigation";
import { getGuestConversation } from "@/actions/guest-messages";
import { MobileThreadScreen } from "@/components/guest-messages/mobile-messages";
import { InboxError } from "@/components/guest-messages/gm-parts";
import { MobileShell } from "@/components/shell/mobile-shell";
import { UUID_RE } from "@/lib/guest-messages/inbox-model";
import { creatableKinds } from "@/lib/guest-messages/task-link-model";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";

export const dynamic = "force-dynamic";

/** 손님 메시지 대화 한 건 — 폰 · 폴드는 이 화면으로, 태블릿 가로는 목록 오른쪽 칸(`?pane=1`, 칸 모드) 안에서 같은 화면. 문서 47 §5-4. */
export default async function MobileMessageThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const [state, session, { id }] = await Promise.all([getOnboardingState(), getCurrentAppSession(), params]);
  if (state.status === "unauthenticated") redirect(`/auth/login?next=${encodeURIComponent(`/mobile/messages/${id}`)}`);
  if (state.status !== "ready" || !session) redirect("/onboarding");
  if (!hasOrganizationContext(session)) redirect("/mobile/unavailable");
  if (!session.capabilities.includes("guest_messages.view")) redirect("/mobile");
  if (!UUID_RE.test(id)) notFound();

  const locale = session.user.preferredLanguage;
  const dict = getDictionary(locale);
  const [badges, result] = await Promise.all([getMobileNavBadges(), getGuestConversation(id)]);
  if (!result.ok && result.errorKey === "not_found") notFound();

  return (
    <MobileShell activeItem="messages" badges={badges} title={dict.guestMessages.title}>
      {result.ok ? (
        <MobileThreadScreen
          conversationId={id}
          initial={result.thread}
          copy={dict.guestMessages}
          locale={locale}
          canReply={session.capabilities.includes("guest_messages.reply")}
          canManage={session.capabilities.includes("guest_messages.manage")}
          taskKinds={creatableKinds(session.capabilities)}
          taskCategoryCopy={{ maintenance: dict.maintenance.form.categories, lostFound: dict.lostFound.categoryLabels }}
        />
      ) : (
        <InboxError copy={dict.guestMessages} />
      )}
    </MobileShell>
  );
}
