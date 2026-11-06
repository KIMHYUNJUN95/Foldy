// 알림 줄(목록 · 벨) → 레이아웃의 `StaffCallHost`. 둘은 서로 다른 트리라 창 이벤트로 잇는다.
export const STAFF_CALL_REOPEN_EVENT = "stayops:staff-call-reopen";

export function requestStaffCallReopen(id: string): void {
  window.dispatchEvent(new CustomEvent<{ id: string }>(STAFF_CALL_REOPEN_EVENT, { detail: { id } }));
}
