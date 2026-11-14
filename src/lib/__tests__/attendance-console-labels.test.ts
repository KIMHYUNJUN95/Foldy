import { describe, expect, it } from "vitest";

import { attendanceMethodLabel, attendanceRoleLabel, formatAdminDate, formatLeaveRange } from "@/lib/attendance-console-labels";
import { LONG_SHIFT_SEC, reviewReason, type ReviewReasonInput } from "@/lib/attendance-review-reason";
import { getDictionary, locales } from "@/lib/i18n";

const base: ReviewReasonInput = {
  status: "completed",
  clockOutLabel: "18:00",
  paidDurationSec: 8 * 3600,
  isAbnormal: false,
  correctionStatus: null,
};

describe("reviewReason", () => {
  it("퇴근 없는 열린 세션은 퇴근 미기록", () => {
    expect(reviewReason({ ...base, status: "open", clockOutLabel: null, paidDurationSec: null })).toBe("clockout_missing");
    expect(reviewReason({ ...base, status: "abandoned", clockOutLabel: null, paidDurationSec: null })).toBe("clockout_missing");
  });
  it("열린 정정 요청", () => {
    expect(reviewReason({ ...base, correctionStatus: "requested" })).toBe("correction_pending");
    expect(reviewReason({ ...base, correctionStatus: "in_review" })).toBe("correction_pending");
  });
  it("12시간 넘으면 장시간, 딱 12시간은 아님", () => {
    expect(reviewReason({ ...base, paidDurationSec: LONG_SHIFT_SEC + 60 })).toBe("long_shift");
    expect(reviewReason({ ...base, paidDurationSec: LONG_SHIFT_SEC })).toBe("review");
  });
  it("이상 감지 · 퇴근 없는 닫힌 세션 · 나머지", () => {
    expect(reviewReason({ ...base, isAbnormal: true })).toBe("abnormal");
    expect(reviewReason({ ...base, status: "invalid", clockOutLabel: null, paidDurationSec: null })).toBe("incomplete");
    expect(reviewReason(base)).toBe("review");
  });
});

describe("attendanceMethodLabel", () => {
  for (const locale of locales) {
    const c = getDictionary(locale).admin.attendanceConsole;
    it(`${locale}: 모든 값에 읽는 이름, 코드는 새지 않고 모르는 값은 수동이 아님`, () => {
      expect(attendanceMethodLabel("totally_new_method", c)).not.toBe(c.methodManual);
      expect(attendanceMethodLabel(null, c)).toBe(c.methodFallback);
      for (const m of ["gps_qr", "gps_wifi", "manual", "qr", null, "totally_new_method"]) {
        const label = attendanceMethodLabel(m, c);
        expect(label).toBeTruthy();
        expect(label).not.toMatch(/gps_|_qr|totally/);
      }
    });
  }
  it("ko 표기", () => {
    const c = getDictionary("ko").admin.attendanceConsole;
    expect(attendanceMethodLabel("gps_wifi", c)).toBe("위치 확인 + Wi-Fi");
    expect(attendanceMethodLabel("gps_qr", c)).toBe("위치 확인 + QR");
  });
});

describe("attendanceRoleLabel", () => {
  it("코드는 사전 이름으로, 비면 대시, 모르는 값은 그대로", () => {
    const roles = getDictionary("ko").roles as Record<string, string>;
    expect(attendanceRoleLabel("part_time_staff", roles)).toBe("아르바이트");
    expect(attendanceRoleLabel(null, roles)).toBe("—");
    expect(attendanceRoleLabel("brand_new", roles)).toBe("brand_new");
  });
  it("모든 로캘에서 알려진 역할은 코드가 아니다", () => {
    for (const locale of locales) {
      const roles = getDictionary(locale).roles as Record<string, string>;
      for (const r of ["owner", "cs_staff", "part_time_staff"]) expect(attendanceRoleLabel(r, roles)).not.toContain("_");
    }
  });
});

describe("날짜 표기", () => {
  it("적용 시작일은 로캘 자연 형식", () => {
    expect(formatAdminDate("2026-04-01", "ko-KR")).toBe("2026. 4. 1");
    expect(formatAdminDate("2026-04-01", "ja-JP")).toBe("2026/4/1");
    expect(formatAdminDate("2026-04-01", "en-US")).toBe("Apr 1, 2026");
  });
  it("연차 기간: 같은 날은 한 날짜, 범위는 en dash", () => {
    expect(formatLeaveRange("2026-11-24", "2026-11-24")).toBe("11/24");
    expect(formatLeaveRange("2026-11-24", "2026-11-25")).toBe("11/24 – 11/25");
  });
});
