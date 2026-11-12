import { describe, expect, it } from "vitest";
import { japanHolidays } from "@/lib/japan-holidays";
import {
  daysBetweenKeys,
  EMPTY_MEMBER_PAYROLL_SETTING,
  paydayFor,
  payrollIssues,
  twoMonthsAfter,
  upcomingPaydays,
  upcomingPaydaysFrom,
} from "@/lib/payroll-settings-rules";

/** 알바 급여 P1 — 공휴일 · 지급일 · 확인 필요 규칙(docs/product/39 §3-A · §3-C). */
describe("japanHolidays", () => {
  it("2026년 — 내각부 발표와 같은 16일 + 振替 · 国民の休日", () => {
    const h = japanHolidays(2026);
    expect([...h.keys()].sort()).toEqual([
      "2026-01-01",
      "2026-01-12",
      "2026-02-11",
      "2026-02-23",
      "2026-03-20",
      "2026-04-29",
      "2026-05-03",
      "2026-05-04",
      "2026-05-05",
      "2026-05-06", // 振替(5/3 일요일)
      "2026-07-20",
      "2026-08-11",
      "2026-09-21",
      "2026-09-22", // 国民の休日
      "2026-09-23",
      "2026-10-12",
      "2026-11-03",
      "2026-11-23",
    ]);
    expect(h.get("2026-05-06")).toBe("substitute");
    expect(h.get("2026-09-22")).toBe("citizens");
  });

  it("2025년 — 춘분 3/20 · 추분 9/23 · 振替 2/24 · 5/6 · 11/24", () => {
    const h = japanHolidays(2025);
    expect(h.get("2025-03-20")).toBe("vernal");
    expect(h.get("2025-09-23")).toBe("autumnal");
    expect(h.get("2025-02-24")).toBe("substitute");
    expect(h.get("2025-05-06")).toBe("substitute");
    expect(h.get("2025-11-24")).toBe("substitute");
    expect(h.size).toBe(19);
  });

  it("2021년 올림픽 특례 — 7/22 · 7/23 · 8/8 + 振替 8/9", () => {
    const h = japanHolidays(2021);
    expect(h.get("2021-07-22")).toBe("marine");
    expect(h.get("2021-07-23")).toBe("sports");
    expect(h.get("2021-08-08")).toBe("mountain");
    expect(h.get("2021-08-09")).toBe("substitute");
    expect(h.has("2021-10-11")).toBe(false);
  });
});

describe("paydayFor", () => {
  it("평일이면 그대로 10일", () => {
    expect(paydayFor("2026-10", 10)).toMatchObject({ date: "2026-11-10", shiftedBecause: null });
  });

  it("10일이 일요일이면 앞 금요일(12월분 → 2027-01-08)", () => {
    expect(paydayFor("2026-12", 10)).toMatchObject({ date: "2027-01-08", nominal: "2027-01-10", shiftedBecause: "sun" });
  });

  it("10일이 토요일이면 앞 금요일(3월분 → 2027-04-09)", () => {
    expect(paydayFor("2027-03", 10)).toMatchObject({ date: "2027-04-09", shiftedBecause: "sat" });
  });

  it("공휴일이면 앞 평일 — 2026-02-11 建国記念の日 → 2/10", () => {
    expect(paydayFor("2026-01", 11)).toMatchObject({ date: "2026-02-10", shiftedBecause: "holiday", holiday: "foundation" });
  });

  it("연휴를 넘어 앞으로 — 2026-05-06 振替 → 5/1(금)", () => {
    expect(paydayFor("2026-04", 6)).toMatchObject({ date: "2026-05-01", shiftedBecause: "holiday" });
  });

  it("앞으로 12달 — 시안과 같은 날짜", () => {
    const dates = upcomingPaydays("2026-10", 10).map((p) => p.date);
    expect(dates).toEqual([
      "2026-11-10",
      "2026-12-10",
      "2027-01-08",
      "2027-02-10",
      "2027-03-10",
      "2027-04-09",
      "2027-05-10",
      "2027-06-10",
      "2027-07-09",
      "2027-08-10",
      "2027-09-10",
      "2027-10-08",
    ]);
  });
});

describe("payrollIssues", () => {
  const filled = { ...EMPTY_MEMBER_PAYROLL_SETTING, paymentMethod: "transfer" as const, withholdingClass: "kou" as const };

  it("월급제는 세지 않는다", () => {
    expect(payrollIssues({ hourly: false, setting: EMPTY_MEMBER_PAYROLL_SETTING, nameKatakana: null, hireDate: null, today: "2026-10-25" })).toEqual([]);
  });

  it("빈 설정 — 지급 방식 · 원천세 · 가타카나", () => {
    expect(payrollIssues({ hourly: true, setting: EMPTY_MEMBER_PAYROLL_SETTING, nameKatakana: " ", hireDate: null, today: "2026-10-25" })).toEqual([
      "payment_method",
      "withholding",
      "katakana",
    ]);
  });

  it("다 채우면 없음", () => {
    expect(payrollIssues({ hourly: true, setting: filled, nameKatakana: "チェ ソヨン", hireDate: "2026-08-20", today: "2026-10-25" })).toEqual([]);
  });

  it("丙 — 입사 2개월이 되는 날까지는 괜찮고, 다음 날부터 걸린다", () => {
    const hei = { ...filled, withholdingClass: "hei" as const };
    const base = { hourly: true, setting: hei, nameKatakana: "ヤマダ リコ", hireDate: "2026-08-25" };
    expect(payrollIssues({ ...base, today: "2026-10-25" })).toEqual([]);
    expect(payrollIssues({ ...base, today: "2026-10-26" })).toEqual(["hei_over"]);
    expect(payrollIssues({ ...base, hireDate: null, today: "2026-10-26" })).toEqual(["hei_no_hire_date"]);
  });

  it("twoMonthsAfter — 말일 넘침은 그 달 말일", () => {
    expect(twoMonthsAfter("2026-12-31")).toBe("2027-02-28");
    expect(twoMonthsAfter("2026-03-01")).toBe("2026-05-01");
  });
});

describe("daysBetweenKeys", () => {
  it("달 · 해를 넘겨도 날짜 수만 센다", () => {
    expect(daysBetweenKeys("2026-11-12", "2026-12-10")).toBe(28);
    expect(daysBetweenKeys("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetweenKeys("2026-11-12", "2026-11-12")).toBe(0);
  });
});

describe("upcomingPaydaysFrom", () => {
  it("이번 달 지급일이 지났으면 이번 달분부터", () => {
    const list = upcomingPaydaysFrom("2026-11-12", 10, 12);
    expect(list).toHaveLength(12);
    expect(list[0].workYm).toBe("2026-11");
    expect(list[0].date).toBe("2026-12-10");
  });
  it("지난달분이 아직 안 나갔으면 그것부터(지급일 당일 포함)", () => {
    expect(upcomingPaydaysFrom("2026-11-05", 10)[0].workYm).toBe("2026-10");
    expect(upcomingPaydaysFrom("2026-11-10", 10)[0].workYm).toBe("2026-10");
    expect(upcomingPaydaysFrom("2026-11-11", 10)[0].workYm).toBe("2026-11");
  });
  it("앞당긴 지급일 기준으로 판단한다", () => {
    // 2027-01-10 은 일요일 → 1월 8일(금). 1월 9일에는 이미 나갔다.
    expect(upcomingPaydaysFrom("2027-01-08", 10)[0].workYm).toBe("2026-12");
    expect(upcomingPaydaysFrom("2027-01-09", 10)[0].workYm).toBe("2027-01");
  });
});
