// 관리자 콘솔 처리 액션이 실패했을 때 토스트 문구 하나를 고른다(2026-11-10 — 수리 · 분실물 · 주문 콘솔이 저장 실패에도 「불러오지
// 못했어요」(errS)를 띄우고 있었다). 서버가 돌려준 이유가 권한 · 그 사이 바뀜이면 그 말을, 나머지는 「저장 못 함」.
// 삭제 액션은 `{ error: "unauthorized" | "not_found" | ... }` 꼴이라 같이 받는다 — 지울 행이 없으면 그 사이 누가 지웠거나 바꾼 것이다.
// `src/actions/orders.ts` 의 `invalid_transition` 도 「그 사이 상태가 바뀜」이다.
export type AdminActionErrorCopy = {
  actionFailed: string;
  actionForbidden: string;
  actionStale: string;
};

export function adminActionErrorMessage(reason: string | undefined, copy: AdminActionErrorCopy): string {
  if (reason === "forbidden" || reason === "unauthorized") return copy.actionForbidden;
  if (reason === "stale" || reason === "not_found" || reason === "invalid_transition") return copy.actionStale;
  return copy.actionFailed;
}
