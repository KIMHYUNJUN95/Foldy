import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const manage = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/user-management-access", () => ({ actorCanManageUsersInOrg: async () => manage.value }));

import { canReviewStaffDocuments } from "@/lib/staff-documents/review-access";

/** 재류카드 확인 · 대신 올리기 문 — view + 사용자 관리 한 판정(docs/product/41 §4). */
const session = (capabilities: string[]) =>
  ({ capabilities, organization: { id: "o" }, user: { id: "u", role: "office_admin" } }) as never;

describe("canReviewStaffDocuments", () => {
  beforeEach(() => {
    manage.value = true;
  });
  it("view + 사용자 관리 둘 다 있어야 통과", async () => {
    expect(await canReviewStaffDocuments(session(["staff_documents.view"]))).toBe(true);
  });
  it("view 만 있으면 막는다", async () => {
    manage.value = false;
    expect(await canReviewStaffDocuments(session(["staff_documents.view"]))).toBe(false);
  });
  it("사용자 관리만 있으면 막는다", async () => {
    expect(await canReviewStaffDocuments(session([]))).toBe(false);
  });
});
