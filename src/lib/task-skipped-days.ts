import { ymdShift } from "@/lib/tokyo-date";

/** 「건너뛴 날」 구역이 거슬러 올라가는 일수. */
export const SKIPPED_DAYS_WINDOW = 30;
/** 처음 보이는 줄 수 — 나머지는 「더 보기」 뒤에 둔다. */
export const SKIPPED_DAYS_VISIBLE = 5;

/**
 * 최근 `SKIPPED_DAYS_WINDOW` 일(오늘 포함, 도쿄 날짜) 안에서 «건너뜀» 으로 기록된 회차 날짜를 최신순으로 돌려준다.
 * 미래 날짜는 여기 넣지 않는다 — `selectUpcomingSkippedDays` 가 따로 고른다.
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

/**
 * 오늘 뒤(도쿄 날짜)에 미리 «건너뜀» 으로 해 둔 회차 날짜 — 가까운 날부터(2026-10-29).
 * 「건너뛴 날」 구역 위에 「앞으로 건너뛸 날」 묶음으로 따로 보여 줘서, 미리 건너뛴 날도 되살릴 수 있게 한다.
 */
export function selectUpcomingSkippedDays(
  states: Iterable<readonly [date: string, state: string]>,
  today: string,
): string[] {
  const out: string[] = [];
  for (const [date, state] of states) {
    if (state === "skipped" && date > today) out.push(date);
  }
  return out.sort();
}
