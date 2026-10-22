import { describe, expect, it } from "vitest";
import { NATIVE_AUTH_CALLBACK, nativeCallbackToWebPath, nativeShortcutToWebPath } from "@/lib/native-app";

// 앱 OAuth 복귀 주소 → 웹 콜백 경로 변환(2026-10-06, B2). 잘못 넘기면 앱 로그인이 조용히 끊긴다.
describe("nativeCallbackToWebPath", () => {
  it("앱 스킴 콜백의 쿼리를 그대로 웹 콜백으로 옮긴다", () => {
    expect(nativeCallbackToWebPath(`${NATIVE_AUTH_CALLBACK}?code=abc&next=%2Fmobile`)).toBe(
      "/auth/callback?code=abc&next=%2Fmobile",
    );
  });

  it("오류 응답(error_description)도 그대로 넘긴다", () => {
    expect(nativeCallbackToWebPath(`${NATIVE_AUTH_CALLBACK}?error_description=denied`)).toBe(
      "/auth/callback?error_description=denied",
    );
  });

  it("다른 스킴 · 다른 경로는 무시한다", () => {
    expect(nativeCallbackToWebPath("https://stay-ops-two.vercel.app/auth/callback?code=abc")).toBeNull();
    expect(nativeCallbackToWebPath("com.harutokyo.foldy://other/path?code=abc")).toBeNull();
    expect(nativeCallbackToWebPath("evil.app://auth/callback?code=abc")).toBeNull();
    expect(nativeCallbackToWebPath("not a url")).toBeNull();
    expect(nativeCallbackToWebPath(`${NATIVE_AUTH_CALLBACK}extra?code=abc`)).toBeNull();
  });

  it("쿼리 없는 주소와 조각(#)도 처리한다 — 예전 WebView 의 URL 파싱에 기대지 않는다", () => {
    expect(nativeCallbackToWebPath(NATIVE_AUTH_CALLBACK)).toBe("/auth/callback");
    expect(nativeCallbackToWebPath(`${NATIVE_AUTH_CALLBACK}?code=abc#frag`)).toBe("/auth/callback?code=abc");
  });
});

// 앱 아이콘 꾹 누르기 메뉴(2026-10-22) — 정해 둔 바로가기만 연다.
describe("nativeShortcutToWebPath", () => {
  it("정해 둔 바로가기를 웹 경로로 바꾼다", () => {
    expect(nativeShortcutToWebPath("com.harutokyo.foldy://open/attendance")).toBe("/mobile/attendance");
    expect(nativeShortcutToWebPath("com.harutokyo.foldy://open/new-task")).toBe("/mobile/tasks/new");
    expect(nativeShortcutToWebPath("com.harutokyo.foldy://open/my-rooms?x=1")).toBe("/mobile/shift/today");
  });

  it("모르는 id · 다른 주소 · 프로토타입 키는 열지 않는다", () => {
    expect(nativeShortcutToWebPath("com.harutokyo.foldy://open/admin")).toBeNull();
    expect(nativeShortcutToWebPath("com.harutokyo.foldy://open/constructor")).toBeNull();
    expect(nativeShortcutToWebPath("com.harutokyo.foldy://open/")).toBeNull();
    expect(nativeShortcutToWebPath("com.harutokyo.foldy://auth/callback?code=1")).toBeNull();
    expect(nativeShortcutToWebPath("https://evil.example/open/attendance")).toBeNull();
  });
});
