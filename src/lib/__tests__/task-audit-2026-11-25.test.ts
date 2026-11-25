import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 할 일 점검 묶음 (2026-11-25).
 *  B. 순서 저장 실패가 성공으로 나오던 것 — `setTaskSortOrders` 가 결과를 돌려준다.
 *  C. 모바일 지난 미완료 처리 · 회차 건너뛰기 · 일괄 되돌리기가 실패를 결과로 돌려준다.
 *  D. 오늘로 · 내일로 옮기기는 작성자 · 프로젝트 주인 · 개발자만.
 *  E. 프로젝트를 나간 작성자는 그 프로젝트 할 일을 지우거나 되살리지 못한다(개인 할 일은 그대로).
 */

type Row = Record<string, unknown>;
type Op = "select" | "update" | "delete" | "insert" | "upsert";

const state = {
  db: {} as Record<string, Row[]>,
  /** `${table}:${op}` → 오류를 낼 남은 횟수(-1 = 계속). */
  fail: {} as Record<string, number>,
  writes: [] as Array<{ table: string; op: Op; payload: unknown }>,
};

function shouldFail(table: string, op: Op): boolean {
  const key = `${table}:${op}`;
  const n = state.fail[key];
  if (!n) return false;
  if (n > 0) state.fail[key] = n - 1;
  return true;
}

function makeQuery(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: Op = "select";
  let payload: Row | Row[] | null = null;
  let limitTo: number | null = null;
  let ignoreDuplicates = false;
  const rows = () => (state.db[table] ??= []);
  const match = (r: Row) => filters.every((f) => f(r));
  const run = () => {
    if (shouldFail(table, op)) return { data: null, error: { message: "boom" } };
    if (op === "select") {
      const hit = rows().filter(match);
      return { data: limitTo === null ? hit : hit.slice(0, limitTo), error: null };
    }
    state.writes.push({ table, op, payload });
    if (op === "update") {
      const hit = rows().filter(match);
      for (const r of hit) Object.assign(r, payload);
      return { data: hit.map((r) => ({ ...r })), error: null };
    }
    if (op === "delete") {
      state.db[table] = rows().filter((r) => !match(r));
      return { data: null, error: null };
    }
    const list = Array.isArray(payload) ? payload : [payload as Row];
    const inserted: Row[] = [];
    for (const p of list) {
      const hit =
        op === "upsert"
          ? rows().find((r) => r.task_id === p.task_id && r.occurrence_date === p.occurrence_date)
          : undefined;
      if (hit) {
        if (!ignoreDuplicates) Object.assign(hit, p);
      } else {
        rows().push({ ...p });
        inserted.push({ ...p });
      }
    }
    return { data: inserted, error: null };
  };
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
    neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), q),
    in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), q),
    is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), q),
    overlaps: () => q,
    order: () => q,
    gt: (k: string, v: string) => (filters.push((r) => String(r[k]) > v), q),
    limit: (n: number) => ((limitTo = n), q),
    filter: () => q,
    maybeSingle: async () => {
      const r = run();
      return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
    },
    update: (p: Row) => ((op = "update"), (payload = p), q),
    delete: () => ((op = "delete"), q),
    insert: (p: Row | Row[]) => ((op = "insert"), (payload = p), q),
    upsert: (p: Row | Row[], opts?: { ignoreDuplicates?: boolean }) => (
      (op = "upsert"), (payload = p), (ignoreDuplicates = !!opts?.ignoreDuplicates), q
    ),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(run()).then(resolve, reject),
  };
  return q;
}

const fakeClient = {
  from: (table: string) => makeQuery(table),
  storage: { from: () => ({ remove: async () => ({ error: null }) }) },
};

