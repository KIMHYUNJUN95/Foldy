import "server-only";

import { redirect } from "next/navigation";
import { getCurrentAppSession } from "@/lib/session";
import { actorCanOpenUserManagement } from "@/lib/user-management-access";

/** 모바일 사용자 관리 입장 — 대시보드 `/admin/users` 와 같은 문(개발자이거나 `user.manage` 위임). 아니면 홈으로. */
export async function requireMobileUserManagement(next: string) {
  const session = await getCurrentAppSession();
  if (!session) redirect(`/auth/login?next=${encodeURIComponent(next)}`);
  if (!(await actorCanOpenUserManagement(session.user.id, session.user.role))) redirect("/mobile");
  return session;
}
