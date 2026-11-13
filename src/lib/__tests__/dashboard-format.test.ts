import { describe, expect, it } from "vitest";
import { formatRequestDate, joinPlace, resolveCleaningTaskLabel, splitSessionRoomLabel } from "@/lib/dashboard-format";

const labels = { arakicho_a: "Arakicho A", takadanobaba: "Takadanobaba", okubo_a: "Okubo A" };
const copy = { today: "Today {time}", yesterday: "Yesterday" };

describe("진행 중 청소 유형 — 키를 번역한다", () => {
  const options = { checkout: "체크아웃 청소", long_stay: "장기 투숙 청소", simple: "간단 청소" };

  it("task_label 키를 사전 문구로 바꾼다", () => {
    expect(resolveCleaningTaskLabel("checkout", options)).toBe("체크아웃 청소");
    expect(resolveCleaningTaskLabel("long_stay", options)).toBe("장기 투숙 청소");
  });

  it("키가 아닌 옛 자유 글자는 그대로, 비어 있으면 빈 글자", () => {
    expect(resolveCleaningTaskLabel("특별 청소", options)).toBe("특별 청소");
    expect(resolveCleaningTaskLabel(null, options)).toBe("");
    expect(resolveCleaningTaskLabel("", options)).toBe("");
  });
});

describe("진행 중 청소 방 칸 — 방 번호와 건물 이름 나누기", () => {
  it("건물 + 방 번호", () => {
    expect(splitSessionRoomLabel("아라키초A 201", labels)).toEqual({ building: "Arakicho A", room: "201" });
  });
  it("방이 하나뿐인 건물은 건물 이름만", () => {
    expect(splitSessionRoomLabel("오쿠보A", labels)).toEqual({ building: "Okubo A", room: "" });
  });
  it("공백이 들어간 건물 이름도 한 건물로", () => {
    const withStay = { ...labels, stay_ari: "STAY ARI Apartment Hotel" };
    expect(splitSessionRoomLabel("STAY ARI Apartment Hotel 301", withStay)).toEqual({ building: "STAY ARI Apartment Hotel", room: "301" });
  });
});

describe("요청 위치 — 빈 값 · 「-」 는 뺀다", () => {
  it("방이 「-」 이면 꼬리 없이", () => {
    expect(joinPlace("다카다노바바", "-", labels)).toBe("Takadanobaba");
    expect(joinPlace("다카다노바바", "  ", labels)).toBe("Takadanobaba");
  });
  it("건물 · 방 둘 다 있으면 점으로", () => {
    expect(joinPlace("아라키초A", "201", labels)).toBe("Arakicho A · 201");
  });
  it("둘 다 없으면 빈 글자", () => {
    expect(joinPlace(null, "-", labels)).toBe("");
  });
});

describe("요청 날짜 — 도쿄 기준 오늘 · 어제 · 짧은 날짜", () => {
  // 2026-11-13 00:30 도쿄 = 2026-11-12 15:30 UTC
  const now = new Date("2026-11-13T00:30:00+09:00");

  it("오늘이면 시각과 함께", () => {
    expect(formatRequestDate("2026-11-13T09:12:00+09:00", now, copy)).toBe("Today 09:12");
    expect(formatRequestDate("2026-11-13T00:00:00+09:00", now, copy)).toBe("Today 00:00");
  });

  it("도쿄 자정 바로 전은 어제(UTC 날짜로는 같은 날이어도)", () => {
    expect(formatRequestDate("2026-11-12T23:59:00+09:00", now, copy)).toBe("Yesterday");
    // 2026-11-12 14:59 UTC = 도쿄 23:59 — UTC 날짜 11/12, 도쿄 날짜도 11/12
    expect(formatRequestDate("2026-11-12T14:59:00Z", now, copy)).toBe("Yesterday");
    // 2026-11-12 15:00 UTC = 도쿄 11/13 00:00 — UTC 날짜는 어제지만 도쿄로는 오늘
    expect(formatRequestDate("2026-11-12T15:00:00Z", now, copy)).toBe("Today 00:00");
  });

  it("그 전은 월/일", () => {
    expect(formatRequestDate("2026-11-10T12:00:00+09:00", now, copy)).toBe("11/10");
    expect(formatRequestDate("2026-10-31T12:00:00+09:00", now, copy)).toBe("10/31");
  });

  it("달 · 해 경계의 어제", () => {
    const first = new Date("2026-12-01T10:00:00+09:00");
    expect(formatRequestDate("2026-11-30T20:00:00+09:00", first, copy)).toBe("Yesterday");
    const jan = new Date("2027-01-01T10:00:00+09:00");
    expect(formatRequestDate("2026-12-31T20:00:00+09:00", jan, copy)).toBe("Yesterday");
  });
});