const ORG = "org-1";
const ME = "u-me";
const PEER = "u-peer";
const session = { user: { id: ME, role: "staff" }, organization: { id: ORG } };
const tasksState = {
  visible: [] as Row[],
  detail: null as Row | null,
  scope: new Set<string>(),
  membership: new Map<string, { ownerUserId: string | null; memberIds: Set<string> }>(),
};

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => fakeClient }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn(async () => fakeClient) }));
vi.mock("@/lib/session", () => ({
  getCurrentAppSession: async () => session,
  hasOrganizationContext: () => true,
}));
vi.mock("@/lib/notifications/create", () => ({
  notifyProjectMembers: async () => {},
  notifyTaskParticipants: async () => {},
}));
vi.mock("@/actions/task-report", () => ({
  generateDailyReport: async () => ({}),
  sendDailyReportToSlack: async () => ({}),
}));
vi.mock("@/lib/projects", () => ({ getProjectDetail: async () => null }));
vi.mock("@/lib/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tasks")>();
  return {
    ...actual,
    getVisibleTasks: async () => tasksState.visible,
    getTaskDetail: async () => tasksState.detail,
    getTaskScope: async () => ({ taskIds: tasksState.scope, projectIds: new Set<string>() }),
    getProjectMembership: async () => tasksState.membership,
  };
});

const { setTaskSortOrders } = await import("@/lib/task-occurrences");
const { canDeleteOrRestoreTask, buildTaskScope } = await import("@/lib/tasks");
const mobile = await import("@/app/mobile/tasks/[id]/actions");
const admin = await import("@/app/admin/tasks/actions");

beforeEach(() => {
  state.db = {};
  state.fail = {};
  state.writes = [];
  tasksState.visible = [];
  tasksState.detail = null;
  tasksState.scope = new Set();
  tasksState.membership = new Map();
});

function taskRecord(over: Row = {}): Row {
  return {
    id: "t-1",
    organizationId: ORG,
    createdByUserId: ME,
    title: "할 일",
    status: "open",
    projectId: null,
    projectOwnerUserId: null,
    recurrenceRule: null,
    recurrenceSeriesId: null,
    recurrenceInstanceDate: null,
    dueAt: "2026-11-20T00:00:00.000Z",
    scheduledDate: null,
    timeLabel: null,
    participants: [],
    ...over,
  };
}

async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const m = String((e as Error).message);
    if (m.startsWith("REDIRECT:")) return m.slice("REDIRECT:".length);
    throw e;
  }
  throw new Error("redirect 가 없었다");
}

describe("B. 순서 저장 결과", () => {
  const positions = () => new Map([["a", 0], ["b", 1]]);
  beforeEach(() => {
    state.db.tasks = [
      { id: "a", organization_id: ORG, sort_order: 5 },
      { id: "b", organization_id: ORG, sort_order: 6 },
    ];
  });

  it("다 저장되면 true", async () => {
    expect(await setTaskSortOrders({ organizationId: ORG, positions: positions() })).toBe(true);
    expect(state.db.tasks.map((r) => r.sort_order)).toEqual([0, 1]);
  });
  it("바뀐 것이 없어도 true", async () => {
    expect(await setTaskSortOrders({ organizationId: ORG, positions: new Map() })).toBe(true);
  });
  it("조회가 실패하면 false", async () => {
    state.fail["tasks:select"] = 1;
    expect(await setTaskSortOrders({ organizationId: ORG, positions: positions() })).toBe(false);
  });
  it("수정 중 하나라도 실패하면 false", async () => {
    state.fail["tasks:update"] = 1;
    expect(await setTaskSortOrders({ organizationId: ORG, positions: positions() })).toBe(false);
  });

  it("모바일 reorderTasks · 관리자 reorderConsoleTasks · reorderConsoleDateTasks 가 실패를 돌려준다", async () => {
    tasksState.scope = new Set(["a", "b"]);
    state.fail["tasks:update"] = -1;
    expect(await mobile.reorderTasks(["b", "a"])).toEqual({ ok: false, reason: "error" });
    expect(await admin.reorderConsoleTasks(["b", "a"])).toEqual({ ok: false, error: "save_failed" });
    expect(
      await admin.reorderConsoleDateTasks("2026-11-25", [
        { taskId: "b", recurring: false },
        { taskId: "a", recurring: false },
      ]),
    ).toEqual({ ok: false, error: "save_failed" });
  });
});

