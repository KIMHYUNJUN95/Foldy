import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { settingsVersionOf } from "@/lib/contract/build";
import { CONTRACT_VERSION } from "@/lib/contract/schema";

import { fakeCheckinDb, type FakeDb } from "./fake-checkin-db";

const state = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ createCheckinServiceClient: () => state.db }));
vi.mock("@/lib/device/auth", () => ({
  authenticateDevice: async () => ({ device: { id: "dev-1", organization_id: "org-1", property_key: "stay_ari", name: "로비" } }),
}));

import { POST as pingRoute } from "@/app/api/device/ping/route";
import { GET as settingsRoute } from "@/app/api/kiosk/settings/route";

const AT = "2026-11-06T01:00:00+00:00";
const settingsRow = (enabled: boolean) => ({ organization_id: "org-1", property_key: "stay_ari", updated_at: AT, staff_call_enabled: enabled, terms_version: 1, video_seconds_per_guest: 5, idle_seconds_input: 240, idle_seconds_done: 30, verification_method: "video", mrz_autofill: true });

let db: FakeDb;
const seed = (rows: Record<string, unknown>[]) => {
  db = fakeCheckinDb({ property_settings: rows, devices: [{ id: "dev-1" }] });
  state.db = db;
};
const ping = () => pingRoute(new Request("https://x/api/device/ping", { method: "POST", body: "{}" }));
const settings = () => settingsRoute(new Request("https://x/api/kiosk/settings"));
const missingColumn = (table: string, columns: string) =>
  table === "property_settings" && columns.includes("staff_call_enabled") ? { code: "42703", message: "column does not exist" } : null;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("CHECKIN_HASH_SECRET", "test-secret");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("settingsVersion", () => {
  it("updated_at 이 그대로여도 직원 통화 켜짐이 바뀌면 값이 바뀐다", () => {
    expect(settingsVersionOf({ updated_at: AT, staff_call_enabled: true })).not.toBe(settingsVersionOf({ updated_at: AT, staff_call_enabled: false }));
  });
  it("계약 버전이 들어가 있어 계약 모양이 바뀌면 옛 앱도 다시 받는다", () => {
    expect(settingsVersionOf({ updated_at: AT, staff_call_enabled: false })).toContain(`contract:${CONTRACT_VERSION}`);
  });
  it("설정 줄이 없어도 값이 있다", () => {
    expect(settingsVersionOf(null)).toBe("default|call:false|contract:2");
  });
  it.each([true, false])("ping 과 settings 가 같은 값(켜짐 %s)", async (enabled) => {
    seed([settingsRow(enabled)]);
    const fromPing = (await (await ping()).json()).settingsVersion;
    const fromSettings = (await (await settings()).json()).settingsVersion;
    expect(fromPing).toBe(`${AT}|call:${enabled}|contract:2`);
    expect(fromSettings).toBe(fromPing);
  });
  it("설정 줄이 없을 때도 둘이 같다", async () => {
    seed([]);
    expect((await (await ping()).json()).settingsVersion).toBe((await (await settings()).json()).settingsVersion);
  });
});

describe("칼럼이 아직 없을 때(마이그레이션 전, 42703)", () => {
  it("settings 는 500 이 아니라 꺼짐", async () => {
    const oldRow: Record<string, unknown> = settingsRow(true);
    delete oldRow.staff_call_enabled;
    seed([oldRow]);
    db.hooks.selectError = missingColumn;
    const response = await settings();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.contract.staffCallEnabled).toBe(false);
    expect(body.settingsVersion).toBe(`${AT}|call:false|contract:2`);
  });
  it("ping 도 500 이 아니라 꺼짐", async () => {
    seed([settingsRow(true)]);
    db.hooks.selectError = missingColumn;
    const response = await ping();
    expect(response.status).toBe(200);
    expect((await response.json()).settingsVersion).toBe(`${AT}|call:false|contract:2`);
  });
  it("다른 오류는 숨기지 않는다", async () => {
    seed([settingsRow(true)]);
    db.hooks.selectError = () => ({ code: "XX000", message: "boom" });
    expect((await settings()).status).toBe(500);
    expect((await ping()).status).toBe(500);
  });
});
