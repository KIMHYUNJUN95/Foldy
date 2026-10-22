import { describe, expect, it } from "vitest";
import {
  displayNameFrom,
  identityIncomplete,
  isKatakanaName,
  normalizeEnglishName,
  normalizeIdentityNames,
  normalizeKatakana,
  validateIdentityNames,
} from "@/lib/identity-names";

describe("identity names", () => {
  it("turns hiragana and half-width katakana into full-width katakana", () => {
    expect(normalizeKatakana("きむ　はる")).toBe("キム ハル");
    expect(normalizeKatakana("ｷﾑ ﾊﾙ")).toBe("キム ハル");
    expect(normalizeKatakana("アーロン・スミス")).toBe("アーロン・スミス");
  });

  it("rejects non-katakana", () => {
    expect(isKatakanaName("キム ハル")).toBe(true);
    expect(isKatakanaName("김하루")).toBe(false);
    expect(isKatakanaName("ー・")).toBe(false);
  });

  it("uppercases English names like the residence card", () => {
    expect(normalizeEnglishName("  kim   haru ")).toBe("KIM HARU");
    expect(normalizeEnglishName("ｋｉｍ")).toBe("KIM");
  });

  it("requires the local name by nationality", () => {
    const base = { nameKo: "", nameJa: "", nameEn: "KIM HARU", nameKatakana: "キム ハル" };
    expect(validateIdentityNames(normalizeIdentityNames({ ...base, nationality: "KR" }))).toEqual({
      nameKo: "name_ko_required",
    });
    expect(validateIdentityNames(normalizeIdentityNames({ ...base, nationality: "JP" }))).toEqual({
      nameJa: "name_ja_required",
    });
    expect(validateIdentityNames(normalizeIdentityNames({ ...base, nationality: "VN" }))).toEqual({});
  });

  it("flags bad English and katakana", () => {
    const errors = validateIdentityNames(
      normalizeIdentityNames({ nationality: "VN", nameKo: "", nameJa: "", nameEn: "김", nameKatakana: "abc" }),
    );
    expect(errors).toEqual({ nameEn: "name_en_invalid", nameKatakana: "name_katakana_invalid" });
  });

  it("rejects unknown nationality codes", () => {
    const errors = validateIdentityNames(
      normalizeIdentityNames({ nationality: "EU", nameKo: "", nameJa: "", nameEn: "A", nameKatakana: "ア" }),
    );
    expect(errors.nationality).toBe("nationality_required");
  });

  it("picks the display name", () => {
    expect(displayNameFrom({ nationality: "KR", nameKo: "김하루", nameJa: "", nameEn: "KIM HARU", nameKatakana: "キム ハル" })).toBe("김하루");
    expect(displayNameFrom({ nationality: "JP", nameKo: "", nameJa: "山田 太郎", nameEn: "YAMADA TARO", nameKatakana: "ヤマダ タロウ" })).toBe("山田 太郎");
    expect(displayNameFrom({ nationality: "VN", nameKo: "", nameJa: "", nameEn: "NGUYEN AN", nameKatakana: "グエン アン" })).toBe("NGUYEN AN");
  });

  it("detects incomplete rows", () => {
    expect(identityIncomplete({ nationality: null, name_en: null, name_katakana: null, name_ko: null, name_ja: null })).toBe(true);
    expect(identityIncomplete({ nationality: "KR", name_en: "KIM HARU", name_katakana: "キム ハル", name_ko: "김하루", name_ja: null })).toBe(false);
  });
});
