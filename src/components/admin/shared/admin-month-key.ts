import { tokyoToday } from "@/lib/tokyo-date";

/**
 * 달 키(`YYYY-MM`) 산술 — 공용 날짜 피커 세 형제가 **같은 구현을 쓴다** (2026-09-11).
 *
 * ## 왜 한곳에 모았나
 *
 * 같은 계산이 두 벌 있었고 **한쪽만 틀려 있었다.** `AdminMonthPicker` 는 정수 산술로 맞게 했는데,
 * `AdminDateRangePicker` 는 `Date` 로 했다가 달을 건너뛰거나 제자리에 머물렀다. 화면마다 달력
 * 동작이 달라지는 종류의 버그라, CLAUDE.md §4a 의 「달력은 셋뿐, 예외 없음」 계약에도 어긋난다.
 *
 * ## 왜 `Date` 로 하면 안 되나
 *
 * 이 콘솔의 날짜 키는 전부 **도쿄 기준**이다. 도쿄 1일 00시는 UTC 로 **전달 말일 15시**라서,
 * `new Date("2026-03-01T00:00:00+09:00")` 가 들고 있는 UTC 날짜는 2월 **28일**이다. 거기에
 * `setUTCMonth(+1)` 을 하면 「2월 31일」이 되고 JS 가 3월로 굴려버린다 — 한 달을 더했는데
 * 제자리다.
 *
 *     (버그 당시 실측) 3월 next → 3월, 5월 next → 5월, 7월 next → 7월, 10·12월 next → 제자리
 *                      3월 prev → 1월, 4월 prev → 3월 … 한 달씩 건너뜀
 *
 * 달은 길이가 제각각이라 「날짜를 가진 시각」에 달을 더하는 연산은 애초에 성립하지 않는다.
 * 년·월을 숫자로 풀어 더하면 그런 함정이 없다.
 */

/** `YYYY-MM` 에 `delta` 달을 더한다. 연도 넘김을 포함해 항상 정확히 한 달씩 움직인다. */
export function shiftMonthKey(monthKey: string, delta: number): string {
  // 잘못된 입력(빈 값 · NaN · 1~12 밖의 달)은 NaN-NaN 을 퍼뜨리지 않고 «이번 달(도쿄)» 에서 이어 간다(2026-10-26).
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey ?? ""));
  const base = match && Number(match[2]) >= 1 && Number(match[2]) <= 12 ? match[0] : tokyoToday().slice(0, 7);
  const [year, month] = base.split("-").map(Number);
  const total = year * 12 + (month - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}
