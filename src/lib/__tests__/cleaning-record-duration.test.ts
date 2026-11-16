import { describe, expect, it } from "vitest";
import {
  countedCleaningMinutes,
  formatCleaningMinutes,
  historyRowDuration,
  summarizeCleaningDurations,
} from "@/lib/cleaning-record-duration";

describe("formatCleaningMinutes", () => {
  it("언어별 단위 · 붙임", () => {
    expect(formatCleaningMinutes(18, "ko", { hour: "시간", min: "분" })).toBe("18분");
    expect(formatCleaningMinutes(70, "ko", { hour: "시간", min: "분" })).toBe("1시간 10분");
    expect(formatCleaningMinutes(60, "ko", { hour: "시간", min: "분" })).toBe("1시간");
    expect(formatCleaningMinutes(70, "ja", { hour: "時間", min: "分" })).toBe("1時間10分");
    expect(formatCleaningMinutes(18, "ja", { hour: "時間", min: "分" })).toBe("18分");
    expect(formatCleaningMinutes(70, "en", { hour: "h", min: "m" })).toBe("1h 10m");
    expect(formatCleaningMinutes(18, "en", { hour: "h", min: "m" })).toBe("18m");
  });
});

describe("청소 기록 소요 상황표", () => {
  const cases = [
    ["완료 · 18분", { finished: true, seconds: 1080 }, 18],
    ["완료 · 초 단위 반올림", { finished: true, seconds: 1109 }, 18],
    ["취소 · 소요 있어도 세지 않음", { finished: false, seconds: 1080 }, null],
    ["진행 중", { finished: false, seconds: null }, null],
    ["시각 모름(완료 · 0초)", { finished: true, seconds: 0 }, null],
    ["시간 값 없음", { finished: true, seconds: null }, null],
    ["처리 끝", { finished: true, closed: true, seconds: 600 }, null],
  ] as const;
  for (const [name, rec, want] of cases) {
    it(name, () => expect(countedCleaningMinutes(rec)).toBe(want));
  }

  it("합계 · 평균은 센 기록만", () => {
    const s = summarizeCleaningDurations(cases.map(([, rec]) => rec));
    expect(s).toEqual({ totalMin: 36, timedCount: 2, avgMin: 18 });
  });

  it("센 기록이 없으면 평균 없음", () => {
    expect(summarizeCleaningDurations([{ finished: false, seconds: 100 }])).toEqual({
      totalMin: 0,
      timedCount: 0,
      avgMin: null,
    });
  });
});

describe("관리자 기록 줄 (화면 · 내보내기 공용)", () => {
  const rows = [
    { status: "done", closed: false, dur: 18 },
    { status: "cancelled", closed: false, dur: 18 },
    { status: "done", closed: true, dur: null },
    { status: "progress", closed: false, dur: null },
    { status: "done", closed: false, dur: 70 },
  ];
  it("취소가 섞여도 합계는 완료 줄만(18 + 70)", () => {
    expect(summarizeCleaningDurations(rows.map(historyRowDuration)).totalMin).toBe(88);
  });
  it("취소 줄 값은 없음", () => {
    expect(countedCleaningMinutes(historyRowDuration(rows[1]))).toBeNull();
  });
});
