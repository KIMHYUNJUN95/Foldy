// 안 A 화면 도우미(2026-11-11) — 기간 날짜 줄 · 「원래 휴무」 빼기 · 일수 실시간 반영 · 0일 금지.
import { describe, expect, it } from "vitest";
import {
  leaveRangeDates,
  normalizeLeaveRequest,
  pruneExcludedDates,
  toggleExcludedDate,
} from "../annual-leave";

describe("leaveRangeDates", () => {
  it("기간의 날짜를 하루씩 늘어놓는다(달 넘김 포함)", () => {
    expect(leaveRangeDates("2026-11-29", "2026-12-02")).toEqual(["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"]);
  });
  it("끝이 시작보다 앞이거나 60일을 넘으면 빈 줄(화면이 그리지 않는다)", () => {
    expect(leaveRangeDates("2026-11-10", "2026-11-09")).toEqual([]);
    expect(leaveRangeDates("2026-01-01", "2026-03-15")).toEqual([]);
  });
});

describe("toggleExcludedDate", () => {
  it("빼고 · 다시 넣고, 정렬된 목록을 돌려준다", () => {
    const one = toggleExcludedDate([], "2026-11-22", "2026-11-20", "2026-11-23");
    expect(one).toEqual(["2026-11-22"]);
    expect(toggleExcludedDate(["2026-11-23", "2026-11-22"].sort(), "2026-11-20", "2026-11-20", "2026-11-23")).toEqual([
      "2026-11-20",
      "2026-11-22",
      "2026-11-23",
    ]);
    expect(toggleExcludedDate(one, "2026-11-22", "2026-11-20", "2026-11-23")).toEqual([]);
  });
  it("마지막 남은 하루는 뺄 수 없다(0일 금지) — 그대로 돌려준다", () => {
    const ex = ["2026-11-20", "2026-11-21"];
    expect(toggleExcludedDate(ex, "2026-11-22", "2026-11-20", "2026-11-22")).toBe(ex);
  });
  it("결과는 서버 규칙(normalizeLeaveRequest)을 통과하고 일수가 맞는다", () => {
    const ex = toggleExcludedDate([], "2026-11-21", "2026-11-20", "2026-11-23");
    const res = normalizeLeaveRequest({
      leaveType: "paid",
      startDate: "2026-11-20",
      endDate: "2026-11-23",
      durationUnit: "full",
      excludedDates: ex,
    });
    expect(res.ok && res.value.daysCount).toBe(3);
  });
});

describe("pruneExcludedDates", () => {
  it("기간이 바뀌면 밖으로 나간 날짜를 버리고, 전부 빠지게 되면 비운다", () => {
    expect(pruneExcludedDates(["2026-11-20", "2026-11-25"], "2026-11-21", "2026-11-26")).toEqual(["2026-11-25"]);
    expect(pruneExcludedDates(["2026-11-21"], "2026-11-21", "2026-11-21")).toEqual([]);
  });
});

describe("parseLeaveDayAmount", () => {
  it("빈 칸 · 음수 · 숫자 아님 · 0.5 단위 아님은 null(예전엔 Number(\"\") = 0 으로 저장됐다)", async () => {
    const { parseLeaveDayAmount } = await import("../annual-leave");
    expect(parseLeaveDayAmount("")).toBeNull();
    expect(parseLeaveDayAmount("  ")).toBeNull();
    expect(parseLeaveDayAmount("-1")).toBeNull();
    expect(parseLeaveDayAmount("abc")).toBeNull();
    expect(parseLeaveDayAmount("1.3")).toBeNull();
    expect(parseLeaveDayAmount("0")).toBe(0);
    expect(parseLeaveDayAmount(" 10.5 ")).toBe(10.5);
  });
});

describe("countLeaveRequestsInYear", () => {
  it("신청 내역 「올해 · n건」 — 올해에 걸친 신청만 센다(전체 건수 아님)", async () => {
    const { countLeaveRequestsInYear } = await import("../annual-leave");
    const rows = [
      { startDate: "2025-12-30", endDate: "2026-01-02" },
      { startDate: "2026-03-01", endDate: "2026-03-01" },
      { startDate: "2025-05-01", endDate: "2025-05-02" },
    ];
    expect(countLeaveRequestsInYear(rows, "2026")).toBe(2);
  });
});

describe("effectiveExcludedDates — 보여 주기 · 보내기가 함께 쓰는 한 곳", () => {
  it("11/20~11/24 에서 11/22 를 뺀 뒤 반차 → 종일(기간 1일)이 되면 뺀 날이 남지 않는다", async () => {
    const { effectiveExcludedDates, normalizeLeaveRequest } = await import("../annual-leave");
    const ex = ["2026-11-22"];
    // 반차 중: 뺄 수 없는 단위
    expect(effectiveExcludedDates(ex, false, "2026-11-20", "2026-11-20")).toEqual([]);
    // 다시 종일인데 기간은 하루 — 기간 밖 날짜는 버린다
    const back = effectiveExcludedDates(ex, true, "2026-11-20", "2026-11-20");
    expect(back).toEqual([]);
    const res = normalizeLeaveRequest({
      leaveType: "paid",
      startDate: "2026-11-20",
      endDate: "2026-11-20",
      durationUnit: "full",
      excludedDates: back,
    });
    expect(res.ok && res.value.daysCount).toBe(1);
  });
  it("경조로 기간이 바뀌어도(시작 + 2일) 기간 밖 날짜는 버린다", async () => {
    const { effectiveExcludedDates } = await import("../annual-leave");
    expect(effectiveExcludedDates(["2026-11-24"], true, "2026-11-20", "2026-11-22")).toEqual([]);
    expect(effectiveExcludedDates(["2026-11-21"], true, "2026-11-20", "2026-11-22")).toEqual(["2026-11-21"]);
  });
});

describe("leaveApproveNeedsReason", () => {
  it("상세가 옛 값이어도(다시 읽기 실패) 서버가 over_balance 를 줬으면 사유 칸을 띄운다", async () => {
    const { leaveApproveNeedsReason } = await import("../annual-leave");
    expect(leaveApproveNeedsReason({ status: "requested", detailOverBalance: false, serverSaidOverBalance: true })).toBe(true);
    expect(leaveApproveNeedsReason({ status: "requested", detailOverBalance: true, serverSaidOverBalance: false })).toBe(true);
    expect(leaveApproveNeedsReason({ status: "requested", detailOverBalance: false, serverSaidOverBalance: false })).toBe(false);
    expect(leaveApproveNeedsReason({ status: "approved", detailOverBalance: true, serverSaidOverBalance: true })).toBe(false);
  });
});
