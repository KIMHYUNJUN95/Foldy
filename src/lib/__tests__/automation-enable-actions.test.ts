import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const state = vi.hoisted(() => ({
  channels: [{ key: "OPS", last4: "abcd", valid: true }],
  destinations: [] as Array<{ channelKey: string; locales: string[] }>,
  enabled: false,
  job: {} as Record<string, unknown>,
  loadDestinations: vi.fn(),
  destUpserts: [] as Array<Array<Record<string, unknown>>>,
  writes: [] as string[],
  jobUpserts: [] as Array<Record<string, unknown>>,
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
      ...state.job,
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
      node[method] = (payload?: Record<string, unknown>) => {
        state.writes.push(`${table}.${method}`);
        if (table === "automation_jobs" && method === "upsert" && payload) state.jobUpserts.push(payload);
        if (table === "automation_destinations" && method === "upsert" && payload) state.destUpserts.push(payload as never);
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
type Fields = { destinations: Array<{ channelKey: string; locales: string[] }>; retryUntil: string; sendTime: string; weekdays: number[] };
const fieldsOf = (over: Partial<Fields> = {}) => ({
  destinations: [] as Fields["destinations"],
  retryUntil: "10:00",
  sendTime: "08:00",
  settings,
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  ...over,
});
/** 기준 = 화면이 맞춰 본 값. 따로 주지 않으면 지금 DB 와 같은 값(그 사이 아무도 안 바꿈). */
const saveWith = (draft: Partial<Fields>, base?: Partial<Fields>) =>
  saveAutomationJob({ ...fieldsOf(draft), base: fieldsOf(base ?? { destinations: state.destinations }), jobKey: "cleaning_list" } as never);
const save = (destinations: Fields["destinations"]) => saveWith({ destinations });

beforeEach(() => {
  state.destinations = [];
  state.enabled = false;
  state.writes = [];
  state.jobUpserts = [];
  state.destUpserts = [];
  state.job = {};
  state.channels = [{ key: "OPS", last4: "abcd", valid: true }];
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
  it("성공하면 이 저장이 쓴 설정 줄 버전(updated_at)을 돌려준다 — 화면 초안이 이보다 옛 그림을 버린다", async () => {
    const result = await save([]);
    expect(result).toMatchObject({ ok: true, version: state.jobUpserts[0]?.updated_at });
    expect(typeof state.jobUpserts[0]?.updated_at).toBe("string");
  });
});

describe("saveAutomationJob — 내가 바꾼 칸만 반영한다(다른 사람이 방금 바꾼 칸을 되돌리지 않는다)", () => {
  it("상대가 재시도 마감(A)을 바꾼 뒤 내가 발송 시각(B)만 저장 → A 는 상대 값 그대로, 돌려준 값도 합친 값", async () => {
    state.job = { retryUntil: "11:30" };
    const result = await saveWith({ sendTime: "07:00" }, {});
    expect(state.jobUpserts[0]).toMatchObject({ retry_until: "11:30", send_time: "07:00" });
    expect(result).toMatchObject({ ok: true, saved: { retryUntil: "11:30", sendTime: "07:00" } });
  });
  it("상대가 넣은 받는 곳은 내가 안 건드렸으면 남는다(지우지 않음)", async () => {
    state.channels = [{ key: "OPS", last4: "abcd", valid: true }, { key: "STAFF", last4: "efgh", valid: true }];
    state.destinations = [{ channelKey: "STAFF", locales: ["ja"] }];
    const result = await saveWith({ destinations: [{ channelKey: "OPS", locales: ["ko"] }], sendTime: "07:00" }, { destinations: [] });
    expect(state.writes).not.toContain("automation_destinations.delete");
    expect(state.destUpserts[0]?.map((row) => row.channel_key)).toEqual(["OPS", "STAFF"]);
    expect(result).toMatchObject({ ok: true, saved: { destinations: [{ channelKey: "OPS", locales: ["ko"] }, { channelKey: "STAFF", locales: ["ja"] }] } });
  });
  it("같은 칸을 둘 다 바꿨으면 나중 저장(나)이 이긴다", async () => {
    state.job = { sendTime: "09:00" };
    await saveWith({ sendTime: "07:00" }, {});
    expect(state.jobUpserts[0]).toMatchObject({ send_time: "07:00" });
  });
  it("합친 결과가 맞지 않으면(상대 발송 11:00 · 내 재시도 마감 10:30) conflict, 아무것도 쓰지 않는다", async () => {
    state.job = { sendTime: "11:00" };
    expect(await saveWith({ retryUntil: "10:30" }, {})).toEqual({ error: "conflict", ok: false });
    expect(state.writes).toEqual([]);
  });
  it("기준이 있는데 모양이 틀리면 invalid, 아무것도 쓰지 않는다", async () => {
    expect(await saveAutomationJob({ ...fieldsOf(), base: { ...fieldsOf(), sendTime: "x" }, jobKey: "cleaning_list" } as never)).toEqual({
      error: "invalid",
      ok: false,
    });
    expect(state.writes).toEqual([]);
  });
  it("기준을 안 보내는 예전 탭은 예전처럼 초안 전체를 저장한다", async () => {
    state.job = { retryUntil: "11:30" };
    const result = await saveAutomationJob({ ...fieldsOf({ sendTime: "07:00" }), jobKey: "cleaning_list" } as never);
    expect(result.ok).toBe(true);
    expect(state.jobUpserts[0]).toMatchObject({ retry_until: "10:00", send_time: "07:00" });
  });
  it("시각 순서는 합친 결과로만 본다 — 상대가 마감을 12:00 으로, 내 화면은 10:00 인 채 발송만 10:30 → 저장된다", async () => {
    state.job = { retryUntil: "12:00" };
    expect((await saveWith({ sendTime: "10:30" }, {})).ok).toBe(true);
    expect(state.jobUpserts[0]).toMatchObject({ retry_until: "12:00", send_time: "10:30" });
  });
  it("내 초안 자체가 마감 < 발송이면 invalid", async () => {
    expect(await saveWith({ retryUntil: "07:00" }, {})).toEqual({ error: "invalid", ok: false });
  });
  it("기준에 그 사이 연결이 끊긴 채널이 있어도 저장된다", async () => {
    expect((await saveWith({ sendTime: "07:00" }, { destinations: [{ channelKey: "OLD", locales: ["ko"] }] })).ok).toBe(true);
  });
});
