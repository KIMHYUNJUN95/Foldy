import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 게시판 댓글 지우기 · 되돌리기 · 신고 처리 서버 액션(게시판 unslop 2026-11-20, 문서 23 「12-E」).
 * Supabase 는 가짜 클라이언트 — 호출마다 표 · 동작 · 거른 조건을 적어 두고, 결과는 handler 가 정한다.
 */

type Call = { table: string; op: string; payload?: unknown; filters: string[]; selected: boolean };
type Result = { data?: unknown; error?: { message?: string } | null };
let calls: Call[] = [];
let handler: (call: Call) => Result = () => ({ data: null, error: null });

function fakeClient() {
  return {
    from(table: string) {
      const call: Call = { filters: [], op: "select", selected: false, table };
      const chain: Record<string, unknown> = {};
      for (const name of ["limit", "order", "maybeSingle", "single"]) chain[name] = () => chain;
      chain.select = () => {
        call.selected = true;
        return chain;
      };
      for (const name of ["eq", "is", "in", "not"]) {
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

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => fakeClient() }));
vi.mock("@/lib/supabase/browser", () => ({ getSupabaseBrowserClient: () => ({}) }));
vi.mock("@/lib/session", () => ({
  getCurrentAppSession: async () => ({ capabilities, organization: { id: ORG }, user: { id: ME } }),
  hasOrganizationContext: () => true,
}));
vi.mock("@/lib/notifications/create", () => ({
  notifyBoardCommentMentions: async () => {},
  notifyBoardPostAuthor: async () => {},
}));
vi.mock("@/lib/board-queries", () => ({
  getActiveOrgMemberIds: async () => [],
  searchMentionableMembers: async () => [],
  validateMentionTargets: async () => [],
}));
vi.mock("@/lib/board-moderation", () => ({ canModerateBoard: () => true, isBoardReportReason: () => true }));

const { deleteBoardComment, restoreBoardComment } = await import("@/app/mobile/board/[id]/actions");
const { reportBoardContent, resolveBoardReport, withdrawBoardReport } = await import("@/actions/board-moderation");

const updates = () => calls.filter((c) => c.table === "board_comments" && c.op === "update");

beforeEach(() => {
  calls = [];
  capabilities = [];
});

describe("deleteBoardComment", () => {
  const read = { data: { post_id: "p1", organization_id: ORG, created_by_user_id: ME } };

  it("지운 사람을 남기고, 안 지워진 · 같은 조직 줄에만 쓴다", async () => {
    handler = (c) => (c.op === "update" ? { data: [{ id: "c1" }] } : read);
    expect(await deleteBoardComment("c1")).toEqual({ ok: true });
    const [u] = updates();
    expect(u.payload).toMatchObject({ deleted_by_user_id: ME });
    expect(u.filters).toEqual(expect.arrayContaining(["eq:id:c1", `eq:organization_id:${ORG}`, "is:deleted_at:null"]));
    expect(u.selected).toBe(true);
  });

  it("그 사이 누가 먼저 지워 0줄이면 not_found(덮어쓰지 않음)", async () => {
    handler = (c) => (c.op === "update" ? { data: [] } : read);
    expect(await deleteBoardComment("c1")).toEqual({ error: "not_found" });
  });
});

describe("restoreBoardComment", () => {
  const deletedAt = () => new Date(Date.now() - 5_000).toISOString();
  const commentRow = (over: Record<string, unknown> = {}) => ({
    data: { post_id: "p1", organization_id: ORG, deleted_by_user_id: ME, deleted_at: deletedAt(), ...over },
  });
  const post = { data: { organization_id: ORG, created_by_user_id: ME, title: null, is_pinned: false, allow_comments: true } };

  function route(opts: { update?: Result; reports?: Result; comment?: Result }) {
    const comment = opts.comment ?? commentRow();
    handler = (c) => {
      if (c.table === "board_posts") return post;
      if (c.table === "board_reports") return opts.reports ?? { data: [] };
      if (c.op === "update") return opts.update ?? { data: [{ id: "c1" }] };
      return comment;
    };
  }

  it("지운 사람이면 비우고, 읽은 시각 · 지운 사람 조건을 같이 건다", async () => {
    route({});
    expect(await restoreBoardComment("c1")).toEqual({ ok: true });
    const [u] = updates();
    expect(u.payload).toEqual({ deleted_at: null, deleted_by_user_id: null });
    expect(u.filters).toEqual(expect.arrayContaining([`eq:deleted_by_user_id:${ME}`, `eq:organization_id:${ORG}`]));
    expect(u.filters.some((f) => f.startsWith("eq:deleted_at:"))).toBe(true);
  });

  it("UPDATE 가 0줄이면 not_found", async () => {
    route({ update: { data: [] } });
    expect(await restoreBoardComment("c1")).toEqual({ error: "not_found" });
  });

  it("신고 조회가 실패하면 거부하고 쓰지 않는다", async () => {
    route({ reports: { error: { message: "boom" } } });
    expect(await restoreBoardComment("c1")).toEqual({ error: "save_failed" });
    expect(updates()).toHaveLength(0);
  });

  it("신고 처리로 지운 댓글은 forbidden", async () => {
    route({ reports: { data: [{ id: "r1" }] } });
    expect(await restoreBoardComment("c1")).toEqual({ error: "forbidden" });
    expect(updates()).toHaveLength(0);
  });

  it("남이 지운 댓글은 forbidden", async () => {
    route({ comment: commentRow({ deleted_by_user_id: "admin" }) });
    expect(await restoreBoardComment("c1")).toEqual({ error: "forbidden" });
  });
});

describe("resolveBoardReport(remove) — 댓글", () => {
  const input = { action: "remove" as const, targetType: "comment" as const, postId: "p1", commentId: "c1" };
  function route(opts: { commentUpdate?: Result; close?: Result }) {
    handler = (c) => {
      if (c.table === "board_posts") return { data: { organization_id: ORG, created_by_user_id: "a", deleted_at: null } };
      if (c.table === "board_reports") return opts.close ?? { data: null };
      if (c.op === "update") return c.filters.includes("is:deleted_at:null") ? (opts.commentUpdate ?? { data: [{ id: "c1" }] }) : { data: null };
      return { data: { post_id: "p1", organization_id: ORG, created_by_user_id: "a", deleted_at: null } };
    };
  }

  it("안 지워진 · 같은 조직 댓글에만 지운 사람을 쓴다", async () => {
    route({});
    expect(await resolveBoardReport(input)).toEqual({ ok: true });
    const [u] = updates();
    expect(u.payload).toMatchObject({ deleted_by_user_id: ME });
    expect(u.filters).toEqual(expect.arrayContaining([`eq:organization_id:${ORG}`, "is:deleted_at:null"]));
  });

  it("신고 닫기가 실패하면 지운 사람을 비운다(지움은 그대로)", async () => {
    route({ close: { error: { message: "boom" } } });
    expect(await resolveBoardReport(input)).toEqual({ error: "save_failed" });
    const [, clear] = updates();
    expect(clear.payload).toEqual({ deleted_by_user_id: null });
    expect(clear.filters).toEqual(expect.arrayContaining(["eq:id:c1", `eq:organization_id:${ORG}`]));
  });

  it("이미 지워져 0줄이었으면 닫기 실패 때도 남의 기록을 건드리지 않는다", async () => {
    route({ commentUpdate: { data: [] }, close: { error: { message: "boom" } } });
    expect(await resolveBoardReport(input)).toEqual({ error: "save_failed" });
    expect(updates()).toHaveLength(1);
  });
});

describe("withdrawBoardReport — 관리자 처리와의 경합(2026-11-25)", () => {
  const report = { data: { id: "r1", post_id: "p1", status: "pending", reporter_user_id: ME, organization_id: ORG } };

  it("지금도 대기 · 문제없음일 때만 거두는 조건을 걸고 바뀐 줄을 확인한다", async () => {
    handler = (c) => (c.op === "update" ? { data: [{ id: "r1" }] } : report);
    expect(await withdrawBoardReport("r1")).toEqual({ ok: true });
    const u = calls.find((c) => c.table === "board_reports" && c.op === "update")!;
    expect(u.filters).toEqual(
      expect.arrayContaining(["eq:id:r1", `eq:organization_id:${ORG}`, `eq:reporter_user_id:${ME}`, "in:status:pending,dismissed"]),
    );
    expect(u.selected).toBe(true);
  });

  it("읽은 뒤 관리자가 먼저 처리해 0줄이면 invalid — 처리 기록을 덮어쓰지 않는다", async () => {
    handler = (c) => (c.op === "update" ? { data: [] } : report);
    expect(await withdrawBoardReport("r1")).toEqual({ error: "invalid" });
  });
});

describe("reportBoardContent — 취소한 신고 다시 열기(2026-11-25)", () => {
  const input = { targetType: "post" as const, postId: "p1", reason: "spam" };
  function route(prior: { id: string; status: string } | null) {
    handler = (c) => {
      if (c.table === "board_posts") return { data: { organization_id: ORG, created_by_user_id: "other", deleted_at: null } };
      if (c.op === "insert") return { error: { code: "23505", message: "dup" } as { message: string } };
      if (c.op === "update") return { data: [{ id: "r1" }] };
      return { data: prior };
    };
  }

  it("조회 · 갱신 모두 조직을 걸고, 갱신은 withdrawn 일 때만", async () => {
    route({ id: "r1", status: "withdrawn" });
    expect(await reportBoardContent(input)).toEqual({ ok: true });
    const lookup = calls.find((c) => c.table === "board_reports" && c.op === "select")!;
    expect(lookup.filters).toContain(`eq:organization_id:${ORG}`);
    const u = calls.find((c) => c.table === "board_reports" && c.op === "update")!;
    expect(u.filters).toEqual(expect.arrayContaining(["eq:id:r1", `eq:organization_id:${ORG}`, "eq:status:withdrawn"]));
  });

  it("withdrawn 이 아니면 다시 열지 않고 already_reported", async () => {
    route({ id: "r1", status: "removed" });
    expect(await reportBoardContent(input)).toEqual({ error: "already_reported" });
    expect(calls.some((c) => c.table === "board_reports" && c.op === "update")).toBe(false);
  });
});
