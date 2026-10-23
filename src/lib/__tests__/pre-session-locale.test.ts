import { describe, expect, it } from "vitest";
import { inferLocaleFromAcceptLanguage, resolvePreSessionLocale } from "@/lib/i18n";

describe("inferLocaleFromAcceptLanguage", () => {
  it("picks the most preferred supported language", () => {
    expect(inferLocaleFromAcceptLanguage("ja-JP,ja;q=0.9,en-US;q=0.8")).toBe("ja");
    expect(inferLocaleFromAcceptLanguage("zh-CN,zh;q=0.9,ko;q=0.5")).toBe("ko");
  });

  it("falls back to English for unsupported languages (2026-10-23)", () => {
    expect(inferLocaleFromAcceptLanguage("zh-CN,zh;q=0.9")).toBe("en");
    expect(inferLocaleFromAcceptLanguage("vi-VN")).toBe("en");
  });

  it("keeps Korean when there is no header", () => {
    expect(inferLocaleFromAcceptLanguage("")).toBe("ko");
  });
});

describe("resolvePreSessionLocale", () => {
  it("query → cookie → Accept-Language", () => {
    expect(resolvePreSessionLocale({ query: "ja", cookie: "en", acceptLanguage: "ko" })).toBe("ja");
    expect(resolvePreSessionLocale({ cookie: "en", acceptLanguage: "ko" })).toBe("en");
    expect(resolvePreSessionLocale({ acceptLanguage: "ja-JP" })).toBe("ja");
  });

  it("skips an invalid query to the cookie instead of jumping to the header", () => {
    expect(resolvePreSessionLocale({ query: "xx", cookie: "ja", acceptLanguage: "ko-KR" })).toBe("ja");
  });

  it("skips an invalid cookie", () => {
    expect(resolvePreSessionLocale({ cookie: "fr", acceptLanguage: "zh-TW" })).toBe("en");
  });
});
