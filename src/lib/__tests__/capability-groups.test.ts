import { describe, expect, it } from "vitest";
import { CAPABILITY_GROUPS, HIDDEN_CAPABILITIES, capabilityGroupOf, groupPermissionRows } from "@/config/capability-groups";
import { assignableCapabilities, capabilityPolicy } from "@/config/capabilities";

/** 사용자 화면 권한 묶음(2026-10-22) — 새 키가 어느 묶음에도 안 들어가 맨 위 「관리자 웹」에 섞이지 않게. */
describe("권한 토글 묶음", () => {
  it("화면에 나오는 키는 모두 정확히 한 묶음에 들어 있다", () => {
    const shown = assignableCapabilities().filter((key) => !HIDDEN_CAPABILITIES.includes(key) && !capabilityPolicy(key).systemOnly);
    for (const key of shown) {
      const count = CAPABILITY_GROUPS.filter((group) => (group.keys as readonly string[]).includes(key)).length;
      expect(count, key).toBe(1);
    }
  });

  it("키가 아닌 줄(개발자 지정)은 관리자 웹 묶음으로", () => {
    expect(capabilityGroupOf("developer")).toBe("access");
  });

  it("묶음 순서와 묶음 안 순서를 지키고 빈 묶음은 뺀다", () => {
    const grouped = groupPermissionRows([{ id: "payroll.view" }, { id: "cleaning.work" }, { id: "attendance.manage" }, { id: "developer" }]);
    expect(grouped.map((group) => group.id)).toEqual(["access", "attendance", "cleaning"]);
    expect(grouped[1].rows.map((row) => row.id)).toEqual(["attendance.manage", "payroll.view"]);
  });
});
