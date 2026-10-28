/**
 * 순수 반복 날짜 계산 — **서버 import 없음**, 그래서 클라이언트 컴포넌트에서 안전하게 쓸 수 있다
 * (예: `tasks-workspace.tsx` 의 캘린더). 회차 계산은 **여기 하나뿐**이다 — 서버
 * (`@/lib/tasks` · `task-occurrences` · 알림 크론)도 이 파일을 가져다 쓴다(2026-10-28 쌍둥이 정리).
 *
 * Todoist 방식 반복 (2026-06-16): 반복 작업은 살아 있는 행 하나이고, 앞으로의 회차는
 * 행으로 저장하지 않고 캘린더 미리보기용으로 즉석에서(여기서) 계산한다.
 */

import { ymdShift } from "@/lib/tokyo-date";

// 반복 규칙 표의 정본. `@/lib/tasks` 도 여기서 가져다 쓴다 — 예전에는 그쪽에 쌍둥이 표가 있었고,
// 한쪽에만 있는 규칙 때문에 지연된 `yearly` 작업이 닫기/일정 변경 분기에서 **하드 삭제**된 적이 있다.
export const STANDARD_RECURRENCE_RULES = [
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "weekdays",
  "weekends",
] as const;
type StandardRecurrenceRule = (typeof STANDARD_RECURRENCE_RULES)[number];

/* ============================================================
   사용자 지정 요일 반복 (2026-07-29)
   `tasks.recurrence_rule` 텍스트 컬럼에 같이 `custom:<d>,<d>,…` 로 저장되며 각 숫자는
   JS 요일(0=일 … 6=토), 중복 제거 후 오름차순이다 — 예: `custom:1,3,5` = 매주 월·수·금.
   스키마 변경 없음: 컬럼은 이미 자유 형식 텍스트였다.

   이 형식의 파서는 이것 하나뿐이다. 서버 쌍둥이(`@/lib/tasks`)는 다시 구현하지 않고
   여기서 가져다 쓴다. 두 파일의 반복 표가 어긋나는 것이야말로
   위 헤더 경고가 설명하는 실패이기 때문이다.
   ============================================================ */
export const CUSTOM_RECURRENCE_PREFIX = "custom:";

/** 0=일 … 6=토. 관리자와 모바일 요일 피커가 이 순서를 공유해서 둘이 똑같이 읽힌다. */
export const WEEKDAY_ORDER = [0, 1, 2, 3, 4, 5, 6] as const;

/** `locale` 의 요일 하나의 짧은 이름 ("월"/"月"/"Mon"). 1970-01-04 는 일요일이었다. */
export function formatWeekday(weekday: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: locale.startsWith("en") ? "short" : "narrow",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(1970, 0, 4 + weekday)));
}

/** `custom:1,3,5` → `[1,3,5]`. 올바른 형식의 사용자 지정 규칙이 아니면 null 을 반환한다. */
export function parseCustomWeekdays(rule: string | null): number[] | null {
  if (!rule || !rule.startsWith(CUSTOM_RECURRENCE_PREFIX)) return null;
  const body = rule.slice(CUSTOM_RECURRENCE_PREFIX.length);
  if (!body) return null;
  const days: number[] = [];
  for (const part of body.split(",")) {
    if (!/^[0-6]$/.test(part)) return null;
    const day = Number(part);
    if (!days.includes(day)) days.push(day);
  }
  if (!days.length) return null;
  return days.sort((a, b) => a - b);
}

