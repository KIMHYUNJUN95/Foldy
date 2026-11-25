import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 게시판 · 신고 · 버그 신고 읽기 — 「못 읽음」과 「비어 있음」을 나누고(2026-11-25 점검 B · G),
 * 안 읽은 글 수는 1,000줄 넘어도 끝까지 센다(점검 E).
 * Supabase 는 가짜 클라이언트 — 호출마다 표 · 동작 · 거른 조건(range 포함)을 적고, 결과는 handler 가 정한다.
 */

type Call = { table: string; op: string; payload?: unknown; filters: string[]; range?: [number, number] };
type Result = { data?: unknown; error?: { message?: string } | null };
let calls: Call[] = [];
let handler: (call: Call) => Result = () => ({ data: [], error: null });

function fakeClient() {
  return {
    from(table: string) {
      const call: Call = { filters: [], op: "select", table };
      const chain: Record<string, unknown> = {};
      for (const name of ["limit", "order", "maybeSingle", "single", "select", "returns", "contains", "or"]) {
        chain[name] = () => chain;
      }
      chain.range = (from: number, to: number) => {
        call.range = [from, to];
        return chain;
      };
      for (const name of ["eq", "is", "in", "not", "neq", "lt"]) {
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

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => fakeClient() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: async () => fakeClient() }));
vi.mock("@/lib/session", () => ({
  getCurrentAppSession: async () => session,
  hasOrganizationContext: () => true,
}));
vi.mock("@/lib/notifications/create", () => ({
  notifyBugReportCreated: async () => {},
  notifyBugReportStatusChanged: async () => {},
}));
vi.mock("@/lib/platform-developers", () => ({ displayRoleKey: () => "staff", fetchPlatformDeveloperIds: async () => new Set() }));

const session = {
  organization: { id: ORG },
  user: { id: ME, role: "office_admin", preferredLanguage: "ko" },
  capabilities: ["board.moderate", "bug.review"],
} as never;

const { listPendingBoardReports, countPendingBoardReports } = await import("@/lib/board-moderation");
const { getBoardFeed, getBoardUnreadCount } = await import("@/lib/board-queries");
const { loadMoreBoardPosts } = await import("@/app/mobile/board/actions");
const { getMyBugReports, getOrgBugReports } = await import("@/lib/bug-reports");

const FAIL = { error: { message: "boom" } };
const report = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  target_type: "post",
  post_id: "p1",
  comment_id: null,
  reason: "spam",
  note: null,
  created_at: "2026-11-25T00:00:00Z",
  target_author_user_id: "u2",
  ...over,
});

beforeEach(() => {
  calls = [];
  handler = () => ({ data: [] });
});

// ─── B. 처리 대기 신고 ───────────────────────────────────────────────────────

describe("listPendingBoardReports — 못 읽음 · 정리 조건(B · G)", () => {
  const reportUpdates = () => calls.filter((c) => c.table === "board_reports" && c.op === "update");

  it("신고 목록을 못 읽으면 loadFailed(빈 목록과 구분)", async () => {
    handler = (c) => (c.table === "board_reports" ? FAIL : { data: [] });
    expect(await listPendingBoardReports(session)).toEqual({ reports: [], loadFailed: true });
  });

  it("대기 신고가 정말 없으면 loadFailed 아님", async () => {
    expect(await listPendingBoardReports(session)).toEqual({ reports: [], loadFailed: false });
  });

  it("글을 못 읽으면 「지워짐」으로 판정하지 않고 아무 신고도 닫지 않는다", async () => {
    handler = (c) => {
      if (c.table === "board_reports") return { data: [report()] };
      if (c.table === "board_posts") return FAIL;
      return { data: [] };
    };
    expect(await listPendingBoardReports(session)).toEqual({ reports: [], loadFailed: true });
    expect(reportUpdates()).toHaveLength(0);
  });

  it("댓글을 못 읽어도 똑같이 닫지 않는다", async () => {
    handler = (c) => {
      if (c.table === "board_reports") return { data: [report({ target_type: "comment", comment_id: "c1" })] };
      if (c.table === "board_posts") return { data: [{ id: "p1", title: "t", content: "x", deleted_at: null, image_urls: [], tags: [], created_at: "x" }] };
      if (c.table === "board_comments") return FAIL;
      return { data: [] };
    };
    expect((await listPendingBoardReports(session)).loadFailed).toBe(true);
    expect(reportUpdates()).toHaveLength(0);
  });

  it("정말 지워진 글의 신고만 닫고, 정리는 대기 · 같은 조직 줄에만 쓴다", async () => {
    handler = (c) => {
      if (c.table === "board_reports" && c.op === "select") return { data: [report()] };
      if (c.table === "board_posts") return { data: [{ id: "p1", title: "t", content: "x", deleted_at: "2026-11-24T00:00:00Z", image_urls: [], tags: [], created_at: "x" }] };
      return { data: [] };
    };
    expect(await listPendingBoardReports(session)).toEqual({ reports: [], loadFailed: false });
    const [u] = reportUpdates();
    expect(u.filters).toEqual(expect.arrayContaining(["in:id:r1", "eq:status:pending", `eq:organization_id:${ORG}`]));
  });
});

