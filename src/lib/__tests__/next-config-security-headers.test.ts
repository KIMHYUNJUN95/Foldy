import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

describe("next.config headers()", () => {
  it("모든 경로에 보안 헤더 세 개를 싣고 X-Frame-Options 는 두지 않는다", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*");
    expect(all).toBeDefined();
    const map = new Map(all!.headers.map((h) => [h.key.toLowerCase(), h.value]));
    expect(map.get("content-security-policy")).toBe("frame-ancestors 'self'");
    expect(map.get("x-content-type-options")).toBe("nosniff");
    expect(map.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(map.has("x-foldy-build")).toBe(true);
    for (const r of rules) {
      for (const h of r.headers) {
        expect(h.key.toLowerCase()).not.toBe("x-frame-options");
        expect(h.value).not.toMatch(/DENY/i);
      }
    }
  });
});
