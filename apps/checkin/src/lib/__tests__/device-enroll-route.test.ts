import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/device/enroll — 코드를 만든 직원을 기기에 옮기고 기록을 남기는지. DB 는 가짜.
const state = vi.hoisted(() => ({
  codeRow: null as null | Record<string, unknown>,
  deviceInserts: [] as Record<string, unknown>[],
  auditInserts: [] as Record<string, unknown>[],
  auditError: null as null | { message: string },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({
  createCheckinServiceClient: () => ({
    from: (table: string) => {
      if (table === "claim_attempts") {
        const query = {
          select: () => query,
          eq: () => query,
          gte: () => query,
          insert: async () => ({ error: null }),
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ count: 0, error: null })),
        };
        return query;
      }
      if (table === "enrollment_codes") {
        const query = {
          update: () => query,
          eq: () => query,
          is: () => query,
          gt: () => query,
          select: () => query,
          maybeSingle: async () => ({ data: state.codeRow, error: null }),
        };
        return query;
      }
      if (table === "devices") {
        return {
          insert: (row: Record<string, unknown>) => {
            state.deviceInserts.push(row);
            return { select: () => ({ single: async () => ({ data: { id: "device-1", property_key: row.property_key, name: row.name }, error: null }) }) };
          },
        };
      }
      if (table === "audit_log") {
        return {
          insert: async (row: Record<string, unknown>) => {
            state.auditInserts.push(row);
            return { error: state.auditError };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { POST } from "@/app/api/device/enroll/route";

const CODE = "48291735";

function enroll() {
  return POST(new Request("https://checkin.example/api/device/enroll", { method: "POST", body: JSON.stringify({ code: CODE }) }));
}

beforeEach(() => {
  vi.stubEnv("CHECKIN_HASH_SECRET", "test-secret");
  state.codeRow = { organization_id: "org-1", property_key: "arakicho_a", device_name: "로비", created_by: "user-1" };
  state.deviceInserts = [];
  state.auditInserts = [];
  state.auditError = null;
});

describe("기기 등록", () => {
  it("코드의 created_by 를 registered_by 로 옮기고 device_enrolled 기록을 남긴다", async () => {
    const response = await enroll();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(state.deviceInserts[0]).toMatchObject({ organization_id: "org-1", registered_by: "user-1", name: "로비" });
    expect(state.auditInserts).toEqual([
      { organization_id: "org-1", actor_user_id: "user-1", device_id: "device-1", action: "device_enrolled", meta: { property_key: "arakicho_a" } },
    ]);
  });

  it("기록에 등록 코드 · 기기 토큰이 없다", async () => {
    const body = await (await enroll()).json();
    const audit = JSON.stringify(state.auditInserts);
    expect(audit).not.toContain(CODE);
    expect(audit).not.toContain(body.token);
    expect(audit).not.toContain(String(state.deviceInserts[0].token_hash));
  });

  it("발급자를 모르는 코드도 기기 id 로 기록된다(check: 사람 또는 기기)", async () => {
    state.codeRow = { ...state.codeRow, created_by: null };
    expect((await enroll()).status).toBe(200);
    expect(state.auditInserts[0]).toMatchObject({ actor_user_id: null, device_id: "device-1" });
  });

  it("기록이 실패해도 기기는 이미 등록됐으니 토큰을 돌려준다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    state.auditError = { message: "boom" };
    const response = await enroll();
    expect(response.status).toBe(200);
    expect((await response.json()).token).toBeTruthy();
    spy.mockRestore();
  });

  it("없는 코드는 기기도 기록도 만들지 않는다", async () => {
    state.codeRow = null;
    expect((await enroll()).status).toBe(404);
    expect(state.deviceInserts).toEqual([]);
    expect(state.auditInserts).toEqual([]);
  });
});
