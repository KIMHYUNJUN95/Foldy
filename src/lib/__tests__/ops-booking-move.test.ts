import { describe, expect, it } from "vitest";
import {
  buildBeds24BookingMove,
  diffMoveReadback,
  moveTargetNights,
  validateReservationMove,
} from "@/lib/ops-booking-move";

const original = { arrival: "2026-10-17", departure: "2026-10-21" };
const today = "2026-10-19";

describe("validateReservationMove", () => {
  it("같은 줄 · 같은 날짜는 옮길 것이 없다", () => {
    expect(validateReservationMove({ next: original, original, sameRow: true, today: "2026-10-01" })).toBe("same_place");
  });

  it("채널 예약도 날짜를 옮긴다(2026-10-20 — 전엔 잠갔다)", () => {
    expect(validateReservationMove({ next: original, original, sameRow: false, today: "2026-10-01" })).toBeNull();
    expect(
      validateReservationMove({
        next: { arrival: "2026-10-18", departure: "2026-10-22" },
        original,
        sameRow: false,
        today: "2026-10-01",
      }),
    ).toBeNull();
  });

  it("직접 · 수기 예약은 날짜도 옮긴다 — 체크인을 과거로 옮기는 것만 막는다", () => {
    const next = { arrival: "2026-10-25", departure: "2026-10-27" };
    expect(validateReservationMove({ next, original, sameRow: true, today })).toBeNull();
    expect(
      validateReservationMove({ next: { arrival: "2026-10-18", departure: "2026-10-20" }, original, sameRow: false, today }),
    ).toBe("past_arrival");
  });

  it("묵고 있는 손님을 다른 방으로 — 체크인은 그대로라 과거여도 된다", () => {
    expect(validateReservationMove({ next: original, original, sameRow: false, today })).toBeNull();
  });

  it("끝난 숙박 · 뒤집힌 날짜는 거절", () => {
    expect(validateReservationMove({ next: original, original, sameRow: false, today: "2026-10-21" })).toBe("past_stay");
    expect(
      validateReservationMove({ next: { arrival: "2026-10-25", departure: "2026-10-25" }, original, sameRow: false, today }),
    ).toBe("bad_dates");
  });
});

describe("moveTargetNights", () => {
  it("다른 줄로 옮기면 남은 밤 전부가 새 밤", () => {
    expect(moveTargetNights({ next: original, original, sameRow: false, today })).toEqual(["2026-10-19", "2026-10-20"]);
  });

  it("같은 줄에서 날짜만 옮기면 원래 묵던 밤은 빼고 새로 차지하는 밤만", () => {
    const next = { arrival: "2026-10-19", departure: "2026-10-23" };
    expect(moveTargetNights({ next, original, sameRow: true, today })).toEqual(["2026-10-21", "2026-10-22"]);
  });
});

describe("buildBeds24BookingMove", () => {
  it("객실만 — 날짜가 같으면 보내지 않는다(이름 · 금액은 절대 안 보냄)", () => {
    expect(buildBeds24BookingMove("68213907", { next: original, original, roomId: "383980" })).toEqual({ id: 68213907, roomId: 383980 });
  });

  it("직접 예약 — 바뀐 날짜만 함께", () => {
    expect(
      buildBeds24BookingMove("1", { next: { arrival: "2026-10-25", departure: "2026-10-21" }, original, roomId: "2" }),
    ).toEqual({ arrival: "2026-10-25", id: 1, roomId: 2 });
  });
});

describe("diffMoveReadback", () => {
  it("다시 읽은 객실 · 날짜가 같으면 빈 배열", () => {
    expect(diffMoveReadback({ id: 1, roomId: 383980 }, { roomId: 383980, arrival: "2026-10-17" })).toEqual([]);
  });

  it("Beds24 가 받기만 하고 안 옮겼으면 roomId 를 돌려준다", () => {
    expect(diffMoveReadback({ id: 1, roomId: 383980, arrival: "2026-10-25" }, { roomId: 383979, arrival: "2026-10-17" })).toEqual([
      "roomId",
      "arrival",
    ]);
  });
});
