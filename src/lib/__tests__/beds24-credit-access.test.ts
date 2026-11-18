import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { canViewBeds24Credit } from "@/lib/beds24/credit-access";
import type { AppSession } from "@/lib/session";

function session(orgId: string, capabilities: string[]): AppSession {
  return { organization: { id: orgId }, capabilities } as unknown as AppSession;
}

describe("canViewBeds24Credit — 레이아웃 게이지와 액션이 같은 답", () => {
  it("조직 + 운영 관리 + 관리 웹이 다 있어야 한다", () => {
    expect(canViewBeds24Credit(session("org-1", ["ops_admin.access", "admin_web.access"]))).toBe(true);
    expect(canViewBeds24Credit(session("org-1", ["ops_admin.access"]))).toBe(false);
    expect(canViewBeds24Credit(session("org-1", ["admin_web.access"]))).toBe(false);
    expect(canViewBeds24Credit(session("platform", ["ops_admin.access", "admin_web.access"]))).toBe(false);
    expect(canViewBeds24Credit(null)).toBe(false);
  });
});
