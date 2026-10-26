// Attendance — 출퇴근 시각 조합 규칙(순수). 직원 정정 요청과 관리자 수동 수정이 같은 규칙을 쓴다.
//
// 운영일(도쿄 YYYY-MM-DD) + 벽시계 "HH:mm" 을 실제 시각으로 바꾸고, 퇴근이 출근보다 앞서면 다음 날로
// 넘긴다(야간 근무 22:00 → 06:00). 두 경로가 이 규칙을 따로 들고 있던 탓에 2026-10-01 까지 직원 쪽만
// 넘기지 않아, 자정을 넘는 정정 요청이 승인 단계의 순서 검사에서 `invalid` 로 떨어졌다.

/** 도쿄 운영일 + "HH:mm" → ISO 시각. 형식이 틀리면 null. */
export function tokyoWallClockInstant(baseDate: string, hhmm: string | null): string | null {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const d = new Date(`${baseDate}T${hhmm}:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * 퇴근 시각 — 같은 날로 붙였을 때 출근 **이후**가 아니면 다음 날로 넘긴다.
 * `clockInAt` 이 없으면(비교 기준이 없으면) 같은 날 그대로 둔다.
 */
export function resolveClockOutAfterClockIn(
  baseDate: string,
  hhmm: string | null,
  clockInAt: string | null,
): string | null {
  const sameDay = tokyoWallClockInstant(baseDate, hhmm);
  if (!sameDay || !clockInAt) return sameDay;
  if (new Date(sameDay).getTime() > new Date(clockInAt).getTime()) return sameDay;
  const next = new Date(sameDay);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

/** "YYYY-MM" 이고 월이 01~12 인가. 관리자 근태 화면 · 마감 액션이 같이 쓴다(2026-10-26). */
export function isValidYm(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/**
 * 그 달이 끝났나 — 도쿄 오늘(YYYY-MM-DD)의 달보다 **앞선** 달만 true. 이번 달 · 다음 달은 아직 근무가 더 생길 수
 * 있어 마감하지 않는다(2026-10-26). 문자열 비교로 충분하다(같은 자릿수 YYYY-MM).
 */
export function isMonthEnded(ym: string, tokyoTodayYmd: string): boolean {
  return ym < tokyoTodayYmd.slice(0, 7);
}
