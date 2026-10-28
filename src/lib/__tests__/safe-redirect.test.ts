import { describe, expect, it } from "vitest";
import { sanitizeNextPath } from "../safe-redirect";

describe("sanitizeNextPath", () => {
  describe("rejects unsafe values → returns fallback", () => {
    it.each([
      ["absolute URL (https)", "https://evil.com"],
      ["absolute URL (http)", "http://evil.com"],
      ["protocol-relative path", "//evil.com"],
      ["backslash bypass /\\evil.com", "/\\evil.com"],
      ["double-backslash bypass /\\\\evil.com", "/\\\\evil.com"],
      ["tab bypass /\\t/evil.com", "/\t/evil.com"],
      ["newline bypass /\\n/evil.com", "/\n/evil.com"],
      ["carriage-return bypass /\\r/evil.com", "/\r/evil.com"],
      ["no leading slash", "evil.com"],
      ["empty string", ""],
    ])("%s", (_, input) => {
      expect(sanitizeNextPath(input)).toBe("");
    });

    it("returns empty string for non-string values", () => {
      expect(sanitizeNextPath(null)).toBe("");
      expect(sanitizeNextPath(undefined)).toBe("");
      expect(sanitizeNextPath(42)).toBe("");
      expect(sanitizeNextPath({})).toBe("");
    });

    it("returns custom fallback when value is unsafe", () => {
      expect(sanitizeNextPath("https://evil.com", "/mobile")).toBe("/mobile");
      expect(sanitizeNextPath("//evil.com", "/mobile")).toBe("/mobile");
      expect(sanitizeNextPath("/\\evil.com", "/mobile")).toBe("/mobile");
      expect(sanitizeNextPath(null, "/mobile")).toBe("/mobile");
    });
  });

  describe("accepts safe in-app paths unchanged", () => {
    it.each([
      ["/mobile"],
      ["/onboarding?next=%2Fmobile"],
      ["/admin/users?id=1#section"],
      ["/"],
      ["/admin"],
      ["/auth/login?lang=ko"],
    ])("%s", (safePath) => {
      expect(sanitizeNextPath(safePath)).toBe(safePath);
    });
  });
});
