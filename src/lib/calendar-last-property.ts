// 모바일 예약 캘린더 — 지난번에 본 건물(2026-10-15). 서버(page.tsx)가 읽어 건물 없이 들어오면 바로 그 건물로 보내고,
// 클라이언트(mobile-calendar-view.tsx)가 건물을 고를 때마다 남긴다. 값은 정규화 전 건물 이름(인코딩해서 저장).
export const CALENDAR_LAST_PROPERTY_COOKIE = "foldy_cal_property";

export function writeCalendarLastPropertyCookie(property: string) {
  if (typeof document === "undefined") return;
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${CALENDAR_LAST_PROPERTY_COOKIE}=${encodeURIComponent(property)}; path=/mobile/calendar; max-age=${oneYear}; samesite=lax`;
}
