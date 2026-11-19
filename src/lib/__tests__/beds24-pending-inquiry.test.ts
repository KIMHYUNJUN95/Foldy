import { describe, expect, it } from "vitest";

import {
  excludePendingInquiries,
  isPendingBeds24Inquiry,
  isPendingBeds24InquiryStatus,
} from "@/lib/beds24/reservation-status";
import { isSalesCountedReservation } from "@/lib/ops-sales-summary";

import { createFakeSupabase } from "./fake-supabase";

// 2026-11-19 — Beds24 채널 설정을 바꿔 문의(inquiry · 5) · 예약 요청(request · 3)도 들어온다. 우리 표에는 `confirmed` 로
// 적히고 원본 상태는 `raw_payload.status` 에만 남는다. 운영 화면은 이 판정 하나로 뺀다.

describe("isPendingBeds24InquiryStatus", () => {
  it("문의 · 예약 요청은 DB 거르기와 같은 정확한 값(글자 · 숫자)만 문의다", () => {
    for (const value of ["inquiry", "request", "3", "5", 3, 5]) {
      expect(isPendingBeds24InquiryStatus(value)).toBe(true);
    }
  });

  it("상태가 없거나 확정 · 신규 · 차단 · 취소면 문의가 아니다(상태 없음 = 센다)", () => {
    for (const value of [null, undefined, "", "  ", "new", "confirmed", "black", "cancelled", "modified", 0, 1, 2, 4, "1", "2", "4", "35"]) {
      expect(isPendingBeds24InquiryStatus(value)).toBe(false);
    }
  });

  it("대소문자 · 공백이 다른 값은 DB 가 못 거르므로 JS 도 문의로 보지 않는다(= 센다, 화면마다 같게)", () => {
    for (const value of ["Inquiry", " request ", "REQUEST", " 5 ", true, {}]) {
      expect(isPendingBeds24InquiryStatus(value)).toBe(false);
    }
  });
});

describe("isPendingBeds24Inquiry (raw_payload)", () => {
  it("raw_payload 의 status 를 본다", () => {
    expect(isPendingBeds24Inquiry({ status: "inquiry" })).toBe(true);
    expect(isPendingBeds24Inquiry({ status: 3 })).toBe(true);
    expect(isPendingBeds24Inquiry({ status: "new" })).toBe(false);
    expect(isPendingBeds24Inquiry({})).toBe(false);
    expect(isPendingBeds24Inquiry(null)).toBe(false);
    expect(isPendingBeds24Inquiry("inquiry")).toBe(false);
  });
});

describe("excludePendingInquiries (DB 에서 거르기)", () => {
  const rows = [
    { id: "inq", raw_payload: { status: "inquiry" } },
    { id: "req", raw_payload: { status: "request" } },
    { id: "num3", raw_payload: { status: 3 } },
    { id: "num5", raw_payload: { status: 5 } },
    { id: "str5", raw_payload: { status: "5" } },
    { id: "new", raw_payload: { status: "new" } },
    { id: "black", raw_payload: { status: "black" } },
    // 원본 상태가 없는 줄(운영 3,489줄) — `NOT IN` 이면 NULL 이라 빠지지만 이 거르기는 남겨야 한다.
    { id: "none", raw_payload: { bookId: 1 } },
  ];

  it("문의 · 요청만 빼고 상태 없는 줄은 남긴다", async () => {
    const { client } = createFakeSupabase({ reservations: rows.map((row) => ({ ...row })) });
    const query = excludePendingInquiries(client.from("reservations").select());
    const { data } = (await query) as { data: Array<{ id: string }> };
    expect(data.map((row) => row.id).sort()).toEqual(["black", "new", "none"]);
  });

  it("raw_payload 를 JSON 포함(cs)의 부정으로 거른다 — NULL 상태를 떨어뜨리는 NOT IN 을 쓰지 않는다", () => {
    const calls: Array<[string, string, unknown]> = [];
    const builder = {
      not(column: string, operator: string, value: unknown) {
        calls.push([column, operator, value]);
        return builder;
      },
    };
    excludePendingInquiries(builder);
    expect(calls.length).toBeGreaterThan(0);
    for (const [column, operator, value] of calls) {
      expect(column).toBe("raw_payload");
      expect(operator).toBe("cs");
      expect(isPendingBeds24Inquiry(JSON.parse(String(value)))).toBe(true);
    }
  });
});

// 회귀 테스트 — 판매 · 매출 판정을 문의 판정 위로 옮겼어도 **예전(isLegacyConfirmedStatus 만 쓰던 때)과 같은 결과**인지 본다.
// " Inquiry" 처럼 문의 판정에 안 걸리는 값도 예전 규칙(1 · 2 · new · confirmed 만 셈)으로 빠진다.
describe("isSalesCountedReservation — 예전과 같은 결과(회귀)", () => {
  it("문의 · 요청은 예전처럼 판매 · 매출에서 빠지고, 상태 없음 · 신규 · 확정은 예전처럼 센다", () => {
    for (const status of ["inquiry", "request", " Inquiry", 3, 5]) {
      expect(isSalesCountedReservation({ raw: { status }, status: "confirmed" })).toBe(false);
    }
    for (const status of [null, "new", "confirmed", 1, 2]) {
      expect(isSalesCountedReservation({ raw: { status }, status: "confirmed" })).toBe(true);
    }
  });
});
