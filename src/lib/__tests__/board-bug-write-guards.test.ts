import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 게시판 · 신고 · 버그 신고 쓰기 — 「읽고 확인 → 쓰기」 사이에 상태가 바뀌어도 잘못 쓰지 않게(2026-11-25 점검 C · D · F).
 * 쓰기 질의 자체에 상태 · 조직 · 삭제 여부 조건을 걸고, 바뀐 줄이 0이면 성공으로 알리지 않는다.
 * Supabase 는 가짜 클라이언트 — 호출마다 표 · 동작 · 거른 조건을 적고, 결과는 handler 가 정한다.
 */

type Call = { table: string; op: string; payload?: unknown; filters: string[]; selected: boolean };
type Result = { data?: unknown; error?: { message?: string; code?: string } | null };
let calls: Call[] = [];
let handler: (call: Call) => Result = () => ({ data: null, error: null });

function fakeClient() {
  return {
    from(table: string) {
      const call: Call = { filters: [], op: "select", selected: false, table };
      const chain: Record<string, unknown> = {};
      for (const name of ["limit", "order", "maybeSingle", "single", "range", "returns"]) chain[name] = () => chain;
      chain.select = () => {
        call.selected = true;
        return chain;
      };
      for (const name of ["eq", "is", "in", "not", "neq"]) {
        chain[name] = (column: string, value: unknown) => {
          call.filters.push(`${name}:${column}:${String(value)}`);
          return chain;
        };
      }
      for (const op of ["insert", "update", "upsert", "delete"]) {
        chain[op] = (payload: unknown) => {
          call.op = op;
          call.payload = payload;
          return chain;
        };
      }
      chain.then = (resolve: (value: Result) => unknown) => {
        calls.push({ ...call, filters: [...call.filters] });
        const r = handler(call);
        return Promise.resolve({ data: r.data ?? null, error: r.error ?? null }).then(resolve);
      };
      return chain;
    },
  };
}

const ORG = "org1";
const ME = "u1";
let capabilities: string[] = [];
let role = "office_admin";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => fakeClient() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: async () => fakeClient() }));
vi.mock("@/lib/supabase/browser", () => ({ getSupabaseBrowserClient: () => ({}) }));
vi.mock("@/lib/session", () => ({
  getCurrentAppSession: async () => ({ capabilities, organization: { id: ORG }, user: { id: ME, role } }),
  hasOrganizationContext: () => true,
}));
const notifyStatusChanged = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/notifications/create", () => ({
  notifyBoardCommentMentions: async () => {},
  notifyBoardPostAuthor: async () => {},
  notifyBugReportCreated: async () => {},
  notifyBugReportStatusChanged: notifyStatusChanged,
}));
vi.mock("@/lib/board-queries", () => ({
  getActiveOrgMemberIds: async () => [],
  searchMentionableMembers: async () => [],
  validateMentionTargets: async () => [],
}));
vi.mock("@/lib/board-moderation", () => ({ canModerateBoard: () => true, isBoardReportReason: () => true }));
vi.mock("@/lib/platform-developers", () => ({ displayRoleKey: () => "staff", fetchPlatformDeveloperIds: async () => new Set() }));

const { pinBoardPost, updateBoardPost, deleteBoardPost } = await import("@/app/mobile/board/[id]/actions");
const { reportBoardContent, withdrawBoardReport, resolveBoardReport } = await import("@/actions/board-moderation");
const { updateBugReport, deleteBugReport, updateBugReportStatus } = await import("@/lib/bug-reports");

const writes = (table: string) => calls.filter((c) => c.table === table && c.op !== "select");
const orgEq = `eq:organization_id:${ORG}`;

beforeEach(() => {
  calls = [];
  notifyStatusChanged.mockClear();
  capabilities = [];
  role = "office_admin";
});

// ─── F. 게시글 고정 · 수정 · 삭제 ──────────────────────────────────────────────

