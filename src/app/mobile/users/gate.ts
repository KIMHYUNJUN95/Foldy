import "server-only";

import { redirect } from "next/navigation";
import { getCurrentAppSession } from "@/lib/session";
import { actorCanManageUsersInOrg } from "@/lib/user-management-access";

/** 모바일 사용자 관리 입장 — 대시보드 `/admin/users` 와 같은 문(개발자이거나 세션 조직에서 대표 · 전무 · `user.manage` 위임). 아니면 홈으로. */
export async function requireMobileUserManagement(next: string) {
  const session = await getCurrentAppSession();
  if (!session) redirect(`/auth/login?next=${encodeURIComponent(next)}`);
  // 보여 줄 명단의 조직(세션 조직) 기준(2026-11-11) — 다른 조직에서의 관리 권한으로 이 조직 명단이 열리지 않게.
  if (!(await actorCanManageUsersInOrg(session.user.id, session.user.role, session.organization.id))) redirect("/mobile");
  return session;
}
