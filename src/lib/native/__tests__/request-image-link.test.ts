import { describe, expect, it } from "vitest";
import { isRequestImageLink, isTrustedSignedImageUrl, requestImageJsonHref } from "../request-image-link";

const ORIGIN = "https://app.example.com";

describe("isRequestImageLink", () => {
  it("같은 출처의 request-images 경로만 true", () => {
    expect(isRequestImageLink(new URL("/api/request-images/org/a.jpg", ORIGIN), ORIGIN)).toBe(true);
    expect(isRequestImageLink(new URL("/api/other/a.jpg", ORIGIN), ORIGIN)).toBe(false);
    expect(isRequestImageLink(new URL("https://evil.com/api/request-images/a.jpg"), ORIGIN)).toBe(false);
  });
  it("JSON 주소는 경로 + ?as=json", () => {
    expect(requestImageJsonHref(new URL("/api/request-images/a%20b.jpg", ORIGIN))).toBe("/api/request-images/a%20b.jpg?as=json");
  });
});

describe("isTrustedSignedImageUrl", () => {
  const SB = "https://abc.supabase.co";
  it("같은 호스트 https 만 통과", () => {
    expect(isTrustedSignedImageUrl("https://abc.supabase.co/storage/v1/object/sign/request-images/a?token=x", SB)).toBe(true);
    expect(isTrustedSignedImageUrl("https://evil.com/a", SB)).toBe(false);
    expect(isTrustedSignedImageUrl("http://abc.supabase.co/a", SB)).toBe(false);
    expect(isTrustedSignedImageUrl("not a url", SB)).toBe(false);
    expect(isTrustedSignedImageUrl(42, SB)).toBe(false);
  });
  it("환경값이 없으면 거절", () => {
    expect(isTrustedSignedImageUrl("https://abc.supabase.co/a", undefined)).toBe(false);
  });
});
