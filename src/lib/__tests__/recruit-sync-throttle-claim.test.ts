import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** 채용 최신분 동기화 — 스로틀 창을 읽고 판단하지 않고 조건부 update 로 먼저 잡는다(동시 두 요청 중 하나만 실행). */
const state = vi.hoisted(() => ({
  row: null as null | { last_run_at: string | null; last_success_at: string | null },
  fetches: 0,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/recruit/firestore", () => ({
  fetchFirestoreCollection: async () => {
    state.fetches += 1;
    return [];
  },
  fetchFirestoreCollectionSince: async () => {
    state.fetches += 1;
    return [];
  },
}));
vi.mock("@/lib/recruit/firestore-auth", () => ({ firestoreAuthState: () => "ok", hasFirestoreServiceAccount: () => false }));
vi.mock("@/lib/recruit/ingest", () => ({ ingestJobApplication: async () => ({ ok: true, created: true }) }));
vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.row, error: null }) }) }),
      // 선점 update — 동기 구간에서 조건을 보고 값을 바꾼다(실제 DB 의 한 문장 원자성과 같다).
      update: (patch: { last_run_at: string }) => ({
        eq: () => ({
          or: (filter: string) => ({
            select: async () => {
              const cutoff = filter.split("last_run_at.lte.")[1];
              const row = state.row;
              if (!row || (row.last_run_at !== null && row.last_run_at > cutoff)) return { data: [], error: null };
              row.last_run_at = patch.last_run_at;
              return { data: [{ id: true }], error: null };
            },
          }),
        }),
      }),
      upsert: async () => ({ error: null }),
    }),
  }),
}));

import { POST } from "@/app/api/recruit/sync/route";

const req = () => new NextRequest("http://localhost/api/recruit/sync", { method: "POST" });

beforeEach(() => {
  state.fetches = 0;
  state.row = { last_run_at: new Date(Date.now() - 10 * 60_000).toISOString(), last_success_at: new Date(Date.now() - 10 * 60_000).toISOString() };
});

describe("채용 동기화 스로틀 선점", () => {
  it("동시에 두 요청이 와도 하나만 Firestore 를 읽는다", async () => {
    const [a, b] = await Promise.all([POST(req()), POST(req())]);
    const bodies = [await a.json(), await b.json()];
    expect(state.fetches).toBe(1);
    expect(bodies.filter((body) => body.skipped === "throttled")).toHaveLength(1);
  });
  it("창 안의 다음 요청은 건너뛴다", async () => {
    await POST(req());
    const second = await (await POST(req())).json();
    expect(second.skipped).toBe("throttled");
    expect(state.fetches).toBe(1);
  });
});
