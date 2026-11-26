import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type RpcResult = { data: unknown; error: { message: string } | null };
let rpcImpl: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return rpcImpl(name, args);
    },
  }),
}));

import { AUTH_ATTEMPT_LIMITS, clientIpFromHeaders, takeAuthAttempt } from "@/lib/auth-attempt-limit";

beforeEach(() => {
  rpcCalls.length = 0;
  rpcImpl = async () => ({ data: true, error: null });
  vi.restoreAllMocks();
});

describe("takeAuthAttempt", () => {
  it("passes the action's limits and hashed keys — never the raw email or IP", async () => {
    expect(await takeAuthAttempt("sign_in", { email: " Staff@Example.com ", ip: "203.0.113.7" })).toBe(true);
    const { name, args } = rpcCalls[0];
    expect(name).toBe("take_auth_attempt");
    expect(args).toMatchObject({ p_action: "sign_in", p_window_seconds: 900, p_email_limit: 10, p_ip_limit: 30 });
    expect(args.p_email_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(args.p_ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(args)).not.toContain("example.com");
    expect(JSON.stringify(args)).not.toContain("203.0.113.7");
  });

  it("normalises email case so Staff@ and staff@ share one bucket", async () => {
    await takeAuthAttempt("password_reset", { email: "Staff@Example.com", ip: null });
    await takeAuthAttempt("password_reset", { email: "staff@example.com", ip: null });
    expect(rpcCalls[0].args.p_email_hash).toBe(rpcCalls[1].args.p_email_hash);
  });

  it("skips the IP key when the IP is unknown instead of pooling everyone into one bucket", async () => {
    await takeAuthAttempt("sign_up", { email: "a@b.co", ip: null });
    expect(rpcCalls[0].args.p_ip_hash).toBeNull();
  });

  it("denies when the database says the limit is reached", async () => {
    rpcImpl = async () => ({ data: false, error: null });
    expect(await takeAuthAttempt("resend_signup", { email: "a@b.co", ip: "1.1.1.1" })).toBe(false);
  });

  it("fails open and logs on a database error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcImpl = async () => ({ data: null, error: { message: "boom" } });
    expect(await takeAuthAttempt("sign_in", { email: "a@b.co", ip: "1.1.1.1" })).toBe(true);
    expect(log).toHaveBeenCalled();
  });

  it("fails open and logs when the call throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcImpl = async () => {
      throw new Error("network");
    };
    expect(await takeAuthAttempt("sign_in", { email: "a@b.co", ip: null })).toBe(true);
    expect(log).toHaveBeenCalled();
  });

  it("email-sending actions are tighter than sign-in", () => {
    for (const action of ["sign_up", "resend_signup", "password_reset"] as const) {
      expect(AUTH_ATTEMPT_LIMITS[action]).toEqual({ windowSeconds: 3600, perEmail: 3, perIp: 10 });
    }
  });
});

describe("clientIpFromHeaders", () => {
  const h = (init: Record<string, string>) => new Headers(init);
  it("takes the first x-forwarded-for value", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });
  it("falls back to x-real-ip, then null", () => {
    expect(clientIpFromHeaders(h({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIpFromHeaders(h({}))).toBeNull();
  });
});
