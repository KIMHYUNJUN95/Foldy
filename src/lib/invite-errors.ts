/**
 * join_organization_with_invite_code RPC 가 일으키는 오류 키 중
 * 온보딩 페이지가 보여줄 수 있는 i18n 오류 키에 바로 대응하는 것.
 * 이 집합에 없는 RPC 오류는 `invite_join_failed` 로 대응된다.
 *
 * 2026-11-11: 만료(`invite_expired`) · 꺼짐(`invite_inactive`) · 다 씀(`invite_maxed`)은 화면에 따로 보이지 않고 `invalid_invite`
 * 하나로 합친다 — 사유가 갈리면 「이 코드는 있다(만료됐을 뿐)」를 맞혀 볼 수 있다. 미리보기(`previewInviteCode`)와 같은 규칙.
 * 사전의 그 세 문구는 남겨 둔다(다른 화면 · 예전 주소의 `?error=` 가 쓸 수 있다).
 */
export const INVITE_ERROR_KEYS = new Set(["missing_invite", "invalid_invite", "membership_blocked"]);

const HIDDEN_REASON_KEYS = new Set(["invite_expired", "invite_inactive", "invite_maxed"]);

export function resolveInviteRpcError(message: string): string {
  if (HIDDEN_REASON_KEYS.has(message)) return "invalid_invite";
  return INVITE_ERROR_KEYS.has(message) ? message : "invite_join_failed";
}
