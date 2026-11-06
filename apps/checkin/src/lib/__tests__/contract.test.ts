import { describe, expect, it } from "vitest";

import { buildContract } from "@/lib/contract/build";
import { CONTRACT_VERSION, contractSchema } from "@/lib/contract/schema";

describe("checkin contract", () => {
  const valid = {
    contractVersion: CONTRACT_VERSION,
    languages: ["ja", "en"],
    welcomeText: { ja: "ようこそ" },
    termsVersion: 3,
    fields: [{ key: "name_roman", required: true, label: { ja: "氏名", en: "Name" } }],
    videoSecondsPerGuest: 5,
    verificationMethod: "video",
    termsText: {},
    idleSecondsInput: 240,
    idleSecondsDone: 30,
    mrzAutofill: true,
    addressRules: { maxLength: 200, minLengthForeign: 8, minLengthJapan: 5, foreignScript: "latin" },
    supportContacts: {},
    staffPin: null,
    staffCallEnabled: false,
  };

  it("맞는 계약은 통과한다", () => {
    expect(contractSchema.parse(valid).fields[0].foreignOnly).toBe(false);
  });

  it("다른 계약 버전 · 지원하지 않는 언어는 막는다", () => {
    expect(contractSchema.safeParse({ ...valid, contractVersion: 99 }).success).toBe(false);
    expect(contractSchema.safeParse({ ...valid, languages: ["fr"] }).success).toBe(false);
  });

  it("주소 규칙은 서버 검사 값 그대로 계약에 실린다", () => {
    const contract = buildContract(null);
    expect(contractSchema.parse(contract).addressRules).toEqual({ maxLength: 200, minLengthForeign: 8, minLengthJapan: 5, foreignScript: "latin" });
  });

  it("직원 통화는 기본 꺼짐, 건물 설정을 그대로 싣는다", () => {
    expect(buildContract(null).staffCallEnabled).toBe(false);
    const row = { staff_call_enabled: true } as unknown as Parameters<typeof buildContract>[0];
    expect(contractSchema.parse(buildContract(row)).staffCallEnabled).toBe(true);
  });
});
