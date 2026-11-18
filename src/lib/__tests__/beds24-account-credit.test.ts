import { describe, expect, it, vi } from "vitest";
import { recordBeds24AccountCredit } from "@/lib/beds24/account-credit";

const NOW = Date.parse("2026-11-18T03:00:00.000Z");
const credit = { remaining: 120, resetsAt: NOW + 120_000, requestCost: 2, limit: null };

function client(rpcError: { code?: string; message: string } | null) {
  const calls: string[] = [];
  const c = {
    rpc: vi.fn(async (name: string, _args?: unknown) => {
      void _args;
      calls.push(`rpc:${name}`);
      return { error: rpcError };
    }),
    from: (table: string) => ({
      upsert: async () => {
        calls.push(`upsert:${table}`);
        return { error: null };
      },
    }),
  };
  return { c: c as never, calls, rpc: c.rpc };
}

describe("recordBeds24AccountCredit", () => {
  it("DB 함수(RPC)로 만료 · 출처 · metadata 를 넘긴다", async () => {
    const { c, calls, rpc } = client(null);
    await recordBeds24AccountCredit(c, credit, "rates_write:calendar.post", NOW);
    expect(calls).toEqual(["rpc:beds24_record_account_credit"]);
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_expires_at: new Date(NOW + 120_000).toISOString(),
      p_source: "rates_write:calendar.post",
      p_metadata: { remaining: 120, resetsAt: NOW + 120_000, requestCost: 2, recordedAt: NOW, source: "rates_write:calendar.post" },
    });
  });

  it("리셋 헤더가 없던 값은 만료를 5분 뒤로 추정하고 표시한다", async () => {
    const { c, rpc } = client(null);
    await recordBeds24AccountCredit(c, { remaining: 90, resetsAt: null, requestCost: 1 }, "x", NOW);
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_expires_at: new Date(NOW + 300_000).toISOString(),
      p_metadata: { remaining: 90, resetsAt: null, expiresEstimated: true },
    });
  });

  it("진짜 리셋 시각이면 추정 표시를 붙이지 않는다", async () => {
    const { c, rpc } = client(null);
    await recordBeds24AccountCredit(c, credit, "x", NOW);
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_metadata.expiresEstimated");
  });

  it("DB 함수가 아직 없으면(마이그레이션 전) 예전처럼 upsert", async () => {
    const { c, calls } = client({ code: "PGRST202", message: "not found" });
    await recordBeds24AccountCredit(c, credit, "x", NOW);
    expect(calls).toEqual(["rpc:beds24_record_account_credit", "upsert:beds24_sync_locks"]);
  });

  it("다른 오류면 덮어쓰지 않고 로그만(던지지 않는다)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { c, calls } = client({ code: "57014", message: "timeout" });
    await expect(recordBeds24AccountCredit(c, credit, "x", NOW)).resolves.toBeUndefined();
    expect(calls).toEqual(["rpc:beds24_record_account_credit"]);
    spy.mockRestore();
  });
});
