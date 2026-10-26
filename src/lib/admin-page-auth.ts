import "server-only";

import { redirect } from "next/navigation";
import { hasAdminWebAccess } from "@/config/capabilities";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext, type AppSession } from "@/lib/session";

type RequireAdminPageSessionOptions = {
  nextPath: string;
};

/** 공용 관리자 페이지 게이트: 인증 -> 온보딩/조직 컨텍스트 -> 관리자 웹 역할 접근. */
export async function requireAdminPageSession({
  nextPath,
}: RequireAdminPageSessionOptions): Promise<AppSession> {
  const [state, session] = await Promise.all([getOnboardingState(), getCurrentAppSession()]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);
  }
  if (state.status !== "ready" || !session || !hasOrganizationContext(session)) {
    redirect("/onboarding");
  }
  if (!hasAdminWebAccess(session)) {
    redirect("/admin/no-access");
  }

  return session;
}