/** `[5,1,3]` → `custom:1,3,5`. 빈/잘못된 집합이면 null (빈 규칙은 절대 저장하지 않는다). */
export function buildCustomRecurrenceRule(weekdays: readonly number[]): string | null {
  const days = [...new Set(weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(
    (a, b) => a - b,
  );
  return days.length ? `${CUSTOM_RECURRENCE_PREFIX}${days.join(",")}` : null;
}

/** 요일 사용자 지정 규칙에만 true (옛 `"custom"` 단독은 해당 없음 — 아래 참고). */
export function isCustomWeekdayRecurrence(rule: string | null): boolean {
  return parseCustomWeekdays(rule) !== null;
}

/**
 * `custom:1,3,5` → "월·수·금" (en: "Mon, Wed, Fri"); 사용자 지정 규칙이 아니면 "".
 *
 * 요일 이름은 제품 문구가 아니라 로케일 데이터이므로, 다른 작업 날짜 렌더링처럼
 * 사전 키가 아니라 `Intl` 을 쓴다. `locale` 은 BCP-47 태그 ("ko", "ja-JP", …).
 * 1970-01-04 가 일요일이었으므로 요일 0 조회의 기준으로 쓴다.
 */
export function formatCustomWeekdays(rule: string | null, locale: string): string {
  const days = parseCustomWeekdays(rule);
  if (!days) return "";
  const names = days.map((day) => formatWeekday(day, locale));
  return locale.startsWith("en") ? names.join(", ") : names.join("·");
}

function formatYmd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shiftMonthlyYmd(ymd: string, months: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = (((targetMonthIndex % 12) + 12) % 12) + 1;
  return formatYmd(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

function shiftYearlyYmd(ymd: string, years: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const targetYear = year + years;
  return formatYmd(targetYear, month, Math.min(day, daysInMonth(targetYear, month)));
}

function isStd(value: string | null): value is StandardRecurrenceRule {
  return !!value && (STANDARD_RECURRENCE_RULES as readonly string[]).includes(value);
}

/**
 * 이 모듈이 규칙의 회차를 계산할 수 있으면 true — 표준 규칙 여섯 개와 사용자 지정
 * 요일 규칙(`custom:1,3,5`). 옛 `"custom"` 단독은 요일 집합이 없으므로 false 로 남아
 * 기존의 표시 전용 동작을 유지한다.
 *
 * 호출자는 이것을 "살아 있는 반복 작업인가?" 게이트로 쓰므로 서버
 * 쌍둥이와 반드시 일치해야 한다. 위 헤더 경고 참고: 거기서는 앞으로 굴러가지만 여기서는 false 를 반환하는 규칙은
 * 닫기/일정 변경 분기에서 하드 삭제된다.
 */
export function isStandardRecurrence(value: string | null): boolean {
  return isStd(value) || isCustomWeekdayRecurrence(value);
}

/**
 * 회차 상태를 읽는 창(일) — 서버 `getOccurrenceStates` 가 이만큼만 읽는다(2026-10-28).
 * 밀린 회차 계산(`outstandingOverdueOccurrences`)도 같은 창으로 자른다. 창이 서로 다르면 창 밖의
 * 완료 기록은 안 읽히는데 회차는 계속 세어져, 오래전에 끝낸 회차가 «밀림»으로 되살아난다.
 */
export const OCCURRENCE_STATE_WINDOW_DAYS = 400;

const WEEKDAY_SETS: Record<"weekdays" | "weekends", readonly number[]> = {
  weekdays: [1, 2, 3, 4, 5],
  weekends: [0, 6],
};

/** 요일 묶음 규칙(평일 · 주말 · 사용자 지정)의 요일 집합. 해당 없으면 null. */
function weekdaySetOf(rule: string): readonly number[] | null {
  if (rule === "weekdays" || rule === "weekends") return WEEKDAY_SETS[rule];
  return parseCustomWeekdays(rule);
}

function weekdayOfYmd(ymd: string): number {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function dayDiff(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

function monthDiff(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/**
 * 반복 작업이 [start, end] (양끝 포함) 안에서 갖는 모든 회차 날짜, 캘린더 미리보기용.
 * `anchor` 이전 날짜는 없다 (과거 미리보기 없음).
 *
 * **n 번째 회차는 항상 앵커에서 바로 계산한다(2026-10-28).** 예전에는 직전 회차에서 한 칸씩
 * 넘어갔는데, 말일이 잘리면 그 잘린 날이 다음 기준이 돼 영영 돌아오지 않았다 — 1/31 → 2/28 →
 * 3/28 → 4/28 …, 2024-02-29 연 반복은 2028 년에도 02-28 이었다. 이제 1/31 → 2/28 → 3/31,
 * 2/29 → 2025~2027 은 2/28 → 2028 은 2/29 다.
 *
 * **요일 묶음 규칙(평일 · 주말 · 사용자 지정)은 규칙에 맞는 날만 낸다(2026-10-28).** 예전에는 앵커
 * 자신을 무조건 첫 회차로 냈다 — 토요일에 만든 「평일마다」가 토요일에도 떴고, 지나면 «밀림» 으로
 * 남았다. 이제 첫 회차는 앵커 이후 처음 맞는 요일이다. 매일 · 매주 · 매월 · 매년은 앵커가 곧 첫 회차다.
 *
 * 앞으로 건너뛰지 않고 해당 n 으로 바로 뛰므로, 아주 오래된 앵커도 정확하다(예전 1500 단계 상한이
 * 4년 넘은 매일 반복에서 회차를 놓쳤다).
 */
export function recurringOccurrencesInRange(
  rule: string | null,
  anchor: string,
  start: string,
  end: string,
): string[] {
  if (rule === null || !isStandardRecurrence(rule)) return [];
  const from = start > anchor ? start : anchor;
  if (from > end) return [];
  const out: string[] = [];

  const weekdays = weekdaySetOf(rule);
  if (weekdays) {
    // 범위 안 날짜를 하루씩 보며 요일만 본다. 호출 범위는 달력 한 달 ~ 창(400일) 정도다.
    for (let cursor = from, guard = 0; cursor <= end && guard < 4000; guard++) {
      if (weekdays.includes(weekdayOfYmd(cursor))) out.push(cursor);
      cursor = ymdShift(cursor, 1);
    }
    return out;
  }

  if (rule === "daily" || rule === "weekly") {
    const step = rule === "daily" ? 1 : 7;
    let n = Math.max(0, Math.ceil(dayDiff(anchor, from) / step));
    for (let guard = 0; guard < 4000; guard++, n++) {
      const date = ymdShift(anchor, n * step);
      if (date > end) break;
      if (date >= from) out.push(date);
    }
    return out;
  }

  // monthly · yearly — 잘림 때문에 n 번째 날짜가 n 의 달 안에서 앞당겨질 수 있으니 한 칸 앞에서 시작한다.
  const monthly = rule === "monthly";
  const span = monthDiff(anchor, from);
  let n = Math.max(0, (monthly ? span : Math.floor(span / 12)) - 1);
  for (let guard = 0; guard < 4000; guard++, n++) {
    const date = monthly ? shiftMonthlyYmd(anchor, n) : shiftYearlyYmd(anchor, n);
    if (date > end) break;
    if (date >= from) out.push(date);
  }
  return out;
}

/**
 * 반복 작업을 `targetDate` 로 옮겨도 되는가 — **이미 그 날짜에 회차가 있으면 false**.
 *
 * 단일 행 모델이라 옮겨도 행이 늘지는 않지만, 사용자 눈에는 "내일에도 이미 있는 그 작업"을 또 내일로
 * 미는 것이라 의미가 없다(2026-07-30 요구). 비반복 작업이나 앵커가 없는 작업은 항상 허용한다.
 *
 * `anchor` 는 그 작업의 현재 회차 날짜다. 앵커 자신과 같은 날짜로 옮기는 것은 애초에 no-op 이라
 * 여기서 막지 않는다(호출부의 메뉴가 반대 방향만 노출한다).
 */
export function canMoveRecurringTo(
  rule: string | null,
  anchor: string | null,
  targetDate: string,
): boolean {
  if (!anchor || !isStandardRecurrence(rule)) return true;
  if (anchor === targetDate) return true;
  return recurringOccurrencesInRange(rule, anchor, targetDate, targetDate).length === 0;
}

/**
 * `occurrenceDate` 가 `anchor` 에서 `rule` 로 생성된 실제 회차일 때만 true.
 *
 * 상세 경로는 날짜를 URL 로 받으므로, 호출자는 이것을 신뢰할 수 없는
 * 후보로 다뤄야 한다. 이 검사를 순수 반복 모듈에 두면 페이지와 서버 액션이
 * 같은 검증 규칙을 쓴다.
 */
export function isRecurringOccurrenceDate(
  rule: string | null,
  anchor: string | null,
  occurrenceDate: string,
): boolean {
  if (!anchor || !/^\d{4}-\d{2}-\d{2}$/.test(occurrenceDate) || !isStandardRecurrence(rule)) {
    return false;
  }
  return recurringOccurrencesInRange(rule, anchor, occurrenceDate, occurrenceDate).length === 1;
}

/* ============================================================
   회차 상태 (2026-07-30, 롤포워드 폐지)
   반복 업무는 완료해도 행이 안 넘어간다(고정 앵커). 각 회차(occurrence_date)의 완료/스킵/이동
   상태는 `task_occurrence_state` 테이블이 정본이고, 클라/서버가 이 순수 헬퍼로 판정한다.
   두 코드 경로(server tasks.ts / client 컴포넌트)가 어긋나면 안 되므로 여기 한 곳에 둔다.
   ============================================================ */
export type OccurrenceState = "completed" | "skipped" | "moved";

/** 상태가 회차를 해결하면 true ("열림"/지연에서 제외). 셋 다 해당한다. */
export function isResolvedOccurrenceState(state: OccurrenceState | undefined): boolean {
  return state === "completed" || state === "skipped" || state === "moved";
}

/**
 * `from`(포함) 이후 첫 회차. 반복이 아니거나 앵커가 없으면 null.
 *
 * **반복 업무의 `dueAt` 은 마감일이 아니라 앵커다** — 「7/30부터 평일마다」의 시작점이라 고정된
 * 채로 과거에 남는다. 이걸 마감일처럼 오늘과 비교하면 반복 업무가 전부 «지연»으로 보인다
 * (2026-08-07 관리함에서 실제로 그랬다). 목록에서 반복 업무에 날짜를 보여줄 거라면 앵커가 아니라
 * **다음 회차**여야 한다.
 *
 * 창을 400일로 끊는다: 「평일」이면 첫 회차가 며칠 안에 나오고, 그보다 성긴 규칙(연 단위)이라도
 * 400일이면 반드시 하나는 걸린다. 무한 루프 대신 명시적 상한을 두는 것이 안전하다.
 */
export function nextRecurringOccurrence(
  rule: string | null,
  anchor: string | null,
  from: string,
): string | null {
  if (!anchor || !isStandardRecurrence(rule)) return null;
  const [occurrence] = recurringOccurrencesInRange(rule, anchor, from, ymdShift(from, 400));
  return occurrence ?? null;
}

/**
 * 반복 작업의 아직 열려 있는 **지연** 회차 날짜: `[anchor, today)` 안의 규칙 회차 중
 * 기록된 상태가 없는 것. `resolvedDates` 는 이 작업에 대해 이미 `task_occurrence_state` 행(완료/건너뜀/이동)을
 * 가진 occurrence_date 문자열 집합이다.
 * 표준이 아닌 규칙이거나 지연이 없으면 비어 있다. 자동 만료되지 않는다 — 날짜는 완료, 건너뜀,
 * 이동될 때까지 남는다 (결정 로그 2026-07-30 참고).
 *
 * 시작은 `today - OCCURRENCE_STATE_WINDOW_DAYS` 로 자른다(2026-10-28) — 서버가 그 창 안의 상태
 * 행만 읽으므로, 창 밖 회차를 세면 끝낸 회차가 «밀림» 으로 되살아난다.
 */
export function outstandingOverdueOccurrences(
  rule: string | null,
  anchor: string | null,
  today: string,
  resolvedDates: ReadonlySet<string>,
): string[] {
  if (!anchor || !isStandardRecurrence(rule)) return [];
  const yesterday = ymdShift(today, -1);
  if (yesterday < anchor) return [];
  const windowStart = ymdShift(today, -OCCURRENCE_STATE_WINDOW_DAYS);
  const start = windowStart > anchor ? windowStart : anchor;
  return recurringOccurrencesInRange(rule, anchor, start, yesterday).filter(
    (d) => !resolvedDates.has(d),
  );
}

/**
 * 완료가 **실제로 정산하는 회차 날짜**(순수 판정, 2026-10-28 갱신).
 *
 * 요청 날짜가 회차면 그대로. 아니면(월·수·금 반복을 화요일에 체크) 그 날짜 **이전의 가장 최근**
 * 미해결 회차로 정산한다 — 그보다 오래된 밀린 회차는 이어지는 흡수 단계가 치운다. 예전에는 가장
 * 오래된 것을 골라, 금·월이 밀린 화요일에 체크하면 금요일만 끝나고 월요일이 «1일 밀림» 으로 남았다.
 * 밀린 것도 없으면 요청 날짜 그대로(호출부의 기존 폴백).
 */
export function pickCompletionOccurrence(
  rule: string | null,
  anchor: string | null,
  requested: string,
  resolvedDates: ReadonlySet<string>,
): string {
  if (isRecurringOccurrenceDate(rule, anchor, requested)) return requested;
  const open = outstandingOverdueOccurrences(rule, anchor, requested, resolvedDates);
  return open[open.length - 1] ?? requested;
}

/**
 * 회차 하나를 완료할 때 함께 흡수할(= `moved` 로 처리할) 밀린 회차 날짜(순수 판정, 2026-10-28).
 *
 * 대상은 `[anchor, min(완료일, 오늘))` 의 미해결 회차다. **오늘(도쿄) 이후는 절대 흡수하지 않는다** —
 * 모바일 「내일」 탭에서 내일 회차를 체크하면 예전에는 아직 열려 있는 오늘 회차까지 «이동» 처리돼
 * 오늘 목록에서 사라졌다. 오늘 몫은 오늘 따로 체크하는 것이다.
 */
export function occurrencesToAbsorb(
  rule: string | null,
  anchor: string | null,
  completedDate: string,
  today: string,
  resolvedDates: ReadonlySet<string>,
): string[] {
  const cap = completedDate < today ? completedDate : today;
  return outstandingOverdueOccurrences(rule, anchor, cap, resolvedDates);
}

/** 그 날짜 회차가 이미 **완료**로 기록돼 있는가 — 두 번 눌러 완료 기록 · 알림이 겹치지 않게 하는 가드. */
export function isOccurrenceCompleted(
  states: ReadonlyMap<string, OccurrenceState>,
  occurrenceDate: string,
): boolean {
  return states.get(occurrenceDate) === "completed";
}
