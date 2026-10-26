/**
 * 순수 반복 날짜 계산 — **서버 import 없음**, 그래서 클라이언트 컴포넌트에서 안전하게 쓸 수 있다
 * (예: `tasks-workspace.tsx` 의 캘린더). TaskRecord 에 묶인 반복 헬퍼(롤오버,
 * 다음/이전 인스턴스)는 server-only 모듈을 끌어오는 `@/lib/tasks` 에 있다.
 *
 * Todoist 방식 반복 (2026-06-16): 반복 작업은 살아 있는 행 하나이고, 앞으로의 회차는
 * 행으로 저장하지 않고 캘린더 미리보기용으로 즉석에서(여기서) 계산한다.
 */

import { ymdShift } from "@/lib/tokyo-date";

// 반드시 `@/lib/tasks` 의 `STANDARD_RECURRENCE_RULES` (서버 전용 쌍둥이)와 동기화해야 한다.
// 한쪽에만 있는 규칙은 두 코드 경로를 조용히 어긋나게 한다 — 예: 지연된
// `yearly` 작업은 tasks.ts 로는 앞으로 굴러가지만 이 파일의 `isStandardRecurrence` 로 거르는
// 닫기/일정 변경 분기에서는 **하드 삭제**된다.
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

/** `fromDate` 이후 엄격히 다음 날짜 중 요일이 `weekdays` 에 속하는 것. */
function nextWeekdayOccurrence(weekdays: readonly number[], fromDate: string, step: 1 | -1): string {
  let cursor = ymdShift(fromDate, step);
  for (let guard = 0; guard < 7; guard++) {
    const [year, month, day] = cursor.split("-").map(Number);
    if (weekdays.includes(new Date(Date.UTC(year, month - 1, day)).getUTCDay())) return cursor;
    cursor = ymdShift(cursor, step);
  }
  return cursor; // 비어 있지 않은 집합에서는 도달 불가; 반환 타입을 완전하게 유지한다
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

function nextOccurrence(rule: string, fromDate: string): string {
  const customDays = parseCustomWeekdays(rule);
  if (customDays) return nextWeekdayOccurrence(customDays, fromDate, 1);
  if (rule === "daily") return ymdShift(fromDate, 1);
  if (rule === "weekly") return ymdShift(fromDate, 7);
  if (rule === "monthly") return shiftMonthlyYmd(fromDate, 1);
  if (rule === "yearly") return shiftYearlyYmd(fromDate, 1);

  let cursor = ymdShift(fromDate, 1);
  while (true) {
    const [year, month, day] = cursor.split("-").map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const matches =
      rule === "weekdays" ? weekday >= 1 && weekday <= 5 : weekday === 0 || weekday === 6;
    if (matches) return cursor;
    cursor = ymdShift(cursor, 1);
  }
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
 * 반복 작업이 [start, end] (양끝 포함) 안에서 갖는 모든 회차 날짜, 캘린더 미리보기용.
 * `anchor` 부터 앞으로 생성하고, `start` 이전 날짜는 건너뛴다 (과거 미리보기 없음).
 */
export function recurringOccurrencesInRange(
  rule: string | null,
  anchor: string,
  start: string,
  end: string,
): string[] {
  if (!isStandardRecurrence(rule) || rule === null) return [];
  const out: string[] = [];
  let cursor = anchor;
  let guard = 0;
  while (cursor < start && guard++ < 1500) cursor = nextOccurrence(rule, cursor);
  while (cursor <= end && guard++ < 3000) {
    if (cursor >= start) out.push(cursor);
    cursor = nextOccurrence(rule, cursor);
  }
  return out;
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
 * 반복 작업의 아직 열려 있는 **지연** 회차 날짜: `[anchor, today)` 안의 규칙 회차 중
 * 기록된 상태가 없는 것. `resolvedDates` 는 이 작업에 대해 이미 `task_occurrence_state` 행(완료/건너뜀/이동)을
 * 가진 occurrence_date 문자열 집합이다.
 * 표준이 아닌 규칙이거나 지연이 없으면 비어 있다. 자동 만료되지 않는다 — 날짜는 완료, 건너뜀,
 * 이동될 때까지 남는다 (결정 로그 2026-07-30 참고).
 */
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

export function outstandingOverdueOccurrences(
  rule: string | null,
  anchor: string | null,
  today: string,
  resolvedDates: ReadonlySet<string>,
): string[] {
  if (!anchor || !isStandardRecurrence(rule)) return [];
  const yesterday = ymdShift(today, -1);
  if (yesterday < anchor) return [];
  return recurringOccurrencesInRange(rule, anchor, anchor, yesterday).filter(
    (d) => !resolvedDates.has(d),
  );
}
