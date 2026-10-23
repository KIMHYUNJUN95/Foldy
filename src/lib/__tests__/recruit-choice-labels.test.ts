import { describe, expect, it } from "vitest";
import { getDictionary } from "@/lib/i18n";
import {
  localizeRecruitCommute,
  localizeRecruitDaysPerWeek,
  localizeRecruitDuration,
  localizeRecruitEmployment,
  localizeRecruitGender,
  localizeRecruitStartDate,
  localizeRecruitWorkDays,
} from "@/lib/recruit/choice-labels";

const en = getDictionary("en").recruit;
const ja = getDictionary("ja").recruit;
const ko = getDictionary("ko").recruit;

describe("recruit form choices stored in Korean are drawn in the viewer's language", () => {
  it("gender", () => {
    expect(localizeRecruitGender("남성", en.choice)).toBe("Male");
    expect(localizeRecruitGender("여성", ja.choice)).toBe("女性");
    expect(localizeRecruitGender(null, en.choice)).toBeNull();
  });

  it("days per week, duration and commute", () => {
    expect(localizeRecruitDaysPerWeek("3일", en.choice)).toBe("3 days/wk");
    expect(localizeRecruitDaysPerWeek("5일", ja.choice)).toBe("週5日");
    expect(localizeRecruitDuration("6개월", en.choice)).toBe("6 mo");
    expect(localizeRecruitDuration("1년", ja.choice)).toBe("1年");
    expect(localizeRecruitCommute("30분~1시간", en.choice)).toBe("30 min–1 hr");
    expect(localizeRecruitCommute("1시간 이상", ja.choice)).toBe("1時間以上");
    expect(localizeRecruitCommute("30분 이내", en.choice)).toBe("Under 30 min");
  });

  it("employment type", () => {
    expect(localizeRecruitEmployment("아르바이트", en.choice)).toBe("Part-time");
    expect(localizeRecruitEmployment("정사원", ja.choice)).toBe("正社員");
  });

  it("Korean viewers see the stored text unchanged", () => {
    const cases: [(raw: string | null, copy: typeof ko.choice) => string | null, string][] = [
      [localizeRecruitGender, "남성"],
      [localizeRecruitDaysPerWeek, "3일"],
      [localizeRecruitDuration, "6개월"],
      [localizeRecruitDuration, "1년"],
      [localizeRecruitCommute, "30분~1시간"],
      [localizeRecruitCommute, "30분 이내"],
      [localizeRecruitEmployment, "아르바이트"],
    ];
    for (const [fn, raw] of cases) expect(fn(raw, ko.choice)).toBe(raw);
  });

  it("unknown answers pass through", () => {
    expect(localizeRecruitDuration("협의 가능", en.choice)).toBe("협의 가능");
    expect(localizeRecruitEmployment("계약직", en.choice)).toBe("계약직");
  });

  it("work days keep stored order", () => {
    expect(localizeRecruitWorkDays(["수", "월", "일"], en.weekDays)).toEqual(["Wed", "Mon", "Sun"]);
    expect(localizeRecruitWorkDays(["토", "?"], ja.weekDays)).toEqual(["土", "?"]);
  });

  it("start date: only the 'available now' answers, free text stays", () => {
    expect(localizeRecruitStartDate("즉시 가능", en.choice)).toBe("Available now");
    expect(localizeRecruitStartDate("즉시가능", ja.choice)).toBe("即日可");
    expect(localizeRecruitStartDate("4월20일", en.choice)).toBe("4월20일");
  });
});
