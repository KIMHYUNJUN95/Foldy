import { hasAdminWebAccess } from "@/config/capabilities";
import { canAccessOpsAdmin } from "@/lib/ops-admin";
import { getCurrentAppSession, type AppSession } from "@/lib/session";

/**
 * 판매 캘린더 읽기 Route Handler 의 권한 확인 — 서버 액션(`requireOpsWriter`)과 같은 조건이다:
 * 로그인 + 활성 멤버십 + 어드민 웹 역할 + `ops_admin.access`. 조직은 세션이 정한다.
 *
 * 액션은 `getOnboardingState()` 의 `auth.getUser()`(Auth 서버 왕복)를 한 번 더 탄다. 그건 계정 정지(`banned_until`)를
 * 최신으로 보려는 것인데, 이 읽기들은 폴링 · 호버로 자주 불려 그 왕복이 곧 지연이다. 그래서 JWT 서명을 서버 안에서
 * 검증하는 `getCurrentAppSession`(getClaims)만 쓴다 — 정지된 계정이 접근 토큰 만료(최대 1시간)까지 읽기만 할 수 있는
 * 차이가 생긴다. 쓰기(저장 · 예약 수정 · 취소)는 그대로 액션이라 `getUser()` 확인을 탄다.
 */
export async function getOpsReadSession(): Promise<AppSession | null> {
  const session = await getCurrentAppSession();
  if (!session) return null;
  if (!hasAdminWebAccess(session) || !canAccessOpsAdmin(session)) return null;
  return session;
}
