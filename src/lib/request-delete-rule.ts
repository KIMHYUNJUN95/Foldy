/**
 * 요청 기록(주문 · 수리 · 분실물) 삭제 규칙 — 화면과 서버가 같은 판정을 쓴다(2026-11-10).
 * docs/product/10-order-request-workflow.md → 「Status constraint」.
 *
 * - `request.delete_any` 권한: 어떤 상태든 가능.
 * - 작성자 본인: 주문은 `ordered` · `received`(이미 외부 발주 나감)를 뺀 상태만. 수리 · 분실물은 상태 제약 없음.
 */
/** PC 콘솔 패널이 휴지통을 보일지 정할 때 페이지가 넘기는 값(본인 id · 남의 것 삭제 권한). */
export type RequestDeleteAccess = { canDeleteAny: boolean; userId: string };

export const OWNER_LOCKED_ORDER_STATUSES: readonly string[] = ["ordered", "received"];

export function canDeleteRequestRecord(input: {
  canDeleteAny: boolean;
  isOwner: boolean;
  /** 주문일 때만 넘긴다. */
  orderStatus?: string;
}): boolean {
  if (input.canDeleteAny) return true;
  if (!input.isOwner) return false;
  if (input.orderStatus !== undefined && OWNER_LOCKED_ORDER_STATUSES.includes(input.orderStatus)) return false;
  return true;
}
