import { describe, expect, it } from "vitest";
import { splitOpsBars } from "@/lib/ops-calendar-occupancy";
import type { OpsCalendarBar } from "@/lib/ops-calendar";
import { opsVacantRoomKeys } from "@/lib/ops-vacant-today";

/**
 * 오늘 빈방만.
 *
 * 계약: `src/lib/ops-vacant-today.ts` — 저쪽 `roomsVacantTodaySet` 과 같은 판정.
 */
const TODAY = "2026-09-29";
const bar = (roomKey: string, checkIn: string, checkOut: string, isCancelled = false): OpsCalendarBar => ({
  channel: "airbnb",
  checkIn,
  checkOut,
  guestName: "g",
  id: `${roomKey}-${checkIn}`,
  isCancelled,
  kind: isCancelled ? "cancelled" : "confirmed",
  roomKey,
});
// 점유는 「예약 표시」 필터와 무관한 확정 숙박(`splitOpsBars().stays`)으로 센다.
const vacant = (bars: OpsCalendarBar[]) =>
  [...opsVacantRoomKeys({ stays: splitOpsBars(bars, ["confirmed", "cancelled"]).stays, roomKeys: ["A", "B", "C"], today: TODAY })].sort();

describe("opsVacantRoomKeys", () => {
  it("오늘 밤을 차지한 예약이 있으면 빈방이 아니다", () => {
    expect(vacant([bar("A", "2026-09-28", "2026-09-30")])).toEqual(["B", "C"]);
    expect(vacant([bar("A", TODAY, "2026-09-30")])).toEqual(["B", "C"]);
  });

  it("오늘 체크아웃하는 예약은 오늘 밤을 차지하지 않는다", () => {
    expect(vacant([bar("A", "2026-09-27", TODAY)])).toEqual(["A", "B", "C"]);
  });

  it("취소된 예약은 안 센다", () => {
    expect(vacant([bar("A", "2026-09-28", "2026-09-30", true)])).toEqual(["A", "B", "C"]);
  });

  it("내일부터의 예약은 오늘을 막지 않는다", () => {
    expect(vacant([bar("B", "2026-09-30", "2026-10-02")])).toEqual(["A", "B", "C"]);
  });
});
