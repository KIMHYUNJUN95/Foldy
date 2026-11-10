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