describe("C. 모바일 실패를 결과로 돌려준다", () => {
  beforeEach(() => {
    state.db.tasks = [{ id: "t-1", organization_id: ORG, due_at: "2026-11-20T00:00:00.000Z", deleted_at: null }];
    tasksState.visible = [taskRecord()];
  });

  it("rescheduleOverdueTo — 성공 / 쓰기 실패 / 잘못된 날짜 / 대상 없음", async () => {
    expect(await mobile.rescheduleOverdueTo("2026-11-30", ["t-1"])).toEqual({ ok: true });
    state.fail["tasks:update"] = 1;
    expect(await mobile.rescheduleOverdueTo("2026-12-01", ["t-1"])).toEqual({ ok: false });
    expect(await mobile.rescheduleOverdueTo("2026-13-01", ["t-1"])).toEqual({ ok: false });
    expect(await mobile.rescheduleOverdueTo("2026-12-01", ["nope"])).toEqual({ ok: false });
  });

  it("dismissOverdueTasks — 성공 / 쓰기 실패", async () => {
    state.fail["tasks:update"] = 1;
    expect(await mobile.dismissOverdueTasks(["t-1"])).toEqual({ ok: false });
    expect(await mobile.dismissOverdueTasks(["t-1"])).toEqual({ ok: true });
  });

  describe("skipOccurrenceOn", () => {
    beforeEach(() => {
      // 매일 반복, 앵커 2026-11-20.
      tasksState.detail = taskRecord({
        recurrenceRule: "daily",
        recurrenceInstanceDate: "2026-11-20",
      });
      state.db.task_occurrence_state = [];
    });
    it("저장되면 ok", async () => {
      expect(await mobile.skipOccurrenceOn("t-1", "2026-11-25")).toEqual({ ok: true });
    });
    it("저장이 실패하면 실패", async () => {
      state.fail["task_occurrence_state:upsert"] = 1;
      expect(await mobile.skipOccurrenceOn("t-1", "2026-11-25")).toEqual({ ok: false });
    });
    it("이미 건너뛴 회차는 같은 결과라 ok, 이미 완료한 회차는 실패", async () => {
      state.db.task_occurrence_state = [
        { task_id: "t-1", organization_id: ORG, occurrence_date: "2026-11-24", state: "skipped" },
        { task_id: "t-1", organization_id: ORG, occurrence_date: "2026-11-25", state: "completed" },
      ];
      expect(await mobile.skipOccurrenceOn("t-1", "2026-11-24")).toEqual({ ok: true });
      expect(await mobile.skipOccurrenceOn("t-1", "2026-11-25")).toEqual({ ok: false });
      expect(state.db.task_occurrence_state[1].state).toBe("completed");
    });
    it("회차가 아닌 날 · 회차 상태를 못 읽으면 실패", async () => {
      expect(await mobile.skipOccurrenceOn("t-1", "2026-11-19")).toEqual({ ok: false });
      // 읽기는 넣기가 막혔을 때(이미 행이 있을 때)만 한다(2026-11-25).
      state.db.task_occurrence_state = [
        { task_id: "t-1", organization_id: ORG, occurrence_date: "2026-11-25", state: "skipped" },
      ];
      state.fail["task_occurrence_state:select"] = 1;
      expect(await mobile.skipOccurrenceOn("t-1", "2026-11-25")).toEqual({ ok: false });
    });
  });

  it("restoreTasksInList — 대상 0건 · 쓰기 실패는 실패", async () => {
    state.db.tasks = [{ id: "t-1", organization_id: ORG, created_by_user_id: ME, project_id: null, deleted_at: "x" }];
    expect(await mobile.restoreTasksInList(["someone-else"])).toEqual({ ok: false });
    state.fail["tasks:update"] = 1;
    expect(await mobile.restoreTasksInList(["t-1"])).toEqual({ ok: false });
    expect(await mobile.restoreTasksInList(["t-1"])).toEqual({ ok: true });
    expect(state.db.tasks[0].deleted_at).toBeNull();
  });
});

