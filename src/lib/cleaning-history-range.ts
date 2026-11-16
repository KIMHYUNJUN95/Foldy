const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function isRealDay(key: string): boolean {
  if (!DAY_KEY.test(key)) return false;
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * 관리자 청소 기록의 첫 기간. 기본은 「이번 달 1일 – 오늘」(운영일, 도쿄) — 오늘 이후는 기록이 있을 수 없어
 * 요약이 어색했다(2026-11-16). 링크로 `from` · `to` 를 주면 둘이 실제 날짜이고 from ≤ to 일 때 그대로 쓴다.
 */
export function resolveHistoryRange(
  operatingToday: string,
  from?: string | null,
  to?: string | null,
): { from: string; to: string } {
  if (from && to && isRealDay(from) && isRealDay(to) && from <= to) return { from, to };
  return { from: `${operatingToday.slice(0, 7)}-01`, to: operatingToday };
}
