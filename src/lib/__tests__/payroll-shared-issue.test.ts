import { describe, expect, it } from "vitest";
import { sharedFirstIssue } from "@/components/mobile/payroll/shared-issue";

type K = "not_finalized" | "bank_missing";
const r = (...issues: K[]) => ({ issues });

describe("sharedFirstIssue", () => {
  it("모든 줄의 첫 안내가 같으면 그 키", () => {
    expect(sharedFirstIssue([r("not_finalized"), r("not_finalized", "bank_missing"), r("not_finalized")])).toBe("not_finalized");
  });
  it("한 줄이라도 다르면 null", () => {
    expect(sharedFirstIssue([r("not_finalized"), r("bank_missing")])).toBeNull();
  });
  it("안내 없는 줄이 섞이면 null", () => {
    expect(sharedFirstIssue([r("not_finalized"), r()])).toBeNull();
    expect(sharedFirstIssue([r(), r()])).toBeNull();
  });
  it("줄이 둘보다 적으면 null", () => {
    expect(sharedFirstIssue([])).toBeNull();
    expect(sharedFirstIssue([r("not_finalized")])).toBeNull();
  });
});
