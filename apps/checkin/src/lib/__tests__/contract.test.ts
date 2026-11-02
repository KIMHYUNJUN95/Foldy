import { describe, expect, it } from "vitest";

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
    supportContacts: {},
    staffPin: null,
  };

  it("맞는 계약은 통과한다", () => {
    expect(contractSchema.parse(valid).fields[0].foreignOnly).toBe(false);
  });

  it("다른 계약 버전 · 지원하지 않는 언어는 막는다", () => {
    expect(contractSchema.safeParse({ ...valid, contractVersion: 99 }).success).toBe(false);
    expect(contractSchema.safeParse({ ...valid, languages: ["fr"] }).success).toBe(false);
  });
});
