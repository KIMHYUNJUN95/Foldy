import { describe, expect, it } from "vitest";

import { platformName, starsLabel } from "@/components/complaints/cx-platform";
import { getDictionary, locales } from "@/lib/i18n";

const NEW_KEYS = ["submitPending", "starsOne", "starsMany", "pickerSearchPh", "pickerSearchPhPc", "pickerBack"] as const;

describe("컴플레인 등록 화면 카피", () => {
  it.each(locales)("%s — 새 키가 모두 있다", (locale) => {
    const t = getDictionary(locale).complaints;
    for (const key of NEW_KEYS) expect(t[key], key).toBeTruthy();
  });

  it("별 라벨은 {n} 자리에 숫자를 넣고 영어는 1일 때만 단수", () => {
    const en = getDictionary("en").complaints;
    expect(starsLabel(1, en)).toBe("1 star");
    expect(starsLabel(4, en)).toBe("4 stars");
    expect(starsLabel(3, getDictionary("ko").complaints)).toBe("별 3개");
    expect(starsLabel(2, getDictionary("ja").complaints)).toBe("星2");
  });

  it("플랫폼 «other» 는 언어별로 번역된다", () => {
    expect(platformName("other", getDictionary("ko"))).toBe("기타");
    expect(platformName("other", getDictionary("ja"))).toBe("その他");
    expect(platformName("other", getDictionary("en"))).toBe("Other");
    expect(platformName("airbnb", getDictionary("ko"))).toBe("Airbnb");
  });

  it.each(locales)("%s — 짧은 힌트 · 자리표시자 끝에 마침표가 없다", (locale) => {
    const t = getDictionary(locale).complaints;
    for (const key of ["ratingNone", "fieldBodyPlaceholder", "fieldGuestPlaceholder", "pickerSearchPh", "pickerSearchPhPc"] as const) {
      expect(t[key], key).not.toMatch(/[.。]$/);
    }
  });
});
