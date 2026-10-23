import { describe, expect, it } from "vitest";
import {
  isOrgTopAdmin,
  isOrgTopAdminOrPlatform,
  isOwnerOrPlatformDeveloper,
  isPlatformDeveloper,
} from "@/config/roles";

// 2026-10-23 「개발자는 전부 가능」 — docs/engineering/05-rls-permissions.md 「개발자 예외」.
describe("isPlatformDeveloper", () => {
  it("is true only for developer_super_admin", () => {
    expect(isPlatformDeveloper("developer_super_admin")).toBe(true);
    expect(isPlatformDeveloper("owner")).toBe(false);
    expect(isPlatformDeveloper("office_admin")).toBe(false);
    expect(isPlatformDeveloper("part_time_staff")).toBe(false);
    expect(isPlatformDeveloper(null)).toBe(false);
    expect(isPlatformDeveloper(undefined)).toBe(false);
  });

  it("is included by isOrgTopAdminOrPlatform but not by isOrgTopAdmin", () => {
    expect(isOrgTopAdminOrPlatform("developer_super_admin")).toBe(true);
    expect(isOrgTopAdmin("developer_super_admin")).toBe(false);
    expect(isOrgTopAdminOrPlatform("owner")).toBe(true);
    expect(isOrgTopAdminOrPlatform("office_admin")).toBe(false);
  });
});

describe("isOwnerOrPlatformDeveloper", () => {
  const staff = { id: "u1", role: "staff" };
  const dev = { id: "d1", role: "developer_super_admin" };

  it("lets the owner through", () => {
    expect(isOwnerOrPlatformDeveloper(staff, "u1")).toBe(true);
  });

  it("blocks someone else's record for a normal member", () => {
    expect(isOwnerOrPlatformDeveloper(staff, "u2")).toBe(false);
    expect(isOwnerOrPlatformDeveloper(staff, null)).toBe(false);
    expect(isOwnerOrPlatformDeveloper(staff, "")).toBe(false);
  });

  it("lets the platform developer through for anyone's record", () => {
    expect(isOwnerOrPlatformDeveloper(dev, "u2")).toBe(true);
    expect(isOwnerOrPlatformDeveloper(dev, null)).toBe(true);
    expect(isOwnerOrPlatformDeveloper(dev, "d1")).toBe(true);
  });
});
