import { ymdShift } from "@/lib/tokyo-date";

/** 「건너뛴 날」 구역이 거슬러 올라가는 일수. */
export const SKIPPED_DAYS_WINDOW = 30;
/** 처음 보이는 줄 수 — 나머지는 「더 보기」 뒤에 둔다. */
export const SKIPPED_DAYS_VISIBLE = 5;

/**
 * 최근 `SKIPPED_DAYS_WINDOW` 일(오늘 포함, 도쿄 날짜) 안에서 «건너뜀» 으로 기록된 회차 날짜를 최신순으로 돌려준다.
 * 미래 날짜는 아직 오지 않은 회차라 구역에 올리지 않는다.
 */
export function selectRecentSkippedDays(
  states: Iterable<readonly [date: string, state: string]>,
  today: string,
): string[] {
  const from = ymdShift(today, -SKIPPED_DAYS_WINDOW);
  const out: string[] = [];
  for (const [date, state] of states) {
    if (state === "skipped" && date >= from && date <= today) out.push(date);
  }
  return out.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}
