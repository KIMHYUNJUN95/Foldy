const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10];

/** 막대 차트 축의 맨 위 눈금 — 가장 큰 막대보다 크거나 같은 보기 좋은 값. 단계를 촘촘히 둬 막대가 위쪽에 모자라게 남지 않게 한다. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 10000;
  const base = 10 ** Math.floor(Math.log10(value));
  for (const step of NICE_STEPS) {
    const candidate = Math.round(step * base * 1000) / 1000;
    if (candidate >= value) return candidate;
  }
  return 10 * base;
}

/**
 * 최근 6개월 막대 한 달의 실적 / 예약 확정 나누기. 고른 달과 상관없이 이번 달만 「1일~오늘 실적 + 나머지 예약 확정」으로 쌓고,
 * 이번 달 이전은 통째로 실적, 이후는 통째로 예약 확정이다. 이번 달 실적을 모르면(null) 이번 달은 통째로 예약 확정으로 둔다.
 */
export function splitMonthRevenue(
  monthKey: string,
  revenue: number,
  thisMonth: string,
  thisMonthActual: number | null,
): { actual: number; booked: number } {
  let actual: number;
  if (monthKey < thisMonth) actual = revenue;
  else if (monthKey === thisMonth) actual = Math.min(Math.max(thisMonthActual ?? 0, 0), revenue);
  else actual = 0;
  return { actual, booked: Math.max(0, revenue - actual) };
}
