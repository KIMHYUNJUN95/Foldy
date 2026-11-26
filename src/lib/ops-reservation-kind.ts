import { pendingBeds24InquiryKind } from "@/lib/beds24/reservation-status";

/**
 * 판매 캘린더 막대 한 개의 **표시 종류** (2026-11-26). **순수하다.**
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「예약 표시 — 상태 필터」
 *
 * 우리 표의 `status` 는 Beds24 문의 · 예약 요청도 `confirmed` 로 적는다 — 원본 상태는 `raw_payload.status` 에만 있다
 * (`src/lib/beds24/reservation-status.ts`). 그래서 종류는 **두 값을 같이** 본다. 문의 판정은 그 파일의 값 집합 하나만 쓴다
 * (`pendingBeds24InquiryKind`) — 매출(`isSalesCountedReservation`) · 청소 · 홈과 같은 판정이다.
 */
export type OpsBarKind = "confirmed" | "inquiry" | "request" | "cancelled";

export function opsReservationKind(status: string | null | undefined, rawStatus: unknown): OpsBarKind {
  if (status === "cancelled" || status === "no_show") return "cancelled";
  return pendingBeds24InquiryKind(rawStatus) ?? "confirmed";
}

/**
 * 이 막대가 **방을 차지하는가** — 확정만. 문의 · 요청 · 취소는 빈 방으로 센다(빈방 · 가동률 · 갭 · 옮기기 · 새 예약 겹침).
 * `kind` 가 없는 예전 모양(손님 검색 등)은 `isCancelled` 만 본다.
 */
export function barOccupiesRoom(bar: { isCancelled: boolean; kind?: OpsBarKind }): boolean {
  if (bar.isCancelled) return false;
  return (bar.kind ?? "confirmed") === "confirmed";
}
