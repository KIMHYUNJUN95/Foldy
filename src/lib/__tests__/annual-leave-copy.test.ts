// 연차 화면 오류 문구 고르기(2026-11-11) — 서버 오류 코드마다 전용 문구, 모르는 코드만 일반 실패.
import { describe, expect, it } from "vitest";
import { leaveBaselineSetupErrorText, leaveSubmitErrorText } from "../annual-leave-copy";
import { getDictionary } from "../i18n";

const c = getDictionary("ko").leave;

describe("leaveSubmitErrorText", () => {
  it.each([
    ["hourly_excluded", c.fHourlyPaidErr],
    ["baseline_required", c.fBaselineRequiredErr],
    ["not_editable", c.fNotEditableErr],
    ["too_long", c.fTooLongErr],
    ["invalid_excluded_dates", c.fExcludedErr],
    ["invalid_dates", c.fInvalidDatesErr],
    ["invalid_date_range", c.fInvalidDatesErr],
    ["read_failed", c.fReadFailedErr],
    ["network", c.fNetworkErr],
    ["something_else", c.exSetupSaveErr],
  ])("%s", (code, text) => {
    expect(leaveSubmitErrorText(code, c)).toBe(text);
  });
});

describe("leaveBaselineSetupErrorText", () => {
  it.each([
    ["hourly_excluded", c.exSetupHourlyErr],
    ["already_set", c.exSetupAlreadySet],
    ["future_hire_date", c.exSetupFutureErr],
    ["invalid_dates", c.exSetupDateErr],
    ["invalid_hire_date", c.exSetupDateErr],
    ["read_failed", c.fReadFailedErr],
    ["network", c.fNetworkErr],
    ["baseline_upsert_failed", c.exSetupSaveErr],
  ])("%s", (code, text) => {
    expect(leaveBaselineSetupErrorText(code, c)).toBe(text);
  });
});

describe("adminLeaveFormErrorText", () => {
  it("새 서버 오류 코드도 전용 문구로", async () => {
    const { adminLeaveFormErrorText } = await import("../annual-leave-copy");
    const lc = getDictionary("ko").admin.leaveConsole;
    expect(adminLeaveFormErrorText("too_long", lc)).toBe(lc.formErrTooLong);
    expect(adminLeaveFormErrorText("invalid_excluded_dates", lc)).toBe(lc.formErrExcluded);
    expect(adminLeaveFormErrorText("baseline_required", lc)).toBe(lc.formErrBaselineRequired);
    expect(adminLeaveFormErrorText("hourly_excluded", lc)).toBe(lc.formErrHourlyExcluded);
    expect(adminLeaveFormErrorText("network", lc)).toBe(lc.errNetwork);
    expect(adminLeaveFormErrorText(undefined, lc)).toBe(lc.formErrCreateFailed);
  });
});

describe("formatExcludedDates", () => {
  it("뺀 날을 짧은 날짜로 이어 쓴다(도쿄 날짜 그대로, 빈 목록은 빈 문자열)", async () => {
    const { formatExcludedDates } = await import("../annual-leave-copy");
    expect(formatExcludedDates(["2026-11-23", "2026-11-22"], "ko-KR")).toBe("11. 22. · 11. 23.");
    expect(formatExcludedDates(["2026-11-22"], "en-US")).toBe("11/22");
    expect(formatExcludedDates([], "ko-KR")).toBe("");
  });
});
