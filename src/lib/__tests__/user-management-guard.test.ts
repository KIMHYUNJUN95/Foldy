import { describe, expect, it } from "vitest";
import {
  authBanAction,
  canChangeTarget,
  deleteScope,
  removesLastOwner,
  targetLock,
} from "@/lib/user-management-guard";

const delegated = { isDeveloper: false, topAdminInOrg: false };
const topAdmin = { isDeveloper: false, topAdminInOrg: true };
const developer = { isDeveloper: true, topAdminInOrg: false };

describe("targetLock", () => {
  it("owner · 전무는 대표급, 개발자는 역할과 무관하게 개발자", () => {
    expect(targetLock({ role: "owner", isDeveloper: false })).toBe("top");
    expect(targetLock({ role: "senior_managing_director", isDeveloper: false })).toBe("top");
    expect(targetLock({ role: "staff", isDeveloper: true })).toBe("dev");
    expect(targetLock({ role: "owner", isDeveloper: true })).toBe("dev");
    expect(targetLock({ role: "office_admin", isDeveloper: false })).toBeNull();
  });
});

describe("canChangeTarget", () => {
  it("user.manage 위임만 받은 직원은 대표급 · 개발자를 못 바꾼다", () => {
    expect(canChangeTarget(delegated, "top")).toBe(false);
    expect(canChangeTarget(delegated, "dev")).toBe(false);
    expect(canChangeTarget(delegated, null)).toBe(true);
  });
  it("대표급은 대표급을 바꿀 수 있지만 개발자 계정은 못 바꾼다", () => {
    expect(canChangeTarget(topAdmin, "top")).toBe(true);
    expect(canChangeTarget(topAdmin, "dev")).toBe(false);
  });
  it("개발자는 모두 바꿀 수 있다", () => {
    expect(canChangeTarget(developer, "top")).toBe(true);
    expect(canChangeTarget(developer, "dev")).toBe(true);
  });
});

describe("removesLastOwner", () => {
  const owner = { role: "owner", status: "active" };
  it("마지막 활성 owner 의 강등 · 비활성 · 삭제를 잡는다", () => {
    expect(removesLastOwner({ target: owner, change: { role: "office_admin" }, activeOwnerCount: 1 })).toBe(true);
    expect(removesLastOwner({ target: owner, change: { status: "suspended" }, activeOwnerCount: 1 })).toBe(true);
    expect(removesLastOwner({ target: owner, change: { delete: true }, activeOwnerCount: 1 })).toBe(true);
  });
  it("owner 로 남는 변경이나 다른 owner 가 있으면 통과", () => {
    expect(removesLastOwner({ target: owner, change: { role: "owner" }, activeOwnerCount: 1 })).toBe(false);
    expect(removesLastOwner({ target: owner, change: { status: "active" }, activeOwnerCount: 1 })).toBe(false);
    expect(removesLastOwner({ target: owner, change: { delete: true }, activeOwnerCount: 2 })).toBe(false);
  });
  it("owner 가 아니거나 이미 비활성인 대상은 해당 없음", () => {
    expect(removesLastOwner({ target: { role: "senior_managing_director", status: "active" }, change: { delete: true }, activeOwnerCount: 0 })).toBe(false);
    expect(removesLastOwner({ target: { role: "owner", status: "suspended" }, change: { delete: true }, activeOwnerCount: 0 })).toBe(false);
  });
});

describe("deleteScope", () => {
  it("다른 조직 멤버십이 있으면 이 조직 멤버십만, 없으면 계정 전체", () => {
    expect(deleteScope(1)).toBe("membership");
    expect(deleteScope(0)).toBe("account");
  });
});

describe("authBanAction", () => {
  it("다른 조직에 활성 멤버십이 있으면 비활성으로 바꿔도 로그인을 막지 않는다", () => {
    expect(authBanAction("suspended", 1)).toBe("keep");
    expect(authBanAction("removed", 2)).toBe("keep");
  });
  it("다른 조직에 활성 멤버십이 없으면 차단", () => {
    expect(authBanAction("suspended", 0)).toBe("ban");
    expect(authBanAction("invited", 0)).toBe("ban");
  });
  it("활성으로 바꾸면 항상 해제 — 바뀐 뒤 활성 멤버십이 생긴다", () => {
    expect(authBanAction("active", 0)).toBe("unban");
    expect(authBanAction("active", 3)).toBe("unban");
  });
});
