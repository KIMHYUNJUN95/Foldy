/** 근태 홈 디자인 미리보기 상태(`?state=`). */
export const ATTENDANCE_PREVIEW_STATES = ["idle", "open", "break", "loading"] as const;
export type AttendancePreviewState = (typeof ATTENDANCE_PREVIEW_STATES)[number];

/**
 * `?state=` 를 미리보기로 받을지(2026-11-11). **운영(production)에서는 늘 null** — 실제 근무 데이터 대신 정적 「근무 중」 ·
 * 「휴게 중」 화면이 보이면 직원이 출근한 줄 착각한다. 개발 · 테스트에서만 디자인 전환기가 동작한다.
 */
export function resolveAttendancePreviewState(
  state: string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): AttendancePreviewState | null {
  if (nodeEnv === "production") return null;
  return (ATTENDANCE_PREVIEW_STATES as readonly string[]).includes(state ?? "") ? (state as AttendancePreviewState) : null;
}
