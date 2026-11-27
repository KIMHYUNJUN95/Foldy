import { describe, expect, it } from "vitest";
import { directoryRoleTag } from "@/lib/directory-role-tag";
import { getDictionary } from "@/lib/i18n";

describe("directoryRoleTag", () => {
  for (const locale of ["ko", "ja", "en"] as const) {
    const d = getDictionary(locale);
    const roles = d.roles as Record<string, string>;
    const short = { fieldManager: d.mobile.directory.roleTagFieldManager, partLeader: d.mobile.directory.roleTagPartLeader };
    const tag = (role: string) => directoryRoleTag(role, roles[role], false, short);

    it(`${locale}: 아르바이트는 묶음 이름과 같아 숨김, 리더 · 현장 관리자는 짧은 말`, () => {
      expect(tag("part_time_staff")).toBe("");
      expect(tag("staff")).toBe(short.partLeader);
      expect(tag("field_manager")).toBe(short.fieldManager);
      expect(short.partLeader).not.toBe("");
      expect(short.fieldManager).not.toBe("");
    });

    it(`${locale}: 관리 · 사무실 역할은 역할 이름 그대로`, () => {
      expect(tag("owner")).toBe(roles.owner);
      expect(tag("office_admin")).toBe(roles.office_admin);
    });
  }

  it("개발자 표시처럼 기본 이름이 아니면 그대로", () => {
    expect(directoryRoleTag("part_time_staff", "Developer", true, { fieldManager: "M", partLeader: "L" })).toBe("Developer");
  });
});
