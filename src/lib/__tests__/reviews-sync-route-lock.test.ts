import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createComplaintsFakeDb } from "@/lib/__tests__/complaints-fake-db";

/**
 * 정기 리뷰 수집 주소의 «도는 중» 잠금 — 2026-11-10 점검 수정.
 * - 잠금 함수가 실패하면(reason "error") 조용히 건너뛰지 않고 207 `organization_lock_failed`.
 * - 사람이 도는 중(busy)이면 200 `busy_manual_sync` 로 그 조직만 건너뛴다.
 * - 앞 조각에서 잡은 잠금을 이어 쓰지 못하면(시간 늘리기 실패) 건너뛴다 — 수집을 돌리지 않는다.
 */
const state = vi.hoisted(() => ({
  db: null as unknown,
  lock: { acquired: true, lockId: "L1" } as { acquired: boolean; lockId: string | null; reason?: string },
  syncCalls: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => state.db }));
vi.mock("@/lib/api-secret", () => ({ requestMatchesSecret: () => true }));
vi.mock("@/lib/beds24/sync-control", () => ({ isBeds24SyncPaused: () => false }));
vi.mock("@/lib/beds24/sync-locks", () => ({
  acquireBeds24Lock: async () => state.lock,
  releaseBeds24Lock: async () => undefined,
}));
vi.mock("@/lib/beds24/reviews-sync", () => ({
  syncOrganizationReviews: async () => {
    state.syncCalls += 1;
    return { nextOffset: null, stoppedEarly: false, totalTargets: 1, upserted: 0, requests: 0, skipped: 0 };
  },
}));

import { POST } from "@/app/api/beds24/reviews-sync/route";
import { reviewSyncRunLockName } from "@/lib/beds24/reviews-sync-manual";

const ORG = "00000000-0000-4000-8000-000000000900";
const request = () => new NextRequest(`http://localhost/api/beds24/reviews-sync?organizationId=${ORG}`, { method: "POST" });

beforeEach(() => {
  process.env.CRON_SECRET = "test";
  state.syncCalls = 0;
  state.lock = { acquired: true, lockId: "L1" };
  state.db = createComplaintsFakeDb({ tables: { beds24_sync_locks: [] } }).client;
});

describe("정기 리뷰 수집 — 잠금 결과에 따라", () => {
  it("잠금 함수 오류면 207 partial_failure · organization_lock_failed, 수집은 안 돈다", async () => {
    state.lock = { acquired: false, lockId: null, reason: "error" };
    const response = await POST(request());
    expect(response.status).toBe(207);
    expect(await response.json()).toMatchObject({ ok: false, mode: "partial_failure", error: "organization_lock_failed" });
    expect(state.syncCalls).toBe(0);
  });

  it("남이 잡은 잠금(busy)이면 200 busy_manual_sync 로 건너뛴다", async () => {
    state.lock = { acquired: false, lockId: null, reason: "busy" };
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: "busy_manual_sync" });
    expect(state.syncCalls).toBe(0);
  });

  it("정기 수집이 이어 쓸 잠금의 시간을 못 늘리면(lockId 가 바뀜) 건너뛴다", async () => {
    // 줄에는 schedule 잠금이 살아 있지만 시간 늘리기(조건부 갱신)가 실패 — 이어 쓰기 실패.
    const fake = createComplaintsFakeDb({
      tables: {
        beds24_sync_locks: [
          {
            name: reviewSyncRunLockName(ORG),
            locked_by: "schedule",
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            metadata: { lockId: "old" },
          },
        ],
      },
      failWrite: (table, op) => (table === "beds24_sync_locks" && op === "update" ? { code: "XX000", message: "boom" } : null),
    });
    state.db = fake.client;
    const response = await POST(request());
    expect(await response.json()).toMatchObject({ mode: "busy_manual_sync" });
    expect(state.syncCalls).toBe(0);
  });

  it("정기 수집이 이어 쓸 잠금이면 시간을 늘리고 돈다", async () => {
    const fake = createComplaintsFakeDb({
      tables: {
        beds24_sync_locks: [
          {
            name: reviewSyncRunLockName(ORG),
            locked_by: "schedule",
            expires_at: new Date(Date.now() + 10_000).toISOString(),
            metadata: { lockId: "old" },
          },
        ],
      },
    });
    state.db = fake.client;
    await POST(request());
    expect(state.syncCalls).toBe(1);
    expect(new Date(String(fake.tables.beds24_sync_locks[0].expires_at)).getTime()).toBeGreaterThan(Date.now() + 200_000);
  });
});
