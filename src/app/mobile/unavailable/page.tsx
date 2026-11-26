import { redirect } from "next/navigation";
import { signOut } from "@/app/auth/actions";
import { FALLBACK_PRIMARY, FallbackScreen } from "@/components/fallback-screen";
import { getDictionary } from "@/lib/i18n";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";

export default async function MobileUnavailablePage() {
  const [state, session] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
  ]);

  if (state.status === "unauthenticated") {
    redirect("/auth/login?next=/mobile");
  }

  if (state.status !== "ready" || !session) {
    redirect("/onboarding?next=/mobile");
  }

  if (hasOrganizationContext(session)) {
    redirect("/mobile");
  }

  const dictionary = getDictionary(session.user.preferredLanguage);
  const copy = dictionary.mobile;

  return (
    <FallbackScreen body={copy.unavailableBody} locale={session.user.preferredLanguage} title={copy.unavailableTitle}>
      <p className="-mt-2 mb-6 text-[13px] leading-5 text-muted-foreground text-pretty [&:lang(ko)]:break-keep">{copy.unavailableHelp}</p>
      <form action={signOut}>
        <input name="next" type="hidden" value="/auth/login?next=/mobile" />
        <button className={FALLBACK_PRIMARY} type="submit">
          {dictionary.common.logout}
        </button>
      </form>
    </FallbackScreen>
  );
}
