import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 할 일 점검 묶음 2 (2026-11-25).
 *  1. PC 콘솔은 바꾼 칸만 보낸다 — 다른 사람이 고친 값을 낡은 값으로 되돌리지 않는다.
 *  2. 완료된 일회성을 반복으로 바꾸면 행이 열림으로 돌아간다(목록에서 사라지지 않게).
 *  3. 건너뛰기 · 반복 완료는 «없을 때만 넣기» 쓰기 한 번으로 판정한다(읽기 → 쓰기 사이 끼어들기).
 *  4. 일회성 완료 실행 취소는 완료 전 상태(진행 중)로 돌아간다.
 *  5. 완료 이력은 1,000행에서 잘리지 않는다.
 *  6. 프로젝트 섹션 이름 바꾸기는 공용 BottomSheet(Esc 로 닫힘).
 *  7. 일정 팝오버의 시각은 공용 AdminTimePicker.
 */

type Row = Record<string, unknown>;
type Op = "select" | "update" | "delete" | "insert" | "upsert";

/** PostgREST 의 한 번 읽기 상한. */
const MAX_ROWS = 1000;

const state = {
  db: {} as Record<string, Row[]>,
  writes: [] as Array<{ table: string; op: Op; payload: unknown }>,
  /** 다음 쓰기 직전에 한 번 부른다 — 다른 사람의 쓰기가 끼어드는 순간. */
  beforeWrite: null as null | ((table: string, op: Op) => void),
  /** 저장소에서 지운 경로. */
  removed: [] as string[],
};

function makeQuery(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: Op = "select";
  let payload: Row | Row[] | null = null;
  let ignoreDuplicates = false;
  let limitTo: number | null = null;
  const rows = () => (state.db[table] ??= []);
  const match = (r: Row) => filters.every((f) => f(r));
  const run = () => {
    if (op === "select") {
      const hit = rows().filter(match);
      return { data: hit.slice(0, Math.min(limitTo ?? MAX_ROWS, MAX_ROWS)), error: null };
    }
    if (state.beforeWrite) {
      const hook = state.beforeWrite;
      state.beforeWrite = null;
      hook(table, op);
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
    const written: Row[] = [];
    for (const p of list) {
      const hit =
        op === "upsert"
          ? rows().find((r) => r.task_id === p.task_id && r.occurrence_date === p.occurrence_date)
          : undefined;
      if (hit) {
        if (ignoreDuplicates) continue;
        Object.assign(hit, p);
        written.push({ ...hit });
      } else {
        rows().push({ ...p });
        written.push({ ...p });
      }
    }
    return { data: written, error: null };
  };
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
    neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), q),
    in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), q),
    is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), q),
    gte: (k: string, v: string) => (filters.push((r) => String(r[k]) >= v), q),
    lte: (k: string, v: string) => (filters.push((r) => String(r[k]) <= v), q),
    gt: (k: string, v: string) => (filters.push((r) => String(r[k]) > v), q),
    overlaps: () => q,
    order: () => q,
    range: () => q,
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
  storage: {
    from: () => ({
      remove: async (paths: string[]) => (state.removed.push(...paths), { error: null }),
    }),
  },
};

const ORG = "org-1";
const ME = "u-me";
const PEER = "u-peer";
const session = { user: { id: ME, role: "staff" }, organization: { id: ORG } };
const tasksState = { detail: null as Row | null };

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
  return { ...actual, getTaskDetail: async () => tasksState.detail };
});

const { recurringRowStatusPatch, reopenedRowStatus } = await import("@/lib/tasks-recurrence");
const { getTaskCompletions } = await import("@/lib/tasks");
const mobile = await import("@/app/mobile/tasks/[id]/actions");
const admin = await import("@/app/admin/tasks/actions");

beforeEach(() => {
  state.db = {};
  state.writes = [];
  state.beforeWrite = null;
  state.removed = [];
  tasksState.detail = null;
});

