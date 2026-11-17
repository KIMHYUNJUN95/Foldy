import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const state = vi.hoisted(() => ({
  channels: [{ key: "OPS", last4: "abcd", valid: true }],
  destinations: [] as Array<{ channelKey: string; locales: string[] }>,
  enabled: false,
  loadDestinations: vi.fn(),
  writes: [] as string[],
}));

vi.mock("@/lib/admin-session", () => ({
  getAdminSessionForApi: async () => ({
    ok: true,
    session: { capabilities: ["automation.manage", "ops_admin.access"], organization: { id: "org" }, user: { id: "u" } },
  }),
}));
vi.mock("@/lib/ops-admin", () => ({ canAccessOpsAdmin: () => true }));
vi.mock("@/lib/automation/channels", () => ({ listAutomationChannels: () => state.channels }));
vi.mock("@/lib/automation/data", () => ({
  AUTOMATION_BUILDING_ORDER: [],
  loadAssignees: vi.fn(),
  loadAssigneesForModel: vi.fn(),
  loadCleaningListModel: vi.fn(),
  loadCleaningRoomOptions: vi.fn(),
  loadDestinations: (...args: unknown[]) => {
    state.loadDestinations(...args);
    return Promise.resolve({ cleaning_list: state.destinations, daily_report: [], same_day_booking: [], cancellation: [] });
  },
  loadJobs: async () => ({
    cleaning_list: {
      enabled: state.enabled,
      lastDoneOn: null,
      nextWakeAt: null,
      retryUntil: "10:00",
      sendTime: "08:00",
      settings: { channels: [], excludedProperties: [], resend: { debounceMinutes: 10, enabled: false, maxPerDay: 3, until: "18:00" } },
      stored: true,
      updatedAt: null,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    },
  }),
  loadPropertyLabeler: vi.fn(),
  withLocalizedCodes: vi.fn(),
}));
vi.mock("@/lib/automation/runner", () => ({ buildPreview: vi.fn(), sendJobNow: vi.fn() }));
vi.mock("@/lib/cleaning-assign/extra-room", () => ({ checkAddExtraRoom: vi.fn(), removeExtraRoom: vi.fn() }));
vi.mock("@/actions/cleaning-assign-guards", () => ({ changed: vi.fn() }));
vi.mock("@/lib/supabase/service", () => {
  const chain = (table: string): Record<string, unknown> => {
    const node: Record<string, unknown> = {};
    for (const method of ["update", "upsert", "insert", "delete"]) {
      node[method] = () => {
        state.writes.push(`${table}.${method}`);
        return node;
      };
    }
    for (const method of ["eq", "in", "select"]) node[method] = () => node;
    node.then = (resolve: (value: unknown) => void) => resolve({ data: [{ job_key: "cleaning_list" }], error: null });
    return node;
  };
  return { getSupabaseServiceClient: () => ({ from: chain }) };
});

import { saveAutomationJob, setAutomationEnabled } from "@/actions/ops-automation";

const settings = { channels: [], excludedProperties: [], resend: { debounceMinutes: 10, enabled: false, maxPerDay: 3, until: "18:00" } };
const save = (destinations: Array<{ channelKey: string; locales: string[] }>) =>
  saveAutomationJob({
    destinations: destinations as never,
    jobKey: "cleaning_list",
    retryUntil: "10:00",
    sendTime: "08:00",
    settings: settings as never,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
  });

beforeEach(() => {
  state.destinations = [];
  state.enabled = false;
  state.writes = [];
  state.loadDestinations.mockClear();
});

describe("setAutomationEnabled — 서버가 같은 판정으로 다시 막는다", () => {
  it("받는 곳 0곳이면 켜지 못하고 아무것도 쓰지 않는다", async () => {
    expect(await setAutomationEnabled("cleaning_list", true)).toEqual({ error: "no_destination", ok: false });
    expect(state.writes).toEqual([]);
  });
  it("연결 안 된 채널만 있어도 켜지 못한다", async () => {
    state.destinations = [{ channelKey: "OLD", locales: ["ko"] }];
    expect(await setAutomationEnabled("cleaning_list", true)).toEqual({ error: "no_destination", ok: false });
  });
  it("언어를 모두 끈 채널만 있어도 켜지 못한다", async () => {
    state.destinations = [{ channelKey: "OPS", locales: [] }];
    expect((await setAutomationEnabled("cleaning_list", true)).ok).toBe(false);
  });
  it("연결된 채널에 언어가 있으면 켠다", async () => {
    state.destinations = [{ channelKey: "OPS", locales: ["ko"] }];
    expect((await setAutomationEnabled("cleaning_list", true)).ok).toBe(true);
  });
  it("끌 때는 받는 곳을 읽지도 않고 받는 곳 0곳이어도 꺼진다", async () => {
    state.enabled = true;
    expect((await setAutomationEnabled("cleaning_list", false)).ok).toBe(true);
    expect(state.loadDestinations).not.toHaveBeenCalled();
  });
});

describe("saveAutomationJob — 켜져 있는 자동화를 받는 곳 0곳으로 저장하지 못한다", () => {
  it("켜져 있고 받는 곳이 0곳이면 no_destination, 아무것도 쓰지 않는다", async () => {
    state.enabled = true;
    expect(await save([])).toEqual({ error: "no_destination", ok: false });
    expect(await save([{ channelKey: "OPS", locales: [] }])).toEqual({ error: "no_destination", ok: false });
    expect(state.writes).toEqual([]);
  });
  it("켜져 있어도 나가는 곳이 있으면 저장된다", async () => {
    state.enabled = true;
    expect((await save([{ channelKey: "OPS", locales: ["ko"] }])).ok).toBe(true);
  });
  it("꺼져 있으면 받는 곳 0곳으로도 저장된다", async () => {
    expect((await save([])).ok).toBe(true);
  });
});
