import { addDays, todayTokyo } from "../tokyo-date";

// 개인 링크(`/r/<토큰>`) 기간 · 체크인 뒤 가리기(2026-11-13 보안 점검). DB 없음 — 테스트로 덮는다.

/** 체크아웃 날짜 다음 날(도쿄)까지만 열린다. 칸을 따로 두지 않고 stay 의 체크아웃 날짜로 판단한다. */
export function guestLinkOpen(checkOutDate: string, now: Date): boolean {
  return todayTokyo(now) <= addDays(checkOutDate, 1);
}

/** 직원 화면과 같은 규칙(`18AB•••••42`) — 체크인 뒤 손님 링크에는 이 값만 나간다. */
export function maskPassportNumber(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 6) return "•".repeat(value.length);
  return `${value.slice(0, 4)}${"•".repeat(value.length - 6)}${value.slice(-2)}`;
}
