import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeCheckinDb, type FakeDb } from "./fake-checkin-db";

const state = vi.hoisted(() => ({
  db: null as unknown,
  device: { id: "dev-1", organization_id: "org-1", property_key: "stay_ari", name: "로비" },
  authError: null as string | null,
  proven: null as null | ((sessionId: string) => unknown),
  deleted: [] as string[],
  deleteFails: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ createCheckinServiceClient: () => state.db }));
vi.mock("@/lib/device/auth", () => ({
  authenticateDevice: async () => (state.authError ? { error: state.authError } : { device: state.device }),
}));
vi.mock("@/lib/kiosk/store", () => ({
  openProvenKioskStay: async (_db: unknown, sessionId: string) => state.proven?.(sessionId) ?? { error: "session_gone" },
}));
vi.mock("livekit-server-sdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("livekit-server-sdk")>();
  return {
    ...original,
    RoomServiceClient: class {
      async deleteRoom(room: string) {
        if (state.deleteFails) throw new Error("livekit down");
        state.deleted.push(room);
      }
    },
  };
});

import { POST as cancelRoute } from "@/app/api/kiosk/call/[id]/cancel/route";
import { POST as endRoute } from "@/app/api/kiosk/call/[id]/end/route";
import { GET as readRoute } from "@/app/api/kiosk/call/[id]/route";
import { POST as createRoute } from "@/app/api/kiosk/call/route";

const CALL_ID = "11111111-1111-4111-8111-111111111111";
const SESSION = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const STAY = "22222222-2222-4222-8222-222222222222";
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const later = (ms: number) => new Date(Date.now() + ms).toISOString();

let db: FakeDb;

const enabled = { organization_id: "org-1", property_key: "stay_ari", staff_call_enabled: true };
const callRow = (over: Record<string, unknown> = {}) => ({
  id: CALL_ID,
  organization_id: "org-1",
  property_key: "stay_ari",
  device_id: "dev-1",
  stay_id: null,
  room_name: `call-${CALL_ID}`,
  status: "ringing",
  step: "find",
  language: "ja",
  ring_deadline_at: later(30_000),
  accepted_at: null,
  accepted_by: null,
  ended_at: null,
  ended_by: null,
  ...over,
});
const liveCall = () => callRow({ status: "accepted", accepted_at: ago(60_000), accepted_by: "staff-1", ring_deadline_at: ago(30_000) });

function seed(tables: Record<string, Record<string, unknown>[]>) {
  db = fakeCheckinDb(tables);
  state.db = db;
}
const create = (body: unknown = { step: "find", language: "ja" }) =>
  createRoute(new Request("https://x/api/kiosk/call", { method: "POST", headers: { authorization: "Bearer t" }, body: typeof body === "string" ? body : JSON.stringify(body) }));
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request("https://x", { headers: { authorization: "Bearer t" } });
const read = (id = CALL_ID) => readRoute(req(), params(id));
const cancel = (id = CALL_ID) => cancelRoute(req(), params(id));
const end = (id = CALL_ID) => endRoute(req(), params(id));
const calls = () => (db.tables.staff_calls ?? []) as Record<string, unknown>[];
const notified = (type: string) => db.rpcCalls.filter((call) => call.args.p_type === type);

