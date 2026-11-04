import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 청소 배정 서버 액션 — 조용히 사라지는 오류 · 조직 확인(문서 45 A7 · A10). 조회 · 쓰기 결과를 표(handler)로 정해 돌린다.
 */

type Call = { table: string; op: string; payload?: unknown };
type Result = { data?: unknown; error?: { code?: string; message?: string } | null };
let calls: Call[] = [];
let handler: (call: Call) => Result = () => ({ data: null, error: null });

function fakeClient() {
  return {
    from(table: string) {
      const call: Call = { op: "select", table };
      const chain: Record<string, unknown> = {};
      const passthrough = ["eq", "in", "not", "is", "limit", "order", "gt", "gte", "lt", "lte", "range", "maybeSingle", "single", "select"];
      for (const name of passthrough) chain[name] = () => chain;
      for (const op of ["insert", "update", "upsert", "delete"]) {
        chain[op] = (payload: unknown) => {
          call.op = op;
          call.payload = payload;
          return chain;
        };
      }
      chain.then = (resolve: (value: Result) => unknown) => {
        calls.push({ ...call });
        const result = handler(call);
        return Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve);
      };
      return chain;
    },
    rpc: async () => ({ data: 1, error: null }),
  };
}

const memberIds = new Set(["11111111-1111-4111-8111-111111111111"]);
const USER = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";
const DATE = "2026-11-10";
let roomsRead: (() => unknown[]) | null = null;
let sessionsRead: (() => unknown[]) | null = null;
const OPTION = { label: "401", propertyName: "아라키초A", roomKey: "k401", roomLabel: "401" };

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => fakeClient() }));
vi.mock("@/lib/session", () => ({
  getCurrentAppSession: async () => ({ capabilities: ["cleaning.assign", "cleaning.assign_swap"], organization: { id: "org" }, user: { id: "admin" } }),
  hasOrganizationContext: () => true,
}));
vi.mock("@/lib/cleaning", () => ({ getCleaningOperatingDateKey: () => DATE }));
vi.mock("@/lib/cleaning-assign/live", () => ({ signalCleaningAssignChange: async () => {} }));
vi.mock("@/lib/cleaning-assign/data", () => ({
  computeDaySuggestions: async () => [],
  computeMonthSuggestions: async () => ({ leftTotal: 0, openTotal: 0, shortDays: [], suggestions: [] }),
  loadFieldMembers: async () => [...memberIds].map((userId) => ({ userId })),
  loadMonthBoard: async () => ({}),
  loadMonthOpenCounts: async () => ({}),
}));
vi.mock("@/lib/cleaning-assign/rooms", () => ({
  loadAddBlockedRoomKeys: async () => new Set<string>(),
  loadAssignDayRooms: async () => (roomsRead ? roomsRead() : []),
  loadDaySessionRows: async () => (sessionsRead ? sessionsRead() : []),
  MAX_DEFER_DAYS: 60,
}));
vi.mock("@/lib/automation/data", () => ({ loadCleaningRoomOptions: async () => [OPTION] }));
vi.mock("@/lib/cleaning-assign/person-shift", () => ({ loadPersonShift: async () => ({}) }));

const { ensureApplication } = await import("@/actions/cleaning-assign-guards");
const { cancelPersonDay, toggleApplicationForUser } = await import("@/actions/cleaning-assign-shift");
const { addApplicantForDay, addRoomForDay, holdRoom, reassignRooms } = await import("@/app/admin/cleaning-assign/actions");
const { assignToRoom, unassignFromRoom } = await import("@/actions/cleaning-assign-room");

beforeEach(() => {
  calls = [];
  handler = () => ({ data: null, error: null });
  roomsRead = null;
  sessionsRead = null;
});

const opsOn = (table: string, op: string) => calls.filter((call) => call.table === table && call.op === op);

describe("A10 조용히 사라지는 오류 — 신청 줄", () => {
  it("읽기 실패면 false", async () => {
    handler = () => ({ error: { code: "x" } });
    await expect(ensureApplication("org", USER, DATE, "admin")).resolves.toBe(false);
  });
  it("넣기 실패면 false, 같은 순간 이미 생긴 줄(23505)은 true", async () => {
    handler = (call) => (call.op === "insert" ? { error: { code: "x" } } : {});
    await expect(ensureApplication("org", USER, DATE, "admin")).resolves.toBe(false);
    handler = (call) => (call.op === "insert" ? { error: { code: "23505" } } : {});
    await expect(ensureApplication("org", USER, DATE, "admin")).resolves.toBe(true);
  });
  it("되살리기 실패면 false", async () => {
    handler = (call) => (call.op === "update" ? { error: { code: "x" } } : { data: { cancelled_at: "2026-11-09T00:00:00Z" } });
    await expect(ensureApplication("org", USER, DATE, "admin", { revive: true })).resolves.toBe(false);
  });
  it("「다시 넣기」 실패를 ok 로 돌려주지 않는다", async () => {
    handler = (call) => (call.op === "update" ? { error: { code: "x" } } : { data: { cancelled_at: "2026-11-09T00:00:00Z" } });
    await expect(addApplicantForDay({ date: DATE, userId: USER })).resolves.toEqual({ ok: false, reason: "error" });
  });
});

