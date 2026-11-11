import { isRealYm } from "@/lib/iso-date-param";

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
  // 규칙은 한 곳 — `src/lib/iso-date-param.ts` 의 `isRealYm`(2026-11-11).
  return isRealYm(value);
}

/**
 * 그 달이 끝났나 — 도쿄 오늘(YYYY-MM-DD)의 달보다 **앞선** 달만 true. 이번 달 · 다음 달은 아직 근무가 더 생길 수
 * 있어 마감하지 않는다(2026-10-26). 문자열 비교로 충분하다(같은 자릿수 YYYY-MM).
 */
export function isMonthEnded(ym: string, tokyoTodayYmd: string): boolean {
  return ym < tokyoTodayYmd.slice(0, 7);
}

/**
 * 개발 서버 전용 — 안 끝난 달도 근태 마감을 허락하는 테스트 스위치(2026-10-27). 데모에서 근태 마감 → 급여 준비 → 결재 →
 * 지급 → 세무사 송부를 한 번에 돌려 보려고 만들었다. `FOLDY_DEV_ALLOW_OPEN_MONTH_CLOSE=1` 이어도 운영 빌드
 * (`NODE_ENV=production`)나 Vercel(`VERCEL` 있음)에서는 **무시**한다 — 운영은 늘 끝난 달만 마감.
 */
export function devAllowsOpenMonthClose(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" && !env.VERCEL && env.FOLDY_DEV_ALLOW_OPEN_MONTH_CLOSE === "1";
}

/** 마감할 수 있는 달인가 — 끝난 달이거나, 개발 서버 테스트 스위치가 켜졌을 때. */
export function canCloseMonth(
  ym: string,
  tokyoTodayYmd: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return isMonthEnded(ym, tokyoTodayYmd) || devAllowsOpenMonthClose(env);
}

/** 한 근무의 최대 길이(분) — `ATTENDANCE_MAX_SHIFT_MINUTES`(attendance.ts)와 같은 값. 이 파일은 순수 시각 규칙만 둔다. */
const MAX_SHIFT_MS = 16 * 60 * 60_000;

/**
 * 직원 정정 요청의 희망 시각 검사(2026-11-11). 현장 근무는 자정을 넘기지 않으므로(가장 늦은 퇴근 23:30) 퇴근을 다음 날로
 * 넘기지 않는다 — 넘기면 「출근 9:00 · 퇴근 8:30」 오타가 23.5시간 근무가 됐다. 비교 기준이 없으면 통과.
 * - `clock_order`: 퇴근이 출근보다 뒤가 아니다(희망 출근, 없으면 세션의 실제 출근 / 희망 퇴근, 없으면 세션의 실제 퇴근).
 * - `too_long`: 16시간을 넘는다.
 */
export function staffCorrectionTimesProblem(input: {
  clockInAt: string | null;
  clockOutAt: string | null;
  sessionClockInAt?: string | null;
  sessionClockOutAt?: string | null;
}): "clock_order" | "too_long" | null {
  const start = input.clockInAt ?? input.sessionClockInAt ?? null;
  const end = input.clockOutAt ?? input.sessionClockOutAt ?? null;
  if (!start || !end) return null;
  const diff = new Date(end).getTime() - new Date(start).getTime();
  if (!(diff > 0)) return "clock_order";
  if (diff > MAX_SHIFT_MS) return "too_long";
  return null;
}
