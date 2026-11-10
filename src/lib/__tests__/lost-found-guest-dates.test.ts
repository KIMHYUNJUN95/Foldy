import { describe, expect, it, vi } from "vitest";

/**
 * 분실물 콘솔 — 예약 없이 손님 이름만 있는 건(2026-11-10 화면 확인에서 크래시).
 * VM 이 날짜를 ""로 넣고 패널이 fmtDate("") → RangeError(Invalid time value) 로 화면 전체가 「문제가 발생했어요」.
 */

vi.mock("server-only", () => ({}));

const { lostItemGuest } = await import("@/lib/admin-lost-found");
const { fmtDate, fmtDateTime, lostGuestLine } = await import("@/components/admin/lost-found/lost-found-console-data");

describe("손님 정보 — 날짜 없으면 null", () => {
  it("예약 없이 이름만 있으면 날짜는 null", () => {
    expect(lostItemGuest(null, "John Doe")).toEqual({ checkIn: null, checkOut: null, name: "John Doe" });
  });

  it("예약이 있으면 예약 날짜", () => {
    expect(
      lostItemGuest({ check_in_date: "2026-11-01", check_out_date: "2026-11-03", guest_name: "A" }, "B"),
    ).toEqual({ checkIn: "2026-11-01", checkOut: "2026-11-03", name: "A" });
  });

  it("예약도 이름도 없으면 null", () => {
    expect(lostItemGuest(null, "")).toBeNull();
  });
});

describe("날짜 표시 — 빈 값 · 잘못된 값에 던지지 않는다", () => {
  it.each(["", "garbage", "2026-13-45"])("fmtDate(%j) → —", (value) => {
    expect(fmtDate(value, "ko")).toBe("—");
  });

  it("정상 날짜는 그대로 표시", () => {
    expect(fmtDate("2026-11-10", "en")).toBe("Nov 10");
  });

  it("fmtDateTime 도 잘못된 날짜에 던지지 않는다", () => {
    expect(fmtDateTime("bad 10:00", "ko")).toBe("— 10:00");
  });
});

describe("패널 손님 줄", () => {
  const template = "{name} · {in} – {out}";
  it("날짜가 없으면 이름만", () => {
    expect(lostGuestLine({ checkIn: null, checkOut: null, name: "John" }, template, "en")).toBe("John");
  });
  it("날짜가 있으면 문구대로", () => {
    expect(lostGuestLine({ checkIn: "2026-11-01", checkOut: "2026-11-03", name: "A" }, template, "en")).toBe("A · Nov 1 – Nov 3");
  });
});

describe("같은 fmtDate 를 쓰는 수리 · 주문 콘솔도 던지지 않는다", async () => {
  const maintenance = await import("@/components/admin/maintenance/maintenance-console-data");
  const orders = await import("@/components/admin/orders/orders-console-data");
  it.each(["", "garbage"])("%j → —", (value) => {
    expect(maintenance.fmtDate(value, "ko")).toBe("—");
    expect(orders.fmtDate(value, "ko")).toBe("—");
  });
});
