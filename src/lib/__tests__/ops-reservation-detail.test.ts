import { describe, expect, it } from "vitest";
import {
  buildOpsReservationDetail,
  hasGuestContactDetails,
  type ReservationDetailRow,
} from "@/lib/ops-reservation-detail";

/**
 * 예약 상세 패널에 보낼 값.
 *
 * 계약: `src/lib/ops-reservation-detail.ts`
 *
 * **원본을 통째로 넘기지 않는다** — Beds24 예약 JSON 에는 결제 토큰이 들어 있다.
 * 이름을 지정해 꺼낸 필드만 나가야 하고, 그걸 테스트로 못 박는다.
 */
const row = (raw: Record<string, unknown>): ReservationDetailRow => ({
  check_in_date: "2026-10-11",
  check_out_date: "2026-10-17",
  guest_name: "Hendrik Venter",
  id: "r1",
  property_name: "아라키초A",
  raw_payload: raw,
  room_label: "202",
  status: "confirmed",
});

describe("buildOpsReservationDetail", () => {
  it("결제 토큰은 절대 밖으로 나가지 않는다", () => {
    const detail = buildOpsReservationDetail(
      row({ pcibookingToken: "pci_secret", stripeToken: "tok_secret", price: 1000 }),
    );
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain("tok_secret");
    expect(serialized).not.toContain("pci_secret");
  });

  it("Beds24 필드를 이름대로 꺼낸다", () => {
    const detail = buildOpsReservationDetail(
      row({
        apiMessage: "Payment collected by Booking.com",
        apiReference: "HMZEYJJX5W",
        bookingTime: "2026-09-13T01:19:38Z",
        comments: "Late check-in please",
        commission: 23696,
        country2: "ca",
        email: "guest@example.com",
        id: 92553068,
        lang: "en",
        numAdult: 2,
        numChild: 1,
        price: 136973,
        referer: "Booking.com",
      }),
    );
    expect(detail).toMatchObject({
      beds24Id: "92553068",
      bookedAt: "2026-09-13T01:19:38Z",
      channelMessage: "Payment collected by Booking.com",
      channelName: "Booking.com",
      channelReference: "HMZEYJJX5W",
      commission: 23696,
      countryCode: "CA",
      email: "guest@example.com",
      guestComments: "Late check-in please",
      language: "en",
      numAdult: 2,
      numChild: 1,
      price: 136973,
    });
  });

  it("빈 문자열·공백은 없는 것이다 — 화면이 줄째 숨긴다", () => {
    const detail = buildOpsReservationDetail(
      row({ arrivalTime: "", comments: "   ", email: "", notes: "" }),
    );
    expect(detail.arrivalTime).toBeNull();
    expect(detail.guestComments).toBeNull();
    expect(detail.email).toBeNull();
    expect(detail.internalNotes).toBeNull();
  });

  it("금액 0 은 0 이고, 없는 금액은 null 이다 — 둘은 다르다", () => {
    expect(buildOpsReservationDetail(row({ price: 0 })).price).toBe(0);
    expect(buildOpsReservationDetail(row({})).price).toBeNull();
  });

  it("번호 0 은 없는 것이다 — Beds24 가 빈 그룹 번호를 0 으로 준다", () => {
    expect(buildOpsReservationDetail(row({ masterId: 0 })).groupMasterId).toBeNull();
    expect(buildOpsReservationDetail(row({ masterId: 555 })).groupMasterId).toBe("555");
  });

  it("채널이 국가를 안 줬으면 전화번호로 추정하고 출처를 phone 으로 적는다 — Airbnb 절반이 이렇다", () => {
    const detail = buildOpsReservationDetail(row({ country: "", phone: "61412345678" }));
    expect(detail.countryCode).toBe("AU");
    expect(detail.countrySource).toBe("phone");
  });

  it("채널이 준 국가가 있으면 그걸 쓴다", () => {
    const detail = buildOpsReservationDetail(row({ country2: "CA", phone: "61412345678" }));
    expect(detail.countryCode).toBe("CA");
    expect(detail.countrySource).toBe("channel");
  });

  it("국가 코드가 없으면 적힌 글자를 그대로 쓴다", () => {
    const detail = buildOpsReservationDetail(row({ country: "Republic of Korea" }));
    expect(detail.countryCode).toBeNull();
    expect(detail.countryText).toBe("Republic of Korea");
  });

  it("주소는 채워진 조각만 이어 붙인다", () => {
    const detail = buildOpsReservationDetail(
      row({ address: "1-2-3 Shinjuku", city: "Tokyo", postcode: "", state: "" }),
    );
    expect(detail.address).toBe("1-2-3 Shinjuku, Tokyo");
  });

  it("휴대폰이 전화와 같으면 한 번만 보인다", () => {
    const detail = buildOpsReservationDetail(row({ mobile: "+81 90", phone: "+81 90" }));
    expect(detail.phone).toBe("+81 90");
    expect(detail.mobile).toBeNull();
  });

  it("원본이 객체가 아니어도 죽지 않는다", () => {
    const detail = buildOpsReservationDetail({ ...row({}), raw_payload: null });
    expect(detail.guestName).toBe("Hendrik Venter");
    expect(detail.beds24Id).toBeNull();
  });
});

/**
 * 「손님」 칸은 보일 값이 하나라도 있을 때만 그린다.
 * Airbnb 문의(inquiry) 원본은 이메일 · 전화 · 주소가 비어 오고, 나라 · 언어도 빈 문자열일 수 있다 —
 * 그때 제목만 있는 빈 칸이 남으면 안 된다(PC 패널 · 모바일 시트 같은 판정).
 */
describe("hasGuestContactDetails", () => {
  it("문의 원본처럼 연락처 · 나라 · 언어가 모두 비면 false", () => {
    const detail = buildOpsReservationDetail(
      row({ address: "", country: "", email: "", firstName: "Guest", lang: "", mobile: "", phone: "", status: "inquiry" }),
    );
    expect(hasGuestContactDetails(detail)).toBe(false);
  });

  it("언어 하나만 있어도 true", () => {
    const detail = buildOpsReservationDetail(row({ email: "", lang: "en", phone: "" }));
    expect(hasGuestContactDetails(detail)).toBe(true);
  });

  it("코드로 못 읽는 나라 글자만 있어도 true", () => {
    const detail = buildOpsReservationDetail(row({ country: "Narnia" }));
    expect(hasGuestContactDetails(detail)).toBe(true);
  });

  it("이메일 · 전화 · 주소가 있으면 true", () => {
    expect(hasGuestContactDetails(buildOpsReservationDetail(row({ email: "a@example.com" })))).toBe(true);
    expect(hasGuestContactDetails(buildOpsReservationDetail(row({ phone: "+81-90-0000-0000" })))).toBe(true);
    expect(hasGuestContactDetails(buildOpsReservationDetail(row({ city: "Tokyo" })))).toBe(true);
  });
});
