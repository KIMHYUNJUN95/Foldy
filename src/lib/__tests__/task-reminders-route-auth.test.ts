import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** 할 일 리마인더 주소 — 비밀값은 Authorization: Bearer 헤더로만(?secret= 은 기록에 남는다). */
const state = vi.hoisted(() => ({ runs: 0 }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => ({}) }));
vi.mock("@/lib/auth/unconfirmed-signup-cleanup", () => ({ cleanupUnconfirmedSignups: async () => ({}) }));
vi.mock("@/lib/staff-documents/retention", () => ({ cleanupExpiredIdDocuments: async () => ({}), cleanupOrphanIdUploads: async () => ({}) }));
vi.mock("@/lib/notifications/id-document-reminders", () => ({ runIdDocumentExpiryReminders: async () => ({}) }));
vi.mock("@/lib/notifications/task-reminders", () => ({
  runTaskReminders: async () => {
    state.runs += 1;
    return {};
  },
}));

import { GET } from "@/app/api/tasks/reminders/route";

beforeEach(() => {
  process.env.CRON_SECRET = "cron-test-secret";
  state.runs = 0;
});

describe("할 일 리마인더 주소 인증", () => {
  it("주소의 ?secret= 은 받지 않는다", async () => {
    const res = await GET(new NextRequest("http://localhost/api/tasks/reminders?secret=cron-test-secret"));
    expect(res.status).toBe(403);
    expect(state.runs).toBe(0);
  });
  it("Bearer 헤더면 돈다", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/tasks/reminders", { headers: { authorization: "Bearer cron-test-secret" } }),
    );
    expect(res.status).toBe(200);
    expect(state.runs).toBe(1);
  });
});
