import { hasAdminWebAccess } from "@/config/capabilities";
import { canAccessOpsAdmin } from "@/lib/ops-admin";
import { hasOrganizationContext, type AppSession } from "@/lib/session";

/**
 * Beds24 크레딧 사용을 볼 수 있는가 — PC 상단 게이지(레이아웃)와 공용 액션(`src/actions/beds24-credit.ts`)이
 * 같은 답을 쓴다. 조직이 있고(플랫폼 계정 제외) · 운영 관리 영역 · 관리 웹.
 */
export function canViewBeds24Credit(session: AppSession | null | undefined): session is AppSession {
  return Boolean(session && hasOrganizationContext(session) && canAccessOpsAdmin(session) && hasAdminWebAccess(session));
}