describe("A10 조용히 사라지는 오류 — 월 보기 신청 넣기 · 빼기", () => {
  it("신청 읽기 실패", async () => {
    handler = (call) => (call.table === "cleaning_shift_applications" ? { error: { code: "x" } } : {});
    await expect(toggleApplicationForUser({ date: DATE, userId: USER })).resolves.toEqual({ ok: false, reason: "error" });
  });
  it("배정 읽기 실패면 신청을 지우지 않는다", async () => {
    handler = (call) => (call.table === "cleaning_assignments" ? { error: { code: "x" } } : { data: { cancelled_at: null, user_id: USER } });
    await expect(toggleApplicationForUser({ date: DATE, userId: USER })).resolves.toEqual({ ok: false, reason: "error" });
    expect(opsOn("cleaning_shift_applications", "delete")).toHaveLength(0);
  });
  it("신청 지우기 실패", async () => {
    handler = (call) => (call.op === "delete" ? { error: { code: "x" } } : call.table === "cleaning_assignments" ? { data: [] } : { data: { cancelled_at: null, user_id: USER } });
    await expect(toggleApplicationForUser({ date: DATE, userId: USER })).resolves.toEqual({ ok: false, reason: "error" });
  });
  it("신청 넣기 실패", async () => {
    handler = (call) => (call.op === "insert" ? { error: { code: "x" } } : {});
    await expect(toggleApplicationForUser({ date: DATE, userId: USER })).resolves.toEqual({ ok: false, reason: "error" });
  });
});

describe("A10 조용히 사라지는 오류 — 방 추가", () => {
  const input = { date: DATE, roomKey: "k401", userIds: [USER] };
  it("배정 실패면 새로 만든 수기 방을 지우고 실패", async () => {
    handler = (call) => (call.table === "cleaning_assignments" && call.op === "upsert" ? { error: { code: "x" } } : {});
    await expect(addRoomForDay(input)).resolves.toEqual({ ok: false, reason: "error" });
    expect(opsOn("cleaning_list_extra_rooms", "delete")).toHaveLength(1);
  });
  it("원래 있던 수기 방은 지우지 않는다", async () => {
    handler = (call) => {
      if (call.table === "cleaning_assignments" && call.op === "upsert") return { error: { code: "x" } };
      if (call.table === "cleaning_list_extra_rooms" && call.op === "select") return { data: { id: "e1" } };
      return {};
    };
    await expect(addRoomForDay(input)).resolves.toEqual({ ok: false, reason: "error" });
    expect(opsOn("cleaning_list_extra_rooms", "delete")).toHaveLength(0);
  });
  it("신청 줄 실패면 넣은 배정 · 새 수기 방을 지우고 실패", async () => {
    handler = (call) => {
      if (call.table === "cleaning_shift_applications" && call.op === "insert") return { error: { code: "x" } };
      if (call.table === "cleaning_assignments" && call.op === "upsert") return { data: [{ id: "a1" }] };
      return {};
    };
    await expect(addRoomForDay(input)).resolves.toEqual({ ok: false, reason: "error" });
    expect(opsOn("cleaning_assignments", "delete")).toHaveLength(1);
    expect(opsOn("cleaning_list_extra_rooms", "delete")).toHaveLength(1);
  });
});

describe("조직 확인", () => {
  it("cancelPersonDay — 현장 인원이 아닌 사람(다른 조직 UUID)은 invalid, 아무것도 쓰지 않는다", async () => {
    await expect(cancelPersonDay({ date: DATE, userId: STRANGER })).resolves.toEqual({ ok: false, reason: "invalid" });
    expect(calls.filter((call) => call.op !== "select")).toHaveLength(0);
  });
});