function taskDetail(over: Row = {}): Row {
  return {
    id: "t-1",
    organizationId: ORG,
    createdByUserId: ME,
    title: "할 일",
    description: null,
    status: "open",
    priority: "normal",
    tags: [],
    imageUrls: [],
    projectId: null,
    projectOwnerUserId: null,
    recurrenceRule: null,
    recurrenceSeriesId: null,
    recurrenceInstanceDate: null,
    dueAt: "2026-11-20T00:00:00.000Z",
    scheduledDate: null,
    timeLabel: null,
    durationMinutes: null,
    participants: [{ userId: PEER, role: "assignee" }],
    ...over,
  };
}

function seedTask(detail: Row, row: Row = {}) {
  tasksState.detail = detail;
  state.db.tasks = [
    {
      id: detail.id,
      organization_id: ORG,
      title: detail.title,
      description: detail.description,
      status: detail.status,
      priority: detail.priority,
      tags: detail.tags,
      image_urls: detail.imageUrls,
      recurrence_rule: detail.recurrenceRule,
      ...row,
    },
  ];
}

const taskRow = () => state.db.tasks[0];
const updatePayloads = () =>
  state.writes.filter((w) => w.table === "tasks" && w.op === "update").map((w) => w.payload as Row);

describe("1. PC 콘솔은 바꾼 칸만 보낸다", () => {
  it("우선순위만 보내면 제목 · 본문 · 태그 · 일정은 쓰지 않는다", async () => {
    seedTask(taskDetail());
    // 화면이 들고 있는 값은 낡았고, 그 사이 다른 사람이 제목을 바꿨다.
    taskRow().title = "다른 사람이 고친 제목";
    const res = await admin.updateConsoleTaskCore({ taskId: "t-1", priority: "urgent" });
    expect(res.ok).toBe(true);
    expect(updatePayloads()).toEqual([{ priority: "urgent" }]);
    expect(taskRow().title).toBe("다른 사람이 고친 제목");
  });

  it("연결만 보내면 연결 칸만 쓴다", async () => {
    seedTask(taskDetail());
    const res = await admin.updateConsoleTaskCore({
      taskId: "t-1",
      context: { propertyId: null, roomId: null, reservationId: null, guestName: "Kim" },
    });
    expect(res.ok).toBe(true);
    const [payload] = updatePayloads();
    expect(payload.guest_name).toBe("Kim");
    expect(Object.keys(payload)).not.toContain("title");
    expect(Object.keys(payload)).not.toContain("due_at");
    expect(Object.keys(payload)).not.toContain("priority");
  });

  it("일정 칸은 한 묶음으로만 받는다", async () => {
    seedTask(taskDetail());
    const res = await admin.updateConsoleTaskCore({ taskId: "t-1", date: "2026-11-30" });
    expect(res).toEqual({ ok: false, error: "invalid_date" });
    expect(updatePayloads()).toEqual([]);
  });

  it("빈 제목은 받지 않는다", async () => {
    seedTask(taskDetail());
    expect(await admin.updateConsoleTaskCore({ taskId: "t-1", title: "  " })).toEqual({
      ok: false,
      error: "missing_title",
    });
  });

  it("사진은 변화분을 서버의 최신 목록에 적용한다 — 그 사이 다른 사람이 붙인 사진을 지우지 않는다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    const base = "https://example.supabase.co/storage/v1/object/public/request-images";
    const a = `${base}/${ORG}/task-images/t-1/a.jpg`;
    const b = `${base}/${ORG}/task-images/t-1/b.jpg`;
    const fresh = `${base}/${ORG}/task-images/t-1/peer.jpg`;
    const mine = `${base}/${ORG}/task-images/t-1/new.jpg`;
    // 서버의 최신 목록 — 화면이 편집을 연 뒤 다른 사람이 peer.jpg 를 붙였다.
    seedTask(taskDetail({ imageUrls: [a, b, fresh] }));
    const res = await admin.updateConsoleTaskCore({
      taskId: "t-1",
      title: "할 일",
      removeImageUrls: [b],
      addImageUrls: [mine],
    });
    expect(res.ok).toBe(true);
    expect(taskRow().image_urls).toEqual([a, fresh, mine]);
  });

  it("화면 — 우선순위 · 연결 · 사진 추가 · 코어 편집이 일정 칸을 다시 보내지 않는다", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/components/admin/tasks/admin-tasks-console.tsx"),
      "utf8",
    );
    const calls = src.split("updateConsoleTaskCore({").slice(1).map((c) => c.slice(0, 400));
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const call of calls) {
      const body = call.slice(0, call.indexOf("})"));
      expect(body).not.toMatch(/\brepeat:|\bdate:|durationMinutes:/);
    }
  });
});