describe("D. 오늘로 · 내일로는 작성자 · 프로젝트 주인 · 개발자만", () => {
  const form = () => {
    const f = new FormData();
    f.set("taskId", "t-1");
    f.set("view", "today");
    return f;
  };
  beforeEach(() => {
    state.db.tasks = [{ id: "t-1", organization_id: ORG, due_at: "2026-11-20T00:00:00.000Z" }];
  });

  it("공유받은 사람 · 프로젝트 멤버는 거절되고 아무것도 쓰지 않는다", async () => {
    tasksState.detail = taskRecord({ createdByUserId: PEER, projectId: "p1", projectOwnerUserId: PEER });
    expect(await redirectOf(mobile.moveTaskToToday(form()))).toBe("/mobile/tasks?view=today&moveError=forbidden");
    expect(await redirectOf(mobile.moveTaskToTomorrow(form()))).toBe(
      "/mobile/tasks?view=today&moveError=forbidden",
    );
    expect(await admin.moveConsoleToToday("t-1")).toEqual({ ok: false, error: "forbidden" });
    expect(await admin.moveConsoleToTomorrow("t-1")).toEqual({ ok: false, error: "forbidden" });
    expect(state.writes).toEqual([]);
  });

  it("작성자 · 프로젝트 주인은 옮긴다", async () => {
    tasksState.detail = taskRecord();
    expect(await redirectOf(mobile.moveTaskToToday(form()))).toBe("/mobile/tasks?view=today");
    tasksState.detail = taskRecord({ createdByUserId: PEER, projectId: "p1", projectOwnerUserId: ME });
    expect(await admin.moveConsoleToTomorrow("t-1")).toEqual({ ok: true });
  });

  it("모바일 이동은 조직 조건을 걸어 쓴다", async () => {
    tasksState.detail = taskRecord();
    state.db.tasks = [{ id: "t-1", organization_id: "org-2", due_at: null }];
    expect(await redirectOf(mobile.moveTaskToToday(form()))).toBe("/mobile/tasks?view=today&moveError=save_failed");
    expect(state.db.tasks[0].due_at).toBeNull();
  });
});

