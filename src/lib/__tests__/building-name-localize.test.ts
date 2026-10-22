import { describe, expect, it } from "vitest";
import { localizeBuildingName, localizeRoomPlaceLabel } from "@/lib/room-label-normalization";

/**
 * 모바일 다국어 점검(2026-10-22) — 데이터는 건물을 한국어 정규 명칭으로 들고 다니므로 그릴 때 바꾼다.
 * 가동률 · 매출 · 판매 캘린더 · 알림 등 일본어 · 영어 화면에 한국어 건물 이름이 남아 있었다.
 */
const ja = {
  arakicho_a: "荒木町A",
  kabukicho: "歌舞伎町",
  okubo_a: "大久保A",
  sano: "佐野",
  stay_ari: "STAY ARI Apartment Hotel",
};

describe("localizeBuildingName", () => {
  it("한국어 정규 명칭 · 다른 표기 모두 보는 사람 언어로", () => {
    expect(localizeBuildingName("가부키초", ja)).toBe("歌舞伎町");
    expect(localizeBuildingName("Kabukicho", ja)).toBe("歌舞伎町");
    expect(localizeBuildingName("사노", ja)).toBe("佐野");
  });

  it("모르는 이름 · 객실 번호는 그대로", () => {
    expect(localizeBuildingName("New Building", ja)).toBe("New Building");
    expect(localizeBuildingName("301", ja)).toBe("301");
  });
});

describe("localizeRoomPlaceLabel", () => {
  it("「건물 객실」의 건물 부분만 바꾼다", () => {
    expect(localizeRoomPlaceLabel("아라키초A 201", ja)).toBe("荒木町A 201");
  });

  it("독채(건물 이름 하나)도 바꾼다", () => {
    expect(localizeRoomPlaceLabel("오쿠보A", ja)).toBe("大久保A");
  });

  it("모르는 건물이면 그대로", () => {
    expect(localizeRoomPlaceLabel("Unknown 101", ja)).toBe("Unknown 101");
  });
});