describe("2. 완료된 일회성을 반복으로 바꾸면 열림으로", () => {
  it("판정 — 반복이 되는 완료 · 진행 중 행만 열림 + 완료 도장 지움", () => {
    expect(recurringRowStatusPatch("daily", "completed")).toEqual({
      status: "open",
      completed_at: null,
      completed_by_user_id: null,
    });
    expect(recurringRowStatusPatch("custom:1,3", "in_progress")).toEqual({
      status: "open",
      completed_at: null,
      completed_by_user_id: null,
    });
    expect(recurringRowStatusPatch("daily", "open")).toEqual({});
    expect(recurringRowStatusPatch("daily", "cancelled")).toEqual({});
    expect(recurringRowStatusPatch(null, "completed")).toEqual({});
  });

  it("관리자 코어 편집 · 일정 변경이 행을 열림으로 돌린다", async () => {
    for (const run of [
      () =>
        admin.updateConsoleTaskCore({
          taskId: "t-1",
          date: "2026-11-25",
          time: "",
          durationMinutes: null,
          repeat: "daily",
        }),
      () =>
        admin.rescheduleConsoleTask("t-1", {
          date: "2026-11-25",
          time: "",
          durationMinutes: null,
          repeat: "daily",
        }),
    ]) {
      seedTask(taskDetail({ status: "completed" }), {
        completed_at: "2026-11-20T01:00:00.000Z",
        completed_by_user_id: ME,
      });
      expect((await run()).ok).toBe(true);
      expect(taskRow()).toMatchObject({
        status: "open",
        recurrence_rule: "daily",
        completed_at: null,
        completed_by_user_id: null,
      });
    }
  });

  it("모바일 수정 폼도 같다", async () => {
    seedTask(taskDetail({ status: "completed" }));
    const fd = new FormData();
    fd.set("taskId", "t-1");
    fd.set("title", "할 일");
    fd.set("dueDate", "2026-11-25");
    fd.set("repeat", "daily");
    fd.set("priority", "normal");
    await mobile.updateTaskCore(fd).catch(() => {});
    expect(taskRow()).toMatchObject({ status: "open", recurrence_rule: "daily" });
  });
});

