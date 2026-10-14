import { describe, expect, it } from "vitest";
import { formatPhoneDisplay, phoneHref } from "@/lib/phone-format";

// 2026-10-14 사용자 요청 — 전화번호는 하이픈으로 끊어 보인다.
describe("formatPhoneDisplay", () => {
  it.each([
    ["+33 6 12 34 56 78", "+33-6-12-34-56-78"],
    ["+819058161006", "+81-90-5816-1006"],
    ["+821036367841", "+82-10-3636-7841"],
    ["14155552671", "+1-415-555-2671"],
    ["09012345678", "090-1234-5678"],
    ["+44 7700 900123", "+44-7700-900123"],
  ])("%s → %s", (raw, expected) => {
    expect(formatPhoneDisplay(raw)).toBe(expected);
  });

  it("끊을 수 없는 값은 그대로 돌려준다", () => {
    expect(formatPhoneDisplay("내선 12")).toBe("내선 12");
    expect(formatPhoneDisplay(null)).toBe("");
  });

  it("tel: 링크는 숫자와 + 만", () => {
    expect(phoneHref("+33 6 12-34")).toBe("tel:+3361234");
  });
});
