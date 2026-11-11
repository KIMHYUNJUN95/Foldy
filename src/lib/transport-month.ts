// 교통비 정산서가 받는 달 — 화면(`?ym`)과 서버 액션이 같은 규칙을 쓴다(2026-11-11).
// 도쿄 지금 달 기준 3년 전 ~ 다음 달(문서 24 — 다음 달 정기권 등). 그 밖의 달은 지금 달로 돌리거나(화면) 거절한다(서버 `invalid_month`).
import { resolveYmParam } from "@/lib/iso-date-param";

export const TRANSPORT_MONTH_WINDOW = { maxMonthsBack: 36, maxMonthsAhead: 1 } as const;

export function transportMonthAllowed(ym: string, currentYm: string): boolean {
  return resolveYmParam(ym, currentYm, TRANSPORT_MONTH_WINDOW) === ym;
}

export function resolveTransportMonth(ym: string | undefined, currentYm: string): string {
  return resolveYmParam(ym, currentYm, TRANSPORT_MONTH_WINDOW);
}