describe("거절 — 상태가 바뀜(stale) · 잘못된 입력(invalid) 구분", () => {
  it("넣기 — 방이 지금 목록에 없으면 stale, 현장 인원이 아니면 invalid, 날짜가 이상하면 invalid", async () => {
    await expect(assignToRoom({ date: DATE, roomKey: "k401", userId: USER })).resolves.toEqual({ ok: false, reason: "stale" });
    await expect(assignToRoom({ date: DATE, roomKey: "k401", userId: STRANGER })).resolves.toEqual({ ok: false, reason: "invalid" });
    await expect(assignToRoom({ date: "nope", roomKey: "k401", userId: USER })).resolves.toEqual({ ok: false, reason: "invalid" });
  });
  it("미루기 · 처리 끝 — 방이 지금 목록에 없으면 stale, 입력이 이상하면 invalid", async () => {
    await expect(holdRoom({ date: DATE, kind: "resolved", originDate: DATE, roomKey: "k401" })).resolves.toEqual({ ok: false, reason: "stale" });
    await expect(holdRoom({ date: DATE, kind: "resolved", originDate: "nope", roomKey: "k401" })).resolves.toEqual({ ok: false, reason: "invalid" });
  });
  it("빼기 — 그 사이 빠졌으면 conflict 그대로", async () => {
    await expect(unassignFromRoom({ date: DATE, roomKey: "k401", userId: USER })).resolves.toEqual({ ok: false, reason: "conflict" });
  });
});

describe("방 추가 — 실제 스키마", () => {
  it("읽기 오류는 console.error 로 남기고 실패", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    handler = (call) => (call.table === "cleaning_list_extra_rooms" && call.op === "select" ? { error: { code: "42703" } } : {});
    await expect(addRoomForDay({ date: DATE, roomKey: "k401", userIds: [] })).resolves.toEqual({ ok: false, reason: "error" });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

const ROOM = { carriedFrom: null, deferredUntil: null, partial: null, propertyName: "아라키초A", resolvedHold: false, roomKey: "k401", roomLabel: "401", sessionRoomLabel: "아라키초A 401", status: "pending" };
const RECORD = { cleaning_date: DATE, closed_without_cleaning: false, room_key: "k401", room_label: "아라키초A 401", staff_user_id: STRANGER, status: "in_progress" };

describe("배정 바꾸기 — 판단 함수 연결", () => {
  it("빼기 — 기록이 있는 사람은 has_record, 아무것도 지우지 않는다", async () => {
    roomsRead = () => [ROOM];
    sessionsRead = () => [{ ...RECORD, staff_user_id: USER }];
    handler = (call) => (call.table === "cleaning_assignments" ? { data: { property_name: "아라키초A", room_key: "k401", room_label: "401" } } : {});
    await expect(unassignFromRoom({ date: DATE, roomKey: "k401", userId: USER })).resolves.toEqual({ ok: false, reason: "has_record" });
    expect(opsOn("cleaning_assignments", "delete")).toEqual([]);
  });

  it("담당 바꾸기 — 기록 있음 has_record · 방 없음 stale · 현장 인원 아님 invalid, 쓰지 않는다", async () => {
    const moves = [{ fromUserId: STRANGER, roomKey: "k401", toUserId: USER }];
    roomsRead = () => [ROOM];
    sessionsRead = () => [RECORD];
    await expect(reassignRooms({ date: DATE, moves })).resolves.toEqual({ ok: false, reason: "has_record" });
    roomsRead = () => [];
    await expect(reassignRooms({ date: DATE, moves })).resolves.toEqual({ ok: false, reason: "stale" });
    await expect(reassignRooms({ date: DATE, moves: [{ fromUserId: USER, roomKey: "k401", toUserId: STRANGER }] })).resolves.toEqual({ ok: false, reason: "invalid" });
    expect(opsOn("cleaning_assignments", "update")).toEqual([]);
  });
});

describe("읽기가 throw 해도 오류 화면 대신 error", () => {
  const boom = () => {
    throw new Error("read failed");
  };

  it("넣기 · 빼기 · 담당 바꾸기 · 미루기 · 방 추가 · 그날 취소", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    roomsRead = boom;
    sessionsRead = boom;
    const error = { ok: false, reason: "error" };
    await expect(assignToRoom({ date: DATE, roomKey: "k401", userId: USER })).resolves.toEqual(error);
    await expect(unassignFromRoom({ date: DATE, roomKey: "k401", userId: USER })).resolves.toEqual(error);
    await expect(reassignRooms({ date: DATE, moves: [{ fromUserId: STRANGER, roomKey: "k401", toUserId: USER }] })).resolves.toEqual(error);
    await expect(holdRoom({ date: DATE, kind: "resolved", originDate: DATE, roomKey: "k401" })).resolves.toEqual(error);
    await expect(addRoomForDay({ date: DATE, roomKey: "k401", userIds: [] })).resolves.toEqual(error);
    await expect(cancelPersonDay({ date: DATE, userId: USER })).resolves.toEqual(error);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
