import { describe, expect, it } from "vitest";
import {
  OCR_DAILY_LIMIT_PER_ORG,
  OCR_DAILY_LIMIT_PER_USER,
  ocrLimitReached,
  pickExpiredOwners,
  retentionCutoff,
  ymdMinusYears,
} from "@/lib/staff-documents/policy";

describe("ocrLimitReached", () => {
  it("사람 · 조직 상한 중 하나라도 차면 막는다", () => {
    expect(ocrLimitReached({ user: 0, organization: 0 })).toBe(false);
    expect(ocrLimitReached({ user: OCR_DAILY_LIMIT_PER_USER - 1, organization: 0 })).toBe(false);
    expect(ocrLimitReached({ user: OCR_DAILY_LIMIT_PER_USER, organization: 0 })).toBe(true);
    expect(ocrLimitReached({ user: 0, organization: OCR_DAILY_LIMIT_PER_ORG })).toBe(true);
  });
});

describe("ymdMinusYears / retentionCutoff", () => {
  it("3년 전 같은 날", () => {
    expect(ymdMinusYears("2029-10-23", 3)).toBe("2026-10-23");
  });
  it("2/29 는 평년 2/28 로", () => {
    expect(ymdMinusYears("2028-02-29", 3)).toBe("2025-02-28");
  });
  it("기준은 도쿄 0시", () => {
    expect(retentionCutoff("2029-10-23")).toBe("2026-10-23T00:00:00+09:00");
  });
});

describe("pickExpiredOwners", () => {
  const cutoff = "2026-10-23T00:00:00+09:00";
  const doc = (userId: string, updatedAt = "2020-01-01T00:00:00Z") => ({ organizationId: "o", userId, updatedAt });

  it("재직 중이면 오래된 서류도 둔다", () => {
    expect(pickExpiredOwners([doc("a")], [{ organizationId: "o", userId: "a", status: "active", leftAt: null }], cutoff)).toEqual([]);
  });

  it("기준보다 먼저 떠난 사람만 고른다 — 도쿄 0시 경계", () => {
    const memberships = [
      // 도쿄 10-22 23:59 → 지운다
      { organizationId: "o", userId: "a", status: "removed", leftAt: "2026-10-22T14:59:00Z" },
      // 도쿄 10-23 00:00 → 아직
      { organizationId: "o", userId: "b", status: "suspended", leftAt: "2026-10-22T15:00:00Z" },
    ];
    expect(pickExpiredOwners([doc("a"), doc("b")], memberships, cutoff)).toEqual([{ organizationId: "o", userId: "a" }]);
  });

  it("떠난 시각을 모르면 지우지 않는다", () => {
    expect(pickExpiredOwners([doc("a")], [{ organizationId: "o", userId: "a", status: "removed", leftAt: null }], cutoff)).toEqual([]);
  });

  it("다른 조직의 멤버십은 보지 않는다", () => {
    const memberships = [{ organizationId: "other", userId: "a", status: "active", leftAt: null }];
    expect(pickExpiredOwners([doc("a")], memberships, cutoff)).toEqual([{ organizationId: "o", userId: "a" }]);
  });

  it("멤버십이 없으면 가장 늦은 서류 시각으로 잰다", () => {
    expect(pickExpiredOwners([doc("a"), doc("a", "2027-01-01T00:00:00Z")], [], cutoff)).toEqual([]);
    expect(pickExpiredOwners([doc("a"), doc("a", "2025-01-01T00:00:00Z")], [], cutoff)).toEqual([{ organizationId: "o", userId: "a" }]);
  });

  it("목록이 잘렸으면 멤버십 없는 사람은 건너뛴다", () => {
    expect(pickExpiredOwners([doc("a")], [], cutoff, { includeOrphans: false })).toEqual([]);
  });
});
