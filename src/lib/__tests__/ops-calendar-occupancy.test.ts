import { describe, expect, it } from "vitest";

import type { OpsCalendarBar } from "@/lib/ops-calendar";
import { opsStayCellKeys, opsStayClash, splitOpsBars } from "@/lib/ops-calendar-occupancy";
import { detectOneNightGaps } from "@/lib/ops-gap-detection";
import { opsVacantRoomKeys } from "@/lib/ops-vacant-today";

/**
 * 점유는 「예약 표시」 필터와 무관하다(독립 검사 2026-11-26).
 *
 * 회귀: 「취소」나 「문의」만 켜서 확정을 끄면 점유를 보이는 막대로 세던 탓에 팔린 밤이 1박 갭이 되고,
 * 「오늘 빈방」이 모든 방이 되고, 팔린 밤에서 가격 · 최소박을 고를 수 있었다. 옮기기 충돌도 숨긴 확정을 못 봤다.
 */
const bar = (id: string, kind: OpsCalendarBar["kind"], checkIn: string, checkOut: string, roomKey = "A"): OpsCalendarBar => ({
  channel: "airbnb",
  checkIn,
  checkOut,
  guestName: `Guest ${id}`,
  id,
  isCancelled: kind === "cancelled",
  kind,
  roomKey,
});

const BARS = [
  bar("conf", "confirmed", "2026-12-02", "2026-12-03"),
  bar("cxl", "cancelled", "2026-12-04", "2026-12-05"),
  bar("inq", "inquiry", "2026-12-01", "2026-12-02"),
];

describe("splitOpsBars — 그릴 막대와 점유를 나눈다", () => {
  it("확정을 꺼도 확정 숙박은 점유로 남는다", () => {
    const { shown, stays } = splitOpsBars(BARS, ["cancelled"]);
    expect(shown.map((item) => item.id)).toEqual(["cxl"]);
    expect(stays.map((item) => item.id)).toEqual(["conf"]);
  });

  it("문의 · 요청 · 취소는 켜도 점유가 아니다", () => {
    const { shown, stays } = splitOpsBars(BARS, ["confirmed", "inquiry", "request", "cancelled"]);
    expect(shown).toHaveLength(3);
    expect(stays.map((item) => item.id)).toEqual(["conf"]);
  });

  it("아무것도 안 골라도 점유는 그대로", () => {
    expect(splitOpsBars(BARS, []).stays.map((item) => item.id)).toEqual(["conf"]);
  });
});

describe("확정을 끈 상태 — 점유 판정이 무너지지 않는다", () => {
  const { stays } = splitOpsBars(BARS, ["cancelled"]);

  it("오늘 빈방 — 확정 숙박이 있는 방은 빈방이 아니다", () => {
    expect([...opsVacantRoomKeys({ roomKeys: ["A", "B"], stays, today: "2026-12-02" })]).toEqual(["B"]);
  });

  it("팔린 칸 — 격자 창 안의 확정 밤만", () => {
    const dates = ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"];
    expect([...opsStayCellKeys(stays, dates)]).toEqual(["A|2026-12-02"]);
    expect([...opsStayCellKeys(stays)]).toEqual(["A|2026-12-02"]);
  });

  it("1박 갭 — 팔린 밤은 갭이 아니다(일괄 최소박이 예약 밤을 바꾸지 않는다)", () => {
    const occupied = opsStayCellKeys(stays);
    const dates = ["2026-12-01", "2026-12-02", "2026-12-03"];
    // 12/01 은 앞뒤가 비어(12/02 팔림, 11/30 과거 처리) 1박 갭, 12/02 는 팔렸다.
    const gaps = detectOneNightGaps({
      cellAt: (date) => ({ minStay: 2, numAvail: 1, occupied: occupied.has(`A|${date}`), overrideKind: null }),
      dates,
      today: "2026-12-01",
    });
    expect(gaps).not.toContain("2026-12-02");
    // 확정을 보이는 막대로만 셌다면(예전 버그) 12/02 가 빈 칸이 되어 12/01 · 12/02 가 이어진 2박 공실이 된다.
    const wrongOccupied = opsStayCellKeys(splitOpsBars(BARS.filter((item) => item.kind !== "confirmed"), ["cancelled"]).stays);
    expect(wrongOccupied.size).toBe(0);
  });

  it("옮기기 충돌 — 숨긴 확정도 겹침이다", () => {
    expect(opsStayClash(stays, "A", "2026-12-01", "2026-12-03", "moving")?.guestName).toBe("Guest conf");
    expect(opsStayClash(stays, "A", "2026-12-03", "2026-12-05", "moving")).toBeNull();
    expect(opsStayClash(stays, "A", "2026-12-01", "2026-12-03", "conf")).toBeNull();
    expect(opsStayClash(stays, "B", "2026-12-01", "2026-12-03", "moving")).toBeNull();
  });
});
