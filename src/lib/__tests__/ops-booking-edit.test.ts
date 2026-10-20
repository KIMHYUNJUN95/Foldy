import { describe, expect, it } from "vitest";
import {
  addedNights,
  buildBeds24BookingUpdate,
  diffBookingReadback,
  diffBookingEdit,
  validateBookingEdit,
  type BookingEditDraft,
} from "@/lib/ops-booking-edit";

/**
 * 예약 수정 규칙.
 *
 * 계약: `src/lib/ops-booking-edit.ts`
 * 채널 예약은 날짜·금액을 못 바꾸고(채널이 주인), 메모는 내부 메모에 쓴다(2026-09-29 사용자 결정).
 */
const original: BookingEditDraft = {
  arrival: "2026-10-10",
  departure: "2026-10-12",
  email: "a@example.com",
  guestName: "Kim Hyunjun",
  notes: "",
  numAdult: 2,
  numChild: 0,
  phone: "+81 90",
  totalPrice: 50000,
};
const TODAY = "2026-10-01";

describe("diffBookingEdit — 바뀐 것만", () => {
  it("안 바뀐 필드는 보내지 않는다 — 그 사이 채널이 바꾼 값을 되돌리지 않게", () => {
    expect(diffBookingEdit(original, { ...original, email: "b@example.com" })).toEqual({
      email: "b@example.com",
    });
  });

  it("앞뒤 공백만 다르면 바뀐 것이 아니다", () => {
    expect(diffBookingEdit(original, { ...original, guestName: "  Kim Hyunjun " })).toEqual({});
  });
});

describe("validateBookingEdit", () => {
  const run = (changes: Partial<BookingEditDraft>) => validateBookingEdit({ changes, original, today: TODAY });

  it("바뀐 것이 없으면 보내지 않는다", () => {
    expect(run({})).toBe("no_changes");
  });

  it("채널 예약도 날짜를 바꾼다(2026-10-20 — 전엔 잠갔다)", () => {
    expect(run({ departure: "2026-10-13" })).toBeNull();
    expect(run({ arrival: "2026-10-11" })).toBeNull();
  });

  it("채널 예약도 총액은 바꾼다 — 매출 기록 보정용(손님 청구액은 안 바뀐다)", () => {
    expect(run({ totalPrice: 60000 })).toBeNull();
    expect(run({ totalPrice: 60000 })).toBeNull();
  });

  it("채널 예약도 이름·연락처·인원·내부 메모는 바꾼다", () => {
    expect(run({ email: "b@example.com", notes: "VIP", numAdult: 3 })).toBeNull();
  });

  it("직접·수기 예약은 날짜·금액까지", () => {
    expect(run({ departure: "2026-10-14", totalPrice: 70000 })).toBeNull();
  });

  it("이름을 비우지 못한다", () => {
    expect(run({ guestName: "  " })).toBe("no_guest_name");
  });

  it("성인 1명 이상 · 어린이 0명 이상", () => {
    expect(run({ numAdult: 0 })).toBe("bad_occupancy");
    expect(run({ numChild: -1 })).toBe("bad_occupancy");
  });

  it("체크아웃은 체크인 다음 날 이후", () => {
    expect(run({ departure: "2026-10-10" })).toBe("bad_dates");
  });

  it("체크인을 과거로 옮기지 못한다 — 하지만 묵는 중인 손님의 체크아웃 연장은 된다", () => {
    expect(run({ arrival: "2026-09-30" })).toBe("past_arrival");
    const inHouse = { ...original, arrival: "2026-09-28" };
    expect(
      validateBookingEdit({ changes: { departure: "2026-10-05" }, original: inHouse, today: TODAY }),
    ).toBeNull();
  });

  it("금액은 0 이상 숫자", () => {
    expect(run({ totalPrice: -1 })).toBe("bad_price");
    expect(run({ totalPrice: null })).toBe("bad_price");
    expect(run({ totalPrice: 0 })).toBeNull();
  });
});

describe("addedNights — 새로 묵게 되는 밤만 검사한다", () => {
  it("연장하면 늘어난 밤만", () => {
    expect(addedNights(original, { departure: "2026-10-14" })).toEqual(["2026-10-12", "2026-10-13"]);
  });

  it("줄이면 새 밤이 없다", () => {
    expect(addedNights(original, { departure: "2026-10-11" })).toEqual([]);
  });

  it("앞으로 옮기면 앞쪽 밤만", () => {
    expect(addedNights(original, { arrival: "2026-10-08", departure: "2026-10-10" })).toEqual([
      "2026-10-08",
      "2026-10-09",
    ]);
  });
});

describe("buildBeds24BookingUpdate", () => {
  it("바뀐 필드만 — 이름은 쪼개고, 메모는 notes(내부 메모)로", () => {
    expect(
      buildBeds24BookingUpdate("92553068", { guestName: "Hendrik Venter", notes: "Late check-in" }),
    ).toEqual({ firstName: "Hendrik", id: 92553068, lastName: "Venter", notes: "Late check-in" });
  });

  it("손님 요청(comments)은 절대 건드리지 않는다", () => {
    expect(buildBeds24BookingUpdate("1", { notes: "x" })).not.toHaveProperty("comments");
  });

  it("금액은 price 로", () => {
    expect(buildBeds24BookingUpdate("1", { totalPrice: 60000 })).toEqual({ id: 1, price: 60000 });
  });
});

describe("diffBookingReadback — 수정 뒤 다시 읽은 값 대조 (2026-10-08)", () => {
  const payload = { arrival: "2026-11-01", departure: "2026-11-04", id: 1, notes: "x", numAdult: 2, price: 45000 };
  it("같으면 빈 목록 — 이름 · 메모는 보지 않는다", () => {
    expect(diffBookingReadback(payload, { arrival: "2026-11-01", departure: "2026-11-04", notes: "다름", numAdult: 2, price: "45000.00" })).toEqual([]);
  });
  it("안 바뀐 항목만 돌려준다", () => {
    expect(diffBookingReadback(payload, { arrival: "2026-10-30", departure: "2026-11-04", numAdult: 1, price: 45000 })).toEqual(["arrival", "numAdult"]);
  });
  it("보내지 않은 항목은 안 본다 · 어린이 빈칸은 0", () => {
    expect(diffBookingReadback({ id: 1, numChild: 0 }, { numAdult: 9 })).toEqual([]);
    expect(diffBookingReadback({ id: 1, price: 1000 }, {})).toEqual(["price"]);
  });
});
