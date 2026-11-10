import { describe, expect, it } from "vitest";
import { isOrderItemTextWithinLimits, normalizeOrderQuantity, ORDER_ITEM_LIMITS } from "@/lib/order-item-rules";

describe("주문 품목 수량 — 0보다 크고 9999 이하인 숫자(소수 허용)", () => {
  it.each([
    ["1", "1"],
    [" 3 ", "3"],
    ["007", "7"],
    ["9999", "9999"],
    ["1.5", "1.5"],
    ["1.50", "1.5"],
    ["0.5", "0.5"],
    [".5", "0.5"],
    ["5.", "5"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeOrderQuantity(raw)).toBe(expected);
  });

  it.each(["", "0", "0.0", "-1", "1e3", "0x10", "abc", ".", "10000", "9999.5", null, undefined])("%s 는 거절", (raw) => {
    expect(normalizeOrderQuantity(raw)).toBeNull();
  });
});

describe("주문 품목 글자 길이", () => {
  it("상한 안이면 통과, 넘으면 거절", () => {
    expect(isOrderItemTextWithinLimits({ link: "", memo: "", name: "타월" })).toBe(true);
    expect(isOrderItemTextWithinLimits({ link: "", memo: "", name: "가".repeat(ORDER_ITEM_LIMITS.nameMax + 1) })).toBe(false);
    expect(isOrderItemTextWithinLimits({ link: "x".repeat(ORDER_ITEM_LIMITS.linkMax + 1), memo: "", name: "a" })).toBe(false);
  });
});

describe("품목 수 한도 — 한 곳(서버 · PC 수정 창 · 모바일 등록 폼 · 「n / 최대」 글)", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (path: string) => readFileSync(path, "utf8");

  it("한도는 화면과 같은 40", () => {
    expect(ORDER_ITEM_LIMITS.maxItems).toBe(40);
  });

  it.each([
    "src/components/admin/orders/orders-action-modal.tsx",
    "src/components/requests/order-create-form.tsx",
  ])("%s 는 숫자를 직접 쓰지 않고 ORDER_ITEM_LIMITS.maxItems 를 쓴다", (path) => {
    const source = read(path);
    expect(source).toContain("ORDER_ITEM_LIMITS.maxItems");
    expect(source).not.toMatch(/items\.length\s*<\s*\d/);
  });

  it("「n / 최대」 글에 숫자를 박지 않는다(ko · ja · en)", () => {
    const i18n = read("src/lib/i18n.ts");
    expect(i18n).not.toMatch(/(wItemsCount|wPhotosKept): "\{n\} \/ \d/);
    expect(i18n.match(/wItemsCount: "\{n\} \/ \{max\}"/g)).toHaveLength(3);
  });
});
