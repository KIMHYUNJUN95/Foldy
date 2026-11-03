import { describe, expect, it } from "vitest";

import { BUILDING_KEYS, isBuildingKey } from "../building-key";
import { COUNTRIES, isCountryCode } from "../guest/countries";
import { guestInputSchema, missingFields, nameRomanOf, type StoredGuest } from "../guest/fields";
import { sniffImageType, sniffVideoType } from "../guest/image";
import { lockState, MAX_FAILURES } from "../guest/limits";
import { matchClaim, normalizeReference, phoneLast4Of, sameName, type ClaimCandidate } from "../guest/match";
import { hashGuestToken, isTokenShaped, newGuestToken } from "../guest/token";
import { partyAfterRemoval, seatCount } from "../guest/party";

const candidate = (over: Partial<ClaimCandidate> = {}): ClaimCandidate => ({
  stayId: "s1",
  checkInDate: "2026-11-05",
  rows: [{ guestName: "Daniel Hu", apiReference: "HM4K2X9PQ", phone: "+1 415-555-0142" }],
  ...over,
});

describe("예약 찾기 판정", () => {
  it("이름은 대소문자 · 순서 · 악센트 · 띄어쓰기를 무시한다", () => {
    expect(sameName("Daniel Hu", "hu", "daniel")).toBe(true);
    expect(sameName("José García", "GARCIA", "JOSE")).toBe(true);
    expect(sameName("Mary-Jane O'Neil", "O NEIL", "MARY JANE")).toBe(true);
    expect(sameName("田中 由紀", "田中", "由紀")).toBe(true);
    expect(sameName("TANAKAYUKI", "TANAKA", "YUKI")).toBe(true);
    expect(sameName("Daniel Hu", "HU", "DAN")).toBe(false);
  });

  it("예약 번호는 공백 · 하이픈 · HM 접두를 무시한다", () => {
    expect(normalizeReference("hm 4k2x-9pq")).toBe(normalizeReference("HM4K2X9PQ"));
    expect(normalizeReference("4K2X9PQ")).toBe(normalizeReference("HM4K2X9PQ"));
    expect(phoneLast4Of("+1 415-555-0142")).toBe("0142");
    expect(phoneLast4Of("12")).toBeNull();
  });

  it("세 가지가 한 예약에만 맞을 때만 연다", () => {
    const input = { lastName: "Hu", firstName: "Daniel", checkInDate: "2026-11-05", reference: "4k2x9pq" };
    expect(matchClaim([candidate()], input)).toEqual({ kind: "one", stayId: "s1" });
    expect(matchClaim([candidate()], { ...input, checkInDate: "2026-11-06" })).toEqual({ kind: "none" });
    expect(matchClaim([candidate()], { ...input, reference: "HM0000000" })).toEqual({ kind: "none" });
    expect(matchClaim([candidate()], { ...input, lastName: "Wu" })).toEqual({ kind: "none" });
    // 같은 이름 · 날짜 · 번호가 둘 → 아무것도 열지 않음
    expect(matchClaim([candidate(), candidate({ stayId: "s2" })], input)).toEqual({ kind: "none" });
  });

  it("전화 뒤 4자리로도 찾되, 번호도 전화도 없으면 열지 않는다", () => {
    const input = { lastName: "Hu", firstName: "Daniel", checkInDate: "2026-11-05", phoneLast4: "0142" };
    expect(matchClaim([candidate()], input).kind).toBe("one");
    expect(matchClaim([candidate()], { ...input, phoneLast4: "9999" }).kind).toBe("none");
    expect(matchClaim([candidate()], { ...input, phoneLast4: undefined }).kind).toBe("none");
    // 직접 예약처럼 채널 번호가 없는 줄은 예약 번호로 열리지 않는다
    const direct = candidate({ rows: [{ guestName: "Daniel Hu", apiReference: null, phone: null }] });
    expect(matchClaim([direct], { ...input, phoneLast4: undefined, reference: "123456789" }).kind).toBe("none");
  });
});

describe("잠금", () => {
  const now = new Date("2026-11-02T10:00:00Z");
  const fail = (minutesAgo: number) => ({ succeeded: false, attempted_at: new Date(now.getTime() - minutesAgo * 60_000).toISOString() });

  it("10분 안 5번 실패면 마지막 실패 + 10분까지 잠근다", () => {
    const recent = [fail(1), fail(2), fail(3), fail(4), fail(5)];
    const state = lockState(recent, now);
    expect(state.failures).toBe(MAX_FAILURES);
    expect(state.lockedUntil).toBe(new Date(now.getTime() + 9 * 60_000).toISOString());
  });

  it("10분 지난 실패 · 성공 앞의 실패는 세지 않는다", () => {
    expect(lockState([fail(1), fail(2), fail(11), fail(12), fail(13)], now)).toMatchObject({ failures: 2, remaining: 3, lockedUntil: null });
    expect(lockState([fail(1), { succeeded: true, attempted_at: now.toISOString() }, fail(3), fail(4), fail(5)], now).failures).toBe(1);
  });
});

