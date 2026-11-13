import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";

// 모든 경로에 붙는 보안 헤더(2026-11-13 점검). CSP 는 frame-ancestors 만 — 화면 · 카메라를 막지 않게.
describe("보안 헤더", () => {
  it("모든 경로에 같은 헤더", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((rule) => rule.source === "/:path*");
    const headers = Object.fromEntries((all?.headers ?? []).map((header) => [header.key.toLowerCase(), header.value]));
    expect(headers["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=(self)");
    expect(headers["permissions-policy"]).toContain("geolocation=()");
  });
});
