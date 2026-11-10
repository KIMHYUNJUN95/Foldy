// 주문 품목 검사 — 모바일 등록(`createOrderRequest`)과 PC 콘솔 내용 수정(`editOrder`)이 같은 규칙을 쓴다(2026-11-10).
// 예전엔 모바일은 `Number(quantity) > 0` 만 봐서 「1e3」 같은 글이 들어갔고, PC 수정은 수량을 아예 보지 않았다(0 · 「abc」 저장).
// 수량은 「0보다 크고 9999 이하인 숫자」 — 소수도 받는다(예전에 저장된 1.5 같은 값이 내용 수정 때 막히지 않게).
// 순수 모듈 — 서버 · 클라이언트 둘 다 import 해도 된다.

export const ORDER_ITEM_LIMITS = {
  /** 한 요청에 담는 품목 수 — 서버(등록 · 내용 수정) · 모바일 등록 폼 · PC 수정 창 · 「n / 최대」 글이 모두 이 값을 쓴다.
   *  예전 화면 한도(40)와 같게 둔다(2026-11-10 — 서버만 30 이라 31~40개 주문이 저장 때 막혔다). */
  maxItems: 40,
  /** 품목 하나의 수량 상한(0보다 큰 숫자, 소수 허용). */
  maxQuantity: 9999,
  nameMax: 120,
  memoMax: 1000,
  linkMax: 2000,
} as const;

/** 수량 원문 → 정규화한 숫자 문자열(앞 0 · 뒤 0 정리: 「02」 → 「2」, 「1.50」 → 「1.5」). 0보다 크고 maxQuantity 이하인 숫자가
 *  아니면 null. 「1e3」 · 「0x10」 · 음수 · 「abc」 는 받지 않는다(숫자와 소수점만). */
export function normalizeOrderQuantity(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  // 「.5」 · 「5.」 도 받는다 — 예전 모바일 규칙(`Number(q) > 0`)이 받아 저장된 값이 내용 수정 때 막히지 않게.
  if (!/^(\d{1,6}(\.\d{0,6})?|\.\d{1,6})$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0 || value > ORDER_ITEM_LIMITS.maxQuantity) return null;
  return String(value);
}

/** 품목 글자 길이(이미 trim 한 값). */
export function isOrderItemTextWithinLimits(item: { link: string; memo: string; name: string }): boolean {
  return (
    item.name.length <= ORDER_ITEM_LIMITS.nameMax &&
    item.memo.length <= ORDER_ITEM_LIMITS.memoMax &&
    item.link.length <= ORDER_ITEM_LIMITS.linkMax
  );
}
