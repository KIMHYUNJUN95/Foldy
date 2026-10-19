import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => null }));

import { sortMembershipsByJoinedAt, type IdentityMembershipRow } from "@/lib/identity-rows";

// 세션(가장 먼저 가입한 활성 조직)과 온보딩(가장 최근 가입한 조직)이 예전 DB 정렬
// `.order("joined_at", { ascending, nullsFirst: false })` 과 같은 순서를 받아야 한다 — 값 없는 행은 늘 맨 뒤.
function row(id: string, joinedAt: string | null): IdentityMembershipRow {
  return { organization_id: id, role: "staff", status: "active", joined_at: joinedAt, organizations: null };
}

describe("sortMembershipsByJoinedAt", () => {
  const rows = [
    row("b", "2026-05-02T00:00:00+00:00"),
    row("n", null),
    row("a", "2026-01-10T00:00:00+00:00"),
    row("c", "2026-09-30T12:00:00+00:00"),
  ];

  it("asc — earliest first, null last", () => {
    expect(sortMembershipsByJoinedAt(rows, "asc").map((r) => r.organization_id)).toEqual(["a", "b", "c", "n"]);
  });

  it("desc — latest first, null still last", () => {
    expect(sortMembershipsByJoinedAt(rows, "desc").map((r) => r.organization_id)).toEqual(["c", "b", "a", "n"]);
  });

  it("does not mutate the input", () => {
    const before = rows.map((r) => r.organization_id);
    sortMembershipsByJoinedAt(rows, "asc");
    expect(rows.map((r) => r.organization_id)).toEqual(before);
  });
});
