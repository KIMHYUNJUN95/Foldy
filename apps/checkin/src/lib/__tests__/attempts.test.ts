import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { recordPending } from "../guest/attempts";
import { kioskLockState, KIOSK_LOCK_MS } from "../kiosk/find";

describe("recordPending — 돌려받는 순서를 믿지 않는다", () => {
  it("DB 가 거꾸로 돌려줘도 key_hash 로 짝을 맞춘다", async () => {
    const db = {
      from: () => ({
        insert: () => ({ select: async () => ({ data: [{ id: 2, key_hash: "b" }, { id: 1, key_hash: "a" }], error: null }) }),
      }),
    };
    const own = await recordPending(db as never, [{ key_hash: "a", ip_hash: "x" }, { key_hash: "b", ip_hash: "-" }]);
    expect(own.idOf("a")).toBe(1);
    expect(own.idOf("b")).toBe(2);
    expect(own.ids.sort()).toEqual([1, 2]);
  });

  it("돌려받은 줄 수가 다르면 판정하지 않는다", async () => {
    const db = { from: () => ({ insert: () => ({ select: async () => ({ data: [{ id: 1, key_hash: "a" }], error: null }) }) }) };
    await expect(recordPending(db as never, [{ key_hash: "a", ip_hash: "x" }, { key_hash: "b", ip_hash: "-" }])).rejects.toThrow();
  });
});

describe("kioskLockState — 동시 요청으로 5의 배수를 건너뛰어도 잠긴다", () => {
  const now = new Date("2026-11-13T06:00:00Z");
  const fails = (n: number, stepMs = 0) => Array.from({ length: n }, (_, i) => ({ succeeded: false, attempted_at: new Date(now.getTime() - i * stepMs).toISOString() }));

  it("한꺼번에 7번이 들어와 있어도(5 → 7) 잠금", () => {
    expect(kioskLockState(fails(7), now).lockedUntil).not.toBeNull();
  });

  it("5번째 실패에서 1분이 지났으면 6번째 시도는 열림(예전 규칙 그대로)", () => {
    const rows = [{ succeeded: false, attempted_at: new Date(now.getTime() - 10_000).toISOString() }, ...fails(5).map((row) => ({ ...row, attempted_at: new Date(now.getTime() - KIOSK_LOCK_MS - 20_000).toISOString() }))];
    expect(kioskLockState(rows, now).lockedUntil).toBeNull();
  });
});
