import { describe, expect, it } from "vitest";
import { formatPhoneDisplay, formatPhoneInput, phoneHref } from "@/lib/phone-format";

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

// 2026-10-16 — 수기 예약 전화 입력칸은 치는 대로 하이픈을 넣는다.
describe("formatPhoneInput", () => {
  it.each([
    ["09012345678", "090-1234-5678"],
    ["0901", "090-1"],
    ["090", "090"],
    ["0312345678", "03-1234-5678"],
    ["+14155550142", "+1-415-555-0142"],
    ["+1 415 555 0142", "+1-415-555-0142"],
    ["+819012345678", "+81-90-1234-5678"],
    ["+", "+"],
  ])("%s → %s", (raw, expected) => {
    expect(formatPhoneInput(raw)).toBe(expected);
  });

  it("끝에 하이픈을 남기지 않는다 — 지우기가 멈추지 않는다", () => {
    for (const raw of ["0", "09", "090", "0901", "+1", "+141", "+1415", "+81"]) {
      expect(formatPhoneInput(raw).endsWith("-")).toBe(false);
    }
  });

  it("국제 번호 외의 숫자 · 글자가 섞인 값은 친 그대로", () => {
    expect(formatPhoneInput("4155550142")).toBe("4155550142");
    expect(formatPhoneInput("내선 12")).toBe("내선 12");
    expect(formatPhoneInput("")).toBe("");
  });
});
