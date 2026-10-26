// 근태 QR 토큰 파싱 가드.
//
// 2026-07-31 에 QR 인코딩을 "토큰만" → "절대 URL" 로 바꿨다. 현장에 이미 붙어 있는 인쇄물은
// 여전히 토큰만 담고 있으므로, 스캐너가 두 형식을 모두 받지 못하면 기존 QR 이 전부 죽는다.
// src/lib/attendance-qr.ts / docs/product/24-attendance-workflow.md → "QR Deep Link" 참고.

import { describe, expect, it } from "vitest";
import { attendanceQrLinkState, extractAttendanceToken } from "@/lib/attendance-qr";

const TOKEN = "att_kGh3Zx9QpL7nT2vWbYc4Rd8sMf1AeJu6";

describe("extractAttendanceToken", () => {
  it("accepts a legacy bare-token QR", () => {
    expect(extractAttendanceToken(TOKEN)).toBe(TOKEN);
    expect(extractAttendanceToken(`  ${TOKEN}  `)).toBe(TOKEN);
  });

  it("accepts the new URL QR", () => {
    expect(extractAttendanceToken(`https://ops.example.com/mobile/attendance/capture?token=${TOKEN}`)).toBe(
      TOKEN,
    );
  });

  it("survives a different host, extra params, or a trailing slash", () => {
    expect(
      extractAttendanceToken(`http://192.168.0.12:3000/mobile/attendance/capture/?token=${TOKEN}&mode=in`),
    ).toBe(TOKEN);
  });

  it("rejects anything that is not an attendance token", () => {
    expect(extractAttendanceToken("")).toBeNull();
    expect(extractAttendanceToken("   ")).toBeNull();
    expect(extractAttendanceToken("https://example.com/hello")).toBeNull();
    expect(extractAttendanceToken("https://example.com/x?token=not-ours")).toBeNull();
    expect(extractAttendanceToken("att_")).toBeNull();
    expect(extractAttendanceToken("random text")).toBeNull();
  });
});

// 인쇄 전 판정 — 카메라로 안 열리는 QR 을 뽑아 전 건물에 붙이는 사고를 막는 안전장치다.
describe("attendanceQrLinkState", () => {
  it("passes a public https link", () => {
    expect(attendanceQrLinkState(`https://ops.example.com/mobile/attendance/capture?token=${TOKEN}`)).toBe(
      "ok",
    );
  });

  it("flags a bare token (NEXT_PUBLIC_APP_URL not set)", () => {
    expect(attendanceQrLinkState(TOKEN)).toBe("missing");
    expect(attendanceQrLinkState("")).toBe("missing");
  });

  it("flags local / private-network addresses that field phones cannot reach", () => {
    expect(attendanceQrLinkState("http://localhost:3000/mobile/attendance/capture")).toBe("local");
    expect(attendanceQrLinkState("http://127.0.0.1:3000/x")).toBe("local");
    expect(attendanceQrLinkState("http://192.168.0.12:3000/x")).toBe("local");
    expect(attendanceQrLinkState("http://172.16.4.9/x")).toBe("local");
  });
});