beforeEach(() => {
  state.authError = null;
  state.proven = null;
  state.deleted = [];
  state.deleteFails = false;
  vi.stubEnv("LIVEKIT_URL", "wss://lk.example");
  vi.stubEnv("LIVEKIT_API_KEY", "key-for-test");
  vi.stubEnv("LIVEKIT_API_SECRET", "secret-for-test-secret-for-test-000");
  vi.spyOn(console, "error").mockImplementation(() => {});
  seed({ property_settings: [enabled] });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/kiosk/call", () => {
  it("기기 토큰이 없으면 401", async () => {
    state.authError = "unauthorized";
    expect((await create()).status).toBe(401);
  });

  it.each([
    [{ step: "lobby", language: "ja" }],
    [{ step: "find", language: "fr" }],
    ["{not json"],
  ])("잘못된 입력 %j 는 400 · 아무것도 만들지 않는다", async (body) => {
    expect((await create(body)).status).toBe(400);
    expect(calls()).toEqual([]);
  });

  it.each([
    ["설정 줄 없음", []],
    ["꺼짐", [{ ...enabled, staff_call_enabled: false }]],
  ])("건물 %s → disabled, 행 · 알림 없음", async (_name, rows) => {
    seed({ property_settings: rows });
    const response = await create();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: false, error: "disabled" });
    expect(calls()).toEqual([]);
    expect(db.rpcCalls).toEqual([]);
  });

  it.each(["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"])("%s 없음 → unconfigured, 행 · 알림 없음", async (name) => {
    vi.stubEnv(name, "");
    const response = await create();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: false, error: "unconfigured" });
    expect(calls()).toEqual([]);
    expect(db.rpcCalls).toEqual([]);
  });

  it("칼럼이 아직 없으면(마이그레이션 전, 42703) disabled", async () => {
    db.hooks.selectError = (table, columns) =>
      table === "property_settings" && columns.includes("staff_call_enabled") ? { code: "42703", message: "column does not exist" } : null;
    const response = await create();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: false, error: "disabled" });
  });

  it("다른 건물의 켜짐 설정은 보지 않는다", async () => {
    seed({ property_settings: [{ ...enabled, property_key: "okubo_a" }, { ...enabled, organization_id: "org-2" }] });
    expect(await (await create()).json()).toMatchObject({ error: "disabled" });
  });

  it("호출: ringing 행 45초 + 방 이름 + 받을 직원 알림(손님 정보 없음) + 기록", async () => {
    const before = Date.now();
    const body = await (await create()).json();
    expect(body).toMatchObject({ ok: true });
    expect(body.token).toBeUndefined();
    const [row] = calls();
    expect(row).toMatchObject({ id: body.callId, organization_id: "org-1", property_key: "stay_ari", device_id: "dev-1", status: "ringing", step: "find", language: "ja", stay_id: null, room_name: `call-${body.callId}` });
    expect(body.ringDeadlineAt).toBe(row.ring_deadline_at);
    expect(Date.parse(body.ringDeadlineAt) - before).toBeGreaterThanOrEqual(45_000);
    expect(Date.parse(body.ringDeadlineAt) - before).toBeLessThan(46_000);

    expect(db.rpcCalls).toEqual([
      {
        name: "notify_staff",
        args: {
          p_organization_id: "org-1",
          p_capability: "checkin.call",
          p_type: "checkin_staff_call",
          p_dedupe_key: `checkin_staff_call:${body.callId}`,
          p_href: "/admin/checkin",
          p_payload: { callId: body.callId, propertyKey: "stay_ari" },
        },
      },
    ]);
    expect(db.tables.audit_log).toEqual([
      { organization_id: "org-1", device_id: "dev-1", action: "staff_call_started", meta: { call_id: body.callId, property_key: "stay_ari" } },
    ]);
  });

  it("증명된 세션의 stay 만 넣는다 — 본문의 stay_id 는 무시", async () => {
    state.proven = (id) => (id === SESSION ? { stay: { id: STAY, organizationId: "org-1" } } : { error: "session_gone" });
    const body = await (await create({ step: "face", language: "en", session_id: SESSION, stay_id: "33333333-3333-4333-8333-333333333333" })).json();
    expect(calls()[0].stay_id).toBe(STAY);
    expect(db.rpcCalls[0].args.p_payload).toEqual({ callId: body.callId, propertyKey: "stay_ari" });
  });

  it("다른 조직의 stay 는 넣지 않는다", async () => {
    state.proven = () => ({ stay: { id: STAY, organizationId: "org-2" } });
    await create({ step: "face", language: "en", sessionId: SESSION });
    expect(calls()[0].stay_id).toBeNull();
  });

  it.each([
    ["증명 안 됨", () => ({ error: "verify_required" })],
    ["세션 없음", () => ({ error: "session_gone" })],
    ["읽기 실패", () => { throw new Error("db"); }],
  ])("%s 이어도 stay 없이 호출은 진행", async (_name, proven) => {
    state.proven = proven;
    expect(await (await create({ step: "face", language: "en", session_id: SESSION })).json()).toMatchObject({ ok: true });
    expect(calls()[0]).toMatchObject({ status: "ringing", stay_id: null });
  });

  it("받을 직원이 0명이면 바로 no_answer — 응답은 같은 모양, 다음 읽기에서 E3", async () => {
    db.hooks.rpc = () => ({ data: 0, error: null });
    const body = await (await create()).json();
    expect(body).toMatchObject({ ok: true });
    expect(calls()[0]).toMatchObject({ status: "no_answer", ended_by: "system" });
    expect(notified("checkin_call_missed")).toEqual([]);
    expect(await (await read(body.callId as string)).json()).toMatchObject({ ok: true, status: "no_answer" });
  });

  it("알림이 실패해도 호출은 ringing 으로 이어진다", async () => {
    db.hooks.rpc = () => ({ data: null, error: { message: "boom" } });
    expect(await (await create()).json()).toMatchObject({ ok: true });
    expect(calls()[0].status).toBe("ringing");
  });

  it("아직 울리는 내 호출이 있으면 새로 만들지 않고 그것을 돌려준다", async () => {
    seed({ property_settings: [enabled], staff_calls: [callRow()] });
    const body = await (await create()).json();
    expect(body).toMatchObject({ ok: true, callId: CALL_ID });
    expect(calls()).toHaveLength(1);
    expect(db.rpcCalls).toEqual([]);
  });

  it("낡은 ringing 을 먼저 no_answer 로 닫고(놓친 알림) 새로 만든다", async () => {
    seed({ property_settings: [enabled], staff_calls: [callRow({ ring_deadline_at: ago(1) })] });
    const body = await (await create()).json();
    expect(body.callId).not.toBe(CALL_ID);
    expect(calls()[0]).toMatchObject({ status: "no_answer", ended_by: "timeout" });
    expect(calls()[1].status).toBe("ringing");
    expect(notified("checkin_call_missed")).toHaveLength(1);
    expect(notified("checkin_staff_call")).toHaveLength(1);
  });

  it("남아 있던 통화 중 행은 system 으로 끝내고 방을 지운 뒤 새로 만든다", async () => {
    seed({ property_settings: [enabled], staff_calls: [liveCall()] });
    const body = await (await create()).json();
    expect(body.callId).not.toBe(CALL_ID);
    expect(calls()[0]).toMatchObject({ status: "ended", ended_by: "system" });
    expect(state.deleted).toEqual([`call-${CALL_ID}`]);
  });

  it("다른 기기의 진행 중 통화는 건드리지 않는다", async () => {
    seed({ property_settings: [enabled], staff_calls: [callRow({ device_id: "dev-2" })] });
    await create();
    expect(calls()[0].status).toBe("ringing");
    expect(calls()).toHaveLength(2);
  });

  it("동시에 두 번 눌려 고유 인덱스에 걸리면 먼저 만든 호출을 돌려준다", async () => {
    const winner = callRow();
    const insert = db.from.bind(db);
    let raced = false;
    db.from = ((table: string) => {
      if (table === "staff_calls" && !raced) {
        const builder = insert(table);
        const original = builder.insert;
        builder.insert = (values) => {
          raced = true;
          (db.tables.staff_calls ??= []).push(winner);
          return original(values);
        };
        return builder;
      }
      return insert(table);
    }) as typeof db.from;
    expect(await (await create()).json()).toMatchObject({ ok: true, callId: CALL_ID });
    expect(calls()).toHaveLength(1);
    expect(db.rpcCalls).toEqual([]);
  });
});