describe("3. 건너뛰기 · 반복 완료는 쓰기 한 번으로 판정한다", () => {
  const recurring = () => taskDetail({ recurrenceRule: "daily", dueAt: "2026-11-01T00:00:00.000Z" });
  const completedRow = (date: string) => ({
    task_id: "t-1",
    organization_id: ORG,
    occurrence_date: date,
    state: "completed",
    completed_by_user_id: PEER,
    moved_to_date: null,
  });
  const occState = (date: string) =>
    (state.db.task_occurrence_state ?? []).find((r) => r.occurrence_date === date)?.state;

  it("모바일 — 건너뛰기 쓰기 직전에 들어온 완료를 «건너뜀»으로 덮지 않는다", async () => {
    tasksState.detail = recurring();
    state.beforeWrite = () => state.db.task_occurrence_state.push(completedRow("2026-11-10"));
    state.db.task_occurrence_state = [];
    expect(await mobile.skipOccurrenceOn("t-1", "2026-11-10")).toEqual({ ok: false });
    expect(occState("2026-11-10")).toBe("completed");
  });

  it("관리자 — 같은 경우 already_resolved, 완료는 그대로", async () => {
    tasksState.detail = recurring();
    state.db.task_occurrence_state = [];
    state.beforeWrite = () => state.db.task_occurrence_state.push(completedRow("2026-11-10"));
    expect(await admin.skipConsoleOccurrence("t-1", "2026-11-10")).toEqual({
      ok: false,
      error: "already_resolved",
    });
    expect(occState("2026-11-10")).toBe("completed");
  });

  it("빈 회차는 건너뛰고, 이미 건너뛴 회차는 같은 결과라 ok", async () => {
    tasksState.detail = recurring();
    state.db.task_occurrence_state = [];
    expect(await mobile.skipOccurrenceOn("t-1", "2026-11-10")).toEqual({ ok: true });
    expect(occState("2026-11-10")).toBe("skipped");
    expect(await mobile.skipOccurrenceOn("t-1", "2026-11-10")).toEqual({ ok: true });
    expect((await admin.skipConsoleOccurrence("t-1", "2026-11-10")).ok).toBe(true);
  });

  it("반복 완료 — 쓰기 직전에 다른 사람이 완료했으면 완료 기록 · 알림을 다시 남기지 않는다", async () => {
    for (const run of [
      () => mobile.completeTask("t-1", "2026-11-10"),
      () => admin.toggleConsoleComplete("t-1", true, "2026-11-10"),
    ]) {
      tasksState.detail = recurring();
      state.db.task_occurrence_state = [];
      state.writes = [];
      state.beforeWrite = (table) => {
        if (table === "task_occurrence_state") state.db.task_occurrence_state.push(completedRow("2026-11-10"));
      };
      expect((await run()).ok).toBe(true);
      const logs = state.writes.filter(
        (w) => w.table === "task_updates" && (w.payload as Row).update_type === "completed",
      );
      expect(logs).toEqual([]);
      expect(state.db.task_occurrence_state.find((r) => r.occurrence_date === "2026-11-10")?.completed_by_user_id).toBe(PEER);
    }
  });

  it("건너뛴 회차를 완료하면 완료로 바뀌고 기록이 남는다", async () => {
    tasksState.detail = recurring();
    state.db.task_occurrence_state = [{ ...completedRow("2026-11-10"), state: "skipped" }];
    expect((await mobile.completeTask("t-1", "2026-11-10")).ok).toBe(true);
    expect(occState("2026-11-10")).toBe("completed");
    expect(
      state.writes.some((w) => w.table === "task_updates" && (w.payload as Row).update_type === "completed"),
    ).toBe(true);
  });
});

describe("4. 일회성 완료 실행 취소는 완료 전 상태로", () => {
  it("판정 — 진행 중만 그대로, 나머지는 열림", () => {
    expect(reopenedRowStatus("in_progress")).toBe("in_progress");
    expect(reopenedRowStatus("completed")).toBe("open");
    expect(reopenedRowStatus("cancelled")).toBe("open");
    expect(reopenedRowStatus(undefined)).toBe("open");
  });

  it("모바일 · 관리자 되돌리기가 넘겨받은 진행 중으로 돌아간다", async () => {
    for (const run of [
      () => mobile.reopenTask("t-1", undefined, "in_progress"),
      () => admin.toggleConsoleComplete("t-1", false, undefined, "in_progress"),
    ]) {
      seedTask(taskDetail({ status: "completed" }));
      expect((await run()).ok).toBe(true);
      expect(taskRow().status).toBe("in_progress");
    }
  });

  it("넘기지 않으면 예전처럼 열림", async () => {
    seedTask(taskDetail({ status: "completed" }));
    await mobile.reopenTask("t-1");
    expect(taskRow().status).toBe("open");
  });

  it("화면 — 실행 취소가 완료 전 상태를 넘긴다", () => {
    const ws = readFileSync(path.join(process.cwd(), "src/components/tasks/tasks-workspace.tsx"), "utf8");
    expect(ws).toMatch(/reopenTask\(task\.id, occurrenceDate, tracked\.restoreStatus\)/);
    expect(ws).toMatch(/trackCompletedFrom\(completedFrom\.current, task\.id, false, task\.status\)/);
    expect(ws).toMatch(/recorded\.occurrenceDate \?\? undoOcc \?\? undefined,\s*undoTracked\.restoreStatus,/);
    const pc = readFileSync(
      path.join(process.cwd(), "src/components/admin/tasks/admin-tasks-console.tsx"),
      "utf8",
    );
    expect(pc).toMatch(/trackCompletedFrom\(completedFrom\.current, t\.id, false, t\.status\)/);
    expect(pc).toMatch(/toggleConsoleComplete\(t\.id, false, res\.occurrenceDate \?\? occDate, undoTracked\.restoreStatus\)/);
  });
});