describe("게시글 쓰기 — 조직 · 살아 있는 글 조건(F)", () => {
  const meta = (over: Record<string, unknown> = {}) => ({
    data: { organization_id: ORG, created_by_user_id: ME, title: null, is_pinned: false, allow_comments: true, ...over },
  });

  it("고정: 같은 조직 · 안 지워진 글에만 쓰고 바뀐 줄을 돌려받는다", async () => {
    handler = (c) => (c.op === "update" ? { data: [{ id: "p1" }] } : meta());
    expect(await pinBoardPost("p1")).toEqual({ ok: true });
    const [u] = writes("board_posts");
    expect(u.filters).toEqual(expect.arrayContaining(["eq:id:p1", orgEq, "is:deleted_at:null"]));
    expect(u.selected).toBe(true);
  });

  it("고정: 그 사이 지워져 0줄이면 not_found", async () => {
    handler = (c) => (c.op === "update" ? { data: [] } : meta());
    expect(await pinBoardPost("p1")).toEqual({ error: "not_found" });
  });

  it("수정: 같은 조건 · 0줄이면 not_found", async () => {
    handler = (c) => (c.op === "update" ? { data: [] } : meta());
    expect(await updateBoardPost("p1", { content: "hi" })).toEqual({ error: "not_found" });
    const [u] = writes("board_posts");
    expect(u.filters).toEqual(expect.arrayContaining(["eq:id:p1", orgEq, "is:deleted_at:null"]));
    expect(u.selected).toBe(true);
  });

  it("수정: 고정 여부가 그대로면 고정 시각 · 고정한 사람을 덮어쓰지 않는다", async () => {
    handler = (c) => (c.op === "update" ? { data: [{ id: "p1" }] } : meta({ is_pinned: true }));
    expect(await updateBoardPost("p1", { content: "hi", isPinned: true })).toEqual({ ok: true });
    const [u] = writes("board_posts");
    expect(u.payload).not.toHaveProperty("pinned_at");
    expect(u.payload).not.toHaveProperty("pinned_by_user_id");
    expect(u.payload).not.toHaveProperty("is_pinned");
  });

  it("수정: 고정을 실제로 바꿀 때만 고정 시각을 찍는다", async () => {
    handler = (c) => (c.op === "update" ? { data: [{ id: "p1" }] } : meta({ is_pinned: false }));
    expect(await updateBoardPost("p1", { content: "hi", isPinned: true })).toEqual({ ok: true });
    const [u] = writes("board_posts");
    expect(u.payload).toMatchObject({ is_pinned: true, pinned_by_user_id: ME });
  });

  it("삭제: 같은 조직 · 안 지워진 글에만(먼저 지운 시각을 덮어쓰지 않음)", async () => {
    handler = (c) => (c.op === "update" ? { data: [{ id: "p1" }] } : meta());
    expect(await deleteBoardPost("p1")).toEqual({ ok: true });
    const [u] = writes("board_posts");
    expect(u.filters).toEqual(expect.arrayContaining(["eq:id:p1", orgEq, "is:deleted_at:null"]));
    expect(u.selected).toBe(true);
  });

  it("삭제: 그 사이 이미 지워져 0줄이어도 성공(지우려던 결과와 같음 — 화면에 오류를 띄우지 않음)", async () => {
    handler = (c) => (c.op === "update" ? { data: [] } : meta());
    expect(await deleteBoardPost("p1")).toEqual({ ok: true });
  });
});

// ─── C. 신고 취소 · 다시 열기 · 처리 ────────────────────────────────────────────

describe("신고 쓰기 — 상태 · 조직 · 본인 조건(C)", () => {
  it("취소: 대기 · 문제없음 상태이고 같은 조직 · 내 신고에만 쓴다", async () => {
    handler = (c) =>
      c.op === "update"
        ? { data: [{ id: "r1" }] }
        : { data: { id: "r1", post_id: "p1", status: "pending", reporter_user_id: ME, organization_id: ORG } };
    expect(await withdrawBoardReport("r1")).toEqual({ ok: true });
    const [u] = writes("board_reports");
    expect(u.filters).toEqual(
      expect.arrayContaining(["eq:id:r1", "in:status:pending,dismissed", orgEq, `eq:reporter_user_id:${ME}`]),
    );
    expect(u.selected).toBe(true);
  });

  it("취소: 그 사이 관리자가 삭제 처리해 0줄이면 invalid(삭제된 기록을 「취소」로 덮지 않음)", async () => {
    handler = (c) =>
      c.op === "update"
        ? { data: [] }
        : { data: { id: "r1", post_id: "p1", status: "pending", reporter_user_id: ME, organization_id: ORG } };
    expect(await withdrawBoardReport("r1")).toEqual({ error: "invalid" });
  });

  const target = { data: { organization_id: ORG, created_by_user_id: "u2", deleted_at: null } };

  it("다시 신고: 취소했던 신고만 다시 열고(같은 조직), 0줄이면 already_reported", async () => {
    handler = (c) => {
      if (c.table === "board_posts") return target;
      if (c.op === "insert") return { error: { code: "23505" } };
      if (c.op === "update") return { data: [] };
      return { data: { id: "r1", status: "withdrawn" } };
    };
    expect(await reportBoardContent({ targetType: "post", postId: "p1", reason: "spam" })).toEqual({
      error: "already_reported",
    });
    const [u] = writes("board_reports").filter((c) => c.op === "update");
    expect(u.filters).toEqual(expect.arrayContaining(["eq:id:r1", "eq:status:withdrawn", orgEq]));
    expect(u.selected).toBe(true);
  });

  it("다시 신고: 한 줄 바뀌면 성공", async () => {
    handler = (c) => {
      if (c.table === "board_posts") return target;
      if (c.op === "insert") return { error: { code: "23505" } };
      if (c.op === "update") return { data: [{ id: "r1" }] };
      return { data: { id: "r1", status: "withdrawn" } };
    };
    expect(await reportBoardContent({ targetType: "post", postId: "p1", reason: "spam" })).toEqual({ ok: true });
  });

  it("처리(삭제): 글은 안 지워진 것만 지운다 — 작성자가 먼저 지운 시각을 덮어쓰지 않음", async () => {
    capabilities = ["board.moderate"];
    handler = (c) => (c.table === "board_posts" && c.op === "select" ? target : { data: [] });
    expect(await resolveBoardReport({ targetType: "post", postId: "p1", action: "remove" })).toEqual({ ok: true });
    const [u] = writes("board_posts");
    expect(u.filters).toEqual(expect.arrayContaining(["eq:id:p1", orgEq, "is:deleted_at:null"]));
  });
});

