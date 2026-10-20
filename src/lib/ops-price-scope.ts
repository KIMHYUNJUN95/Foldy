/**
 * 가격 수정 범위 — **순수 모듈**(2026-10-20 사용자 요청 「Beds24 처럼 가격 수정 때 날짜 · 객실을 바꿀 수 있게」).
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md 「가격 수정 범위 — 기간 · 요일 · 객실」
 *
 * 격자에서 고른 칸이 처음 범위다. 패널에서 **기간 · 요일 · 객실**을 고치면 그 셋을 곱한 칸(객실 × 날짜)이 새 대상이 된다 —
 * 격자에 안 보이는 날짜도 된다. 날짜는 도쿄 달력 날짜(`YYYY-MM-DD`) 문자열로만 다룬다(`ymdShift`).
 */
import { ymdShift } from "@/lib/tokyo-date";

/** 0 = 일요일 … 6 = 토요일(JS `getUTCDay` 와 같은 번호). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const ALL_WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

export type PriceScope = {
  from: string;
  to: string;
  /** 고른 요일. 7개 전부면 거르지 않는다. */
  weekdays: readonly Weekday[];
  /** 격자 행 키(`건물::객실`). 순서는 격자 순서를 따른다(`expandPriceScope` 가 `rooms` 순서로 돈다). */
  roomKeys: readonly string[];
};

/**
 * 고를 수 있는 날짜 — **오늘 ~ 1년 뒤**. 지난 날은 팔 수 없고, 요금은 「어제부터 12개월」만 받아 둔다
 * (`room-rates-sync.ts`) — 그 너머는 기준가가 없어 어차피 빠진다.
 */
export function priceScopeBounds(today: string): { min: string; max: string } {
  return { max: ymdShift(today, 365), min: today };
}

/** 이 범위의 하루 상한 — 1년. 그 이상은 위 경계로 이미 막힌다. */
export const MAX_SCOPE_DAYS = 366;

export function weekdayOf(date: string): Weekday {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() as Weekday;
}

/** `from` ~ `to`(둘 다 포함)의 날짜. 거꾸로면 빈 목록, 너무 길면 `MAX_SCOPE_DAYS` 에서 끊는다. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let date = from; date <= to && out.length < MAX_SCOPE_DAYS; date = ymdShift(date, 1)) out.push(date);
  return out;
}

/**
 * 격자에서 고른 칸 → 처음 범위. 기간은 처음 ~ 끝 날짜, 요일은 전부, 객실은 고른 객실.
 *
 * 격자 선택은 듬성듬성할 수 있다(Ctrl 로 날짜 두 개만 고름 등). 처음 범위를 그 모양 그대로 옮길 수는 없으므로 **고치기 전까지는
 * 고른 칸을 그대로 쓰고**(`usePriceScope` 의 `edited`), 기간 · 요일 · 객실 중 하나를 고치는 순간부터 이 범위로 펼친다.
 */
export function scopeFromCells(cells: ReadonlyArray<{ roomKey: string; date: string }>): PriceScope | null {
  if (cells.length === 0) return null;
  let from = cells[0].date;
  let to = cells[0].date;
  const roomKeys: string[] = [];
  const seen = new Set<string>();
  for (const cell of cells) {
    if (cell.date < from) from = cell.date;
    if (cell.date > to) to = cell.date;
    if (!seen.has(cell.roomKey)) {
      seen.add(cell.roomKey);
      roomKeys.push(cell.roomKey);
    }
  }
  return { from, roomKeys, to, weekdays: ALL_WEEKDAYS };
}

/**
 * 범위 → 칸(객실 × 날짜). 객실은 `rooms` 순서(= 격자 순서), 날짜는 오름차순. 고른 요일만, 경계(`bounds`) 안만.
 * `rooms` 에 없는 객실 키는 버린다(필터로 사라진 행).
 */
export function expandPriceScope(
  scope: PriceScope,
  rooms: ReadonlyArray<{ key: string }>,
  bounds: { min: string; max: string },
): { roomKey: string; date: string }[] {
  const from = scope.from < bounds.min ? bounds.min : scope.from;
  const to = scope.to > bounds.max ? bounds.max : scope.to;
  const weekdays = new Set(scope.weekdays);
  const dates = datesBetween(from, to).filter((date) => weekdays.has(weekdayOf(date)));
  const wanted = new Set(scope.roomKeys);
  const cells: { roomKey: string; date: string }[] = [];
  for (const room of rooms) {
    if (!wanted.has(room.key)) continue;
    for (const date of dates) cells.push({ date, roomKey: room.key });
  }
  return cells;
}

/** 요일 하나를 켜고 끈다. 마지막 하나는 끄지 않는다 — 요일이 비면 대상이 0칸이 되어 아무것도 못 한다. */
export function toggleWeekday(weekdays: readonly Weekday[], day: Weekday): Weekday[] {
  const on = weekdays.includes(day);
  if (on && weekdays.length === 1) return [...weekdays];
  const next = on ? weekdays.filter((value) => value !== day) : [...weekdays, day];
  return ALL_WEEKDAYS.filter((value) => next.includes(value));
}
