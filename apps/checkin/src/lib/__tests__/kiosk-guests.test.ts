import { describe, expect, it } from "vitest";

import { missingFields, type StoredGuest } from "../guest/fields";
import {
  companionsFollowing,
  invalidFieldsOf,
  kioskGuestBodySchema,
  kioskGuestRow,
  kioskStatusAfterSave,
  routeBodySchema,
  SHARED_FIELDS,
} from "../kiosk/guests";

const sessionId = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const guest = (over: Record<string, unknown> = {}) => ({
  lastName: "lin",
  firstName: "mei",
  guestType: "adult",
  hasJapanAddress: false,
  nationality: "twn",
  passportNumber: "31-23 456",
  age: 32,
  gender: "female",
  ...over,
});
const parse = (over: Record<string, unknown> = {}) => kioskGuestBodySchema.safeParse({ sessionId, guest: guest(over) });

describe("태블릿 명부 저장 — 입력 검사", () => {
  it("웹과 같은 규칙(국적 · 여권 번호 · 나이)", () => {
    const ok = parse();
    expect(ok.success && ok.data.guest.nationality).toBe("TWN");
    expect(ok.success && ok.data.guest.passportNumber).toBe("3123456");
    const bad = parse({ nationality: "XXX", passportNumber: "12", age: 200 });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(invalidFieldsOf(bad.error).sort()).toEqual(["age", "nationality", "passportNumber"]);
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
  const rep = { prev_stay: "当日入国", next_dest: "大阪" };
  const input = (over: Record<string, unknown> = {}) => {
    const parsed = parse(over);
    if (!parsed.success) throw new Error("bad");
    return parsed.data.guest;
  };

  it("새 동행자는 대표자의 전 숙박지 · 다음 행선지를 이어받지만 주소는 이어받지 않는다", () => {
    const row = kioskGuestRow(input(), rep, true, "t");
    expect(row).toMatchObject({ name_roman: "LIN MEI", prev_stay: "当日入国", next_dest: "大阪", source: "guest" });
    expect("address" in row).toBe(false);
    expect(kioskGuestRow(input({ address: "Taiwan, Tainan, 12 Zhongzheng Rd" }), rep, true, "t").address).toBe("Taiwan, Tainan, 12 Zhongzheng Rd");
  });

  it("주소를 보냈으면 그 사람 규칙으로 검사한다(외국인 영문만 · 8자 이상)", () => {
    expect(parse({ address: "Taipei" }).success).toBe(false);
    expect(parse({ address: "台湾 台北市 中正区 1-2-3" }).success).toBe(false);
    const bad = parse({ address: "대한민국 서울시 강남구 1번지" });
    expect(bad.success).toBe(false);
    expect(bad.success ? [] : invalidFieldsOf(bad.error)).toEqual(["address"]);
    expect(parse({ address: "대한민국 서울시 강남구 1번지", hasJapanAddress: true }).success).toBe(true);
  });

  it("고칠 때 주소를 안 보내면 칸을 건드리지 않는다", () => {
    const row = kioskGuestRow(input(), rep, false, "t");
    expect("address" in row).toBe(false);
    expect("prev_stay" in row).toBe(false);
  });

  it("일본 거주 여부가 실제로 바뀐 사람은 옛 주소를 비운다(다시 묻기)", () => {
    const row = (over: Record<string, unknown>, previous: { has_japan_address: boolean | null } | null) =>
      kioskGuestRow(input(over), rep, false, "t", false, previous);
    expect(row({ hasJapanAddress: true }, { has_japan_address: false })).toMatchObject({ address: null });
    expect(row({ hasJapanAddress: false }, { has_japan_address: true })).toMatchObject({ address: null });
    expect("address" in row({ hasJapanAddress: false }, { has_japan_address: false })).toBe(false);
    expect("address" in row({ hasJapanAddress: false }, { has_japan_address: null })).toBe(false);
    expect("address" in row({ hasJapanAddress: true }, null)).toBe(false);
    // 같이 보낸 새 주소는 그대로 저장
    expect(row({ hasJapanAddress: true, address: "東京都新宿区1-2-3" }, { has_japan_address: false })).toMatchObject({ address: "東京都新宿区1-2-3" });
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

  it("연락처는 대표자만 저장하고, 안 보내면 건드리지 않는다", () => {
    expect(kioskGuestRow(input({ contact: "+1-415-555-0142" }), rep, false, "t", true).contact).toBe("+1-415-555-0142");
    expect("contact" in kioskGuestRow(input({ contact: "+1-415-555-0142" }), rep, false, "t")).toBe(false);
    expect("contact" in kioskGuestRow(input(), rep, false, "t", true)).toBe(false);
    expect(kioskGuestRow(input(), rep, false, "t")).toMatchObject({ age: 32 });
  });

  it("숙박지는 비어 있었거나 대표자의 옛 값일 때만 따라간다(주소는 이어받기 대상이 아님)", () => {
    const guests = [
      { id: "r", is_representative: true, prev_stay: "A", next_dest: null },
      { id: "c1", is_representative: false, prev_stay: "A", next_dest: null },
      { id: "c2", is_representative: false, prev_stay: null, next_dest: null },
      { id: "c3", is_representative: false, prev_stay: "B", next_dest: null },
    ];
    expect(companionsFollowing(guests, "prev_stay", "A", "C")).toEqual(["c1", "c2"]);
    expect(companionsFollowing(guests, "prev_stay", "A", "A")).toEqual([]);
    expect(SHARED_FIELDS).not.toContain("address");
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
    age: 32,
    contact: null,
    gender: "female",
    no_passport_reason: null,
    address: "Taiwan, Taipei, 1 Xinyi Rd",
    prev_stay: "当日入国",
    next_dest: "大阪",
  };
  it("직원 확인 사유는 여권 번호 · 사진을 빼 주고, 어른의 「child」 는 빼 주지 않는다", () => {
    expect(missingFields({ ...base, no_passport_reason: "not_shown" }, false)).toEqual([]);
    expect(missingFields({ ...base, no_passport_reason: "child" }, false)).toEqual(["passport_number", "passport_photo"]);
  });

  it("주소가 없으면 누구든(동행자 · 어린이 · 직원 확인 사유 포함) 빠진 칸 — 끝낼 수 없다", () => {
    expect(missingFields({ ...base, passport_number: "3123456", address: null }, true)).toEqual(["address"]);
    expect(missingFields({ ...base, address: null, no_passport_reason: "not_shown" }, false)).toEqual(["address"]);
    expect(missingFields({ ...base, address: null, has_japan_address: true }, false)).toEqual(["address"]);
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
