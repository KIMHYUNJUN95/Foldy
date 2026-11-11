/** 쿼리스트링 날짜(YYYY-MM-DD)가 달력에 실제로 있는 날인지. 2026-02-30 · 2026-13-01 은 거절. */
export function isRealIsoDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** 기간 쿼리 두 개를 검사한다. 틀린 쪽은 기본값, 시작이 끝보다 늦으면 둘 다 기본값. */
export function resolveDateRangeParams(
  from: string | undefined,
  to: string | undefined,
  fallback: { from: string; to: string },
): { from: string; to: string } {
  const f = isRealIsoDate(from) ? from : fallback.from;
  const t = isRealIsoDate(to) ? to : fallback.to;
  return f > t ? { ...fallback } : { from: f, to: t };
}

/** 쿼리스트링 달(YYYY-MM)이 실제 달(01~12)인지. `2025-00` · `2025-13` 은 거절 — 그 값으로 날짜를 만들면 RangeError 가 난다. */
export function isRealYm(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function monthIndex(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
}

/**
 * `?ym` 검사 — 실제 달이고 지금 달 기준 `maxMonthsBack` 달 전 ~ `maxMonthsAhead` 달 뒤 안일 때만 받는다. 아니면 지금 달.
 * 기본은 앞쪽 제한 없음 · 미래 없음(근태 급여 · 근무 기록).
 */
export function resolveYmParam(
  ym: string | undefined,
  currentYm: string,
  options: { maxMonthsBack?: number; maxMonthsAhead?: number } = {},
): string {
  if (!isRealYm(ym)) return currentYm;
  const diff = monthIndex(ym) - monthIndex(currentYm);
  if (diff > (options.maxMonthsAhead ?? 0)) return currentYm;
  if (options.maxMonthsBack != null && diff < -options.maxMonthsBack) return currentYm;
  return ym;
}

/** `?date` 검사 — 실제 날짜이고 오늘(도쿄 YYYY-MM-DD) ~ `maxDaysBack` 일 전 안일 때만. 아니면 오늘. */
export function resolveDayParam(date: string | undefined, todayYmd: string, maxDaysBack: number): string {
  if (!isRealIsoDate(date) || date > todayYmd) return todayYmd;
  const [y, m, d] = todayYmd.split("-").map(Number);
  const min = new Date(Date.UTC(y, m - 1, d - maxDaysBack)).toISOString().slice(0, 10);
  return date >= min ? date : todayYmd;
}
