import { redirect } from "next/navigation";
import { NotificationList } from "@/components/notifications/notification-list";
import { SplitList } from "@/components/shell/split-list";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getDictionary } from "@/lib/i18n";
import { buildNotificationViews, loadNotificationActorNames } from "@/lib/notifications/brief";
import { listNotificationsForUser } from "@/lib/notifications/queries";
import { getOnboardingState } from "@/lib/onboarding";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function MobileNotificationsPage() {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
  ]);

  if (state.status === "unauthenticated") {
    redirect("/auth/login?next=/mobile/notifications");
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const copy = dictionary.mobile.notifications;
  const supabase = await getSupabaseServerClient();

  const [{ items, schemaUnavailable }, navBadges] = await Promise.all([
    listNotificationsForUser(supabase, {
      userId: session.user.id,
      organizationId: session.organization.id,
    }),
    navBadgesPromise,
  ]);
  // 줄 글자(짧은 제목 · 대상 · 시각)는 여기서 만든다 — 클라이언트에 사전을 싣지 않는다(화이트 리디자인 2026-10-15).
  const actorNames = await loadNotificationActorNames(supabase, items);
  const { views, todayKey } = buildNotificationViews(items, { locale, actorNames });

  return (
    // 넓은 화면(2026-10-05 · 화이트 리디자인 2026-10-15): 폴드는 가운데 540px 한 줄, 태블릿 가로는 왼쪽 알림 목록 · 오른쪽 그 알림의 상세 칸(`SplitList`).
    <MobileShell badges={navBadges} split title={copy.title}>
      <div>
        {schemaUnavailable ? (
          <>
            <div className="space-y-1 mb-4">
              <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-foreground">
                {copy.title}
              </h1>
              <p className="text-sm text-muted-foreground">{copy.subtitle}</p>
            </div>
            <section className="rounded-[28px] border border-dashed border-border bg-muted/30 px-5 py-6">
              <h2 className="text-sm font-bold text-foreground">{copy.unavailableTitle}</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {copy.unavailableBody}
              </p>
            </section>
          </>
        ) : (
          <SplitList detail="notifications">
          <NotificationList copy={{ ...copy.w, title: copy.title }} items={views} todayKey={todayKey} />
          </SplitList>
        )}
      </div>
    </MobileShell>
  );
}
