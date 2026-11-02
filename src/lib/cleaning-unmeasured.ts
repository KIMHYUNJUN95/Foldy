/**
 * 「끝낸 시각 모름」 청소 기록 — 알바가 다음 날 「청소했어요」로 닫은 기록(2026-11-02 사용자 결정).
 * 그 기록은 완료 · 소요 0초 · **끝낸 시각 = 시작 시각** 으로 저장된다(`closeStaleSessionCore`). 소요 0초만 보면
 * 1초 안에 끝낸 정상 기록과 구분이 안 되므로, 세 가지가 모두 맞을 때만 「시각 모름」으로 본다.
 * 화면은 끝 시각을 비우고, 관리자 강제 완료는 이 기록만 덮어써 시각을 채울 수 있다.
 */
export type UnmeasuredSessionLike = {
  status: string;
  started_at: string | null;
  completed_at: string | null;
  duration_seconds: number | null;
  closed_without_cleaning?: boolean | null;
};

export function isUnmeasuredSession(row: UnmeasuredSessionLike): boolean {
  if (row.status !== "completed" || row.duration_seconds !== 0 || row.closed_without_cleaning) return false;
  if (!row.started_at || !row.completed_at) return false;
  return Date.parse(row.started_at) === Date.parse(row.completed_at);
}
