import { describe, expect, it } from "vitest";
import { isStaleUnconfirmedSignup } from "@/lib/auth/unconfirmed-signup-rule";

const now = new Date("2026-10-20T00:00:00Z");
const base = { id: "u1", created_at: "2026-10-01T00:00:00Z", identities: [{ provider: "email" }] };

describe("isStaleUnconfirmedSignup", () => {
  it("지난 지 7일 넘은 미확인 이메일 가입은 지운다", () => {
    expect(isStaleUnconfirmedSignup(base, now)).toBe(true);
  });
  it("7일 안이면 남긴다", () => {
    expect(isStaleUnconfirmedSignup({ ...base, created_at: "2026-10-15T00:00:00Z" }, now)).toBe(false);
  });
  it("메일을 확인했거나 한 번이라도 로그인했으면 남긴다", () => {
    expect(isStaleUnconfirmedSignup({ ...base, email_confirmed_at: "2026-10-02T00:00:00Z" }, now)).toBe(false);
    expect(isStaleUnconfirmedSignup({ ...base, last_sign_in_at: "2026-10-02T00:00:00Z" }, now)).toBe(false);
  });
  it("Google 등 다른 방식으로 들어온 계정은 건드리지 않는다", () => {
    expect(isStaleUnconfirmedSignup({ ...base, identities: [{ provider: "google" }] }, now)).toBe(false);
  });
});
