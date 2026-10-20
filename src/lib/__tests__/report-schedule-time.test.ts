import { describe, expect, it } from "vitest";
import {
  durationLabel,
  earliestMinute,
  fromMinutes,
  minuteGone,
  offsetTime,
  parseTimeText,
  slotOpen,
  slotTimes,
  toMinutes,
} from "@/lib/report-schedule-time";

/** 업무일지 「보낼 시각」(2026-10-20 3차 — 모바일 휠 · PC 칸 하나 + 목록) — 시각 계산 규칙. */
describe("report schedule time", () => {
  const at = (hhmm: string) => toMinutes(hhmm);
  const parse = (raw: string, now = "16:25") => {
    const min = parseTimeText(raw, at(now));
    return min === null ? null : fromMinutes(min);
  };

  it("지금 + 2분부터, 오늘 23:59 까지만", () => {
    expect(slotOpen("16:27", at("16:25"))).toBe(true);
    expect(slotOpen("16:26", at("16:25"))).toBe(false);
    expect(earliestMinute(at("16:25"))).toBe(at("16:27"));
    expect(earliestMinute(at("23:58"))).toBeNull();
    expect(minuteGone(at("16:26"), at("16:25"))).toBe(true);
    expect(minuteGone(at("16:27"), at("16:25"))).toBe(false);
  });

  it("「30분 뒤 · 1시간 뒤」는 오늘을 넘으면 없다", () => {
    expect(offsetTime(at("16:25"), 30)).toBe("16:55");
    expect(offsetTime(at("23:40"), 30)).toBeNull();
  });

  it("PC 목록 — 가장 이른 시각을 15분 단위로 올린 것부터 23:45 까지", () => {
    const slots = slotTimes(at("16:25"));
    expect(slots[0]).toBe("16:30");
    expect(slots.at(-1)).toBe("23:45");
    expect(slotTimes(at("16:14"))[0]).toBe("16:30"); // 16:16 → 16:30
    expect(slotTimes(at("23:50"))).toEqual([]);
  });

  it("친 글자 — 숫자 · 콜론 · 시/分 · 반 · 오전/오후", () => {
    expect(parse("1837")).toBe("18:37");
    expect(parse("937", "08:00")).toBe("09:37");
    expect(parse("18")).toBe("18:00");
    expect(parse("18:37")).toBe("18:37");
    expect(parse("１８：３７")).toBe("18:37");
    expect(parse("18.5")).toBe("18:05");
    expect(parse("6시37분")).toBe("18:37"); // 6:37 은 지났으니 오후
    expect(parse("6시 반")).toBe("18:30");
    expect(parse("6時37分")).toBe("18:37");
    expect(parse("午後6時")).toBe("18:00");
    expect(parse("오후 6시 반")).toBe("18:30");
    expect(parse("6:30 pm")).toBe("18:30");
    expect(parse("9am", "08:00")).toBe("09:00");
    expect(parse("9", "08:00")).toBe("09:00"); // 아직 안 지났으면 그대로
    expect(parse("16:10")).toBe("16:10"); // 지난 시각도 돌려준다(막는 건 화면)
  });

  it("친 글자 — 「n분 뒤」 · 「+n」 · 「n時間後」 = 지금부터", () => {
    expect(parse("30분 뒤")).toBe("16:55");
    expect(parse("+45")).toBe("17:10");
    expect(parse("1시간 뒤")).toBe("17:25");
    expect(parse("30分後")).toBe("16:55");
    expect(parse("in 2 hours")).toBe("18:25");
    expect(parse("30분 뒤", "23:50")).toBeNull();
  });

  it("못 알아들으면 null", () => {
    expect(parse("")).toBeNull();
    expect(parse("30")).toBeNull();
    expect(parse("2460")).toBeNull();
    expect(parse("18:75")).toBeNull();
    expect(parse("abc")).toBeNull();
  });

  it("남은 시간 문구", () => {
    const t = { hm: "{h}시간 {m}분", h: "{h}시간", m: "{m}분" };
    expect(durationLabel(72, t)).toBe("1시간 12분");
    expect(durationLabel(120, t)).toBe("2시간");
    expect(durationLabel(12, t)).toBe("12분");
    expect(durationLabel(0, t)).toBe("1분");
  });
});
