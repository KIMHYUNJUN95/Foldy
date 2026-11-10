import { beforeEach, describe, expect, it, vi } from "vitest";
import { createComplaintsFakeDb } from "@/lib/__tests__/complaints-fake-db";

/**
 * 「지금 가져오기」 — 2026-11-10 점검 수정.
 * - 이어 부를 위치(offset)를 **서버가** 잠금 줄에 들고 있는다. 화면이 보낸 offset 은 믿지 않는다 —
 *   예전엔 `offset: 0` 을 계속 보내면 잠금이 살아 있는 동안 같은 조각을 몇 번이고 다시 돌려 Beds24 크레딧을 태웠다.
 * - 정기 수집과 수동 수집은 같은 «도는 중» 잠금을 나눠 쓴다.
 */
const state = vi.hoisted(() => ({
  db: null as unknown,
  session: null as unknown,
  syncCalls: [] as Array<{ offset: number; limit: number }>,
  total: 30,
  lockOk: true,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  getCurrentAppSession: async () => state.session,
  hasOrganizationContext: () => true,
}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => state.db }));
vi.mock("@/lib/beds24/sync-control", () => ({ isBeds24SyncPaused: () => false }));
vi.mock("@/lib/beds24/sync-locks", () => ({
  getBeds24Cooldown: async () => ({ active: false, until: null }),
  acquireBeds24Lock: async (db: { from: (t: string) => { upsert: (r: unknown, o: unknown) => PromiseLike<unknown> } }, name: string, by: string) => {
    if (!state.lockOk) return { acquired: false, lockId: null, reason: "busy" };
    const lockId = `lock-${Math.random()}`;
    await db.from("beds24_sync_locks").upsert(
      { name, locked_by: by, expires_at: new Date(Date.now() + 300_000).toISOString(), metadata: { lockId } },
      { onConflict: "name" },
    );
    return { acquired: true, lockId };
  },
  releaseBeds24Lock: async () => undefined,
}));
vi.mock("@/lib/beds24/reviews-sync", () => ({
  syncOrganizationReviews: async ({ offset, limit }: { offset: number; limit: number }) => {
    state.syncCalls.push({ offset, limit });
    const next = offset + limit;
    return { nextOffset: next < state.total ? next : null, stoppedEarly: false, totalTargets: state.total, upserted: 1 };
  },
}));

import { syncReviewsNowStep } from "@/app/mobile/complaints/review-sync-actions";
import { extendReviewSyncRun, reviewSyncRunLockName, scheduleRunLockPlan } from "@/lib/beds24/reviews-sync-manual";

const ORG = "00000000-0000-4000-8000-000000000900";

beforeEach(() => {
  state.db = createComplaintsFakeDb({ tables: { beds24_sync_locks: [] } }).client;
  state.session = {
    organization: { id: ORG },
    user: { id: "u1" },
    capabilities: ["complaint.write"],
  };
  state.syncCalls = [];
  state.total = 30;
  state.lockOk = true;
});

describe("syncReviewsNowStep — 서버가 이어 부를 위치를 갖는다", () => {
  it("같은 runId 로 이어 부르면 조각은 앞으로만 간다", async () => {
    const first = await syncReviewsNowStep({ runId: null });
    expect(first.ok).toBe(true);
    const runId = first.ok ? first.runId : "";
    await syncReviewsNowStep({ runId });
    await syncReviewsNowStep({ runId });
    expect(state.syncCalls.map((c) => c.offset)).toEqual([0, 12, 24]);
  });

  it("끝난 뒤에는 같은 runId 로 다시 돌릴 수 없다(lost)", async () => {
    const first = await syncReviewsNowStep({ runId: null });
    const runId = first.ok ? first.runId : "";
    await syncReviewsNowStep({ runId });
    const last = await syncReviewsNowStep({ runId });
    expect(last.ok && last.done).toBe(true);
    const again = await syncReviewsNowStep({ runId });
    expect(again).toMatchObject({ ok: false, error: "lost" });
    expect(state.syncCalls).toHaveLength(3);
  });

  it("끝나면 다시 누를 수 있는 시각(availableAt)을 같이 준다, 그 전엔 too_soon", async () => {
    let result = await syncReviewsNowStep({ runId: null });
    const runId = result.ok ? result.runId : "";
    for (let guard = 0; guard < 10 && result.ok && !result.done; guard += 1) result = await syncReviewsNowStep({ runId });
    expect(result.ok && result.availableAt).toBeTruthy();
    const next = await syncReviewsNowStep({ runId: null });
    expect(next).toMatchObject({ ok: false, error: "too_soon" });
  });

  it("남이 잡은 잠금(정기 수집이 도는 중)이면 busy", async () => {
    state.lockOk = false;
    expect(await syncReviewsNowStep({ runId: null })).toMatchObject({ ok: false, error: "busy" });
  });
});

describe("scheduleRunLockPlan — 정기 수집이 수동 수집을 피한다", () => {
  it("사람이 돌리는 중이면 이 조직은 건너뛴다", () => {
    expect(scheduleRunLockPlan({ active: true, lockedBy: "user-1", lockId: "x" })).toEqual({ kind: "skip" });
  });
  it("정기 수집이 앞 조각에서 잡은 잠금이면 이어 쓴다", () => {
    expect(scheduleRunLockPlan({ active: true, lockedBy: "schedule", lockId: "x" })).toEqual({ kind: "reuse", lockId: "x" });
  });
  it("아무도 안 잡았으면 새로 잡는다", () => {
    expect(scheduleRunLockPlan({ active: false, lockedBy: null, lockId: null })).toEqual({ kind: "acquire" });
  });
});

describe("잠금 시간 늘리기 — 한 바퀴가 5분을 넘겨도 잠금이 풀리지 않는다", () => {
  type LockRow = { name: string; expires_at: string; metadata: { lockId?: string } };
  async function lockRow(): Promise<LockRow> {
    const db = state.db as { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: LockRow }> } } } };
    const { data } = await db.from("beds24_sync_locks").select("*").eq("name", reviewSyncRunLockName(ORG)).maybeSingle();
    return data;
  }

  it("조각을 가져갈 때마다 expires_at 이 다시 5분 뒤로 간다", async () => {
    const first = await syncReviewsNowStep({ runId: null });
    const runId = first.ok ? first.runId : "";
    const db = state.db as { from: (t: string) => { update: (r: unknown) => { eq: (k: string, v: string) => Promise<unknown> } } };
    const soon = new Date(Date.now() + 5_000).toISOString();
    await db.from("beds24_sync_locks").update({ expires_at: soon }).eq("name", reviewSyncRunLockName(ORG));
    await syncReviewsNowStep({ runId });
    expect(new Date((await lockRow()).expires_at).getTime()).toBeGreaterThan(Date.now() + 200_000);
  });

  it("extendReviewSyncRun 은 내 lockId 일 때만 늘린다", async () => {
    await syncReviewsNowStep({ runId: null });
    const { metadata } = await lockRow();
    expect(await extendReviewSyncRun(state.db as never, ORG, "someone-else")).toBe(false);
    expect(await extendReviewSyncRun(state.db as never, ORG, metadata.lockId as string)).toBe(true);
  });
});
