import { describe, expect, it } from "vitest";
import { BUILDING_ORDER, buildingKeyOf } from "@/components/admin/cleaning/cleaning-console-data";
import {
  CALENDAR_BUILDING_ORDER,
  CANONICAL_TO_BUILDING_KEY,
  getDisplayRoomLabel,
  isExcludedOperationalProperty,
} from "@/lib/room-label-normalization";

/**
 * 청소 콘솔(대시보드) · 모바일 청소의 건물 순서 = 예약 캘린더 순서(2026-10-15).
 * 스테이아리가 `BUILDING_ORDER` 에 없어 대시보드 오늘 현황에서 통째로 사라졌던 회귀를 막는다. docs/product/07-cleaning-workflow.md
 */
describe("cleaning building order", () => {
  const operational = CALENDAR_BUILDING_ORDER.filter((name) => !isExcludedOperationalProperty(name));

  it("follows the reservation calendar order (operational buildings only)", () => {
    expect(BUILDING_ORDER).toEqual(operational.map((name) => CANONICAL_TO_BUILDING_KEY[name]));
  });

  it("includes STAY ARI right after Kabukicho", () => {
    expect(BUILDING_ORDER.indexOf("stay_ari")).toBe(BUILDING_ORDER.indexOf("kabukicho") + 1);
    expect(buildingKeyOf("STAY ARI Apartment Hotel")).toBe("stay_ari");
  });

  it("never returns a key the console cannot draw — unknown or non-operational buildings fall to the 'other' group", () => {
    expect(buildingKeyOf("사노")).toBeNull();
    expect(buildingKeyOf("New Building")).toBeNull();
    for (const name of operational) expect(BUILDING_ORDER).toContain(buildingKeyOf(name));
  });

  it("shows STAY ARI rooms as numbers only", () => {
    expect(getDisplayRoomLabel("STAY ARI Apartment Hotel", "O103")).toBe("103");
  });
});
