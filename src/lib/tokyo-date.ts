/**
 * Tokyo 운영 날짜 유틸 — **순수 모듈, 서버 import 없음.**
 *
 * 이 프로젝트의 업무 날짜는 전부 도쿄 달력 기준이다(CLAUDE.md → Tokyo timezone). 그런데 정본이던
 * `@/lib/tasks` 가 supabase/session 을 끌어오는 서버 전용 모듈이라, 클라이언트 컴포넌트가 값으로
 * 가져올 수 없었다. 그래서 같은 함수가 투두 기능 안에서만 **일곱 벌** 재구현돼 있었다:
 * `tasks.ts` · `tasks-recurrence.ts` · `admin/tasks/helpers.ts` · `tasks-workspace.tsx` ·
 * `task-card.tsx` · `task-schedule-sheet.tsx` · `date-time-fields.tsx`.
 *
 * 이 저장소가 반복해서 당한 사고가 정확히 그 «쌍둥이 어긋남»이다(결정 로그 참고). 날짜 계산은
 * 갈라지면 조용히 하루가 어긋나고, 그 하루가 지연·회차·정산 판정을 전부 뒤집는다. 그래서 서버·
 * 클라이언트가 **같은 파일 하나**를 보게 한다.
 *
 * 서버 쪽 호출부는 그대로 두기 위해 `@/lib/tasks` 가 여기서 재수출한다.
 */

const TZ = "Asia/Tokyo";

/** 오늘의 도쿄 운영 날짜(YYYY-MM-DD). 컷오버 시각은 없다 — 순수한 도쿄 달력 날짜다. */
export function tokyoToday(): string {
  return tokyoDateOfDate(new Date());
}

/** `timestamptz` 값이 도쿄 달력으로 몇 일인지(YYYY-MM-DD). null 은 그대로 null. */
export function tokyoDateOf(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return tokyoDateOfDate(d);
}

function tokyoDateOfDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * YYYY-MM-DD 를 `days` 만큼 옮긴다. 달·해 경계를 `Date.UTC` 정규화로 넘긴다.
 *
 * UTC 로 계산하는 것이 맞다 — 입력이 이미 «도쿄 달력 날짜»라는 시간대 없는 값이므로, 로컬 시간대로
 * 파싱하면 실행 환경에 따라 하루가 밀린다.
 */
export function ymdShift(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** YYYY-MM-DD 형식인가. 라우트 파라미터처럼 믿을 수 없는 입력을 거를 때 쓴다. */
export function isYmd(value: string | null | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * YYYY-MM-DD 형식이면서 **달력에 있는 날짜**인가(2026-02-31 · 2026-13-01 은 아니다). `new Date("2026-02-31")` 는 3월 3일로
 * 굴러가서 형식 검사만으로는 못 거른다(2026-11-10 분실물 보관 연장에서 발견).
 */
export function isCalendarYmd(value: string | null | undefined): value is string {
  return isYmd(value) && ymdShift(value, 0) === value;
}

/**
 * 도쿄 달력 날짜를 **`timestamptz` 조회 경계**로 바꾼다 (2026-09-11).
 *
 * 화면의 기간 선택기는 도쿄 날짜(`YYYY-MM-DD`)를 준다. 그런데 DB 의 `reviewed_at` ·
 * `applied_at` 은 `timestamptz` 라서, 그 날짜를 그대로 `T00:00:00Z` 로 붙이면 **UTC 자정**을
 * 기준으로 자른다. 도쿄는 UTC+9 이므로 결과가 9시간 밀린다 —
 *
 * - 시작일의 **오전 0~9시(도쿄)에 들어온 것이 빠지고**,
 * - 종료일 **다음 날 오전 0~9시(도쿄) 것이 섞여 들어온다.**
 *
 * 2026-09-11 실측: 외부 리뷰 2,617건 중 **17.8%** 가 UTC 날짜와 도쿄 날짜가 다르다. 시작일을
 * 2026-09-01 로 잡으면 그날 리뷰 2건이 **둘 다** 빠졌고, 08-24 는 5건 중 3건이 빠졌다.
 * 화면에 뜨는 숫자가 조용히 틀리는 종류라 눈치채기 어렵다.
 *
 * 반열린 구간 `[start, endExclusive)` 로 쓴다. 끝을 `23:59:59` 로 잡는 방식은 그 1초 안의
 * 소수점을 놓치므로 쓰지 않는다.
 */
export function tokyoDayRangeBounds(from: string, to: string): { start: string; endExclusive: string } {
  return {
    start: `${from}T00:00:00+09:00`,
    endExclusive: `${ymdShift(to, 1)}T00:00:00+09:00`,
  };
}

/** 시작 경계만 필요할 때. */
export function tokyoDayStart(dateKey: string): string {
  return `${dateKey}T00:00:00+09:00`;
}

/** 그 날을 **포함**하는 끝 경계(= 다음 날 0시). `lt` 와 함께 쓴다. */
export function tokyoDayEndExclusive(dateKey: string): string {
  return `${ymdShift(dateKey, 1)}T00:00:00+09:00`;
}

/**
 * 지금부터 다음 도쿄 자정까지 남은 밀리초 (2026-11-12 예약 캘린더 점검).
 *
 * 캘린더를 켜 둔 채 자정을 넘기면 「오늘」 표시 · 오늘 체크인 목록이 어제에 머물렀다. 화면은 이 시간 뒤에 오늘 키를 다시 읽는다.
 * 최소 1초 — 자정 바로 그 순간에 0 이 되어 타이머가 연달아 도는 일이 없게.
 */
export function msUntilNextTokyoMidnight(now: Date = new Date()): number {
  const next = Date.parse(tokyoDayEndExclusive(tokyoDateOfDate(now)));
  return Math.max(1000, next - now.getTime());
}
