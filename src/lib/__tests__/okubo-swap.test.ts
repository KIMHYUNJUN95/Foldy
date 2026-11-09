import { describe, expect, it } from "vitest";
import { getCanonicalPropertyName } from "@/lib/room-label-normalization";
import { getPropertyMapMeta } from "@/lib/property-map-links";
import { PROPERTY_LOCATIONS } from "@/lib/property-locations";
import { defaultSalesExcluded } from "@/lib/ops-sales-summary";
import { dictionaries } from "@/lib/i18n";

// 2026-11-09 Beds24 에서 오쿠보A · B 이름을 맞바꿨다. 분류는 okubo 바로 뒤 글자만 본다.
describe("오쿠보A · B 이름 분류 — okubo 뒤 글자만 본다", () => {
  const cases: Array<[string, string]> = [
    ["Okubo_A (B棟)", "오쿠보A"],
    ["Okubo_B (A棟)", "오쿠보B"],
    ["Okubo_A (A棟)", "오쿠보A"],
    ["Okubo_B (B棟)", "오쿠보B"],
    ["오쿠보A", "오쿠보A"],
    ["오쿠보B", "오쿠보B"],
    ["大久保A", "오쿠보A"],
    ["大久保B", "오쿠보B"],
    ["Okubo A", "오쿠보A"],
    ["OkuboB", "오쿠보B"],
    ["Okubo_C (kr)", "오쿠보C"],
    ["OkuboCC", "오쿠보C"],
    ["大久保B（A棟）", "오쿠보B"],
  ];
  it.each(cases)("%s -> %s", (raw, expected) => {
    expect(getCanonicalPropertyName(raw)).toBe(expected);
  });
});

describe("okubo 로 시작하는 다른 이름은 A 가 아니다", () => {
  it("Okubo Apartment", () => {
    expect(getCanonicalPropertyName("Okubo Apartment")).toBe("Okubo Apartment");
  });
});

describe("건물 출입 정보는 실제 집을 따라간다", () => {
  const keyBox = (name: string) =>
    getPropertyMapMeta(name)?.sharedAccess.find((item) => item.labelKey === "keyBoxPassword")?.code;
  it("오쿠보A = 5757, 오쿠보B = 0072", () => {
    expect(keyBox("오쿠보A")).toBe("5757");
    expect(keyBox("오쿠보B")).toBe("0072");
  });
  it("1-5-19 주소는 오쿠보B, 오쿠보A 는 오쿠보B 와 같은 위치", () => {
    expect(getPropertyMapMeta("오쿠보B")?.address.en).toContain("1 Chome-5-19 Okubo");
    expect(getPropertyMapMeta("오쿠보A")?.address.ko).toContain("오쿠보B와 동일한 위치");
    expect(getPropertyMapMeta("오쿠보A")?.address.ja).toContain("オクボB");
    expect(getPropertyMapMeta("오쿠보A")?.address.en).toContain("Okubo B");
  });
  it("지도 좌표도 맞바꿨다 (1-5-19 집 = 오쿠보B)", () => {
    expect(PROPERTY_LOCATIONS["오쿠보B"].lng).toBe(139.706157);
    expect(PROPERTY_LOCATIONS["오쿠보A"].lng).toBe(139.70603);
    expect(PROPERTY_LOCATIONS["오쿠보A"].adjoin).toBe(PROPERTY_LOCATIONS["오쿠보B"].adjoin);
  });
});

describe("합계 기본 제외 건물", () => {
  it("오쿠보B + 사노 (같은 실제 집)", () => {
    expect(defaultSalesExcluded(["아라키초A", "오쿠보A", "오쿠보B", "Sano"])).toEqual(["오쿠보B", "Sano"]);
  });
});

describe("청소 명단 제목에는 동 표시가 없다", () => {
  it("ko · en · ja", () => {
    expect(dictionaries.ko.automationMessages.buildings.cleaning).toMatchObject({ okubo_a: "오쿠보A", okubo_b: "오쿠보B", okubo_c: "오쿠보C" });
    expect(dictionaries.en.automationMessages.buildings.cleaning).toMatchObject({ okubo_a: "Okubo A", okubo_b: "Okubo B", okubo_c: "Okubo C" });
    expect(dictionaries.ja.automationMessages.buildings.cleaning).toMatchObject({ okubo_a: "大久保A", okubo_b: "大久保B", okubo_c: "大久保C" });
  });
});
