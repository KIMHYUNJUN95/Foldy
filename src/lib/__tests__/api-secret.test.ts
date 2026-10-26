import { describe, expect, it } from "vitest";
import { requestMatchesSecret, safeEqualSecret } from "@/lib/api-secret";

function req(headers: Record<string, string>, query = "") {
  return {
    headers: new Headers(headers),
    nextUrl: { searchParams: new URLSearchParams(query) },
  };
}

describe("api-secret", () => {
  it("compares length-safely", () => {
    expect(safeEqualSecret("abc", "abc")).toBe(true);
    expect(safeEqualSecret("abc", "abcd")).toBe(false);
    expect(safeEqualSecret("", "")).toBe(false);
  });
  it("accepts any matching candidate instead of the first non-null one", () => {
    const r = req({ authorization: "Bearer wrong", "x-beds24-webhook-secret": "right" });
    expect(requestMatchesSecret(r, ["right"], { headers: ["x-beds24-webhook-secret"] })).toBe(true);
  });
  it("query only when allowed, and never with no configured secret", () => {
    const r = req({}, "secret=right");
    expect(requestMatchesSecret(r, ["right"])).toBe(false);
    expect(requestMatchesSecret(r, ["right"], { query: true })).toBe(true);
    expect(requestMatchesSecret(r, [undefined, ""], { query: true })).toBe(false);
  });
});
