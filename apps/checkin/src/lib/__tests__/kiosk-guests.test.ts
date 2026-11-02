import { describe, expect, it } from "vitest";

import { missingFields, type StoredGuest } from "../guest/fields";
import {
  companionsFollowing,
  invalidFieldsOf,
  kioskGuestBodySchema,
  kioskGuestRow,
  kioskStatusAfterSave,
  routeBodySchema,
} from "../kiosk/guests";

const sessionId = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const guest = (over: Record<string, unknown> = {}) => ({
  lastName: "lin",
  firstName: "mei",
  guestType: "adult",
  hasJapanAddress: false,
  nationality: "twn",
  passportNumber: "31-23 456",
  birthDate: "1994-03-08",
  gender: "female",
  ...over,
});
const parse = (over: Record<string, unknown> = {}) => kioskGuestBodySchema.safeParse({ sessionId, guest: guest(over) });

describe("태블릿 명부 저장 — 입력 검사", () => {
  it("웹과 같은 규칙(국적 · 여권 번호 · 날짜)", () => {
    const ok = parse();
    expect(ok.success && ok.data.guest.nationality).toBe("TWN");
    expect(ok.success && ok.data.guest.passportNumber).toBe("3123456");
    const bad = parse({ nationality: "XXX", passportNumber: "12", birthDate: "2026-02-30" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(invalidFieldsOf(bad.error).sort()).toEqual(["birthDate", "nationality", "passportNumber"]);
  });

  it("「child」 사유는 어린이만, 다른 사유는 누구나", () => {
    expect(parse({ noPassportReason: "child" }).success).toBe(false);
    const fail = parse({ noPassportReason: "child" });
    if (!fail.success) expect(invalidFieldsOf(fail.error)).toEqual(["noPassportReason"]);
    expect(parse({ guestType: "child", noPassportReason: "child" }).success).toBe(true);
    for (const reason of ["japan_resident", "not_shown", "camera_off"]) expect(parse({ noPassportReason: reason }).success).toBe(true);
    expect(parse({ noPassportReason: "lost" }).success).toBe(false);
  });

  it("MRZ 원문은 200자까지", () => {
    expect(parse({ mrz: { raw: "P<TWNLIN<<MEI\n3123456<<", valid: true } }).success).toBe(true);
    expect(parse({ mrz: { raw: "A".repeat(201), valid: true } }).success).toBe(false);
    expect(kioskGuestBodySchema.safeParse({ sessionId: "x", guest: guest() }).success).toBe(false);
  });
});

describe("태블릿 명부 저장 — 저장할 칸", () => {
  const rep = { address: "Taipei", prev_stay: "当日入国", next_dest: "大阪" };
  const input = (over: Record<string, unknown> = {}) => {
    const parsed = parse(over);
    if (!parsed.success) throw new Error("bad");
    return parsed.data.guest;
  };

  it("새 동행자는 대표자의 주소 · 전 숙박지 · 다음 행선지를 이어받는다", () => {
    const row = kioskGuestRow(input(), rep, true, "t");
    expect(row).toMatchObject({ name_roman: "LIN MEI", address: "Taipei", prev_stay: "当日入国", next_dest: "大阪", source: "guest" });
    expect(kioskGuestRow(input({ address: "Tainan" }), rep, true, "t").address).toBe("Tainan");
  });

  it("고칠 때 주소를 안 보내면 칸을 건드리지 않는다", () => {
    const row = kioskGuestRow(input(), rep, false, "t");
    expect("address" in row).toBe(false);
    expect("prev_stay" in row).toBe(false);
  });

  it("여권 없음 사유가 있으면 번호는 비우고, MRZ 가 오면 source = mrz", () => {
    expect(kioskGuestRow(input({ noPassportReason: "camera_off" }), null, false, "t")).toMatchObject({
      passport_number: null,
      no_passport_reason: "camera_off",
    });
    expect(kioskGuestRow(input({ mrz: { raw: "P<TWN", valid: false } }), null, false, "t")).toMatchObject({
      source: "mrz",
      mrz_raw: "P<TWN",
      mrz_valid: false,
    });
  });

  it("동행자는 비어 있었거나 대표자의 옛 값일 때만 따라간다", () => {
    const guests = [
      { id: "r", is_representative: true, address: "A", prev_stay: null, next_dest: null },
      { id: "c1", is_representative: false, address: "A", prev_stay: null, next_dest: null },
      { id: "c2", is_representative: false, address: null, prev_stay: null, next_dest: null },
      { id: "c3", is_representative: false, address: "B", prev_stay: null, next_dest: null },
    ];
    expect(companionsFollowing(guests, "address", "A", "C")).toEqual(["c1", "c2"]);
    expect(companionsFollowing(guests, "address", "A", "A")).toEqual([]);
  });
});

describe("태블릿 저장 뒤 상태", () => {
  const done = { missing: [] };
  it("태블릿은 pre_registered 로 올리지 않고, 덜 되면 내린다", () => {
    expect(kioskStatusAfterSave({ status: "pending", consented: true, partySize: 1, guests: [done] })).toBeNull();
    expect(kioskStatusAfterSave({ status: "pre_registered", consented: true, partySize: 1, guests: [done] })).toBeNull();
    expect(kioskStatusAfterSave({ status: "pre_registered", consented: true, partySize: 2, guests: [done] })).toBe("pending");
    expect(kioskStatusAfterSave({ status: "pre_registered", consented: true, partySize: 1, guests: [{ missing: ["gender"] }] })).toBe("pending");
  });
});

describe("빠진 칸 — 태블릿 여권 없음 사유", () => {
  const base: StoredGuest = {
    is_representative: false,
    guest_type: "adult",
    name_roman: "LIN MEI",
    has_japan_address: false,
    nationality: "TWN",
    passport_number: null,
    birth_date: "1994-03-08",
    gender: "female",
    no_passport_reason: null,
    address: "Taipei",
    prev_stay: "当日入国",
    next_dest: "大阪",
  };
  it("직원 확인 사유는 여권 번호 · 사진을 빼 주고, 어른의 「child」 는 빼 주지 않는다", () => {
    expect(missingFields({ ...base, no_passport_reason: "not_shown" }, false)).toEqual([]);
    expect(missingFields({ ...base, no_passport_reason: "child" }, false)).toEqual(["passport_number", "passport_photo"]);
  });
});

describe("전 숙박지 · 다음 행선지 입력", () => {
  it("앞뒤 공백을 지우고 1~120자", () => {
    const ok = routeBodySchema.safeParse({ sessionId, prevStay: " 東京 ", nextDest: "出国" });
    expect(ok.success && ok.data.prevStay).toBe("東京");
    expect(routeBodySchema.safeParse({ sessionId, prevStay: "  ", nextDest: "出国" }).success).toBe(false);
    expect(routeBodySchema.safeParse({ sessionId, prevStay: "x".repeat(121), nextDest: "出国" }).success).toBe(false);
  });
});
