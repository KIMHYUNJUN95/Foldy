import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * 플랫폼 개발자(`platform_admins` 활성)는 조직 멤버십이 `owner` 여도 화면에선 「개발자」로 보인다
 * (2026-10-16 사용자 「대표로 되어 있는 곳 전부 개발자로」). 세션 역할이 이미 그렇게 정해지고
 * (`src/lib/session.ts`), 사용자 목록 · 연차 표도 같은 규칙이다 — 다른 사람의 역할 글자를 그리는 곳도 맞춘다.
 *
 * **표시 전용.** 권한 판단에는 쓰지 않는다(멤버십 role 은 그대로).
 * `platform_admins` 는 RLS 로 남의 행이 안 읽혀서 service-role 로 읽는다(user_id 만).
 */
export const PLATFORM_DEVELOPER_ROLE = "developer_super_admin";

export async function fetchPlatformDeveloperIds(userIds: string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(userIds)).filter(Boolean);
  if (ids.length === 0) return new Set();
  const { data } = await getSupabaseServiceClient()
    .from("platform_admins")
    .select("user_id")
    .eq("is_active", true)
    .in("user_id", ids);
  return new Set(((data ?? []) as { user_id: string }[]).map((row) => row.user_id));
}

/** 화면에 그릴 역할 키 — 플랫폼 개발자면 `developer_super_admin`, 아니면 멤버십 역할 그대로. */
export function displayRoleKey(role: string, userId: string, devIds: Set<string>): string {
  return devIds.has(userId) ? PLATFORM_DEVELOPER_ROLE : role;
}

/** `{ id, role }` 목록의 역할을 화면용으로 바꾼다(고르기 목록처럼 역할 키를 클라이언트에서 글자로 바꾸는 곳). */
export async function withDisplayRoles<T extends { id: string; role: string }>(users: T[]): Promise<T[]> {
  const devIds = await fetchPlatformDeveloperIds(users.map((u) => u.id));
  return devIds.size === 0 ? users : users.map((u) => ({ ...u, role: displayRoleKey(u.role, u.id, devIds) }));
}
