import { describe, expect, it } from "vitest";
import { localizeStoredPlaceText } from "@/lib/attendance-site-display";
import { getDictionary } from "@/lib/i18n";
import { resolveRequestLocation } from "@/lib/request-location";

/**
 * 어드민(PC) 다국어 점검(2026-10-23) — 수리 · 분실물 · 주문 위치와 교통비 항목에 한국어 건물 이름이 남던 곳.
 */
const en = getDictionary("en").cleaning.buildingLabels;

describe("resolveRequestLocation", () => {
  it("사노 · 스테이아리도 바꾼다 — 예전 파일 안 표에 빠져 있었다", () => {
    expect(resolveRequestLocation("201", undefined, en, "사노").buildingLabel).toBe(en.sano);
    expect(resolveRequestLocation("301", undefined, en, "STAY ARI Apartment Hotel").buildingLabel).toBe(en.stay_ari);
  });

  it("독채의 객실 이름(= 한국어 건물 이름)도 바꾼다", () => {
    expect(resolveRequestLocation("오쿠보A", undefined, en, "오쿠보A")).toEqual({
      buildingLabel: en.okubo_a,
      roomLabel: en.okubo_a,
    });
  });

  it("건물 접두어는 떼고 방 번호는 그대로", () => {
    expect(resolveRequestLocation("아라키초A 201", undefined, en, "아라키초A").roomLabel).toBe("201");
  });
});

describe("localizeStoredPlaceText", () => {
  it("교통비 항목의 저장된 장소 글자를 조각마다 바꾼다", () => {
    expect(localizeStoredPlaceText("아라키초A · 아라키초A 201", "en")).toBe(`${en.arakicho_a} · ${en.arakicho_a} 201`);
    expect(localizeStoredPlaceText("사무실", "en")).toBe(getDictionary("en").attendance.siteOffice);
  });

  it("모르는 글자는 그대로", () => {
    expect(localizeStoredPlaceText("Shinjuku Station", "ja")).toBe("Shinjuku Station");
  });
});