// ─── D. 버그 신고 수정 · 삭제 ────────────────────────────────────────────────

describe("버그 신고 수정 · 삭제 — 접수 상태 조건(D)", () => {
  const session = () =>
    ({ organization: { id: ORG }, user: { id: ME, role, preferredLanguage: "ko" }, capabilities }) as never;
  const row = { data: { id: "b1", organization_id: ORG, reported_by_user_id: ME, status: "submitted", title: "t" } };

  beforeEach(() => {
    role = "part_time";
  });

  it("수정: 접수 상태에만 쓰고, 그 사이 검토가 시작돼 0줄이면 not_editable", async () => {
    handler = (c) => (c.op === "update" ? { data: [] } : row);
    await expect(updateBugReport({ session: session(), id: "b1", title: "t", description: "d", imageUrls: [] })).rejects.toThrow(
      "not_editable",
    );
    const [u] = writes("bug_reports");
    expect(u.filters).toEqual(expect.arrayContaining(["eq:id:b1", orgEq, "eq:status:submitted"]));
    expect(u.selected).toBe(true);
  });

  it("수정: 한 줄 바뀌면 성공", async () => {
    handler = (c) => (c.op === "update" ? { data: [{ id: "b1" }] } : row);
    await expect(
      updateBugReport({ session: session(), id: "b1", title: "t", description: "d", imageUrls: [] }),
    ).resolves.toBeUndefined();
  });

  it("삭제: 접수 상태에만 지우고, 0줄이면 not_editable", async () => {
    handler = (c) => (c.op === "delete" ? { data: [] } : row);
    await expect(deleteBugReport({ session: session(), id: "b1" })).rejects.toThrow("not_editable");
    const [d] = writes("bug_reports");
    expect(d.filters).toEqual(expect.arrayContaining(["eq:id:b1", orgEq, "eq:status:submitted"]));
    expect(d.selected).toBe(true);
  });

  it("플랫폼 개발자는 상태와 상관없이 고친다(상태 조건 없음)", async () => {
    role = "developer_super_admin";
    handler = (c) => (c.op === "update" ? { data: [{ id: "b1" }] } : { data: { ...row.data, status: "closed" } });
    await updateBugReport({ session: session(), id: "b1", title: "t", description: "d", imageUrls: [] });
    const [u] = writes("bug_reports");
    expect(u.filters).not.toContain("eq:status:submitted");
  });
});

describe("버그 신고 상태 바꾸기 — 읽은 상태 조건", () => {
  const session = () =>
    ({ organization: { id: ORG }, user: { id: ME, role, preferredLanguage: "ko" }, capabilities }) as never;
  const row = { data: { id: "b1", organization_id: ORG, reported_by_user_id: "u2", status: "submitted", title: "t" } };

  beforeEach(() => {
    capabilities = ["bug.review"];
  });

  it("읽은 상태 그대로일 때만 쓰고 바뀐 줄을 돌려받는다 · 한 줄이면 작성자에게 알림", async () => {
    handler = (c) => (c.op === "update" ? { data: [{ id: "b1" }] } : row);
    await updateBugReportStatus({ session: session(), id: "b1", status: "reviewing" });
    const [u] = writes("bug_reports");
    expect(u.filters).toEqual(expect.arrayContaining(["eq:id:b1", orgEq, "eq:status:submitted"]));
    expect(u.selected).toBe(true);
    expect(notifyStatusChanged).toHaveBeenCalledTimes(1);
  });

  it("그 사이 다른 검토자가 상태를 바꿔 0줄이면 status_changed · 알림 없음", async () => {
    handler = (c) => (c.op === "update" ? { data: [] } : row);
    await expect(updateBugReportStatus({ session: session(), id: "b1", status: "closed" })).rejects.toThrow("status_changed");
    expect(notifyStatusChanged).not.toHaveBeenCalled();
  });
});
