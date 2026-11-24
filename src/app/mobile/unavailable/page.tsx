import { redirect } from "next/navigation";
import { signOut } from "@/app/auth/actions";
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
    <main className="min-h-[100svh] bg-surface px-6 py-[max(28px,env(safe-area-inset-top))] text-foreground">
      <section className="mx-auto flex min-h-[calc(100svh-56px)] w-full max-w-[420px] flex-col justify-center">
        <p className="px-6 text-[20px] font-semibold tracking-[-0.01em] text-foreground">
          Foldy
        </p>
        <div className="mt-9 rounded-3xl bg-card px-6 py-7">
          <p className="text-[12px] font-medium text-muted-foreground">
            {copy.unavailableEyebrow}
          </p>
          <h1 className="mt-3 text-[24px] font-semibold leading-tight tracking-[-0.04em] text-balance text-foreground [&:lang(ko)]:break-keep">
            {copy.unavailableTitle}
          </h1>
          <p className="mt-4 text-[14px] font-normal leading-6 text-muted-foreground [&:lang(ko)]:break-keep">
            {copy.unavailableBody}
          </p>
          <p className="mt-4 rounded-2xl bg-muted px-4 py-3 text-[13px] font-normal leading-5 text-muted-foreground [&:lang(ko)]:break-keep">
            {copy.unavailableHelp}
          </p>
          <form action={signOut} className="mt-6">
            <input name="next" type="hidden" value="/auth/login?next=/mobile" />
            <button
              className="h-13 w-full rounded-[14px] bg-primary text-[15px] font-semibold text-primary-foreground active:scale-[0.99]"
              type="submit"
            >
              {dictionary.common.logout}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
