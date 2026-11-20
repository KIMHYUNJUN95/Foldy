import { describe, expect, it } from "vitest";
import { buildGuestSearchPlan, matchesDigits, matchesGuestName } from "@/lib/guest-search";
import { GUEST_NAME_CASES } from "@/lib/__tests__/guest-name-cases";

/**
 * 어드민 상단 예약 검색 — 이름 · 번호 매칭.
 *
 * 계약: `src/lib/guest-search.ts` (2026-09-30 사용자 요청: 띄어쓰기 · 성 순서 무관)
 */
describe("matchesGuestName", () => {
  it("대소문자 · 띄어쓰기를 무시한다", () => {
    expect(matchesGuestName("kimminsu", "Kim Minsu")).toBe(true);
    expect(matchesGuestName("KIM MIN SU", "Kim Minsu")).toBe(true);
  });

  it("성 순서가 바뀌어도 찾는다 — 띄어 써도, 붙여 써도", () => {
    expect(matchesGuestName("minsu kim", "Kim Minsu")).toBe(true);
    expect(matchesGuestName("minsukim", "Kim Minsu")).toBe(true);
    expect(matchesGuestName("김민수", "민수 김")).toBe(true);
    expect(matchesGuestName("민수김", "김 민수")).toBe(true);
    expect(matchesGuestName("roger tan", "Tan Roger")).toBe(true);
  });

  it("이름 일부로도 찾는다", () => {
    expect(matchesGuestName("anna", "Anna Paczkowska")).toBe(true);
    expect(matchesGuestName("paczk", "Anna Paczkowska")).toBe(true);
  });

  it("악센트 · 전각을 무시한다", () => {
    expect(matchesGuestName("jose", "José García")).toBe(true);
    expect(matchesGuestName("ＳＯＬ　ＬＥＥ", "SOL LEE")).toBe(true);
  });

  it("다른 사람은 걸리지 않는다", () => {
    expect(matchesGuestName("kim minsu", "Kim Minji")).toBe(false);
    expect(matchesGuestName("minsukim", "Minsu Park")).toBe(false);
  });
});

describe("matchesDigits", () => {
  it("하이픈 · 공백 · 국가번호를 무시한다", () => {
    expect(matchesDigits("09012345678", "+81 90-1234-5678")).toBe(true);
    expect(matchesDigits("1234-5678", "+81 90 1234 5678")).toBe(true);
    expect(matchesDigits("5678", "090-1234-5678")).toBe(true);
  });

  it("짧거나 다른 번호는 걸리지 않는다", () => {
    expect(matchesDigits("123", "090-1234-5678")).toBe(false);
    expect(matchesDigits("09099998888", "090-1234-5678")).toBe(false);
  });
});

describe("buildGuestSearchPlan", () => {
  it("DB 거름 조각은 최종 판정이 맞는 이름을 떨어뜨리지 않는다", () => {
    const cases: [string, string][] = [
      ["minsukim", "Kim Minsu"],
      ["민수김", "김 민수"],
      ["김민수", "민수 김"],
      ["roger tan", "Tan Roger"],
    ];
    for (const [query, name] of cases) {
      const plan = buildGuestSearchPlan(query);
      const lower = name.toLowerCase();
      for (const fragment of plan?.nameFragments ?? []) expect(lower).toContain(fragment);
    }
  });

  it("번호 · 예약번호를 알아본다", () => {
    // 보조 평면 한 글자(UTF-16 으로는 2)는 한 글자로 센다 — DB(char_length)와 같게 이름으로 찾지 않는다.
    expect(buildGuestSearchPlan("𠮷")?.nameFragments).toEqual([]);
    expect(buildGuestSearchPlan("𠮷田")?.nameFragments.length).toBeGreaterThan(0);
    expect(buildGuestSearchPlan("090-1234-5678")?.digits).toBe("09012345678");
    expect(buildGuestSearchPlan("HMABC12345")?.reference).toBe("HMABC12345");
    expect(buildGuestSearchPlan("kim minsu")?.reference).toBeNull();
  });
});

describe("이름 사례표 — DB 판정과 같은 표(guest-name-cases.ts)", () => {
  it.each(GUEST_NAME_CASES.map((c) => [c.label, c] as const))("%s", (_label, c) => {
    expect(matchesGuestName(c.query, c.name)).toBe(c.expected);
  });
});
