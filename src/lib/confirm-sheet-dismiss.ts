/** 확인 시트를 닫아도 되는지 — 사진을 올리는 중이거나 저장 요청이 가는 중이면 안 된다(닫으면 방금 저장되는 기록의 사진을 지운다). */
export function canDismissConfirmSheet(state: { running: boolean; pending: boolean }): boolean {
  return !state.running && !state.pending;
}
