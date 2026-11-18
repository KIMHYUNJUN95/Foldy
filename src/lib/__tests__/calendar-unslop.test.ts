import { describe, expect, it } from "vitest";

import { getCalendarReservationNumbers } from "@/lib/reservation-display-id";
import { barLabelMaxWidth, roomRowSubPrefix } from "@/lib/calendar-row-labels";

describe("예약 캘린더 예약번호 — 채널 번호 먼저, Beds24 번호는 보조", () => {
  it("채널 번호(apiReference)가 있으면 그게 먼저, Beds24 번호는 따로", () => {
    expect(
      getCalendarReservationNumbers({ raw_payload: { apiReference: "HMBN3ZNEBA", bookId: 71402312 }, source_reservation_id: "71402312" }),
    ).toEqual({ primary: "HMBN3ZNEBA", beds24Id: "71402312" });
  });
  it("Booking.com 숫자 번호도 채널 번호로 · 공백은 다듬는다", () => {
    expect(
      getCalendarReservationNumbers({ raw_payload: { apiReference: " 4014852166 ", bookId: "71402310" }, source_reservation_id: "71402310::room::201" }),
    ).toEqual({ primary: "4014852166", beds24Id: "71402310" });
  });
  it("채널 번호가 없으면(직접 예약) Beds24 번호만 — 보조는 없다", () => {
    expect(getCalendarReservationNumbers({ raw_payload: { bookId: 555 }, source_reservation_id: "555" })).toEqual({
      primary: "555",
      beds24Id: null,
    });
  });
  it("채널 번호와 Beds24 번호가 같으면 보조를 두 번 그리지 않는다", () => {
    expect(getCalendarReservationNumbers({ raw_payload: { apiReference: "555" }, source_reservation_id: "555" })).toEqual({
      primary: "555",
      beds24Id: null,
    });
  });
  it("둘 다 없으면 저장 번호(객실 꼬리표 뗌)", () => {
    expect(getCalendarReservationNumbers({ raw_payload: null, source_reservation_id: "999::room::201" })).toEqual({
      primary: "999",
      beds24Id: null,
    });
  });
});

describe("오늘 운영 아랫글 — 1동 1실은 건물 이름을 두 번 쓰지 않는다", () => {
  it("건물 전체 보기 · 보통 방이면 건물 이름을 붙인다", () => {
    expect(roomRowSubPrefix({ selectedProperty: null, propertyName: "아라키초A", roomLabel: "201" })).toBe(true);
  });
  it("방 라벨이 건물 이름과 같으면(1동 1실) 빼기", () => {
    expect(roomRowSubPrefix({ selectedProperty: null, propertyName: "오쿠보A", roomLabel: "오쿠보A" })).toBe(false);
    expect(roomRowSubPrefix({ selectedProperty: null, propertyName: "오쿠보A", roomLabel: " 오쿠보A " })).toBe(false);
  });
  it("건물을 골랐으면 언제나 빼기", () => {
    expect(roomRowSubPrefix({ selectedProperty: "아라키초A", propertyName: "아라키초A", roomLabel: "201" })).toBe(false);
  });
});

describe("모바일 막대 글자 — 객실 칸 뒤로 넘어간 막대는 보이는 폭만큼만", () => {
  it("막대가 객실 칸 오른쪽에서 시작하면 제한 없음", () => {
    expect(barLabelMaxWidth({ barLeft: 120, barRight: 300, visibleLeft: 64 })).toBeNull();
  });
  it("왼쪽이 가려졌으면 보이는 폭 - 안쪽 여백", () => {
    expect(barLabelMaxWidth({ barLeft: 10, barRight: 200, visibleLeft: 64 })).toBe(200 - 64 - 16);
  });
  it("거의 다 가려졌으면 0 아래로 내려가지 않는다", () => {
    expect(barLabelMaxWidth({ barLeft: -100, barRight: 70, visibleLeft: 64 })).toBe(0);
  });
});
