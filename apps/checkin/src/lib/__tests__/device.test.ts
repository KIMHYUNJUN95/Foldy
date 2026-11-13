import { describe, expect, it } from "vitest";

import { buildContract, type PropertySettingsRow } from "@/lib/contract/build";
import { contractSchema } from "@/lib/contract/schema";
import { devicePin, hashPin, isPinShaped, parseStaffPin, verifyDevicePin, verifyPin } from "@/lib/device/pin";

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
  staff_call_enabled: false,
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

  it("PIN 은 기기별로 다시 만든 값만 계약에 싣는다(원 해시 · 원문 없음)", () => {
    const stored = hashPin("482913");
    const contract = contractSchema.parse(buildContract({ ...row, staff_pin_hash: stored }, { id: "dev-1", secret: "s" }));
    expect(contract.staffPin?.algorithm).toBe("pbkdf2-sha256-hmac-device");
    const body = JSON.stringify(contract);
    expect(body).not.toContain("482913");
    expect(body).not.toContain(parseStaffPin(stored)!.hash);
    const other = buildContract({ ...row, staff_pin_hash: stored }, { id: "dev-2", secret: "s" });
    expect(other.staffPin?.hash).not.toBe(contract.staffPin?.hash);
    expect(other.staffPin?.deviceSalt).not.toBe(contract.staffPin?.deviceSalt);
  });

  it("기기 정보가 없으면 PIN 을 싣지 않는다", () => {
    expect(buildContract({ ...row, staff_pin_hash: hashPin("482913") }).staffPin).toBeNull();
  });
});

describe("staff pin", () => {
  it("Foldy 건물 설정이 만드는 해시와 같은 값 — 고정 벡터(Foldy checkin-cross-app.test.ts 에도 같은 값)", () => {
    const stored = "pbkdf2-sha256$120000$MDEyMzQ1Njc4OWFiY2RlZg==$Mj2V/Qp/9Ws/rF9fWcmliH7KRiXnTrYlbfyrrBo7xn8=";
    expect(hashPin("482913", Buffer.from("0123456789abcdef"))).toBe(stored);
    expect(verifyPin("482913", stored)).toBe(true);
  });

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

  it("기기별 값으로 오프라인 대조 — 맞는 PIN 만, 다른 기기 값으로는 안 됨", () => {
    const stored = hashPin("2468");
    const mine = devicePin(stored, "dev-1", "s")!;
    expect(verifyDevicePin("2468", mine)).toBe(true);
    expect(verifyDevicePin("2469", mine)).toBe(false);
    expect(verifyDevicePin("2468", { ...mine, hash: devicePin(hashPin("1357"), "dev-1", "s")!.hash })).toBe(false);
    expect(devicePin(null, "dev-1", "s")).toBeNull();
  });

  it("기기별 값 고정 벡터 — 태블릿 PinTest.kt 와 같은 값", () => {
    const stored = hashPin("4821", Buffer.from("0123456789abcdef"));
    expect(devicePin(stored, "dev-1", "test-secret")).toEqual({
      algorithm: "pbkdf2-sha256-hmac-device",
      iterations: 120000,
      salt: "MDEyMzQ1Njc4OWFiY2RlZg==",
      deviceSalt: "im6jm7ygxmtL2HAC8Xbj7RR64Gi9bYt4oFaL+1ayBsY=",
      keyBytes: 32,
      hash: "MydjpKau9Y4/P7M0CbXQgo9Uv+mUW2URaI88xfthAJY=",
    });
  });
});