describe("GET /api/kiosk/call/[id]", () => {
  it.each([
    ["다른 기기", { device_id: "dev-2" }],
    ["다른 조직", { organization_id: "org-2" }],
  ])("%s 의 통화는 404 · 바뀌지 않는다", async (_name, over) => {
    seed({ staff_calls: [callRow({ ring_deadline_at: ago(1), ...over })] });
    for (const route of [read, cancel, end]) expect((await route()).status).toBe(404);
    expect(calls()[0].status).toBe("ringing");
  });

  it("없는 통화 · 모양이 틀린 id 도 404", async () => {
    expect((await read()).status).toBe(404);
    expect((await read("not-a-uuid")).status).toBe(404);
  });

  it("기기 토큰이 없으면 401", async () => {
    state.authError = "revoked";
    for (const route of [read, cancel, end]) expect((await route()).status).toBe(401);
  });

  it("ringing: 토큰 없음", async () => {
    seed({ staff_calls: [callRow()] });
    const body = await (await read()).json();
    expect(body).toMatchObject({ ok: true, status: "ringing" });
    expect(body).not.toHaveProperty("token");
    expect(body).not.toHaveProperty("url");
  });

  it("accepted: 태블릿 토큰 + 주소", async () => {
    seed({ staff_calls: [liveCall()] });
    const body = await (await read()).json();
    expect(body).toMatchObject({ ok: true, status: "accepted", url: "wss://lk.example" });
    const claims = JSON.parse(Buffer.from((body.token as string).split(".")[1], "base64url").toString());
    expect(claims.sub).toBe("kiosk-dev-1");
    expect(claims.video.room).toBe(`call-${CALL_ID}`);
  });

  it("45초가 지난 ringing → no_answer + 놓친 알림 한 번(다시 읽어도 또 안 보냄)", async () => {
    seed({ staff_calls: [callRow({ ring_deadline_at: ago(1) })] });
    expect(await (await read()).json()).toMatchObject({ status: "no_answer" });
    expect(await (await read()).json()).toMatchObject({ status: "no_answer" });
    expect(calls()[0]).toMatchObject({ status: "no_answer", ended_by: "timeout" });
    expect(calls()[0].ended_at).toBeTruthy();
    expect(notified("checkin_call_missed")).toEqual([
      {
        name: "notify_staff",
        args: {
          p_organization_id: "org-1",
          p_capability: "checkin.call",
          p_type: "checkin_call_missed",
          p_dedupe_key: `checkin_call_missed:${CALL_ID}`,
          p_href: "/admin/checkin",
          p_payload: { callId: CALL_ID, propertyKey: "stay_ari" },
        },
      },
    ]);
    expect((db.tables.audit_log as Record<string, unknown>[]).map((row) => row.action)).toEqual(["staff_call_no_answer"]);
  });

  it("놓친 알림이 실패해도 상태는 답한다", async () => {
    seed({ staff_calls: [callRow({ ring_deadline_at: ago(1) })] });
    db.hooks.rpc = () => { throw new Error("rpc down"); };
    expect(await (await read()).json()).toMatchObject({ ok: true, status: "no_answer" });
  });

  it("다른 쪽이 먼저 받았으면(조건부 update 0줄) 다시 읽어 accepted 로 답하고 놓친 알림은 없다", async () => {
    seed({ staff_calls: [callRow({ ring_deadline_at: ago(1) })] });
    db.hooks.beforeUpdate = () => {
      Object.assign(calls()[0], { status: "accepted", accepted_at: new Date().toISOString(), accepted_by: "staff-1" });
      db.hooks.beforeUpdate = null;
    };
    expect(await (await read()).json()).toMatchObject({ status: "accepted" });
    expect(notified("checkin_call_missed")).toEqual([]);
  });

  it("30분 지난 accepted → ended(timeout), 토큰 없음, 방 지움", async () => {
    seed({ staff_calls: [callRow({ status: "accepted", accepted_at: ago(30 * 60_000), accepted_by: "staff-1", ring_deadline_at: ago(31 * 60_000) })] });
    const body = await (await read()).json();
    expect(body).toMatchObject({ status: "ended" });
    expect(body).not.toHaveProperty("token");
    expect(calls()[0]).toMatchObject({ status: "ended", ended_by: "timeout" });
    expect(state.deleted).toEqual([`call-${CALL_ID}`]);
  });

  it("통화 중 환경 변수가 사라지면 토큰을 못 주므로 system 으로 끝낸다", async () => {
    vi.stubEnv("LIVEKIT_API_SECRET", "");
    seed({ staff_calls: [liveCall()] });
    const body = await (await read()).json();
    expect(body).toMatchObject({ ok: true, status: "ended" });
    expect(calls()[0]).toMatchObject({ status: "ended", ended_by: "system" });
  });
});