describe("명부 칸", () => {
  const base: StoredGuest = {
    is_representative: false,
    guest_type: "adult",
    name_roman: "LIN MEI",
    has_japan_address: false,
    nationality: "TWN",
    passport_number: "3123456",
    age: 32,
    contact: null,
    gender: "female",
    no_passport_reason: null,
    address: "Taipei",
    prev_stay: "Home",
    next_dest: "Airport",
  };

  it("외국인은 여권 사진까지 있어야 끝", () => {
    expect(missingFields(base, true)).toEqual([]);
    expect(missingFields(base, false)).toEqual(["passport_photo"]);
    expect(missingFields({ ...base, nationality: null, prev_stay: null }, true)).toEqual(["prev_stay", "nationality"]);
  });

  it("여권 없는 어린이는 여권 번호 · 사진을 빼 준다", () => {
    expect(missingFields({ ...base, guest_type: "child", no_passport_reason: "child", passport_number: null }, false)).toEqual([]);
  });

  it("일본에 주소가 있어도 성별 · 나이 · 숙박지는 받는다(신주쿠 규칙 10), 국적 · 여권은 빼 준다", () => {
    const resident = { ...base, has_japan_address: true, nationality: null, passport_number: null };
    expect(missingFields(resident, false)).toEqual([]);
    expect(missingFields({ ...resident, address: null, gender: null, age: null, prev_stay: null }, false)).toEqual([
      "address",
      "gender",
      "age",
      "prev_stay",
    ]);
  });

  it("연락처는 대표자만", () => {
    expect(missingFields({ ...base, is_representative: true }, true)).toEqual(["contact"]);
    expect(missingFields({ ...base, is_representative: true, contact: "+1-415-555-0142" }, true)).toEqual([]);
    expect(missingFields(base, true)).toEqual([]);
  });

  it("나이 0 은 빈 칸이 아니다", () => {
    expect(missingFields({ ...base, age: 0 }, true)).toEqual([]);
  });

  it("입력 검사: 국적 코드 · 여권 번호 · 나이", () => {
    const ok = guestInputSchema.parse({
      lastName: " lin ",
      firstName: "mei",
      guestType: "adult",
      hasJapanAddress: false,
      nationality: "twn",
      passportNumber: "31 234-56",
      age: 32,
      gender: "female",
    });
    expect(ok).toMatchObject({ lastName: "lin", nationality: "TWN", passportNumber: "3123456", address: null, contact: null, age: 32 });
    expect(ok).not.toHaveProperty("nameKana");
    expect(nameRomanOf(" lin ", " mei ")).toBe("LIN MEI");
    const bad = (over: Record<string, unknown>) =>
      guestInputSchema.safeParse({ lastName: "A", firstName: "B", guestType: "adult", hasJapanAddress: false, ...over }).success;
    expect(bad({ nationality: "XXX" })).toBe(false);
    expect(bad({ passportNumber: "12" })).toBe(false);
    expect(bad({ age: 131 })).toBe(false);
    expect(bad({ age: 3.5 })).toBe(false);
    expect(bad({ age: "32" })).toBe(false);
    expect(bad({ lastName: "" })).toBe(false);
  });
});

describe("나머지 도우미", () => {
  it("국가 표는 249개, alpha-3 는 겹치지 않는다", () => {
    expect(COUNTRIES).toHaveLength(249);
    expect(new Set(COUNTRIES.map((c) => c.alpha3)).size).toBe(249);
    expect(isCountryCode("JPN")).toBe(true);
    expect(isCountryCode("ZZZ")).toBe(false);
  });

  it("이미지는 앞 바이트로만 판단", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffImageType(new TextEncoder().encode("RIFF1234WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
  });

  it("토큰은 43자 · 해시는 원문과 다르다", () => {
    const token = newGuestToken();
    expect(isTokenShaped(token.raw)).toBe(true);
    expect(token.hash).toBe(hashGuestToken(token.raw));
    expect(token.hash).not.toContain(token.raw);
    expect(isTokenShaped("../etc")).toBe(false);
  });

  it("건물 키", () => {
    expect(BUILDING_KEYS).toContain("kabukicho");
    expect(isBuildingKey("kabukicho")).toBe(true);
    expect(isBuildingKey("Kabukicho")).toBe(false);
  });
});


describe("party", () => {
  it("seats = larger of saved and party size", () => {
    expect(seatCount(1, 3)).toBe(3);
    expect(seatCount(4, 3)).toBe(4);
  });
  it("removing an empty seat lowers the party size", () => {
    expect(partyAfterRemoval(1, 3, false)).toBe(2);
    expect(partyAfterRemoval(2, 3, false)).toBe(2);
  });
  it("cannot remove an empty seat when none is left", () => {
    expect(partyAfterRemoval(3, 3, false)).toBeNull();
  });
  it("removing a saved companion lowers both", () => {
    expect(partyAfterRemoval(3, 3, true)).toBe(2);
    expect(partyAfterRemoval(4, 3, true)).toBe(3);
  });
  it("keeps the representative", () => {
    expect(partyAfterRemoval(1, 1, false)).toBeNull();
    expect(partyAfterRemoval(1, 1, true)).toBeNull();
  });
});

describe("영상 형식 확인", () => {
  it("ftyp 를 가진 MP4 만 통과", () => {
    const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    expect(sniffVideoType(mp4)).toBe("video/mp4");
    const ftyp = (brand: string) => new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, ...[...brand].map((ch) => ch.charCodeAt(0))]);
    expect(sniffVideoType(ftyp("3gp4"))).toBe("video/mp4");
    expect(sniffVideoType(ftyp("qt  "))).toBe("video/mp4");
    expect(sniffVideoType(ftyp("heic"))).toBeNull();
    expect(sniffVideoType(ftyp("avif"))).toBeNull();
    expect(sniffVideoType(ftyp("M4A "))).toBeNull();
    expect(sniffVideoType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(sniffVideoType(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74]))).toBeNull();
  });
});
