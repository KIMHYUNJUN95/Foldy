import { describe, expect, it } from "vitest";
import {
  durationLabel,
  earliestMinute,
  fromMinutes,
  offsetTime,
  parsePart,
  partDone,
  slotOpen,
  stepTime,
  toMinutes,
} from "@/lib/report-schedule-time";

/** 업무일지 「보낼 시각」 직접 입력(1분 단위, 2026-10-20 2차) — 칸 계산 규칙. */
describe("report schedule time", () => {
  const at = (hhmm: string) => toMinutes(hhmm);

  it("분은 59 → 00 이면 시도 넘어가고, 시는 23 ↔ 00 으로 돈다", () => {
    expect(stepTime("17:59", "minute", 1, at("09:00"))).toBe("18:00");
    expect(stepTime("18:00", "minute", -1, at("09:00"))).toBe("17:59");
    expect(stepTime("23:10", "hour", 1, at("09:00"))).toBe("00:10");
    expect(stepTime("00:10", "hour", -1, at("09:00"))).toBe("23:10");
    expect(stepTime("17:30", "minute", 10, at("09:00"))).toBe("17:40");
  });

  it("빈 칸(지금 바로)에서 올리면 고를 수 있는 가장 이른 시각을 5분 단위로 올린 값부터", () => {
    expect(stepTime(null, "minute", 1, at("16:25"))).toBe("16:30"); // 16:27 → 16:30
    expect(stepTime(null, "hour", 1, at("16:28"))).toBe("16:30");
  });

  it("지금 + 2분부터, 오늘 23:59 까지만", () => {
    expect(slotOpen("16:27", at("16:25"))).toBe(true);
    expect(slotOpen("16:26", at("16:25"))).toBe(false);
    expect(earliestMinute(at("16:25"))).toBe(at("16:27"));
    expect(earliestMinute(at("23:58"))).toBeNull();
  });

  it("「30분 뒤 · 1시간 뒤」는 오늘을 넘으면 없다", () => {
    expect(offsetTime(at("16:25"), 30)).toBe("16:55");
    expect(offsetTime(at("23:40"), 30)).toBeNull();
  });

  it("치는 숫자 — 시 3~9 · 분 6~9 로 시작하면 한 자리로 끝, 범위 밖은 null", () => {
    expect(partDone("1", "hour")).toBe(false);
    expect(partDone("3", "hour")).toBe(true);
    expect(partDone("5", "minute")).toBe(false);
    expect(partDone("7", "minute")).toBe(true);
    expect(parsePart("23", "hour")).toBe(23);
    expect(parsePart("24", "hour")).toBeNull();
    expect(parsePart("59", "minute")).toBe(59);
    expect(parsePart("6a", "minute")).toBeNull();
    expect(fromMinutes(at("07:05"))).toBe("07:05");
  });

  it("남은 시간 문구", () => {
    const t = { hm: "{h}시간 {m}분", h: "{h}시간", m: "{m}분" };
    expect(durationLabel(72, t)).toBe("1시간 12분");
    expect(durationLabel(120, t)).toBe("2시간");
    expect(durationLabel(12, t)).toBe("12분");
    expect(durationLabel(0, t)).toBe("1분");
  });
});