describe("통화 중 받은 직원 다시 확인", () => {
  const checks = () => db.rpcCalls.filter((call) => call.name === "can_take_call");

  it("accepted 를 읽을 때마다 받은 직원을 묻고, 되면 토큰을 준다", async () => {
    seed({ staff_calls: [liveCall()] });
    db.hooks.rpc = () => ({ data: true, error: null });
    expect(await (await read()).json()).toMatchObject({ status: "accepted", url: "wss://lk.example" });
    expect(checks()).toEqual([{ name: "can_take_call", args: { p_organization_id: "org-1", p_user_id: "staff-1" } }]);
  });

  it("권한이 사라졌으면 ended(system) + 방 삭제 + 기록, 토큰 없음", async () => {
    seed({ staff_calls: [liveCall()] });
    db.hooks.rpc = () => ({ data: false, error: null });
    const body = await (await read()).json();
    expect(body).toMatchObject({ ok: true, status: "ended" });
    expect(body).not.toHaveProperty("token");
    expect(calls()[0]).toMatchObject({ status: "ended", ended_by: "system" });
    expect(state.deleted).toEqual([`call-${CALL_ID}`]);
    expect((db.tables.audit_log as Record<string, unknown>[]).map((row) => row.action)).toEqual(["staff_call_ended"]);
  });

  it.each([
    ["오류 응답", () => ({ data: null, error: { message: "boom" } })],
    ["예외", () => { throw new Error("rpc down"); }],
  ])("판정 %s 면 멀쩡한 통화를 끊지 않는다", async (_name, rpc) => {
    seed({ staff_calls: [liveCall()] });
    db.hooks.rpc = rpc;
    expect(await (await read()).json()).toMatchObject({ ok: true, status: "accepted", url: "wss://lk.example" });
    expect(calls()[0].status).toBe("accepted");
    expect(state.deleted).toEqual([]);
  });

  it("30분이 지났으면 묻지 않고 timeout 으로 닫는다", async () => {
    seed({ staff_calls: [callRow({ status: "accepted", accepted_at: ago(30 * 60_000), accepted_by: "staff-1", ring_deadline_at: ago(31 * 60_000) })] });
    expect(await (await read()).json()).toMatchObject({ status: "ended" });
    expect(calls()[0].ended_by).toBe("timeout");
    expect(checks()).toEqual([]);
  });

  it("울리는 중에는 묻지 않는다", async () => {
    seed({ staff_calls: [callRow()] });
    await read();
    expect(checks()).toEqual([]);
  });
});

