import { describe, expect, it } from "vitest";
import { FALLBACK_COPY, resolveFallbackLocale } from "@/lib/fallback-copy";
import { getDictionary, type Locale } from "@/lib/i18n";
import { pickRequestLocale } from "@/lib/request-locale";

describe("fallback-copy ↔ dictionary.appShell", () => {
  for (const locale of ["ko", "ja", "en"] as Locale[]) {
    it(`${locale}: 오류 화면 문구가 사전과 같다`, () => {
      const shell = getDictionary(locale).appShell;
      const copy = FALLBACK_COPY[locale];
      expect(copy.errorTitle).toBe(shell.errorTitle);
      expect(copy.errorBody).toBe(shell.errorBody);
      expect(copy.retry).toBe(shell.errorRetry);
      expect(copy.home).toBe(shell.errorHome);
      expect(copy.goHome).toBe(shell.errorHome);
    });
  }
});

describe("pickRequestLocale", () => {
  it("세션 언어가 쿠키 · 헤더보다 먼저", () => {
    expect(pickRequestLocale({ sessionLocale: "ko", cookie: "en", acceptLanguage: "ja" })).toBe("ko");
  });
  it("세션이 없으면 쿠키 → Accept-Language", () => {
    expect(pickRequestLocale({ cookie: "en", acceptLanguage: "ja" })).toBe("en");
    expect(pickRequestLocale({ cookie: null, acceptLanguage: "ja-JP,ja;q=0.9" })).toBe("ja");
  });
});

describe("resolveFallbackLocale", () => {
  it("ja · en 계열은 그 언어, 나머지와 빈 값은 ko", () => {
    expect(resolveFallbackLocale("ja-JP")).toBe("ja");
    expect(resolveFallbackLocale("EN")).toBe("en");
    expect(resolveFallbackLocale("fr")).toBe("ko");
    expect(resolveFallbackLocale(null)).toBe("ko");
    expect(resolveFallbackLocale(undefined)).toBe("ko");
  });
});
