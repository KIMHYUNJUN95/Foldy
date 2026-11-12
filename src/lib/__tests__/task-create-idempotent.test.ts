import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase } from "@/lib/__tests__/fake-supabase";

/**
 * 공용 만들기 함수 — 다시 보낸 요청(2026-11-13 손님 메시지 6단계 검토 반영). docs/product/47-guest-messaging.md §5-7
 * - 할 일: 요청 id 를 주면 그 id 로 넣고, 같은 id 로 다시 오면 내가 방금 만든 이 조직 할 일만 돌려준다(두 번 만들지 않음).
 *   id 를 안 주면(모바일 새 할 일 폼) 예전처럼 서버가 만든다. 만들기 되돌리기 지우기는 조직으로도 거른다.
 * - 분실물: 방 카탈로그 읽기가 던지면 저장하지 않고 save_failed(수리 · 점검과 같게).
 */
const state = vi.hoisted(() => ({ db: null as unknown, catalogThrows: false }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => state.db }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn(async () => state.db) }));
vi.mock("@/lib/task-linked-context", () => ({ linkedContextBelongsToOrg: vi.fn(async () => true) }));
vi.mock("@/lib/notifications/create", () => ({ notifyTaskParticipants: vi.fn() }));
vi.mock("@/lib/projects", () => ({ getProjectDetail: vi.fn(async () => null) }));
vi.mock("@/lib/rooms", () => ({
  getActiveRoomCatalogServer: vi.fn(async () => {
    if (state.catalogThrows) throw new Error("catalog read failed");
    return [{ propertyName: "아라키초A", displayRoomLabel: "101" }];
  }),
}));

import { createTaskRecord, type TaskCreateInput } from "@/lib/task-create";
import { createLostItemRecord } from "@/lib/lost-item-create";
import type { AppSession } from "@/lib/session";

const ORG = "00000000-0000-4000-8000-000000000a01";
const ME = "00000000-0000-4000-8000-000000000b01";
const OTHER = "00000000-0000-4000-8000-000000000b02";
const REQ = "00000000-0000-4000-8000-000000000f01";
const session = { organization: { id: ORG }, user: { id: ME }, capabilities: [] } as unknown as AppSession;

function input(over: Partial<TaskCreateInput> = {}): TaskCreateInput {
  return {
    title: "Extra towels",
    description: "",
    scheduledDate: "",
    dueDate: "",
    time: "",
    durationMinutes: "",
    priority: "normal",
    repeat: "",
    tags: [],
    shareUserIds: [],
    directive: false,
    imageUrls: [],
    ctxPropertyId: null,
    ctxRoomId: null,
    ctxReservationId: null,
    ctxGuestName: null,
    projectId: null,
    sectionId: null,
    ...over,
  };
}

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let deletes: Array<{ table: string; filters: Array<[string, unknown]> }>;

/** tasks 의 id 고유 키 · 지우기 필터를 흉내 낸다. */
function db(failParticipants = false) {
  const fake = createFakeSupabase(tables).client;
  return {
    from(table: string) {
      const b = fake.from(table) as unknown as Record<string, (...args: unknown[]) => unknown>;
      if (table === "tasks") {
        const insert = b.insert.bind(b);
        b.insert = (value: unknown) => {
          const row = value as Row;
          if (tables.tasks.some((r) => r.id === row.id)) return Promise.resolve({ data: null, error: { code: "23505" } });
          return insert({ created_at: new Date().toISOString(), deleted_at: null, ...row });
        };
        b.delete = () => {
          const entry = { table, filters: [] as Array<[string, unknown]> };
          deletes.push(entry);
          const chain = {
            eq(column: string, value: unknown) {
              entry.filters.push([column, value]);
              return chain;
            },
            then(resolve: (v: unknown) => void) {
              resolve({ data: null, error: null });
            },
          };
          return chain;
        };
      }
      if (table === "task_participants" && failParticipants) {
        b.insert = () => Promise.resolve({ data: null, error: { code: "23502" } });
      }
      return b;
    },
  };
}

beforeEach(() => {
  tables = { tasks: [], task_participants: [] };
  deletes = [];
  state.db = db();
  state.catalogThrows = false;
});

describe("createTaskRecord — 요청 id", () => {
  it("id 를 안 주면 예전처럼 서버가 새 id(모바일 새 할 일 폼 그대로)", async () => {
    const a = await createTaskRecord(session, input());
    const b = await createTaskRecord(session, input());
    expect(a.ok && b.ok && a.id !== b.id).toBe(true);
    expect(tables.tasks).toHaveLength(2);
  });
  it("같은 요청 id 로 다시 오면 한 건 — 두 번째는 같은 할 일을 돌려준다", async () => {
    const first = await createTaskRecord(session, input({ id: REQ }));
    const second = await createTaskRecord(session, input({ id: REQ }));
    expect(first).toEqual({ ok: true, id: REQ, projectId: null });
    expect(second).toEqual({ ok: true, id: REQ, projectId: null });
    expect(tables.tasks).toHaveLength(1);
    expect(tables.task_participants).toHaveLength(1);
  });
  it("같은 id 가 남의 할 일 · 10분 넘은 할 일 · 지운 할 일이면 save_failed", async () => {
    tables.tasks.push({ id: REQ, organization_id: ORG, created_by_user_id: OTHER, created_at: new Date().toISOString(), deleted_at: null });
    expect(await createTaskRecord(session, input({ id: REQ }))).toEqual({ ok: false, error: "save_failed" });
    tables.tasks[0] = { ...tables.tasks[0], created_by_user_id: ME, created_at: new Date(Date.now() - 11 * 60 * 1000).toISOString() };
    expect(await createTaskRecord(session, input({ id: REQ }))).toEqual({ ok: false, error: "save_failed" });
    tables.tasks[0] = { ...tables.tasks[0], created_at: new Date().toISOString(), deleted_at: new Date().toISOString() };
    expect(await createTaskRecord(session, input({ id: REQ }))).toEqual({ ok: false, error: "save_failed" });
  });
  it("uuid 가 아닌 요청 id 는 거절", async () => {
    expect(await createTaskRecord(session, input({ id: "k-123" }))).toEqual({ ok: false, error: "save_failed" });
    expect(tables.tasks).toHaveLength(0);
  });
  it("참여자 넣기가 실패하면 되돌리기 지우기 — id 와 조직으로 거른다", async () => {
    state.db = db(true);
    expect(await createTaskRecord(session, input({ id: REQ }))).toEqual({ ok: false, error: "save_failed" });
    expect(deletes).toEqual([{ table: "tasks", filters: [["id", REQ], ["organization_id", ORG]] }]);
  });
});

describe("createLostItemRecord — 방 카탈로그 읽기 실패", () => {
  it("던지면 save_failed(오류 화면으로 터지지 않음)", async () => {
    state.catalogThrows = true;
    const result = await createLostItemRecord(session, {
      propertyName: "아라키초A",
      roomLabel: "101",
      itemName: "Charger",
      category: "other",
      memo: "",
      imageUrls: [],
    });
    expect(result).toEqual({ ok: false, error: "save_failed" });
  });
});
