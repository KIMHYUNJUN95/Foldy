/**
 * 권한 오버라이드 허용 목록 — owner/developer 가 부여할 수 있는 `permission_key` 의 닫힌 집합으로,
 * 역할 위에 얹는 기간 한정 사용자별 예외로 쓰인다 (참고:
 * `docs/product/27-permission-override-workflow.md` 및 마이그레이션
 * `202607090002_membership_permission_overrides.sql`).
 *
 * 검증(서버 액션이 이 목록에 없는 키를 거부함)과 UI 정렬의 단일 진실 공급원이다.
 * 사람이 읽는 라벨/설명은 i18n(`admin.users.console.keys`)에 있고 같은 문자열을 키로 쓴다.
 * 각 키는 기능별 RLS/서버 게이트에 따로 적용한다 — 그 기능의 기존 역할 검사 옆에
 * `OR public.has_permission_override(org, user, '<key>')` 를 추가하는 식이다.
 */
export const PERMISSION_OVERRIDE_KEYS = [
  "order_processor",
  "maintenance_status_change",
  "property_room_manage",
  "can_generate_report",
] as const;

export type PermissionOverrideKey = (typeof PERMISSION_OVERRIDE_KEYS)[number];

export function isPermissionOverrideKey(value: string): value is PermissionOverrideKey {
  return (PERMISSION_OVERRIDE_KEYS as readonly string[]).includes(value);
}
