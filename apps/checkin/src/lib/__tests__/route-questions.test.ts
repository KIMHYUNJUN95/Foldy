import { describe, expect, it } from "vitest";

import { routeSummary } from "@/components/route-questions";
import en from "@/lib/i18n/en.json";
import ko from "@/lib/i18n/ko.json";

describe("routeSummary", () => {
  it("명부 값을 화면 언어 문구로 바꾼다", () => {
    expect(routeSummary(ko.route, "大阪", "出国")).toBe("어젯밤 오사카 · 다음 일본 떠남");
    expect(routeSummary(en.route, "当日入国", "Bangkok")).toBe("Arrived in Japan today · Next: Bangkok");
    expect(routeSummary(en.route, "", "")).toBe("");
  });
});