describe("countPendingBoardReports — 못 읽으면 null(G)", () => {
  it("읽기 실패는 0 이 아니라 null", async () => {
    handler = () => FAIL;
    expect(await countPendingBoardReports(session)).toBeNull();
  });

  it("없으면 0", async () => {
    expect(await countPendingBoardReports(session)).toBe(0);
  });
});

// ─── G. 게시판 피드 · 버그 신고 목록 ─────────────────────────────────────────

describe("getBoardFeed · loadMoreBoardPosts — 못 읽음(G)", () => {
  it("일반 글을 못 읽으면 loadFailed", async () => {
    handler = (c) => (c.table === "board_posts" && c.filters.includes("eq:is_pinned:false") ? FAIL : { data: [] });
    const feed = await getBoardFeed({ session, limit: 15 });
    expect(feed).toMatchObject({ posts: [], nextCursor: null, loadFailed: true });
  });

  it("고정 글을 못 읽어도 loadFailed(조용히 빠뜨리지 않음)", async () => {
    handler = (c) => (c.table === "board_posts" && c.filters.includes("eq:is_pinned:true") ? FAIL : { data: [] });
    expect((await getBoardFeed({ session, limit: 15 })).loadFailed).toBe(true);
  });

  it("글이 정말 없으면 loadFailed 아님", async () => {
    expect(await getBoardFeed({ session, limit: 15 })).toEqual({ posts: [], nextCursor: null, loadFailed: false });
  });

  it("더 불러오기에서 못 읽으면 load_failed 오류(빈 페이지로 끝내지 않음)", async () => {
    handler = (c) => (c.table === "board_posts" ? FAIL : { data: [] });
    expect(await loadMoreBoardPosts({ category: null, before: "2026-11-25T00:00:00Z|p9" })).toEqual({ error: "load_failed" });
  });
});

describe("버그 신고 목록 — 못 읽음(G)", () => {
  it("내 신고 · 조직 신고 모두 읽기 실패를 loadFailed 로", async () => {
    handler = () => FAIL;
    expect(await getMyBugReports(session)).toEqual({ reports: [], loadFailed: true });
    expect(await getOrgBugReports(session)).toEqual({ reports: [], loadFailed: true });
  });

  it("없으면 loadFailed 아님", async () => {
    expect(await getMyBugReports(session)).toEqual({ reports: [], loadFailed: false });
  });
});

// ─── E. 안 읽은 글 수 — 1,000줄 넘어도 ───────────────────────────────────────

describe("getBoardUnreadCount — 나눠 읽기(E)", () => {
  const posts = Array.from({ length: 2500 }, (_, i) => ({ id: `p${String(i).padStart(4, "0")}`, created_by_user_id: "u2" }));
  const reads = posts.slice(0, 1200).map((p) => ({ post_id: p.id }));
  const page = <T,>(rows: T[], c: Call) => {
    // 서버처럼 한 번에 최대 1,000줄 — range 없이 부르면 앞 1,000줄만 온다.
    const [from, to] = c.range ?? [0, 999];
    return { data: rows.slice(from, Math.min(to, from + 999) + 1) };
  };

  it("글 2,500개 · 읽음 1,200개 → 안 읽음 1,300(앞 1,000줄에서 멈추지 않음)", async () => {
    handler = (c) => {
      if (c.table === "board_posts") return page(posts, c);
      if (c.table === "board_post_reads") return page(reads, c);
      return { data: [] };
    };
    expect(await getBoardUnreadCount(session)).toBe(1300);
    const postPages = calls.filter((c) => c.table === "board_posts").map((c) => c.range);
    expect(postPages).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("중간 쪽을 못 읽으면 0(지금과 같이 닫힘)", async () => {
    handler = (c) => {
      if (c.table === "board_posts") return c.range?.[0] === 1000 ? FAIL : page(posts, c);
      if (c.table === "board_post_reads") return page(reads, c);
      return { data: [] };
    };
    expect(await getBoardUnreadCount(session)).toBe(0);
  });

  it("내가 쓴 글 · 차단한 사람 글은 빼는 규칙은 그대로", async () => {
    const mixed = [
      { id: "a", created_by_user_id: ME },
      { id: "b", created_by_user_id: "blocked" },
      { id: "c", created_by_user_id: "u2" },
    ];
    handler = (c) => {
      if (c.table === "board_posts") return page(mixed, c);
      if (c.table === "user_blocks") return { data: [{ blocked_user_id: "blocked" }] };
      return { data: [] };
    };
    expect(await getBoardUnreadCount(session)).toBe(1);
  });
});
