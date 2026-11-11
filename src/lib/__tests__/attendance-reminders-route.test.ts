import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 근태 리마인더 주소 — 비밀값은 헤더(Authorization: Bearer)로만 받는다(2026-11-11). 주소의 `?secret=` 은 서버 · 프록시 기록에
 * 남으므로 받지 않는다. 이 주소는 아직 예약 실행되지 않는다(알림은 개발 막바지에 한꺼번에 — 문서 24 「근태 점검 1차」).
 */
const state = vi.hoisted(() => ({ runs: 0 }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => ({}) }));
vi.mock("@/lib/notifications/attendance-reminders", () => ({
  runAttendanceReminders: async () => {
    state.runs += 1;
    return { remindersCreated: 0, abnormalAlerts: 0, openSessions: 0 };
  },
}));

import { GET } from "@/app/api/attendance/reminders/route";

beforeEach(() => {
  process.env.CRON_SECRET = "cron-test-secret";
  state.runs = 0;
});

describe("근태 리마인더 주소 인증", () => {
  it("주소의 ?secret= 은 받지 않는다", async () => {
    const res = await GET(new NextRequest("http://localhost/api/attendance/reminders?secret=cron-test-secret"));
    expect(res.status).toBe(403);
    expect(state.runs).toBe(0);
  });

  it("Bearer 헤더면 돈다", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/attendance/reminders", {
        headers: { authorization: "Bearer cron-test-secret" },
      }),
    );
    expect(res.status).toBe(200);
    expect(state.runs).toBe(1);
  });
});
