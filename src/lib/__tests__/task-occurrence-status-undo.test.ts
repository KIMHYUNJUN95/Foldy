import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 반복 할 일 회차 대상 회귀 (2026-10-19, #14).
 *  a. 콘솔 상세의 상태 버튼은 **연 회차**를 완료한다 — 시리즈 앵커(첫 회차)로 폴백하지 않는다.
 *  b. 회차가 아닌 날 완료하면 서버가 가장 최근 밀린 회차로(2026-10-28 전에는 가장 오래된 것) 정산하므로, 그 **기록된 날짜**를
 *     돌려주고 실행 취소가 그 날짜를 되살린다.
 *  c. 프로젝트에서 빠져 상한이 5장이 된 할 일을 고쳐도 기존 사진을 자르거나 스토리지에서 지우지 않는다.
 */

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const removedPaths: string[] = [];

function makeQuery(table: string) {
  const filters: Array<[string, unknown]> = [];
  // `.overlaps(col, values)` — 배열 칼럼이 values 와 하나라도 겹치는 행(cleanupRemovedTaskImages 의 참조 확인).
  const overlapFilters: Array<[string, unknown[]]> = [];
  // `.neq(col, v)` — 한 번만 완료되게 거는 조건부 갱신(2026-10-28).
  const negFilters: Array<[string, unknown]> = [];
  let op: "select" | "update" | "delete" | "insert" | "upsert" = "select";
  let payload: Row | Row[] | null = null;
  const rows = () => (db[table] ??= []);
  const match = (r: Row) =>
    filters.every(([k, v]) => r[k] === v) &&
    negFilters.every(([k, v]) => r[k] !== v) &&
    overlapFilters.every(([k, vs]) => Array.isArray(r[k]) && (r[k] as unknown[]).some((x) => vs.includes(x)));
  const run = () => {
    if (op === "select") return { data: rows().filter(match), error: null };
    if (op === "update") {
      const hit = rows().filter(match);
      for (const r of hit) Object.assign(r, payload);
      // `.update(...).select("id")` 는 바뀐 행을 돌려준다.
      return { data: hit.map((r) => ({ ...r })), error: null };
    }
    if (op === "delete") {
      db[table] = rows().filter((r) => !match(r));
      return { data: null, error: null };
    }
    const list = Array.isArray(payload) ? payload : [payload as Row];
    for (const p of list) {
      if (op === "upsert") {
        const hit = rows().find((r) => r.task_id === p.task_id && r.occurrence_date === p.occurrence_date);
        if (hit) {
          Object.assign(hit, p);
          continue;
        }
      }
      rows().push({ ...p });
    }
    return { data: null, error: null };
  };
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => {
      filters.push([k, v]);
      return q;
    },
    neq: (k: string, v: unknown) => {
      negFilters.push([k, v]);
      return q;
    },
    maybeSingle: async () => {
      const r = run();
      return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: null };
    },
    overlaps: (k: string, vs: unknown[]) => {
      overlapFilters.push([k, vs]);
      return q;
    },
    update: (p: Row) => {
      op = "update";
      payload = p;
      return q;
    },
    delete: () => {
      op = "delete";
      return q;
    },
    insert: (p: Row | Row[]) => {
      op = "insert";
      payload = p;
      return q;
    },
    upsert: (p: Row | Row[]) => {
      op = "upsert";
      payload = p;
      return q;
    },
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(run()).then(resolve, reject),
  };
  return q;
}

const fakeClient = {
  from: (table: string) => makeQuery(table),
  storage: {
    from: () => ({
      remove: async (paths: string[]) => {
        removedPaths.push(...paths);
        return { error: null };
      },
    }),
  },
};

const ORG = "org-1";
const ME = "u-me";
const session = { user: { id: ME }, organization: { id: ORG } };
let currentTask: Record<string, unknown> = {};

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => fakeClient }));
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
  return { ...actual, getTaskDetail: async () => currentTask };
});

const { setConsoleTaskStatus, toggleConsoleComplete, updateConsoleTaskCore } = await import(
  "@/app/admin/tasks/actions"
);

// 월 · 수 · 금 반복, 시작 2026-10-05(월).
function recurringTask(): Record<string, unknown> {
  return {
    id: "t-1",
    title: "재고 확인",
    description: null,
    status: "open",
    priority: "normal",
    tags: [],
    imageUrls: [],
    projectId: null,
    createdByUserId: ME,
    participants: [],
    recurrenceRule: "custom:1,3,5",
    recurrenceSeriesId: "t-1",
    recurrenceInstanceDate: "2026-10-05",
    scheduledDate: "2026-10-05",
    dueAt: null,
    timeLabel: null,
    durationMinutes: null,
  };
}

