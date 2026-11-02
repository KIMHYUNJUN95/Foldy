import { describe, expect, it } from "vitest";

import { buildContract, type PropertySettingsRow } from "@/lib/contract/build";
import { contractSchema } from "@/lib/contract/schema";
import { hashPin, isPinShaped, parseStaffPin, verifyPin } from "@/lib/device/pin";

const row: PropertySettingsRow = {
  languages: ["ja", "en", "fr"],
  welcome_text: { ja: "ようこそ", en: "", ko: 3 },
  terms_text: { ko: "약관" },
  terms_version: 2,
  required_fields: [{ key: "next_dest", required: true }, { key: "name_roman", required: false }, { key: "bogus" }, "x"],
  video_seconds_per_guest: 5,
  support_contacts: { phone: " 03-0000-0000 ", fax: "1" },
  idle_seconds_input: 240,
  idle_seconds_done: 30,
  verification_method: "video",
  staff_pin_hash: null,
  mrz_autofill: true,
};

describe("contract build", () => {
  it("settings 줄이 없으면 기본값 — 4개 언어 · 기본 칸 · PIN 없음", () => {
    const contract = contractSchema.parse(buildContract(null));
    expect(contract.languages).toEqual(["ja", "en", "zh-Hans", "ko"]);
    expect(contract.fields.map((field) => field.key)).toEqual([
      "name_roman", "address", "nationality", "passport_number", "prev_stay", "next_dest",
    ]);
    expect(contract.fields.find((field) => field.key === "nationality")?.foreignOnly).toBe(true);
    expect(contract.fields[0].label.ko).toBe("이름(로마자)");
    expect(contract.staffPin).toBeNull();
  });

  it("건물 설정을 반영하고 잘못된 값은 버린다", () => {
    const contract = contractSchema.parse(buildContract(row));
    expect(contract.languages).toEqual(["ja", "en"]);
    expect(contract.welcomeText).toEqual({ ja: "ようこそ" });
    expect(contract.termsText).toEqual({ ko: "약관" });
    expect(contract.fields.find((field) => field.key === "next_dest")?.required).toBe(true);
    // 이름은 설정과 상관없이 필수.
    expect(contract.fields.find((field) => field.key === "name_roman")?.required).toBe(true);
    expect(contract.supportContacts).toEqual({ phone: "03-0000-0000" });
  });

  it("PIN 해시를 계약에 싣는다(원문 없음)", () => {
    const stored = hashPin("482913");
    const contract = buildContract({ ...row, staff_pin_hash: stored });
    expect(contract.staffPin?.algorithm).toBe("pbkdf2-sha256");
    expect(JSON.stringify(contract)).not.toContain("482913");
  });
});

describe("staff pin", () => {
  it("맞는 PIN 만 통과한다", () => {
    const stored = hashPin("2468");
    expect(verifyPin("2468", stored)).toBe(true);
    expect(verifyPin("2469", stored)).toBe(false);
    expect(verifyPin("2468", null)).toBe(false);
  });
  it("모양 검사", () => {
    expect(isPinShaped("123")).toBe(false);
    expect(isPinShaped("1234")).toBe(true);
    expect(isPinShaped("12a4")).toBe(false);
    expect(parseStaffPin("md5$1$a$b")).toBeNull();
  });
});
