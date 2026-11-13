import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const paused = vi.hoisted(() => ({ value: false }));
const calls = vi.hoisted(() => ({ list: [] as unknown[] }));

vi.mock("@/lib/beds24/sync-control", () => ({ isBeds24SyncPaused: () => paused.value }));
vi.mock("@/lib/guest-messages/backfill", () => ({
  BACKFILL_MAX_PAGES_PER_CALL: 20,
  backfillGuestMessageHistory: async (...args: unknown[]) => {
    calls.list.push(args);
    return { skipped: null, stoppedEarly: null };
  },
  isBackfillFailure: () => false,
}));

const PG_TOKEN = "p".repeat(48);
vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: () => ({
    rpc: async (_fn: string, args: { p_token: string }) => ({ data: args.p_token === PG_TOKEN, error: null }),
  }),
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/beds24/messages-backfill/route";

const ORG = "11111111-1111-4111-8111-111111111111";
const SECRET = "test-cron-secret";

function request(query: string, auth: boolean | string = true) {
  const token = auth === true ? SECRET : auth || null;
  return new NextRequest(`https://app.test/api/beds24/messages-backfill?${query}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  paused.value = false;
  calls.list = [];
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("/api/beds24/messages-backfill", () => {
  it("authenticates before reporting the sync pause", async () => {
    paused.value = true;
    const anonymous = await GET(request(`organizationId=${ORG}`, false));
    expect(anonymous.status).toBe(403);
    const authed = await GET(request(`organizationId=${ORG}`));
    expect(authed.status).toBe(202);
  });

  it("caps pages at 20 and requires organizationId", async () => {
    expect((await GET(request(`organizationId=${ORG}&pages=21`))).status).toBe(400);
    expect((await GET(request("pages=5"))).status).toBe(400);
    const ok = await GET(request(`organizationId=${ORG}&pages=20&restart=1`));
    expect(ok.status).toBe(200);
    expect(calls.list).toEqual([[ORG, { mode: "run", restart: true }, { maxPages: 20 }]]);
  });

  it("accepts the pg_cron Vault token, rejects a wrong one, and stays closed without either", async () => {
    expect((await GET(request(`organizationId=${ORG}&pages=20`, PG_TOKEN))).status).toBe(200);
    expect((await GET(request(`organizationId=${ORG}`, "w".repeat(48)))).status).toBe(403);
    delete process.env.CRON_SECRET;
    expect((await GET(request(`organizationId=${ORG}`, false))).status).toBe(404);
    expect((await GET(request(`organizationId=${ORG}&pages=20`, PG_TOKEN))).status).toBe(200);
  });
});