function occRows() {
  return (db.task_occurrence_state ?? []).map((r) => `${r.occurrence_date}:${r.state}`).sort();
}

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  removedPaths.length = 0;
  db.tasks = [{ id: "t-1", organization_id: ORG }];
  currentTask = recurringTask();
});

describe("a. 상태 버튼은 연 회차를 완료한다", () => {
  it("넘긴 회차(10-14 수)에 기록하고 첫 회차(10-05)는 건드리지 않는다", async () => {
    db.task_occurrence_state = ["2026-10-05", "2026-10-07", "2026-10-09", "2026-10-12"].map((d) => ({
      task_id: "t-1",
      occurrence_date: d,
      state: "completed",
    }));
    const res = await setConsoleTaskStatus("t-1", "completed", "2026-10-14");
    expect(res).toMatchObject({ ok: true, occurrenceDate: "2026-10-14" });
    expect(occRows()).toContain("2026-10-14:completed");
  });

  it("완료된 회차를 대기로 — 그 회차만 되살린다", async () => {
    db.task_occurrence_state = [
      { task_id: "t-1", occurrence_date: "2026-10-05", state: "completed" },
      { task_id: "t-1", occurrence_date: "2026-10-14", state: "completed" },
    ];
    await setConsoleTaskStatus("t-1", "open", "2026-10-14");
    expect(occRows()).toEqual(["2026-10-05:completed"]);
  });

  it("진행 중인 미완료 회차를 대기로 — 행 status 를 open 으로", async () => {
    currentTask = { ...recurringTask(), status: "in_progress" };
    db.tasks = [{ id: "t-1", organization_id: ORG, status: "in_progress" }];
    await setConsoleTaskStatus("t-1", "open", "2026-10-14");
    expect(db.tasks[0].status).toBe("open");
  });
});

describe("b. 회차가 아닌 날 완료 → 실행 취소", () => {
  it("화요일(10-13) 완료는 밀린 월요일(10-12)로 기록되고, 그 날짜로 되돌리면 풀린다", async () => {
    db.task_occurrence_state = ["2026-10-05", "2026-10-07", "2026-10-09"].map((d) => ({
      task_id: "t-1",
      occurrence_date: d,
      state: "completed",
    }));
    const res = await toggleConsoleComplete("t-1", true, "2026-10-13");
    expect(res).toMatchObject({ ok: true, occurrenceDate: "2026-10-12" });
    expect(occRows()).toContain("2026-10-12:completed");

    // 예전 실행 취소: 누른 날짜(10-13)로 → 아무것도 안 풀린다(버그 재현).
    await toggleConsoleComplete("t-1", false, "2026-10-13");
    expect(occRows()).toContain("2026-10-12:completed");

    // 고친 실행 취소: 서버가 돌려준 날짜로.
    await toggleConsoleComplete("t-1", false, res.ok ? res.occurrenceDate : undefined);
    expect(occRows()).not.toContain("2026-10-12:completed");
  });
});

describe("c. 상한이 줄어든 할 일의 사진", () => {
  const base = "https://example.supabase.co/storage/v1/object/public/request-images";
  const photos = Array.from({ length: 15 }, (_, i) => `${base}/${ORG}/task-images/t-1/p${i}.jpg`);

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    currentTask = { ...recurringTask(), recurrenceRule: null, recurrenceSeriesId: null, imageUrls: photos };
    db.tasks = [{ id: "t-1", organization_id: ORG, image_urls: photos }];
  });

  const edit = (imageUrls: string[]) =>
    updateConsoleTaskCore({
      taskId: "t-1",
      title: "수정",
      desc: "",
      date: "2026-10-20",
      time: "",
      durationMinutes: null,
      repeat: "none",
      priority: "normal",
      tags: [],
      imageUrls,
    });

  it("프로젝트 밖(상한 5)에서 15장 그대로 저장 — 자르지도 지우지도 않는다", async () => {
    const res = await edit(photos);
    expect(res.ok).toBe(true);
    expect(db.tasks[0].image_urls).toEqual(photos);
    expect(removedPaths).toEqual([]);
  });

  it("새 사진은 상한을 넘으면 받지 않는다", async () => {
    await edit([...photos, `${base}/${ORG}/task-images/t-1/new.jpg`]);
    expect(db.tasks[0].image_urls).toEqual(photos);
  });

  it("사용자가 뺀 사진만 지운다", async () => {
    await edit(photos.slice(1));
    expect(db.tasks[0].image_urls).toEqual(photos.slice(1));
    expect(removedPaths).toEqual([`${ORG}/task-images/t-1/p0.jpg`]);
  });
});
