/**
 * join_organization_with_invite_code RPC 가 일으키는 오류 키 중
 * 온보딩 페이지가 보여줄 수 있는 i18n 오류 키에 바로 대응하는 것.
 * 이 집합에 없는 RPC 오류는 `invite_join_failed` 로 대응된다.
 */
export const INVITE_ERROR_KEYS = new Set([
  "missing_invite",
  "invalid_invite",
  "invite_inactive",
  "invite_expired",
  "invite_maxed",
  "membership_blocked",
]);

export function resolveInviteRpcError(message: string): string {
  return INVITE_ERROR_KEYS.has(message) ? message : "invite_join_failed";
}
