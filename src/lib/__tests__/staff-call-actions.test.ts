import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase } from "@/lib/__tests__/fake-supabase";

/**
 * 직원 통화 서버 액션 — 세션 · DB 는 가짜, 토큰은 진짜 livekit-server-sdk 로 만들어 풀어 본다. docs/product/46 §5 · §9.
 * 실제 동시 받기는 Postgres 조건부 update 가 보장하고, 여기서는 「두 번째 호출이 0행을 맞으면 진다」를 본다.
 */
const state = vi.hoisted(() => ({
  session: null as null | { organization: { id: string }; user: { id: string }; capabilities: string[] },
  onboarding: "ready",
  checkin: null as unknown,
  publicDb: null as unknown,
  deletedRooms: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  hasOrganizationContext: (session: { organization: { id: string } }) => session.organization.id !== "platform",
  getCurrentAppSession: vi.fn(async () => state.session),
}));
vi.mock("@/lib/onboarding", () => ({
  getOnboardingState: vi.fn(async () => ({ status: state.onboarding })),
}));
// 실제처럼 관리자 웹 권한을 요구한다 — 통화 액션이 이 문을 타면 아래 「관리자 웹 권한 없는 직원」 테스트가 깨진다.
vi.mock("@/lib/admin-session", () => ({
  getAdminSessionForApi: vi.fn(async () =>
    state.session?.capabilities.includes("admin_web.access") ? { ok: true, session: state.session } : { ok: false, status: 403 },
  ),
}));
vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: () => ({
    schema: () => state.checkin,
    from: (table: string) => (state.publicDb as { from: (t: string) => unknown }).from(table),
  }),
}));
vi.mock("livekit-server-sdk", async (original) => {
  const actual = await original<typeof import("livekit-server-sdk")>();
  return {
    ...actual,
    RoomServiceClient: class {
      async deleteRoom(room: string) {
        state.deletedRooms.push(room);
      }
    },
  };
});

import { getCheckinStaffCallSetting, setCheckinStaffCallEnabled } from "@/actions/checkin/settings";
import { revokeCheckinDevice } from "@/actions/checkin/devices";
import { acceptStaffCall, endStaffCall, getRingingStaffCalls, getStaffCallStatus, getStaffCallStay } from "@/actions/checkin/calls";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = uuid(900);
const OTHER_ORG = uuid(901);
const ME = uuid(800);
const OTHER_USER = uuid(801);
const CALL = uuid(1);
const STAY = uuid(2);
const DEVICE = uuid(3);
const NOW = Date.parse("2026-11-06T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function callRow(over: Record<string, unknown> = {}) {
  return {
    id: CALL,
    organization_id: ORG,
    property_key: "arakicho_a",
    device_id: DEVICE,
    stay_id: STAY,
    room_name: `call-${CALL}`,
    status: "ringing",
    step: "passport",
    language: "en",
    ring_deadline_at: iso(NOW + 30_000),
    created_at: iso(NOW - 15_000),
    accepted_at: null,
    accepted_by: null,
    ended_at: null,
    ended_by: null,
    ...over,
  };
}

let fake: ReturnType<typeof createFakeSupabase>;

function seed(calls: Record<string, unknown>[]) {
  fake = createFakeSupabase({
    staff_calls: calls,
    devices: [{ id: DEVICE, organization_id: ORG, name: "1F tablet" }],
    audit_log: [],
    stays: [
      {
        id: STAY,
        organization_id: ORG,
        status: "in_progress",
        reservation_group_key: "HM4K2X9PQ",
        property_key: "arakicho_a",
        check_in_date: "2026-11-06",
        check_out_date: "2026-11-08",
        guest_count_expected: 2,
        party_size: null,
        checked_in_at: null,
        verified_at: null,
        verified_by: null,
        checkin_code: "573914",
      },
    ],
    stay_rooms: [{ id: uuid(41), organization_id: ORG, stay_id: STAY, reservation_id: uuid(51), room_label: "201" }],
    guests: [],
    guest_documents: [],
    consents: [],
    sessions: [],
  });
  state.checkin = fake.client;
  state.publicDb = createFakeSupabase({ reservations: [{ id: uuid(51), organization_id: ORG, source: "Airbnb", guest_name: "LEAD GUEST", guest_count: 2 }], profiles: [] }).client;
}

