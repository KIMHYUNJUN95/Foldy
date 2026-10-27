/**
 * 관리자가 수동 정정 · 수기 입력으로 기록을 고쳤을 때 대기 중 정정 요청을 「승인」으로 닫을지 「반려」로 닫을지(2026-10-27).
 * 서버 액션 `closePendingCorrectionsAfterManualFix`(src/app/admin/attendance/actions.ts)가 쓴다. docs/product/24 「수동 정정과 정정 요청」.
 */

/** 같은 순간인가 — timestamptz 문자열은 표기(자릿수 · 오프셋)가 달라도 같은 순간일 수 있다. */
function sameMoment(a: string, b: string): boolean {
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) ? x === y : a === b;
}

/** 직원이 바란 시각(적은 것만)이 고친 결과와 모두 같은가 — 바란 시각이 하나도 없으면 같다고 보지 않는다. */
export function correctionMatchesFix(
  row: { desired_clock_in_at: string | null; desired_clock_out_at: string | null },
  clockInAt: string | null,
  clockOutAt: string | null,
): boolean {
  if (!row.desired_clock_in_at && !row.desired_clock_out_at) return false;
  if (row.desired_clock_in_at && !(clockInAt && sameMoment(row.desired_clock_in_at, clockInAt))) return false;
  if (row.desired_clock_out_at && !(clockOutAt && sameMoment(row.desired_clock_out_at, clockOutAt))) return false;
  return true;
}
