/* i18n-ignore-file -- 일본어 고정 인쇄 양식 문구를 확인하는 테스트. */
import { describe, expect, it } from "vitest";
import {
  EXTRA_ACTIVITY_JA,
  MAX_PRINT_PEOPLE,
  WORK_RESTRICTION_JA,
  buildPrintSheet,
  formatJaDate,
  formatJaDateTime,
  nationalityJa,
  parsePrintUserIds,
  printFooter,
  type PrintSheetInput,
} from "@/lib/staff-documents/print";
import { EXTRA_ACTIVITIES, WORK_RESTRICTIONS } from "@/lib/staff-documents/fields";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function input(over: Partial<PrintSheetInput> = {}): PrintSheetInput {
  return {
    kind: "residence_card",
    status: "confirmed",
    organizationName: "株式会社テスト",
    profile: { nameKatakana: "キム ハル", nameKo: "김하루", nameJa: null, nameEn: "KIM HARU", nationality: "KR", birthDate: "2001-05-14" },
    doc: {
      nameRoman: "KIM HARU",
      birthDate: "2001-05-14",
      nationalityText: "韓国",
      cardNumber: "AB12345678CD",
      residenceStatus: "特定活動",
      expiresOn: "2027-03-31",
      workRestriction: "designated",
      extraActivity: "none",
      confirmedAt: "2026-10-21T16:30:00Z", // 도쿄 10/22 01:30
    },
    confirmedByName: "管理 太郎",
    ...over,
  };
}

const value = (rows: { label: string; value: string }[], label: string) => rows.find((r) => r.label === label)?.value;

describe("parsePrintUserIds", () => {
  it("keeps valid uuids once, in order, lower-cased", () => {
    expect(parsePrintUserIds(`${A},bad,${B.toUpperCase()},${A}`)).toEqual([A, B]);
  });
  it("accepts repeated params and drops junk", () => {
    expect(parsePrintUserIds([A, "x;drop table", B])).toEqual([A, B]);
    expect(parsePrintUserIds(undefined)).toEqual([]);
  });
  it("caps at MAX_PRINT_PEOPLE", () => {
    const many = Array.from({ length: 80 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(parsePrintUserIds(many.join(","))).toHaveLength(MAX_PRINT_PEOPLE);
  });
});

describe("Japanese labels", () => {
  it("covers every work restriction and extra activity code", () => {
    for (const code of WORK_RESTRICTIONS) expect(WORK_RESTRICTION_JA[code]).toBeTruthy();
    for (const code of EXTRA_ACTIVITIES) expect(EXTRA_ACTIVITY_JA[code]).toBeTruthy();
    expect(WORK_RESTRICTION_JA.none).toBe("就労制限なし");
    expect(EXTRA_ACTIVITY_JA.weekly_28h).toBe("許可：原則週28時間以内・風俗営業等の従事を除く");
  });
  it("formats dates the Japanese way, in Tokyo time", () => {
    expect(formatJaDate("2026-03-05")).toBe("2026年3月5日");
    expect(formatJaDate("")).toBe("—");
    expect(formatJaDateTime("2026-10-22T06:40:00Z")).toBe("2026年10月22日 15:40");
    expect(formatJaDateTime("2026-10-22T15:05:00Z")).toBe("2026年10月23日 00:05");
  });
  it("names the nationality in Japanese, falling back to the card text", () => {
    expect(nationalityJa("KR")).toBe("韓国");
    expect(nationalityJa("", "ベトナム")).toBe("ベトナム");
    expect(nationalityJa(null)).toBe("—");
  });
  it("builds the footer line", () => {
    expect(printFooter(new Date("2026-10-22T06:40:00Z"), "山田")).toBe("Foldy で出力　出力日時 2026年10月22日 15:40　出力者 山田");
  });
});

describe("buildPrintSheet", () => {
  it("residence card: Korean name, card fields, confirmed in Tokyo date", () => {
    const sheet = buildPrintSheet(input());
    expect(sheet.title).toBe("在留カード 写し");
    expect(sheet.backLabel).toBe("裏面");
    expect(value(sheet.top, "韓国名")).toBe("김하루");
    expect(sheet.top.find((r) => r.label === "韓国名")?.lang).toBe("ko");
    expect(value(sheet.top, "国籍・地域")).toBe("韓国");
    expect(value(sheet.top, "確認日")).toBe("2026年10月22日");
    expect(value(sheet.bottom, "カード番号")).toBe("AB12345678CD");
    expect(value(sheet.bottom, "就労制限")).toBe("指定書により指定された就労活動のみ可");
    expect(value(sheet.bottom, "資格外活動許可")).toBe("—");
    expect(value(sheet.bottom, "確認者")).toBe("管理 太郎");
    expect(sheet.attestation).toContain("在留カード原本");
  });

  it("unconfirmed (pending / returned) shows 未確認 and no attestation", () => {
    for (const status of ["pending", "returned"] as const) {
      const sheet = buildPrintSheet(input({ status }));
      expect(value(sheet.top, "確認日")).toBe("未確認");
      expect(value(sheet.bottom, "確認者")).toBe("未確認");
      expect(sheet.attestation).toBeNull();
    }
  });

  it("no Korean name → no native-name row", () => {
    const sheet = buildPrintSheet(input({ profile: { ...input().profile, nameKo: null, nationality: "VN" } }));
    expect(sheet.top.some((r) => r.label === "韓国名" || r.label === "氏名")).toBe(false);
  });

  it("my number card: front only, Japanese name, no residence fields, never a number", () => {
    const sheet = buildPrintSheet(
      input({
        kind: "my_number_card",
        profile: { ...input().profile, nationality: "JP", nameJa: "山田 花子", nameKo: null },
        doc: { ...input().doc, cardNumber: "123456789012", residenceStatus: null, workRestriction: null, extraActivity: null },
      }),
    );
    expect(sheet.title).toBe("マイナンバーカード（表面）写し");
    expect(sheet.backLabel).toBeNull();
    expect(value(sheet.top, "氏名")).toBe("山田 花子");
    const labels = sheet.bottom.map((r) => r.label);
    expect(labels).toEqual(["有効期限", "確認者"]);
    const everything = JSON.stringify(sheet);
    expect(everything).not.toContain("123456789012");
    expect(everything).not.toContain("在留資格");
  });

  it("falls back to profile birth date and English name", () => {
    const sheet = buildPrintSheet(input({ doc: { ...input().doc, birthDate: null, nameRoman: null } }));
    expect(value(sheet.top, "生年月日")).toBe("2001年5月14日");
    expect(value(sheet.top, "英字氏名")).toBe("KIM HARU");
  });
});