const sessionWith = (capabilities: string[], userId = ME, organizationId = ORG) => {
  state.session = { organization: { id: organizationId }, user: { id: userId }, capabilities };
};

function setLiveKitEnv() {
  vi.stubEnv("LIVEKIT_URL", "wss://example.livekit.cloud");
  vi.stubEnv("LIVEKIT_API_KEY", "key");
  vi.stubEnv("LIVEKIT_API_SECRET", "secret-secret-secret-secret-secret-secret");
}

const decode = (token: string) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
const row = () => (fake.tables.staff_calls as Record<string, unknown>[])[0];

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  setLiveKitEnv();
  state.deletedRooms = [];
  state.onboarding = "ready";
  sessionWith(["checkin.call"]);
  seed([callRow()]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("권한", () => {
  it.each(["getRinging", "accept", "end", "status", "stay"])("%s — 권한이 없으면 거부", async (name) => {
    sessionWith([]);
    const result =
      name === "getRinging"
        ? await getRingingStaffCalls()
        : name === "accept"
          ? await acceptStaffCall(CALL)
          : name === "end"
            ? await endStaffCall(CALL)
            : name === "status"
              ? await getStaffCallStatus(CALL)
              : await getStaffCallStay(CALL);
    expect(result).toEqual({ ok: false, errorKey: "forbidden" });
  });

  it("로그인이 없으면 거부", async () => {
    state.session = null;
    expect(await getRingingStaffCalls()).toEqual({ ok: false, errorKey: "forbidden" });
  });

  it("관리자 웹 권한 없는 직원도 checkin.call 만으로 받는다", async () => {
    sessionWith(["checkin.call"]);
    expect(await getRingingStaffCalls()).toMatchObject({ ok: true });
    expect(await acceptStaffCall(CALL)).toMatchObject({ ok: true });
    expect(await getStaffCallStatus(CALL)).toEqual({ ok: true, status: "accepted" });
    expect(await endStaffCall(CALL)).toEqual({ ok: true, status: "ended" });
  });

  it("관리자 웹 권한 없이 checkin.view 가 있으면 내가 받은 통화의 예약을 본다", async () => {
    sessionWith(["checkin.call", "checkin.view"]);
    await acceptStaffCall(CALL);
    expect(await getStaffCallStay(CALL)).toMatchObject({ ok: true, stay: { stayId: STAY } });
  });

  it.each(["disabled", "suspended", "removed", "unauthenticated", "needs_profile", "needs_membership"])("온보딩 상태가 %s 면(정지 계정 등) 토큰이 살아 있어도 거부", async (status) => {
    state.onboarding = status;
    expect(await getRingingStaffCalls()).toEqual({ ok: false, errorKey: "forbidden" });
    expect(await acceptStaffCall(CALL)).toEqual({ ok: false, errorKey: "forbidden" });
    expect(row()).toMatchObject({ status: "ringing", accepted_by: null });
  });

  it("활성 멤버십이 없으면(세션 없음) 거부", async () => {
    state.session = null;
    expect(await acceptStaffCall(CALL)).toEqual({ ok: false, errorKey: "forbidden" });
  });

  it("개인 차단 등으로 키가 빠진 세션은 거부", async () => {
    sessionWith(["checkin.view", "admin_web.access"]);
    expect(await acceptStaffCall(CALL)).toEqual({ ok: false, errorKey: "forbidden" });
  });

  it("조직 없는 플랫폼 세션은 거부", async () => {
    sessionWith(["checkin.call"], ME, "platform");
    expect(await getRingingStaffCalls()).toEqual({ ok: false, errorKey: "forbidden" });
  });

  it("id 모양이 틀리면 DB 를 읽지 않고 거부", async () => {
    expect(await acceptStaffCall("not-a-uuid")).toEqual({ ok: false, errorKey: "forbidden" });
    expect(fake.writes).toEqual([]);
  });
});

describe("getRingingStaffCalls", () => {
  it("우리 조직 울리는 호출만, 기기 이름과 함께", async () => {
    seed([callRow(), callRow({ id: uuid(5), organization_id: OTHER_ORG, room_name: `call-${uuid(5)}` }), callRow({ id: uuid(6), status: "accepted", room_name: `call-${uuid(6)}` })]);
    expect(await getRingingStaffCalls()).toEqual({
      ok: true,
      calls: [{ id: CALL, propertyKey: "arakicho_a", deviceName: "1F tablet", step: "passport", language: "en", ringDeadlineAt: iso(NOW + 30_000) }],
    });
  });

  it("손님 정보 · 방 이름은 내보내지 않는다", async () => {
    const result = await getRingingStaffCalls();
    expect(JSON.stringify(result)).not.toContain("call-");
    expect(JSON.stringify(result)).not.toContain(STAY);
  });

  it("45초가 지난 호출은 no_answer 로 닫고 놓친 알림을 한 번 넣는다", async () => {
    seed([callRow({ ring_deadline_at: iso(NOW - 1) })]);
    expect(await getRingingStaffCalls()).toEqual({ ok: true, calls: [] });
    expect(row()).toMatchObject({ status: "no_answer", ended_by: "timeout", ended_at: iso(NOW) });
    expect(fake.rpcCalls).toEqual([
      {
        name: "notify_staff",
        args: {
          p_organization_id: ORG,
          p_capability: "checkin.call",
          p_type: "checkin_call_missed",
          p_dedupe_key: `checkin_call_missed:${CALL}`,
          p_href: "/admin/checkin",
          p_payload: { callId: CALL, propertyKey: "arakicho_a" },
        },
      },
    ]);

    await getRingingStaffCalls();
    expect(fake.rpcCalls).toHaveLength(1);
  });
});

describe("acceptStaffCall", () => {
  it("먼저 온 한 명만 받는다 — 두 번째는 already_taken", async () => {
    const first = await acceptStaffCall(CALL);
    expect(first).toMatchObject({ ok: true, url: "wss://example.livekit.cloud", stayId: null, canViewStay: false });
    expect(row()).toMatchObject({ status: "accepted", accepted_by: ME, accepted_at: iso(NOW) });

    sessionWith(["checkin.call"], OTHER_USER);
    expect(await acceptStaffCall(CALL)).toEqual({ ok: false, errorKey: "already_taken" });
    expect(row()).toMatchObject({ accepted_by: ME });
  });

  it("같은 사람이 두 기기에서 눌러도 두 번째는 진다", async () => {
    await acceptStaffCall(CALL);
    expect(await acceptStaffCall(CALL)).toEqual({ ok: false, errorKey: "already_taken" });
  });

  it("직원 토큰은 마이크만 올릴 수 있고 카메라는 없다", async () => {
    const result = await acceptStaffCall(CALL);
    if (!result.ok) throw new Error(result.errorKey);
    const claims = decode(result.token);
    expect(claims.sub).toBe(`staff-${ME}`);
    expect(claims.video).toMatchObject({ room: `call-${CALL}`, roomJoin: true, canSubscribe: true, canPublishSources: ["microphone"] });
    expect(claims.video.canPublishSources).not.toContain("camera");
    expect(claims.video.canPublishSources).not.toContain("screen_share");
    expect(claims.video.roomAdmin).toBeUndefined();
    expect(claims.video.roomRecord).toBeUndefined();
    expect(claims.exp - claims.nbf).toBe(30 * 60);
  });

  it("방 이름이 call-<uuid> 모양이 아니면 토큰을 주지 않고 통화를 닫는다", async () => {
    seed([callRow({ room_name: "other-room" })]);
    expect(await acceptStaffCall(CALL)).toEqual({ ok: false, errorKey: "failed" });
    expect(row()).toMatchObject({ status: "ended", ended_by: "system" });
  });

  it("45초가 지났으면 expired — 받히지 않고 놓친 호출로 닫힌다", async () => {
    seed([callRow({ ring_deadline_at: iso(NOW - 1) })]);
    expect(await acceptStaffCall(CALL)).toEqual({ ok: false, errorKey: "expired" });
    expect(row()).toMatchObject({ status: "no_answer", accepted_by: null });
    expect(fake.rpcCalls).toHaveLength(1);
  });

  it.each(["no_answer", "canceled", "failed"])("이미 %s 면 expired", async (status) => {
    seed([callRow({ status })]);
    expect(await acceptStaffCall(CALL)).toEqual({ ok: false, errorKey: "expired" });
  });

  it("다른 조직 통화는 거부 — 있다는 것도 알리지 않는다", async () => {
    seed([callRow({ organization_id: OTHER_ORG })]);
    expect(await acceptStaffCall(CALL)).toEqual({ ok: false, errorKey: "forbidden" });
    expect(row()).toMatchObject({ status: "ringing", accepted_by: null });
  });

  it("환경 변수가 없으면 unconfigured — 호출을 잡지 않는다", async () => {
    vi.stubEnv("LIVEKIT_API_SECRET", "");
    expect(await acceptStaffCall(CALL)).toEqual({ ok: false, errorKey: "unconfigured" });
    expect(row()).toMatchObject({ status: "ringing", accepted_by: null });
  });

  it("checkin.view 가 있고 stay 가 있을 때만 예약 보기를 연다", async () => {
    sessionWith(["checkin.call", "checkin.view"]);
    expect(await acceptStaffCall(CALL)).toMatchObject({ ok: true, stayId: STAY, canViewStay: true });

    sessionWith(["checkin.call", "checkin.view"]);
    seed([callRow({ stay_id: null })]);
    expect(await acceptStaffCall(CALL)).toMatchObject({ ok: true, stayId: null, canViewStay: false });
  });

  it("기록에는 통화 id 와 건물만", async () => {
    await acceptStaffCall(CALL);
    expect(fake.tables.audit_log).toHaveLength(1);
    expect(fake.tables.audit_log[0]).toMatchObject({
      action: "staff_call_accepted",
      actor_user_id: ME,
      organization_id: ORG,
      meta: { call_id: CALL, property_key: "arakicho_a" },
    });
  });
});

describe("endStaffCall", () => {
  const accepted = (over: Record<string, unknown> = {}) => callRow({ status: "accepted", accepted_by: ME, accepted_at: iso(NOW - 1000), ...over });

  it("받은 본인이 끊는다 — 상태 ended + 방 삭제", async () => {
    seed([accepted()]);
    expect(await endStaffCall(CALL)).toEqual({ ok: true, status: "ended" });
    expect(row()).toMatchObject({ status: "ended", ended_by: "staff", ended_at: iso(NOW) });
    expect(state.deletedRooms).toEqual([`call-${CALL}`]);
  });

  it("받지 않은 사람은 끊지 못한다", async () => {
    seed([accepted({ accepted_by: OTHER_USER })]);
    expect(await endStaffCall(CALL)).toEqual({ ok: false, errorKey: "forbidden" });
    expect(row()).toMatchObject({ status: "accepted" });
  });

  it("checkin.manage 는 예외로 끊을 수 있다", async () => {
    sessionWith(["checkin.call", "checkin.manage"]);
    seed([accepted({ accepted_by: OTHER_USER })]);
    expect(await endStaffCall(CALL)).toEqual({ ok: true, status: "ended" });
  });

  it("다른 조직 통화는 manage 여도 거부", async () => {
    sessionWith(["checkin.call", "checkin.manage"]);
    seed([accepted({ organization_id: OTHER_ORG })]);
    expect(await endStaffCall(CALL)).toEqual({ ok: false, errorKey: "forbidden" });
  });

  it("이미 끝난 내 통화는 그대로 성공, 기록을 더하지 않는다", async () => {
    seed([accepted({ status: "ended", ended_by: "guest" })]);
    expect(await endStaffCall(CALL)).toEqual({ ok: true, status: "ended" });
    expect(row()).toMatchObject({ ended_by: "guest" });
    expect(fake.tables.audit_log).toEqual([]);
  });

  it("방 삭제가 실패해도 끝난 것은 끝난 것", async () => {
    seed([accepted({ room_name: "other-room" })]);
    expect(await endStaffCall(CALL)).toEqual({ ok: true, status: "ended" });
    expect(state.deletedRooms).toEqual([]);
  });
});

describe("getStaffCallStatus", () => {
  it("내가 받은 통화의 상태만", async () => {
    seed([callRow({ status: "accepted", accepted_by: ME, accepted_at: iso(NOW) })]);
    expect(await getStaffCallStatus(CALL)).toEqual({ ok: true, status: "accepted" });
  });

  it("남이 받은 통화는 거부", async () => {
    seed([callRow({ status: "accepted", accepted_by: OTHER_USER, accepted_at: iso(NOW) })]);
    expect(await getStaffCallStatus(CALL)).toEqual({ ok: false, errorKey: "forbidden" });
  });

  it("30분이 지난 통화는 읽을 때 끝낸다", async () => {
    seed([callRow({ status: "accepted", accepted_by: ME, accepted_at: iso(NOW - 30 * 60_000 - 1) })]);
    expect(await getStaffCallStatus(CALL)).toEqual({ ok: true, status: "ended" });
    expect(row()).toMatchObject({ status: "ended", ended_by: "timeout" });
    expect(state.deletedRooms).toEqual([`call-${CALL}`]);
  });
});

describe("getStaffCallStay", () => {
  beforeEach(() => sessionWith(["checkin.call", "checkin.view"]));
  const accepted = (over: Record<string, unknown> = {}) => callRow({ status: "accepted", accepted_by: ME, accepted_at: iso(NOW), ...over });

  it("checkin.view 없이는 거부 — checkin.call 만으로는 안 된다", async () => {
    sessionWith(["checkin.call"]);
    seed([accepted()]);
    expect(await getStaffCallStay(CALL)).toEqual({ ok: false, errorKey: "forbidden" });
  });

  it("받은 통화의 stay 요약만 — 코드 · 여권은 없다", async () => {
    seed([accepted()]);
    const result = await getStaffCallStay(CALL);
    expect(result).toMatchObject({
      ok: true,
      stay: { stayId: STAY, propertyKey: "arakicho_a", roomLabels: ["201"], checkInDate: "2026-11-06", checkOutDate: "2026-11-08", partySize: 2 },
    });
    expect(JSON.stringify(result)).not.toContain("573914");
  });

  it("내가 받지 않은 통화는 거부", async () => {
    seed([accepted({ accepted_by: OTHER_USER })]);
    expect(await getStaffCallStay(CALL)).toEqual({ ok: false, errorKey: "forbidden" });
  });

  it("다른 조직 통화는 거부", async () => {
    seed([accepted({ organization_id: OTHER_ORG })]);
    expect(await getStaffCallStay(CALL)).toEqual({ ok: false, errorKey: "forbidden" });
  });

  it("끝난 통화는 거부", async () => {
    seed([accepted({ status: "ended" })]);
    expect(await getStaffCallStay(CALL)).toEqual({ ok: false, errorKey: "forbidden" });
  });

  it("stay 가 없는 통화는 not_found", async () => {
    seed([accepted({ stay_id: null })]);
    expect(await getStaffCallStay(CALL)).toEqual({ ok: false, errorKey: "not_found" });
  });
});

describe("표가 아직 없을 때", () => {
  it("not_ready 를 돌려주고 던지지 않는다", async () => {
    state.checkin = {
      from: () => {
        const api: Record<string, unknown> = {};
        for (const method of ["select", "eq", "order", "lte", "gt", "maybeSingle", "update", "in"]) api[method] = () => api;
        api.then = (resolve: (value: unknown) => unknown) => resolve({ data: null, error: { code: "PGRST205" } });
        return api;
      },
    };
    expect(await getRingingStaffCalls()).toEqual({ ok: false, errorKey: "not_ready" });
    expect(await acceptStaffCall(CALL)).toEqual({ ok: false, errorKey: "not_ready" });
  });
});

describe("건물별 켜기 · 끄기", () => {
  const settings = (over: Record<string, unknown> = {}) => ({ organization_id: ORG, property_key: "arakicho_a", updated_at: "2026-11-01T00:00:00.000Z", staff_call_enabled: false, ...over });

  beforeEach(() => {
    sessionWith(["checkin.manage", "admin_web.access"]);
    seed([]);
  });

  it("checkin.manage 없이는 거부 — checkin.call 로는 안 된다", async () => {
    sessionWith(["checkin.call", "admin_web.access"]);
    expect(await setCheckinStaffCallEnabled("arakicho_a", true)).toEqual({ ok: false, errorKey: "forbidden" });
    expect(await getCheckinStaffCallSetting("arakicho_a")).toEqual({ ok: false, errorKey: "forbidden" });
  });

  it("줄이 없으면 꺼짐, 켜면 줄이 생긴다", async () => {
    fake.tables.property_settings = [];
    expect(await getCheckinStaffCallSetting("arakicho_a")).toEqual({ ok: true, enabled: false });
    expect(await setCheckinStaffCallEnabled("arakicho_a", true)).toEqual({ ok: true, enabled: true });
    expect(fake.tables.property_settings[0]).toMatchObject({ organization_id: ORG, property_key: "arakicho_a", staff_call_enabled: true });
  });

  it("폼의 동시 저장 검사 값(updated_at)은 그대로 둔다, 다른 조직 줄은 건드리지 않는다", async () => {
    fake.tables.property_settings = [settings(), settings({ organization_id: OTHER_ORG })];
    await setCheckinStaffCallEnabled("arakicho_a", true);
    expect(fake.tables.property_settings[0]).toMatchObject({ staff_call_enabled: true, updated_at: "2026-11-01T00:00:00.000Z" });
    expect(fake.tables.property_settings[1]).toMatchObject({ staff_call_enabled: false });
    expect(fake.tables.audit_log[0]).toMatchObject({ action: "property_settings_updated", meta: { changed: ["staff_call_enabled"], enabled: true } });
  });

  it("없는 건물은 invalid", async () => {
    expect(await setCheckinStaffCallEnabled("nowhere", true)).toEqual({ ok: false, errorKey: "invalid" });
  });

  it("칼럼이 아직 없으면 not_ready — 설정 화면이 멈추지 않는다", async () => {
    state.checkin = {
      from: () => {
        const api: Record<string, unknown> = {};
        for (const method of ["select", "eq", "update", "maybeSingle"]) api[method] = () => api;
        api.then = (resolve: (value: unknown) => unknown) => resolve({ data: null, error: { code: "42703" } });
        return api;
      },
    };
    expect(await getCheckinStaffCallSetting("arakicho_a")).toEqual({ ok: false, errorKey: "not_ready" });
    expect(await setCheckinStaffCallEnabled("arakicho_a", true)).toEqual({ ok: false, errorKey: "not_ready" });
  });
});

describe("직원 카메라", () => {
  it("직원 화면 코드 어디서도 카메라를 켜지 않는다", () => {
    const dir = "src/components/checkin-call";
    for (const file of readdirSync(dir)) {
      const source = readFileSync(`${dir}/${file}`, "utf8");
      expect(source, file).not.toMatch(/setCameraEnabled|createLocalVideoTrack|createLocalTracks|setScreenShareEnabled|video:\s*true/);
    }
  });
});

describe("Foldy 쪽에서 닫을 때 기록", () => {
  const closed = (action: string) => (fake.tables.audit_log as Record<string, unknown>[]).filter((entry) => entry.action === action);

  it("45초 초과로 닫으면 기기 이름으로 남긴다", async () => {
    seed([callRow({ ring_deadline_at: iso(NOW - 1) })]);
    await getRingingStaffCalls();
    expect(closed("staff_call_no_answer")).toEqual([
      expect.objectContaining({ organization_id: ORG, device_id: DEVICE, meta: { call_id: CALL, property_key: "arakicho_a" } }),
    ]);
    await getRingingStaffCalls();
    expect(closed("staff_call_no_answer")).toHaveLength(1);
  });

  it("30분 초과로 닫으면 남긴다", async () => {
    seed([callRow({ status: "accepted", accepted_by: ME, accepted_at: iso(NOW - 30 * 60_000 - 1) })]);
    await getStaffCallStatus(CALL);
    expect(closed("staff_call_ended")).toEqual([expect.objectContaining({ device_id: DEVICE, meta: { call_id: CALL, property_key: "arakicho_a" } })]);
  });

  it("토큰 실패로 닫으면 남긴다", async () => {
    seed([callRow({ room_name: "other-room" })]);
    await acceptStaffCall(CALL);
    expect(closed("staff_call_ended")).toEqual([expect.objectContaining({ device_id: DEVICE })]);
  });
});

describe("시간 초과 닫기는 문 앞에서 막히지 않는다", () => {
  const overdue = (over: Record<string, unknown> = {}) => callRow({ status: "accepted", accepted_by: OTHER_USER, accepted_at: iso(NOW - 30 * 60_000 - 1), ...over });

  it("상태 읽기 — 남의 통화여도 시간이 지났으면 닫고, 답은 거부", async () => {
    seed([overdue()]);
    expect(await getStaffCallStatus(CALL)).toEqual({ ok: false, errorKey: "forbidden" });
    expect(row()).toMatchObject({ status: "ended", ended_by: "timeout" });
  });

  it("끊기 — 같다", async () => {
    seed([overdue()]);
    expect(await endStaffCall(CALL)).toEqual({ ok: false, errorKey: "forbidden" });
    expect(row()).toMatchObject({ status: "ended", ended_by: "timeout" });
  });

  it("예약 보기 — 같다", async () => {
    sessionWith(["checkin.view"]);
    seed([overdue()]);
    expect(await getStaffCallStay(CALL)).toEqual({ ok: false, errorKey: "forbidden" });
    expect(row()).toMatchObject({ status: "ended", ended_by: "timeout" });
  });

  it("다른 조직 통화는 닫지 않는다", async () => {
    seed([overdue({ organization_id: OTHER_ORG })]);
    await getStaffCallStatus(CALL);
    expect(row()).toMatchObject({ status: "accepted" });
  });
});

describe("기기 폐기", () => {
  const device = (over: Record<string, unknown> = {}) => ({ id: DEVICE, organization_id: ORG, name: "T", revoked_at: null, ...over });
  beforeEach(() => sessionWith(["checkin.manage", "admin_web.access"]));

  it("진행 중 통화를 ended 로 닫고 방을 지운다 — 끝난 통화 · 다른 기기는 그대로", async () => {
    const other = uuid(7);
    seed([
      callRow({ status: "accepted", accepted_by: ME, accepted_at: iso(NOW) }),
      callRow({ id: uuid(5), room_name: `call-${uuid(5)}`, status: "ended", ended_by: "guest", ended_at: iso(NOW) }),
      callRow({ id: uuid(6), room_name: `call-${uuid(6)}`, device_id: other }),
    ]);
    fake.tables.devices = [device()];
    expect(await revokeCheckinDevice(DEVICE)).toEqual({ ok: true, already: false });
    const rows = fake.tables.staff_calls as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ status: "ended", ended_by: "system", ended_at: iso(NOW) });
    expect(rows[1]).toMatchObject({ ended_by: "guest" });
    expect(rows[2]).toMatchObject({ status: "ringing" });
    expect(state.deletedRooms).toEqual([`call-${CALL}`]);
    expect(fake.tables.audit_log).toContainEqual(expect.objectContaining({ action: "staff_call_ended", actor_user_id: ME, device_id: DEVICE }));
  });

  it("울리는 통화도 닫는다", async () => {
    seed([callRow()]);
    fake.tables.devices = [device()];
    await revokeCheckinDevice(DEVICE);
    expect(row()).toMatchObject({ status: "ended", ended_by: "system" });
  });

  it("통화를 닫다 실패해도 폐기는 완료된다", async () => {
    seed([callRow()]);
    fake.tables.devices = [device()];
    const real = fake.client;
    state.checkin = {
      ...real,
      from: (table: string) => {
        if (table === "staff_calls") throw new Error("boom");
        return real.from(table);
      },
    };
    expect(await revokeCheckinDevice(DEVICE)).toEqual({ ok: true, already: false });
    expect((fake.tables.devices as Record<string, unknown>[])[0].revoked_at).toBeTruthy();
  });

  it("다른 조직 기기는 not_found, 통화도 그대로", async () => {
    seed([callRow()]);
    fake.tables.devices = [device({ organization_id: OTHER_ORG })];
    expect(await revokeCheckinDevice(DEVICE)).toEqual({ ok: false, errorKey: "not_found" });
    expect(row()).toMatchObject({ status: "ringing" });
  });
});
