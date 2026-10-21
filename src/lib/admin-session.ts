import { redirect } from "next/navigation";
import { hasAdminWebAccess } from "@/config/capabilities";
import type { Role } from "@/config/roles";
import { getOnboardingState } from "@/lib/onboarding";
import type { AppSession } from "@/lib/session";
import { getCurrentAppSession } from "@/lib/session";

export type AdminApiAuthResult =
  | { ok: true; session: AppSession }
  | { ok: false; status: 401 | 403 };

export async function getAdminSessionForApi(): Promise<AdminApiAuthResult> {
  const [state, session] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
  ]);

  if (state.status === "unauthenticated" || !session) {
    return { ok: false, status: 401 };
  }

  if (state.status !== "ready") {
    return { ok: false, status: 403 };
  }

  if (!hasAdminWebAccess(session)) {
    return { ok: false, status: 403 };
  }

  return { ok: true, session };
}

export async function requireAdminSession() {
  const [state, session] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
  ]);

  if (state.status === "unauthenticated") {
    redirect("/auth/login?next=/admin");
  }

  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }

  if (!hasAdminWebAccess(session)) {
    redirect("/mobile");
  }

  return session;
}

export function hasAnyRole(role: Role, allowedRoles: readonly Role[]) {
  return allowedRoles.includes(role);
}