describe("5. 완료 이력은 1,000행에서 잘리지 않는다", () => {
  it("1,500건을 끝까지 읽는다", async () => {
    // 작업 100개 × 15일 — (작업, 도쿄 날짜)마다 한 건.
    const noon = new Date(`${new Date().toISOString().slice(0, 10)}T03:00:00.000Z`).getTime();
    state.db.task_participants = Array.from({ length: 100 }, (_, t) => ({
      user_id: ME,
      task_id: `t-${String(t).padStart(3, "0")}`,
      role: "assignee",
    }));
    state.db.project_participants = [];
    state.db.task_updates = [];
    for (let i = 0; i < 1500; i += 1) {
      state.db.task_updates.push({
        id: `u-${String(i).padStart(5, "0")}`,
        task_id: `t-${String(i % 100).padStart(3, "0")}`,
        update_type: "completed",
        created_at: new Date(noon - Math.floor(i / 100) * 86_400_000).toISOString(),
        created_by_user_id: ME,
      });
    }
    const out = await getTaskCompletions(session as never);
    expect(out).toHaveLength(1500);
  });

  it("같은 날 완료 → 다시 열기는 시각 순으로 상쇄된다(id 순과 달라도)", async () => {
    const at = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    state.db.task_participants = [{ user_id: ME, task_id: "t-1", role: "assignee" }];
    state.db.project_participants = [];
    state.db.task_updates = [
      // id 순서로는 다시 열기가 먼저지만 시각은 완료 → 다시 열기 → 완료.
      { id: "a", task_id: "t-1", update_type: "reopened", created_at: at(20), created_by_user_id: ME },
      { id: "b", task_id: "t-1", update_type: "completed", created_at: at(10), created_by_user_id: PEER },
      { id: "c", task_id: "t-1", update_type: "completed", created_at: at(30), created_by_user_id: ME },
    ];
    const out = await getTaskCompletions(session as never);
    expect(out).toHaveLength(1);
    expect(out[0].byUserId).toBe(PEER);
  });
});

describe("6 · 7. 화면 약속", () => {
  it("섹션 이름 바꾸기는 공용 BottomSheet — 손으로 만든 포털 · 가운데 창이 없다", () => {
    const src = readFileSync(path.join(process.cwd(), "src/components/tasks/project-detail-view.tsx"), "utf8");
    expect(src).not.toMatch(/createPortal/);
    const block = src.slice(src.indexOf("{renameTarget ? ("), src.indexOf("{/* 프로젝트 삭제 확인 */}"));
    expect(block).toMatch(/<BottomSheet ariaLabel=\{p\.renameSectionTitle\}/);
  });

  it("관리자 할 일 콘솔에 브라우저 기본 시계가 없다", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/components/admin/tasks/admin-tasks-console.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/type="time"/);
    expect(src).toMatch(/<AdminTimePicker ariaLabel=\{dict\.schTime\}/);
  });
});

