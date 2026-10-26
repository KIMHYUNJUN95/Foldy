export type RequestDatePreset = "all" | "today" | "7d" | "30d";

export type RequestDateRangeFilter = {
  endDate?: string;
  startDate?: string;
};

export type RequestDatePresetFilter = {
  datePreset?: RequestDatePreset;
};

export type RequestDateFilter = RequestDateRangeFilter & RequestDatePresetFilter;

const PRESET_VALUES = new Set<RequestDatePreset>(["all", "today", "7d", "30d"]);

function isIsoDate(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// ── 도쿄 운영 날짜 (docs/product/07-cleaning-workflow.md 참고) ──────────
// 이 필터들은 서버(모바일 요청 페이지 + admin 주문 내보내기)에서 실행되므로
// 호스트 로컬 날짜 계산은 UTC 러너에서 9시간 어긋난다. 그래서 날짜 경계는
// Asia/Tokyo `YYYY-MM-DD` 키로 도출한다 — `tokyoToday()` 와 같은 패턴이며,
// src/lib/tasks.ts 및 requests-filter-view.tsx 의 오늘/어제 묶음과 같다 — 맨 마지막에만
// 고정 +09:00 오프셋으로 시점으로 변환한다(일본은 서머타임이 없음).
const TOKYO_TIME_ZONE = "Asia/Tokyo";
const TOKYO_UTC_OFFSET = "+09:00";

const tokyoDateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: TOKYO_TIME_ZONE,
  year: "numeric",
});

/** 시점의 도쿄 달력 날짜(YYYY-MM-DD). */
function tokyoDateKey(date: Date = new Date()) {
  return tokyoDateKeyFormatter.format(date);
}

/** YYYY-MM-DD 키를 문자열 공간에 머무른 채 일 단위로 옮긴다. */
function shiftDateKey(key: string, deltaDays: number) {
  const [year, month, day] = key.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day));
  shifted.setUTCDate(shifted.getUTCDate() + deltaDays);
  return shifted.toISOString().slice(0, 10);
}

/** 주어진 날짜 키의 Asia/Tokyo 00:00 시점(UTC ISO). */
function tokyoDayStartIso(key: string) {
  return new Date(`${key}T00:00:00${TOKYO_UTC_OFFSET}`).toISOString();
}

/** 배타적 상한: `key` 다음 날의 Asia/Tokyo 00:00. */
function tokyoDayEndExclusiveIso(key: string) {
  return tokyoDayStartIso(shiftDateKey(key, 1));
}

export function parseRequestDatePreset(
  value: string | null | undefined,
): RequestDatePreset {
  return PRESET_VALUES.has(value as RequestDatePreset)
    ? (value as RequestDatePreset)
    : "all";
}

export function parseRequestDateRange(params: {
  endDate?: string;
  startDate?: string;
}): RequestDateRangeFilter {
  return {
    endDate: isIsoDate(params.endDate) ? params.endDate : undefined,
    startDate: isIsoDate(params.startDate) ? params.startDate : undefined,
  };
}

export function getTimestampRange(filter: RequestDateFilter): {
  from?: string;
  to?: string;
} {
  if (filter.startDate || filter.endDate) {
    return {
      from: filter.startDate ? tokyoDayStartIso(filter.startDate) : undefined,
      to: filter.endDate ? tokyoDayEndExclusiveIso(filter.endDate) : undefined,
    };
  }

  const today = tokyoDateKey();

  switch (filter.datePreset) {
    case "today":
      return { from: tokyoDayStartIso(today), to: tokyoDayEndExclusiveIso(today) };
    // "7일" / "30일" 은 오늘을 포함한 도쿄 달력 일수 전체를 뜻한다(오늘 - 6 / 오늘 - 29),
    // 오늘/어제 묶음 헤더와 맞추고, 흘러가는 7×24h 창이 아닌 달력 날짜 기준으로 한다.
    case "7d":
      return { from: tokyoDayStartIso(shiftDateKey(today, -6)) };
    case "30d":
      return { from: tokyoDayStartIso(shiftDateKey(today, -29)) };
    case "all":
    default:
      return {};
  }
}
