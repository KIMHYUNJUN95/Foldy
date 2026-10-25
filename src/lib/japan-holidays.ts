/**
 * 일본 공휴일(国民の祝日) 계산 — 표를 손으로 넣지 않고 법 규칙으로 계산한다(알바 급여 지급일, docs/product/39 §3-C).
 *
 * - 2020년 이후 규칙(天皇誕生日 2/23 · スポーツの日). 2020 · 2021 올림픽 특례(海の日 · スポーツの日 · 山の日 이동)를 포함한다.
 * - 춘분 · 추분은 국립천문대 근사식(1980~2099 유효). 실제 날짜는 전해 2월 관보로 확정되지만, 이 범위에서 근사식과 어긋난 해는 없다.
 * - 振替休日: 공휴일이 일요일이면 그 뒤 첫 「공휴일이 아닌 날」. 国民の休日: 두 공휴일 사이에 낀 평일(9월에 생김).
 * - 날짜 키는 `YYYY-MM-DD`(도쿄 달력 날짜 그대로 — 시각 계산 없음).
 */

export type JapanHolidayKey =
  | "newYear"
  | "comingOfAge"
  | "foundation"
  | "emperor"
  | "vernal"
  | "showa"
  | "constitution"
  | "greenery"
  | "children"
  | "marine"
  | "mountain"
  | "respectAged"
  | "autumnal"
  | "sports"
  | "culture"
  | "labor"
  | "substitute"
  | "citizens";

const pad = (n: number) => String(n).padStart(2, "0");
const key = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** 그 달 n번째 월요일의 날짜(1~31). */
function nthMonday(y: number, m: number, n: number): number {
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const firstMonday = 1 + ((8 - firstDow) % 7);
  return firstMonday + (n - 1) * 7;
}

function vernalDay(y: number): number {
  return Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
}

function autumnalDay(y: number): number {
  return Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
}

/** 요일(0=일 … 6=토) — 날짜 키 기준. */
export function dayOfWeek(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 날짜 키에 하루 더하기 · 빼기. */
export function addDaysKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return key(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

const cache = new Map<number, Map<string, JapanHolidayKey>>();

/** 그 해 공휴일 전부(날짜 키 → 이름 키). 2020 이전 · 2099 이후는 빈 표. */
export function japanHolidays(year: number): Map<string, JapanHolidayKey> {
  const hit = cache.get(year);
  if (hit) return hit;
  const out = new Map<string, JapanHolidayKey>();
  if (year < 2020 || year > 2099) {
    cache.set(year, out);
    return out;
  }
  const y = year;
  const base: [number, number, JapanHolidayKey][] = [
    [1, 1, "newYear"],
    [1, nthMonday(y, 1, 2), "comingOfAge"],
    [2, 11, "foundation"],
    [2, 23, "emperor"],
    [3, vernalDay(y), "vernal"],
    [4, 29, "showa"],
    [5, 3, "constitution"],
    [5, 4, "greenery"],
    [5, 5, "children"],
    [9, nthMonday(y, 9, 3), "respectAged"],
    [9, autumnalDay(y), "autumnal"],
    [11, 3, "culture"],
    [11, 23, "labor"],
  ];
  // 올림픽 특례(2020 · 2021) — 海の日 · スポーツの日 · 山の日 이 옮겨졌다.
  if (y === 2020) {
    base.push([7, 23, "marine"], [7, 24, "sports"], [8, 10, "mountain"]);
  } else if (y === 2021) {
    base.push([7, 22, "marine"], [7, 23, "sports"], [8, 8, "mountain"]);
  } else {
    base.push([7, nthMonday(y, 7, 3), "marine"], [8, 11, "mountain"], [10, nthMonday(y, 10, 2), "sports"]);
  }
  for (const [m, d, name] of base) out.set(key(y, m, d), name);

  // 国民の休日 — 앞뒤가 공휴일인 평일(일요일이 아닌 날). 振替休日보다 먼저 본다(법 3조 3항은 「祝日」 사이만 센다).
  for (const k of [...out.keys()]) {
    const twoAfter = addDaysKey(k, 2);
    const between = addDaysKey(k, 1);
    if (out.has(twoAfter) && !out.has(between) && dayOfWeek(between) !== 0) {
      out.set(between, "citizens");
    }
  }

  // 振替休日 — 일요일인 공휴일 다음의 첫 「공휴일이 아닌 날」.
  for (const k of [...out.keys()].sort()) {
    if (dayOfWeek(k) !== 0 || out.get(k) === "substitute") continue;
    let next = addDaysKey(k, 1);
    while (out.has(next)) next = addDaysKey(next, 1);
    if (next.startsWith(String(y))) out.set(next, "substitute");
  }

  cache.set(year, out);
  return out;
}

/** 이 날이 일본 공휴일이면 이름 키, 아니면 null. */
export function japanHolidayOf(dateKey: string): JapanHolidayKey | null {
  const year = Number(dateKey.slice(0, 4));
  return japanHolidays(year).get(dateKey) ?? null;
}