describe("묶음 2 다듬기", () => {
  const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

  it("관리자 홈 할 일 카드 — 실행 취소가 완료 전 상태를 넘긴다", () => {
    expect(read("src/lib/admin-dashboard.ts")).toMatch(/status: t\.status,/);
    const card = read("src/components/admin/dashboard-todos.tsx");
    expect(card).toMatch(/toggleConsoleComplete\(t\.id, done, t\.occurrenceDate, tracked\.restoreStatus\)/);
    expect(card).toMatch(/save\(undo, !undo\.done, false, undo\.prevStatus\)/);
  });

  it("일정 묶음에 소요 시간도 든다 — 빠지면 invalid_date", async () => {
    seedTask(taskDetail());
    expect(
      await admin.updateConsoleTaskCore({ taskId: "t-1", date: "2026-11-30", time: "10:00", repeat: "none" }),
    ).toEqual({ ok: false, error: "invalid_date" });
    expect(await admin.updateConsoleTaskCore({ taskId: "t-1", durationMinutes: 30 })).toEqual({
      ok: false,
      error: "invalid_date",
    });
    expect(updatePayloads()).toEqual([]);
    const ok = await admin.updateConsoleTaskCore({
      taskId: "t-1",
      date: "2026-11-30",
      time: "10:00",
      durationMinutes: 30,
      repeat: "none",
    });
    expect(ok.ok).toBe(true);
    expect(taskRow().duration_minutes).toBe(30);
  });

  it("한도를 넘어 버린 새 사진은 장수를 돌려주고 올라간 파일을 지운다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    const base = "https://example.supabase.co/storage/v1/object/public/request-images";
    const have = [1, 2, 3, 4, 5].map((n) => `${base}/${ORG}/task-images/t-1/${n}.jpg`);
    const extra = `${base}/${ORG}/task-images/t-1/extra.jpg`;
    // 화면이 4장일 때 붙였는데 그 사이 다른 사람이 5장째를 붙였다.
    seedTask(taskDetail({ imageUrls: have }));
    const res = await admin.updateConsoleTaskCore({ taskId: "t-1", addImageUrls: [extra] });
    expect(res).toMatchObject({ ok: true, droppedImages: 1 });
    expect(taskRow().image_urls).toEqual(have);
    expect(state.removed).toEqual([`${ORG}/task-images/t-1/extra.jpg`]);
  });

  it("화면 — 버린 사진이 있으면 phTooMany 로 안내한다", () => {
    const src = read("src/components/admin/tasks/admin-tasks-console.tsx");
    expect(src.match(/res\.droppedImages \? fill\(dict\.phTooMany/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("핵심 편집 — 바뀐 칸만, 바뀐 게 없으면 빈 묶음", async () => {
    const { changedCoreFields } = await import("@/components/admin/tasks/helpers");
    const start = { title: "제목", desc: "본문", tags: ["a", "b"] };
    expect(changedCoreFields(start, { title: " 제목 ", desc: "본문", tags: ["a", "b"] })).toEqual({});
    expect(changedCoreFields(start, { title: "새 제목", desc: "본문", tags: ["a", "b"] })).toEqual({
      title: "새 제목",
    });
    expect(changedCoreFields(start, { title: "제목", desc: "", tags: ["a"] })).toEqual({ desc: "", tags: ["a"] });
    const src = read("src/components/admin/tasks/admin-tasks-console.tsx");
    expect(src).toMatch(/changedCoreFields\(coreEditStart\.current, draft\)/);
  });
});

describe("묶음 2 마지막 손질", () => {
  const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");
  const base = "https://example.supabase.co/storage/v1/object/public/request-images";

  it("방금 완료한 일회성은 체크를 다시 눌러 풀어도 완료 전 상태로", async () => {
    const { trackCompletedFrom } = await import("@/lib/tasks-recurrence");
    let mem: Record<string, string> = {};
    // 진행 중 → 완료
    ({ memory: mem } = trackCompletedFrom(mem, "t-1", true, "in_progress"));
    // 체크 다시 눌러 풀기 — 줄의 상태는 이미 완료
    const off = trackCompletedFrom(mem, "t-1", false, "completed");
    expect(off.restoreStatus).toBe("in_progress");
    mem = off.memory;
    // 실행 취소처럼 누르기 전 기록을 넘기면 그 값
    expect(trackCompletedFrom({}, "t-2", false, "in_progress").restoreStatus).toBe("in_progress");
    // 예전에 완료된 것 — 기억이 없으면 열림(넘길 값 없음)
    expect(trackCompletedFrom({}, "t-3", false, "completed").restoreStatus).toBeUndefined();
  });

  it("화면 — 관리자 홈 · 콘솔 · 모바일 목록이 같은 기억을 쓴다", () => {
    for (const rel of [
      "src/components/admin/dashboard-todos.tsx",
      "src/components/admin/tasks/admin-tasks-console.tsx",
      "src/components/tasks/tasks-workspace.tsx",
    ]) {
      expect(read(rel)).toMatch(/trackCompletedFrom\(/);
    }
  });

  it("버린 사진 — 같은 주소는 한 번만 센다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    const have = [1, 2, 3, 4, 5].map((n) => `${base}/${ORG}/task-images/t-1/${n}.jpg`);
    const extra = `${base}/${ORG}/task-images/t-1/extra.jpg`;
    seedTask(taskDetail({ imageUrls: have }));
    const res = await admin.updateConsoleTaskCore({ taskId: "t-1", addImageUrls: [extra, extra] });
    expect(res).toMatchObject({ ok: true, droppedImages: 1 });
    expect(state.removed).toEqual([`${ORG}/task-images/t-1/extra.jpg`]);
  });

  it("버린 사진 — 조직 밖 주소는 한도 초과로 세지 않고 지우기 후보에도 넣지 않는다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    const foreign = `${base}/org-2/task-images/t-9/x.jpg`;
    seedTask(taskDetail({ imageUrls: [] }));
    const res = await admin.updateConsoleTaskCore({ taskId: "t-1", addImageUrls: [foreign] });
    expect(res.ok).toBe(true);
    expect(res).not.toHaveProperty("droppedImages");
    expect(state.removed).toEqual([]);
  });

  it("changedCoreFields — 없음 · 빈 문자열 · 태그 순서 · 줄바꿈 든 태그", async () => {
    const { changedCoreFields } = await import("@/components/admin/tasks/helpers");
    const start = { title: "제목", desc: null, tags: ["a", "b"] };
    expect(changedCoreFields(start, { title: "제목", desc: "", tags: ["a", "b"] })).toEqual({});
    expect(changedCoreFields(start, { title: "제목", desc: "  ", tags: ["a", "b"] })).toEqual({});
    expect(changedCoreFields(start, { title: "제목", desc: "", tags: ["b", "a"] })).toEqual({ tags: ["b", "a"] });
    expect(
      changedCoreFields({ title: "제목", desc: "", tags: ["a\nb"] }, { title: "제목", desc: "", tags: ["a", "b"] }),
    ).toEqual({ tags: ["a", "b"] });
  });
});

describe("완료 전 상태 기억 — 끝맺음", () => {
  const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

  it("풀기 뒤에는 그 id 기억을 지운다 — 나중에 남이 완료한 줄을 풀 때 낡은 진행 중을 쓰지 않는다", async () => {
    const { trackCompletedFrom } = await import("@/lib/tasks-recurrence");
    const done = trackCompletedFrom({}, "t-1", true, "in_progress").memory;
    const off = trackCompletedFrom(done, "t-1", false, "completed");
    expect(off.restoreStatus).toBe("in_progress");
    expect(off.memory).toEqual({});
    expect(trackCompletedFrom(off.memory, "t-1", false, "completed").restoreStatus).toBeUndefined();
  });

  it("완료가 실패하면 그 id 기억을 지운다", async () => {
    const { trackCompletedFrom, forgetCompletedFrom } = await import("@/lib/tasks-recurrence");
    const done = trackCompletedFrom({ "t-2": "in_progress" }, "t-1", true, "in_progress").memory;
    expect(forgetCompletedFrom(done, "t-1")).toEqual({ "t-2": "in_progress" });
  });

  it("화면 — 세 곳 모두 완료 실패 때 기억을 지운다", () => {
    for (const rel of [
      "src/components/admin/dashboard-todos.tsx",
      "src/components/admin/tasks/admin-tasks-console.tsx",
      "src/components/tasks/tasks-workspace.tsx",
    ]) {
      expect(read(rel)).toMatch(/forgetCompletedFrom\(/);
    }
  });

  it("되돌리기는 지금 완료일 때만 — 이미 열린 줄을 늦게 온 풀기가 진행 중으로 덮지 않는다", async () => {
    for (const run of [
      () => mobile.reopenTask("t-1", undefined, "in_progress"),
      () => admin.toggleConsoleComplete("t-1", false, undefined, "in_progress"),
    ]) {
      seedTask(taskDetail({ status: "open" }));
      state.writes = [];
      expect((await run()).ok).toBe(true);
      expect(taskRow().status).toBe("open");
      expect(state.writes.filter((w) => w.table === "task_updates")).toEqual([]);
    }
  });
});
