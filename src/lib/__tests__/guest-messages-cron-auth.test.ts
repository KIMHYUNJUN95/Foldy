import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { authorizeGuestMessagesCron } from "@/lib/guest-messages/cron-auth";

const SECRET = "test-cron-secret";
const TOKEN = "a".repeat(64);

function req(bearer?: string) {
  return { headers: new Headers(bearer ? { authorization: `Bearer ${bearer}` } : {}) };
}
function db(answer: { data: unknown; error: { code?: string; message: string } | null }) {
  const calls: unknown[] = [];
  const made = { count: 0 };
  const client = {
      rpc: (fn: "guest_messages_cron_token_ok", args: { p_token: string }) => {
        calls.push([fn, args]);
        return Promise.resolve(answer);
      },
  };
  // 라우트는 서비스 클라이언트를 만드는 함수를 넘긴다 — CRON_SECRET 이 맞으면 만들지도 않는다.
  return { calls, made, client: () => { made.count += 1; return client; } };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("손님 메시지 정기 실행 인가", () => {
  it("CRON_SECRET 이 맞으면 DB 에 묻지 않고 통과", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const fake = db({ data: false, error: null });
    expect(await authorizeGuestMessagesCron(req(SECRET), fake.client)).toEqual({ ok: true });
    expect(fake.calls).toHaveLength(0);
    expect(fake.made.count).toBe(0);
  });

  it("pg_cron 토큰은 guest_messages_cron_token_ok 로 대조 — 맞으면 통과(CRON_SECRET 이 없어도)", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const fake = db({ data: true, error: null });
    expect(await authorizeGuestMessagesCron(req(TOKEN), fake.client)).toEqual({ ok: true });
    expect(fake.calls).toEqual([["guest_messages_cron_token_ok", { p_token: TOKEN }]]);
  });

  it("틀린 값은 403, CRON_SECRET 이 없으면 404(닫힌 채)", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    expect(await authorizeGuestMessagesCron(req(TOKEN), db({ data: false, error: null }).client)).toEqual({ ok: false, status: 403 });
    vi.stubEnv("CRON_SECRET", "");
    expect(await authorizeGuestMessagesCron(req(TOKEN), db({ data: false, error: null }).client)).toEqual({ ok: false, status: 404 });
    expect(await authorizeGuestMessagesCron(req(), db({ data: true, error: null }).client)).toEqual({ ok: false, status: 404 });
  });

  it("짧은 값은 DB 에 묻지 않고, 함수가 없으면(마이그레이션 전) 거절", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const short = db({ data: true, error: null });
    expect(await authorizeGuestMessagesCron(req("short"), short.client)).toEqual({ ok: false, status: 403 });
    expect(short.calls).toHaveLength(0);
    expect(short.made.count).toBe(0);
    const missing = db({ data: null, error: { code: "PGRST202", message: "not found" } });
    expect(await authorizeGuestMessagesCron(req(TOKEN), missing.client)).toEqual({ ok: false, status: 403 });
  });
});
