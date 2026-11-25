import { beforeEach, describe, expect, it, vi } from "vitest";

// 할 일 공유 — 참여자 줄은 들어갔는데 is_shared 표시가 실패하면 참여자를 되돌린다(2026-11-25).
// 안 되돌리면 다시 눌러도 「새로 추가할 사람 없음」이라 표시가 영영 안 켜지고 알림도 안 간다.

type Call = { table: string; op: string; payload?: unknown; filters: string[] };
let calls: Call[] = [];
let failTasksUpdate = false;
const notified: unknown[] = [];

function client() {
  return {
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      const chain: Record<string, unknown> = {};
      for (const n of ["select", "limit", "order", "maybeSingle", "single"]) chain[n] = () => chain;
      for (const n of ["eq", "in", "is", "not"]) {
        chain[n] = (c: string, v: unknown) => (call.filters.push(`${n}:${c}:${String(v)}`), chain);
      }
      for (const op of ["insert", "update", "delete", "upsert"]) {
        chain[op] = (payload: unknown) => ((call.op = op), (call.payload = payload), chain);
      }
      chain.then = (resolve: (v: unknown) => unknown) => {
        calls.push({ ...call, filters: [...call.filters] });
        const error = failTasksUpdate && table === "tasks" && call.op === "update" ? { message: "boom" } : null;
        return Promise.resolve({ data: [], error }).then(resolve);
      };
      return chain;
    },
  };
}

const ORG = "org1";
const ME = "author";
const taskDetail = {
  id: "t1",
  title: "T",
  projectId: null,
  createdByUserId: ME,
  participants: [{ userId: ME, role: "author", isFirstRecipient: false }],
};

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => client() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/browser", () => ({ getSupabaseBrowserClient: () => ({}) }));
vi.mock("@/lib/session", () => ({
  getCurrentAppSession: async () => ({ capabilities: [], organization: { id: ORG }, user: { id: ME, role: "office_admin" } }),
  hasOrganizationContext: () => true,
}));
vi.mock("@/lib/notifications/create", () => ({
  notifyTaskParticipants: async (...args: unknown[]) => {
    notified.push(args);
  },
  notifyProjectMembers: async () => {},
}));
vi.mock("@/actions/task-report", () => ({ generateDailyReport: async () => ({}) }));
vi.mock("@/lib/tasks", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getTaskDetail: async () => taskDetail,
  getShareableUsers: async () => [{ id: "u2" }, { id: "u3" }],
  canEditTaskCore: () => true,
}));

const { shareConsoleTask } = await import("@/app/admin/tasks/actions");
const { shareTaskWithUsers } = await import("@/app/mobile/tasks/[id]/actions");

const rollback = () => calls.find((c) => c.table === "task_participants" && c.op === "delete");

beforeEach(() => {
  calls = [];
  notified.length = 0;
  failTasksUpdate = false;
});

describe("shareConsoleTask", () => {
  it("is_shared 쓰기가 실패하면 방금 넣은 참여자를 지우고 save_failed", async () => {
    failTasksUpdate = true;
    expect(await shareConsoleTask("t1", ["u2", "u3"], false)).toEqual({ ok: false, error: "save_failed" });
    expect(rollback()?.filters).toEqual(expect.arrayContaining(["eq:task_id:t1", "in:user_id:u2,u3"]));
    expect(notified).toHaveLength(0);
  });

  it("성공하면 되돌리지 않고 알린다", async () => {
    expect(await shareConsoleTask("t1", ["u2"], false)).toEqual({ ok: true });
    expect(rollback()).toBeUndefined();
    expect(notified).toHaveLength(1);
  });
});

describe("shareTaskWithUsers (모바일)", () => {
  const form = () => {
    const f = new FormData();
    f.set("taskId", "t1");
    f.set("shareJson", JSON.stringify(["u2", "u3"]));
    return f;
  };

  it("is_shared 쓰기가 실패하면 참여자를 지우고 save_failed 로 보낸다", async () => {
    failTasksUpdate = true;
    await expect(shareTaskWithUsers(form())).rejects.toThrow(/REDIRECT:.*save_failed/);
    expect(rollback()?.filters).toEqual(expect.arrayContaining(["eq:task_id:t1", "in:user_id:u2,u3"]));
    expect(notified).toHaveLength(0);
  });

  it("성공하면 되돌리지 않는다", async () => {
    await expect(shareTaskWithUsers(form())).rejects.toThrow(/REDIRECT:(?!.*save_failed)/);
    expect(rollback()).toBeUndefined();
    expect(notified).toHaveLength(1);
  });
});
