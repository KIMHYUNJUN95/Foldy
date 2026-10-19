import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { isMisroutedSupabaseCallback, middleware } from "../../../middleware";

const desktopUA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

function req(url: string) {
  return new NextRequest(new URL(url, "https://foldy.test"), {
    headers: { "user-agent": desktopUA },
  });
}

function check(url: string) {
  const u = new URL(url, "https://foldy.test");
  return isMisroutedSupabaseCallback(u.pathname, u.searchParams);
}

describe("isMisroutedSupabaseCallback", () => {
  it("앱이 붙인 ?error= 단독은 콜백이 아니다 — 화면의 오류 안내를 지우지 않는다", () => {
    expect(check("/admin/settings/organization?error=save_failed")).toBe(false);
    expect(check("/mobile/lost-found/new?error=missing_item_name")).toBe(false);
    expect(check("/auth/login?view=email&error=invalid_credentials")).toBe(false);
    expect(check("/?error=x")).toBe(false);
  });

  it("code · error_code · error_description 은 엉뚱한 경로로 떨어진 콜백이다", () => {
    expect(check("/?code=abc")).toBe(true);
    expect(check("/mobile?code=abc")).toBe(true);
    expect(check("/auth/login?code=abc")).toBe(true);
    expect(check("/?error=access_denied&error_code=otp_expired&error_description=expired")).toBe(true);
    expect(check("/auth/login?error_description=denied")).toBe(true);
  });

  it("/auth/callback 자신은 다시 보내지 않는다", () => {
    expect(check("/auth/callback?code=abc")).toBe(false);
    expect(check("/auth/callback?error_description=x")).toBe(false);
  });
});

describe("middleware — 콜백 재전송", () => {
  it("?code= 는 /auth/callback 으로, next 에 원래 경로(콜백 파라미터 제외)를 싣는다", async () => {
    const res = await middleware(req("/mobile/tasks?code=abc&view=today"));
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/auth/callback");
    expect(location.searchParams.get("code")).toBe("abc");
    expect(location.searchParams.get("next")).toBe("/mobile/tasks?view=today");
  });

  it("이미 next 가 있으면 그대로 둔다", async () => {
    const res = await middleware(req("/?code=abc&next=%2Fadmin%2Forders"));
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/auth/callback");
    expect(location.searchParams.get("next")).toBe("/admin/orders");
  });

  it("공개 경로의 ?error= 는 그대로 통과한다", async () => {
    const res = await middleware(req("/privacy?error=x"));
    expect(res.headers.get("location")).toBeNull();
  });
});