describe("E. 나간 작성자의 프로젝트 할 일 지우기 · 되살리기", () => {
  const me = { id: ME, role: "staff" };
  it("판정 — 개인 할 일 작성자는 범위와 상관없이, 프로젝트 할 일은 범위 안에서만", () => {
    expect(
      canDeleteOrRestoreTask(me, { createdByUserId: ME, projectId: null, projectOwnerUserId: null }, false),
    ).toBe(true);
    expect(
      canDeleteOrRestoreTask(me, { createdByUserId: ME, projectId: "p1", projectOwnerUserId: PEER }, false),
    ).toBe(false);
    expect(
      canDeleteOrRestoreTask(me, { createdByUserId: ME, projectId: "p1", projectOwnerUserId: PEER }, true),
    ).toBe(true);
    // 프로젝트 주인은 멤버 할 일을(범위 안).
    expect(
      canDeleteOrRestoreTask(me, { createdByUserId: PEER, projectId: "p1", projectOwnerUserId: ME }, true),
    ).toBe(true);
    // 남의 할 일 — 공유만 받은 사람은 안 된다.
    expect(
      canDeleteOrRestoreTask(me, { createdByUserId: PEER, projectId: null, projectOwnerUserId: null }, true),
    ).toBe(false);
    // 개발자는 범위 안에서만.
    const dev = { id: ME, role: "developer_super_admin" };
    expect(
      canDeleteOrRestoreTask(dev, { createdByUserId: PEER, projectId: null, projectOwnerUserId: null }, false),
    ).toBe(false);
    expect(
      canDeleteOrRestoreTask(dev, { createdByUserId: PEER, projectId: null, projectOwnerUserId: null }, true),
    ).toBe(true);
  });

  beforeEach(() => {
    state.db.tasks = [
      { id: "left", organization_id: ORG, created_by_user_id: ME, project_id: "p1", deleted_at: "x" },
      { id: "mine", organization_id: ORG, created_by_user_id: ME, project_id: null, deleted_at: "x" },
    ];
    state.db.projects = [{ id: "p1", organization_id: ORG, created_by_user_id: PEER }];
    tasksState.membership = new Map([["p1", { ownerUserId: PEER, memberIds: new Set([PEER]) }]]);
    // 나간 프로젝트 할 일은 범위 밖, 개인 할 일은 범위 밖이어도(혹시 참여자 행이 없어도) 되살린다.
    tasksState.scope = new Set();
  });

  it("모바일 — 나간 프로젝트 할 일은 일괄 삭제 · 되살리기 · 단건 되살리기에서 빠진다", async () => {
    expect(await mobile.restoreTask("left")).toEqual({ ok: false });
    expect(await mobile.restoreTasksInList(["left"])).toEqual({ ok: false });
    expect(await mobile.restoreTask("mine")).toEqual({ ok: true });
    state.db.tasks[0].deleted_at = null;
    expect(await mobile.deleteTasksInList(["left"])).toEqual({ deletedIds: [] });
    expect(state.db.tasks[0].deleted_at).toBeNull();
  });

  it("관리자 — 단건 · 일괄 되살리기에서 빠진다", async () => {
    expect(await admin.restoreConsoleTask("left")).toEqual({ ok: false, error: "forbidden" });
    expect(await admin.restoreConsoleTasks(["left"])).toEqual({ ok: false, error: "forbidden" });
    expect(await admin.restoreConsoleTasks(["mine"])).toEqual({ ok: true });
  });

  it("실제 범위 규칙(buildTaskScope) — 나간 프로젝트의 author 행은 범위에서 빠지고, 지우기 · 되살리기가 거절된다", async () => {
    // 나는 p1 을 나갔다(멤버 아님) — 내 author 행은 그대로 남아 있다.
    const scope = buildTaskScope({
      participantRows: [
        { taskId: "left", role: "author", projectId: "p1" },
        { taskId: "mine", role: "author", projectId: null },
      ],
      memberProjectIds: [],
      projectTaskIds: [],
    });
    expect(scope.taskIds.has("left")).toBe(false);
    tasksState.scope = scope.taskIds;
    expect(await mobile.restoreTask("left")).toEqual({ ok: false });
    expect(await admin.restoreConsoleTask("left")).toEqual({ ok: false, error: "forbidden" });
    state.db.tasks[0].deleted_at = null;
    expect(await mobile.deleteTasksInList(["left"])).toEqual({ deletedIds: [] });
    expect(state.db.tasks[0].deleted_at).toBeNull();
  });

  it("일괄 삭제 — 대상 읽기 · 쓰기 실패는 「지울 것 없음」과 구별해 failed 를 돌려준다", async () => {
    state.db.tasks[1].deleted_at = null;
    state.fail["tasks:select"] = 1;
    expect(await mobile.deleteTasksInList(["mine"])).toEqual({ deletedIds: [], failed: true });
    state.fail["tasks:update"] = 1;
    expect(await mobile.deleteTasksInList(["mine"])).toEqual({ deletedIds: [], failed: true });
    expect(await mobile.deleteTasksInList(["mine"])).toEqual({ deletedIds: ["mine"] });
  });

  it("아직 멤버라 범위 안이면 되살린다", async () => {
    tasksState.scope = new Set(["left"]);
    expect(await mobile.restoreTask("left")).toEqual({ ok: true });
  });
});

describe("F. 할 일 사진 라이트박스는 겹 화면 약속을 따른다", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../components/tasks/photo-gallery.tsx", import.meta.url), "utf8");
  const { photoKeys } = await import("@/components/tasks/photo-gallery");

  it("dialog · aria-modal · 이름 · 뒤로가기 겹 표시 · 캐러셀 스와이프 끄기", () => {
    expect(src).toMatch(/role="dialog"/);
    expect(src).toMatch(/aria-modal="true"/);
    expect(src).toMatch(/aria-label=\{title\}[\s\S]*data-native-back-overlay/);
    expect(src).toMatch(/data-native-back-overlay/);
    expect(src).toMatch(/data-swipe-back="off"/);
  });
  it("목록 key 는 순번이 아니라 주소(같은 주소는 몇 번째인지 덧붙임)", () => {
    expect(src).not.toMatch(/key=\{i\}/);
    expect(photoKeys(["a", "b", "a"])).toEqual(["a#0", "b#0", "a#1"]);
  });
});