describe("cancel · end", () => {
  it("cancel: ringing → canceled", async () => {
    seed({ staff_calls: [callRow()] });
    expect(await (await cancel()).json()).toMatchObject({ ok: true, status: "canceled" });
    expect(calls()[0]).toMatchObject({ status: "canceled", ended_by: "guest" });
    expect(calls()[0].ended_at).toBeTruthy();
    expect(state.deleted).toEqual([]);
    expect(db.rpcCalls).toEqual([]);
  });

  it("cancel: 기한이 지났으면 no_answer 로 답한다", async () => {
    seed({ staff_calls: [callRow({ ring_deadline_at: ago(1) })] });
    expect(await (await cancel()).json()).toMatchObject({ status: "no_answer" });
    expect(notified("checkin_call_missed")).toHaveLength(1);
  });

  it("cancel 과 받기가 겹치면 통화를 끝낸다(직원만 빈 방에 남지 않게)", async () => {
    seed({ staff_calls: [callRow()] });
    db.hooks.beforeUpdate = () => {
      Object.assign(calls()[0], { status: "accepted", accepted_at: new Date().toISOString(), accepted_by: "staff-1" });
      db.hooks.beforeUpdate = null;
    };
    expect(await (await cancel()).json()).toMatchObject({ status: "ended" });
    expect(calls()[0]).toMatchObject({ status: "ended", ended_by: "guest" });
    expect(state.deleted).toEqual([`call-${CALL_ID}`]);
  });

  it("end: accepted → ended + 방 지움 + 기록(통화 id · 건물만)", async () => {
    seed({ staff_calls: [liveCall()] });
    expect(await (await end()).json()).toMatchObject({ ok: true, status: "ended" });
    expect(calls()[0]).toMatchObject({ status: "ended", ended_by: "guest" });
    expect(state.deleted).toEqual([`call-${CALL_ID}`]);
    expect(db.tables.audit_log).toEqual([
      { organization_id: "org-1", device_id: "dev-1", action: "staff_call_ended", meta: { call_id: CALL_ID, property_key: "stay_ari" } },
    ]);
  });

  it("end: 방 지우기가 실패해도 끝낸 것으로 답한다", async () => {
    state.deleteFails = true;
    seed({ staff_calls: [liveCall()] });
    expect(await (await end()).json()).toMatchObject({ ok: true, status: "ended" });
  });

  it("end: 환경 변수가 없어도 끝낼 수 있다", async () => {
    vi.stubEnv("LIVEKIT_URL", "");
    seed({ staff_calls: [liveCall()] });
    expect(await (await end()).json()).toMatchObject({ ok: true, status: "ended" });
    expect(state.deleted).toEqual([]);
  });

  it("end: 아직 울리는 중이면 canceled", async () => {
    seed({ staff_calls: [callRow()] });
    expect(await (await end()).json()).toMatchObject({ status: "canceled" });
  });

  it.each(["ended", "no_answer", "canceled", "failed"])("이미 끝난 %s 는 그대로 답한다(두 번 눌러도 안전)", async (status) => {
    seed({ staff_calls: [callRow({ status, ended_at: ago(1000), ended_by: "system", ring_deadline_at: ago(5000) })] });
    for (const route of [cancel, end]) expect(await (await route()).json()).toMatchObject({ ok: true, status });
    expect(calls()[0].ended_by).toBe("system");
    expect(db.tables.audit_log ?? []).toEqual([]);
  });
});

describe("로그에 비밀 · 손님 정보 없음", () => {
  it("기록 · 알림 어디에도 토큰이 없다", async () => {
    seed({ staff_calls: [liveCall()] });
    const { token } = (await (await read()).json()) as { token: string };
    await end();
    expect(JSON.stringify([db.tables.audit_log, db.rpcCalls])).not.toContain(token);
  });
});
