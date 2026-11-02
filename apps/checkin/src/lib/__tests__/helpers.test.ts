import { describe, expect, it } from "vitest";

import { buildingKeyOf } from "../building-key";
import { newCheckinCode } from "../checkin-code";
import { isCronAuthorized } from "../cron-auth";
import { guestCountOf } from "../guest-count";
import { addDays, addYears, todayTokyo } from "../tokyo-date";

describe("tokyo-date", () => {
  it("UTC 오후 3시 이후는 도쿄 다음 날", () => {
    expect(todayTokyo(new Date("2026-11-01T14:59:00Z"))).toBe("2026-11-01");
    expect(todayTokyo(new Date("2026-11-01T15:00:00Z"))).toBe("2026-11-02");
  });
  it("날짜 · 해 더하기", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addYears("2028-02-29", 3)).toBe("2031-02-28");
    expect(addYears("2026-11-07", 3)).toBe("2029-11-07");
  });
});

describe("buildingKeyOf", () => {
  it("한국어 · 일본어 · 영어 이름을 같은 키로", () => {
    expect(buildingKeyOf("아라키초A")).toBe("arakicho_a");
    expect(buildingKeyOf("荒木町B")).toBe("arakicho_b");
    expect(buildingKeyOf("Okubo AB棟")).toBe("okubo_a");
    expect(buildingKeyOf("타카다노바바")).toBe("takadanobaba");
    expect(buildingKeyOf("STAY ARI Apartment Hotel")).toBe("stay_ari");
    expect(buildingKeyOf("없는 건물")).toBeNull();
  });
});

describe("guestCountOf", () => {
  it("성인 + 어린이 + 유아", () => {
    expect(guestCountOf({ numAdult: 2, numChild: 1, numInfant: 1 })).toBe(4);
    expect(guestCountOf({ adults: "3" })).toBe(3);
    expect(guestCountOf({})).toBeNull();
    expect(guestCountOf(null)).toBeNull();
  });
});

describe("newCheckinCode", () => {
  it("항상 6자리 숫자", () => {
    for (let i = 0; i < 200; i += 1) expect(newCheckinCode()).toMatch(/^[0-9]{6}$/);
  });
});

describe("isCronAuthorized", () => {
  it("비밀값이 맞을 때만 통과", () => {
    expect(isCronAuthorized("Bearer s3cret", "s3cret")).toBe(true);
    expect(isCronAuthorized("Bearer wrong", "s3cret")).toBe(false);
    expect(isCronAuthorized("s3cret", "s3cret")).toBe(false);
    expect(isCronAuthorized(null, "s3cret")).toBe(false);
    expect(isCronAuthorized("Bearer ", undefined)).toBe(false);
  });
});
