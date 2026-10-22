import { describe, expect, it } from "vitest";
import {
  EMPTY_ID_FIELDS,
  daysUntil,
  documentKindFor,
  editedFieldsOf,
  expiryTone,
  fieldsForKind,
  normalizeIdFields,
  validateIdFields,
} from "@/lib/staff-documents/fields";
import { getDictionary } from "@/lib/i18n";

const residence = normalizeIdFields({
  ...EMPTY_ID_FIELDS,
  nameRoman: "kim  haru",
  birthDate: "2001-05-14",
  expiresOn: "2027-03-31",
  cardNumber: "ab 1234 5678 cd",
  residenceStatus: "特定活動",
  workRestriction: "designated",
  extraActivity: "none",
});

describe("staff document fields", () => {
  it("일본 국적은 마이넘버 카드, 그 밖은 재류카드", () => {
    expect(documentKindFor("JP")).toBe("my_number_card");
    expect(documentKindFor("KR")).toBe("residence_card");
    expect(fieldsForKind("my_number_card")).not.toContain("cardNumber");
  });

  it("정리: 대문자 · 공백 하나 · 카드 번호 공백 제거 · 없는 날짜는 비움", () => {
    expect(residence.nameRoman).toBe("KIM HARU");
    expect(residence.cardNumber).toBe("AB12345678CD");
    expect(normalizeIdFields({ birthDate: "2001-02-30" }).birthDate).toBe("");
    expect(normalizeIdFields({ workRestriction: "bogus" as never }).workRestriction).toBe("");
  });

  it("검사: 재류카드 필수 칸 · 카드 번호 형식", () => {
    expect(validateIdFields("residence_card", residence)).toEqual({});
    expect(validateIdFields("residence_card", { ...residence, cardNumber: "AB1234CD" }).cardNumber).toBe("card_number_invalid");
    expect(validateIdFields("residence_card", { ...residence, residenceStatus: "" }).residenceStatus).toBe("required");
    // 마이넘버 카드는 생년월일만 필수(재류 칸 없음)
    expect(validateIdFields("my_number_card", normalizeIdFields({ birthDate: "1990-01-01" }))).toEqual({});
  });

  it("본인이 고친 칸만 남긴다(읽지 못한 빈 칸은 고친 것이 아님)", () => {
    const read = { ...residence, address: "" };
    const saved = { ...residence, cardNumber: "AB12345678CE", address: "東京都" };
    expect(editedFieldsOf(read, saved, "residence_card")).toEqual(["cardNumber"]);
    expect(editedFieldsOf(null, saved, "residence_card")).toEqual([]);
  });

  it("만료 표시: 지남 · 30일 · 90일", () => {
    expect(daysUntil("2026-10-24", "2026-10-23")).toBe(1);
    expect(expiryTone(daysUntil("2026-10-22", "2026-10-23"))).toBe("expired");
    expect(expiryTone(30)).toBe("within30");
    expect(expiryTone(90)).toBe("within90");
    expect(expiryTone(91)).toBe("ok");
    expect(expiryTone(daysUntil("", "2026-10-23"))).toBeNull();
  });

  it("문구는 세 언어 모두 같은 키", () => {
    const ko = Object.keys(getDictionary("ko").idCard).sort();
    expect(Object.keys(getDictionary("ja").idCard).sort()).toEqual(ko);
    expect(Object.keys(getDictionary("en").idCard).sort()).toEqual(ko);
    expect(getDictionary("ja").idCard.submit).not.toBe(getDictionary("en").idCard.submit);
  });
});
