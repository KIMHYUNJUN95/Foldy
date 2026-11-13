import { describe, expect, it } from "vitest";
import { cleanActivityPlace, getActivityWhat, joinBuildingRoom, type HomeActivityWhatCopy } from "@/lib/home-activity";
import { formatTokyoDateTitle } from "@/lib/home-date-title";

describe("홈 장소 문자열 — 빈 방이면 꼬리 부호 없음", () => {
  it("방이 비었거나 「-」 이면 건물만", () => {
    expect(joinBuildingRoom("다카다노바바", "-")).toBe("다카다노바바");
    expect(joinBuildingRoom("다카다노바바", "")).toBe("다카다노바바");
    expect(joinBuildingRoom("다카다노바바", null)).toBe("다카다노바바");
  });
  it("방이 있으면 공백으로 잇는다", () => {
    expect(joinBuildingRoom("아라키초A", "201")).toBe("아라키초A 201");
  });
});

const copy: HomeActivityWhatCopy = {
  cleaningNone: "청소 완료",
  cleaningByType: { checkout: "체크아웃 청소 완료", simple: "간단 청소 완료" },
  cleaningOther: "{task} 완료",
  lostItem: "분실물 접수",
  maintenance: "수리 요청",
  order: "비품 주문",
  linen: "리넨 반품",
};

describe("홈 오늘 기록 — 종류 → 첫 줄 문구", () => {
  it("종류마다 문구가 맞는다", () => {
    expect(getActivityWhat("lost_item_reported", copy)).toBe("분실물 접수");
    expect(getActivityWhat("maintenance_reported", copy)).toBe("수리 요청");
    expect(getActivityWhat("order_requested", copy)).toBe("비품 주문");
    expect(getActivityWhat("linen_returned", copy)).toBe("리넨 반품");
  });
  it("청소는 유형별 문구, 모르는 유형은 그 글자 + 완료, 유형 없으면 「청소 완료」", () => {
    expect(getActivityWhat("cleaning_completed", copy, "checkout")).toBe("체크아웃 청소 완료");
    expect(getActivityWhat("cleaning_completed", copy, "특별 청소")).toBe("특별 청소 완료");
    expect(getActivityWhat("cleaning_completed", copy, "")).toBe("청소 완료");
    expect(getActivityWhat("cleaning_completed", copy, undefined)).toBe("청소 완료");
  });
});

describe("홈 큰 제목 — 도쿄 오늘 날짜", () => {
  const noon = new Date("2026-11-13T03:00:00Z"); // 도쿄 12:00 금요일
  it("ko · ja · en 형식", () => {
    expect(formatTokyoDateTitle("ko", noon)).toBe("11월 13일 금요일");
    expect(formatTokyoDateTitle("ja", noon)).toBe("11月13日(金)");
    expect(formatTokyoDateTitle("en", noon)).toBe("Friday, November 13");
  });
  it("UTC 15:00 이후는 도쿄 다음 날", () => {
    const edge = new Date("2026-11-13T15:00:00Z");
    expect(formatTokyoDateTitle("ko", edge)).toBe("11월 14일 토요일");
    expect(formatTokyoDateTitle("en", new Date("2026-11-13T14:59:59Z"))).toBe("Friday, November 13");
  });
});

describe("오늘 기록 장소 정리", () => {
  it("「-」 뿐이거나 비면 빈 글자, 꼬리 「-」 제거", () => {
    expect(cleanActivityPlace("-")).toBe("");
    expect(cleanActivityPlace("")).toBe("");
    expect(cleanActivityPlace(null)).toBe("");
    expect(cleanActivityPlace("다카다노바바 -")).toBe("다카다노바바");
    expect(cleanActivityPlace("아라키초A 201")).toBe("아라키초A 201");
  });
});
