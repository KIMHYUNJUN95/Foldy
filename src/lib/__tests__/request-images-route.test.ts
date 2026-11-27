import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** 비공개 request-images 라우트 — 로그인 · 조직 멤버 · 근태 정정 본인/관리자만 · 경로 장난 거절. */
type Filters = Record<string, unknown>;
const state = vi.hoisted(() => ({
  session: null as null | {
    organization: { id: string };
    user: { id: string; role?: string };
    capabilities: string[];
  },
  memberships: [] as Array<{
    organization_id: string;
    user_id: string;
    status: string;
  }>,
  corrections: [] as Array<{
    id: string;
    organization_id: string;
    requested_by_user_id: string;
    image_urls: string[];
  }>,
  otherOrgCaps: [] as string[],
  objects: [] as Array<{ name: string; owner_id: string | null }>,
  rpcFails: false,
  /** 사용자 세션(RLS) 으로 보이는 행 — visibleTo 에 든 사용자만 읽는다. */
  rls: {} as Record<
    string,
    Array<Record<string, unknown> & { visibleTo: string[] }>
  >,
  rlsQueries: [] as string[],
  rlsError: false,
  bugs: [] as Array<{
    id: string;
    organization_id: string;
    reported_by_user_id: string;
  }>,
  signedPaths: [] as string[],
  signFails: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({
  getCurrentAppSession: async () => state.session,
}));
vi.mock("@/lib/capabilities-server", () => ({
  memberCapabilities: async () => state.otherOrgCaps,
}));
vi.mock("@/lib/supabase/service", () => {
  function query(table: string) {
    const filters: Filters = {};
    let contains: string[] = [];
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return builder;
      },
      contains: (_col: string, vals: string[]) => {
        contains = vals;
        return builder;
      },
      limit: () => builder,
      maybeSingle: async () => {
        const rows = (
          table === "memberships"
            ? state.memberships
            : table === "attendance_correction_requests"
              ? state.corrections
              : table === "bug_reports"
                ? state.bugs
                : []
        ) as Array<Record<string, unknown>>;
        const hit = rows.find(
          (row) =>
            Object.entries(filters).every(([k, v]) => row[k] === v) &&
            contains.every((c) =>
              (row.image_urls as string[] | undefined)?.includes(c),
            ),
        );
        return { data: hit ?? null, error: null };
      },
    };
    return builder;
  }
  return {
    getSupabaseServiceClient: () => ({
      from: query,
      rpc: async (fn: string, args: { p_names: string[] }) => {
        if (fn !== "request_image_owners" || state.rpcFails)
          return { data: null, error: { message: "rpc failed" } };
        return {
          data: state.objects.filter((o) => args.p_names.includes(o.name)),
          error: null,
        };
      },
      storage: {
        from: () => ({
          createSignedUrl: async (path: string) => {
            state.signedPaths.push(path);
            if (state.signFails)
              return { data: null, error: { message: "not found" } };
            return {
              data: {
                signedUrl: `https://proj.supabase.co/storage/v1/object/sign/request-images/${path}?token=t`,
              },
              error: null,
            };
          },
        }),
      },
    }),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({
    from: (table: string) => {
      state.rlsQueries.push(table);
      const filters: Filters = {};
      const nulls: string[] = [];
      let overlaps: string[] = [];
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        is: (col: string, val: null) => {
          if (val === null) nulls.push(col);
          return builder;
        },
        overlaps: (_col: string, vals: string[]) => {
          overlaps = vals;
          return builder;
        },
        limit: () => builder,
        maybeSingle: async () => {
          if (state.rlsError) return { data: null, error: { message: "boom", code: "XX000" } };
          const userId = state.session?.user.id ?? "";
          const read = (row: Record<string, unknown>, col: string) =>
            col
              .split(".")
              .reduce<unknown>(
                (v, k) => (v as Record<string, unknown> | undefined)?.[k],
                row,
              );
          const hit = (state.rls[table] ?? []).find(
            (row) =>
              row.visibleTo.includes(userId) &&
              Object.entries(filters).every(([k, v]) => read(row, k) === v) &&
              nulls.every((c) => read(row, c) == null) &&
              overlaps.some((u) => (row.image_urls as string[]).includes(u)),
          );
          return { data: hit ? { id: hit.id } : null, error: null };
        },
      };
      return builder;
    },
  }),
}));

import { GET } from "@/app/api/request-images/[...path]/route";

const BASE = "https://proj.supabase.co";
const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "33333333-3333-4333-8333-333333333333";
const REC = "22222222-2222-4222-8222-222222222222";
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STRANGER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CORR_PATH = `${ORG}/attendance-corrections/${REC}/a.jpg`;

function get(path: string, query = "") {
  return GET(
    new NextRequest(`http://localhost/api/request-images/${path}${query}`),
  );
}
function login(userId: string, orgId = ORG, capabilities: string[] = []) {
  state.session = {
    organization: { id: orgId },
    user: { id: userId },
    capabilities,
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
  state.session = null;
  state.memberships = [];
  state.otherOrgCaps = [];
  state.signedPaths = [];
  state.signFails = false;
  state.rpcFails = false;
  state.objects = [{ name: CORR_PATH, owner_id: OWNER }];
  state.rls = {};
  state.rlsQueries = [];
  state.rlsError = false;
  state.bugs = [];
  state.corrections = [
    {
      id: "c1",
      organization_id: ORG,
      requested_by_user_id: OWNER,
      image_urls: [
        `${BASE}/storage/v1/object/public/request-images/${CORR_PATH}`,
      ],
    },
  ];
});

describe("GET /api/request-images/[...path]", () => {
  it("로그인 안 함 → 401", async () => {
    const res = await get(`${ORG}/complaint-images/${REC}/a.jpg`);
    expect(res.status).toBe(401);
  });

  it("같은 조직 멤버 → 302 서명 주소 · 캐시 헤더", async () => {
    login(STRANGER);
    const res = await get(`${ORG}/complaint-images/${REC}/a.jpg`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain(
      "/object/sign/request-images/",
    );
    expect(res.headers.get("cache-control")).toBe("private, max-age=240");
    expect(state.signedPaths).toEqual([`${ORG}/complaint-images/${REC}/a.jpg`]);
  });

  it("다른 조직(멤버 아님) → 403, 서명하지 않음", async () => {
    login(STRANGER, OTHER_ORG);
    const res = await get(`${ORG}/complaint-images/${REC}/a.jpg`);
    expect(res.status).toBe(403);
    expect(state.signedPaths).toEqual([]);
  });

  it("세션 조직이 아니어도 그 조직 활성 멤버면 열린다", async () => {
    login(STRANGER, OTHER_ORG);
    state.memberships = [
      { organization_id: ORG, user_id: STRANGER, status: "active" },
    ];
    const res = await get(`${ORG}/lost-items/${REC}/a.jpg`);
    expect(res.status).toBe(302);
  });

  it("근태 정정 — 본인 아님 · 권한 없음 → 403", async () => {
    login(STRANGER);
    const res = await get(CORR_PATH);
    expect(res.status).toBe(403);
    expect(state.signedPaths).toEqual([]);
  });

  it("근태 정정 — 본인 → 302", async () => {
    login(OWNER);
    const res = await get(CORR_PATH);
    expect(res.status).toBe(302);
  });

  it("근태 정정 — attendance.manage 관리자 → 302", async () => {
    login(STRANGER, ORG, ["attendance.manage"]);
    const res = await get(CORR_PATH);
    expect(res.status).toBe(302);
  });

  it("근태 정정 — 올린 사람이어도 그 조직 활성 멤버가 아니면 403", async () => {
    login(OWNER, OTHER_ORG);
    const res = await get(CORR_PATH);
    expect(res.status).toBe(403);
  });

  it("연차 사진 — 권한 없고 기록 없음 → 403", async () => {
    login(STRANGER);
    const res = await get(`${ORG}/annual-leave-requests/${REC}/a.jpg`);
    expect(res.status).toBe(403);
  });

  it("경로 장난 · 모르는 폴더 · 칸 수 → 400", async () => {
    login(OWNER, ORG, ["attendance.manage"]);
    for (const bad of [
      `${ORG}/complaint-images/%2E%2E/a.jpg`,
      `${ORG}/complaint-images/${REC}%2Fa.jpg`,
      `${ORG}/complaint-images/${REC}%5Ca.jpg`,
      `${ORG}/complaint-images//a.jpg`,
      `${ORG}/complaint-images`,
      `${ORG}/unknown-folder/${REC}/a.jpg`,
      `${ORG}/transport-reimbursements/${REC}/${REC}/a.jpg`,
      `not-a-uuid/complaint-images/${REC}/a.jpg`,
      `${ORG}/complaint-images/${REC}/x/a.jpg`,
    ]) {
      const res = await get(bad);
      expect(res.status, bad).toBe(400);
    }
    expect(state.signedPaths).toEqual([]);
  });

  it("5칸 폴더(complaint-comment-images)는 5칸만", async () => {
    login(STRANGER);
    expect(
      (await get(`${ORG}/complaint-comment-images/${REC}/${REC}/a.jpg`)).status,
    ).toBe(302);
  });

  it("서명 실패 → 404", async () => {
    login(STRANGER);
    state.signFails = true;
    const res = await get(`${ORG}/complaint-images/${REC}/a.jpg`);
    expect(res.status).toBe(404);
  });

  it("근태 정정 — 남의 사진 주소를 내 기록에 넣어도 올린 사람이 아니면 403 (주소 끼워 넣기)", async () => {
    login(STRANGER);
    state.corrections.push({
      id: "c2",
      organization_id: ORG,
      requested_by_user_id: STRANGER,
      image_urls: [
        `${BASE}/storage/v1/object/public/request-images/${CORR_PATH}`,
      ],
    });
    const res = await get(CORR_PATH);
    expect(res.status).toBe(403);
    expect(state.signedPaths).toEqual([]);
  });

  it("근태 정정 — 올린 사람(storage owner)이면 기록이 아직 없어도 302", async () => {
    login(OWNER);
    state.corrections = [];
    expect((await get(CORR_PATH)).status).toBe(302);
  });

  it("근태 정정 — 주인 확인을 못 읽으면 403", async () => {
    login(OWNER);
    state.rpcFails = true;
    expect((await get(CORR_PATH)).status).toBe(403);
  });

  it("근태 정정 · 연차 사진은 no-store, 다른 폴더는 private max-age=240", async () => {
    login(OWNER);
    const restricted = await get(CORR_PATH);
    expect(restricted.headers.get("cache-control")).toBe("no-store");
    const leavePath = `${ORG}/annual-leave-requests/${REC}/a.jpg`;
    state.objects.push({ name: leavePath, owner_id: OWNER });
    expect((await get(leavePath)).headers.get("cache-control")).toBe(
      "no-store",
    );
    const open = await get(`${ORG}/lost-items/${REC}/a.jpg`);
    expect(open.headers.get("cache-control")).toBe("private, max-age=240");
  });

  it("?as=json — 같은 검사 후 200 { url } · no-store", async () => {
    login(STRANGER);
    const res = await get(`${ORG}/complaint-images/${REC}/a.jpg`, "?as=json");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { url: string };
    expect(body.url).toContain("/object/sign/request-images/");
  });

  it("?as=json — 오류도 같은 상태 코드에 JSON 본문", async () => {
    const unauth = await get(
      `${ORG}/complaint-images/${REC}/a.jpg`,
      "?as=json",
    );
    expect(unauth.status).toBe(401);
    expect(await unauth.json()).toEqual({ error: "unauthorized" });
    login(STRANGER);
    const forbidden = await get(CORR_PATH, "?as=json");
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "forbidden" });
    const bad = await get(`${ORG}/unknown/${REC}/a.jpg`, "?as=json");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "bad_request" });
    state.signFails = true;
    const missing = await get(
      `${ORG}/complaint-images/${REC}/a.jpg`,
      "?as=json",
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not_found" });
  });

  describe("할 일 · 제안 · 버그 사진 — 표 RLS 와 같은 범위(2026-11-27 「셋 다 좁히기」)", () => {
    const TASK_PATH = `${ORG}/task-images/${REC}/t.jpg`;
    const UPDATE_PATH = `${ORG}/task-update-images/${REC}/u.jpg`;
    const SUGG_PATH = `${ORG}/suggestion-images/${REC}/s.jpg`;
    const BUG_ID = "44444444-4444-4444-8444-444444444444";
    const BUG_PATH = `${ORG}/bug-reports/${BUG_ID}/b.jpg`;
    const pub = (path: string) =>
      `${BASE}/storage/v1/object/public/request-images/${path}`;

    beforeEach(() => {
      state.rls = {
        tasks: [
          {
            id: "t1",
            organization_id: ORG,
            deleted_at: null,
            image_urls: [pub(TASK_PATH)],
            visibleTo: [OWNER],
          },
        ],
        task_updates: [
          {
            id: "u1",
            tasks: { organization_id: ORG, deleted_at: null },
            image_urls: [pub(UPDATE_PATH)],
            visibleTo: [OWNER],
          },
        ],
        staff_suggestions: [],
        staff_suggestion_comments: [
          {
            id: "sc1",
            organization_id: ORG,
            image_urls: [
              `${BASE}/storage/v1/object/request-images/${SUGG_PATH}`,
            ],
            visibleTo: [OWNER],
          },
        ],
      };
      state.bugs = [
        { id: BUG_ID, organization_id: ORG, reported_by_user_id: OWNER },
      ];
    });

    it("참여자가 아니면 403 — 할 일 · 메모 · 제안", async () => {
      login(STRANGER);
      for (const path of [TASK_PATH, UPDATE_PATH, SUGG_PATH]) {
        expect((await get(path)).status, path).toBe(403);
      }
      expect(state.signedPaths).toEqual([]);
    });

    it("그 행을 읽을 수 있는 참여자 → 302 · no-store", async () => {
      login(OWNER);
      for (const path of [TASK_PATH, UPDATE_PATH, SUGG_PATH]) {
        const res = await get(path);
        expect(res.status, path).toBe(302);
        expect(res.headers.get("cache-control"), path).toBe("no-store");
      }
    });

    it("지운(소프트 삭제) 할 일 · 지운 할 일의 메모 사진은 참여자여도 403", async () => {
      login(OWNER);
      state.rls.tasks[0].deleted_at = "2026-11-27T00:00:00Z";
      state.rls.task_updates[0].tasks = {
        organization_id: ORG,
        deleted_at: "2026-11-27T00:00:00Z",
      };
      expect((await get(TASK_PATH)).status).toBe(403);
      expect((await get(UPDATE_PATH)).status).toBe(403);
    });

    it("다른 조직 행에 같은 주소가 있어도 그 경로 조직 행만 본다", async () => {
      login(OWNER);
      state.rls.tasks[0].organization_id = OTHER_ORG;
      state.rls.task_updates[0].tasks = {
        organization_id: OTHER_ORG,
        deleted_at: null,
      };
      expect((await get(TASK_PATH)).status).toBe(403);
      expect((await get(UPDATE_PATH)).status).toBe(403);
    });

    it("올린 사람(storage owner)은 아직 저장 전이어도 302", async () => {
      login(STRANGER);
      state.objects.push(
        { name: TASK_PATH, owner_id: STRANGER },
        { name: SUGG_PATH, owner_id: STRANGER },
      );
      expect((await get(TASK_PATH)).status).toBe(302);
      expect((await get(SUGG_PATH)).status).toBe(302);
    });

    it("버그 사진 — 신고한 사람 302 · 검토자(bug.review) 302 · 다른 멤버 403 · 모두 no-store", async () => {
      login(OWNER);
      const own = await get(BUG_PATH);
      expect(own.status).toBe(302);
      expect(own.headers.get("cache-control")).toBe("no-store");
      login(STRANGER, ORG, ["bug.review"]);
      expect((await get(BUG_PATH)).status).toBe(302);
      login(STRANGER);
      expect((await get(BUG_PATH)).status).toBe(403);
    });

    it("버그 사진 — 세션 조직이 아니면 그 조직의 bug.review 권한으로 본다", async () => {
      login(STRANGER, OTHER_ORG, ["bug.review"]);
      state.memberships = [
        { organization_id: ORG, user_id: STRANGER, status: "active" },
      ];
      expect((await get(BUG_PATH)).status).toBe(403);
      state.otherOrgCaps = ["bug.review"];
      expect((await get(BUG_PATH)).status).toBe(302);
    });

    it("버그 사진 — 플랫폼 개발자는 그 조직 멤버면 302, 신고 행이 없으면 누구도 403", async () => {
      state.session = {
        organization: { id: ORG },
        user: { id: STRANGER, role: "developer_super_admin" },
        capabilities: [],
      };
      expect((await get(BUG_PATH)).status).toBe(302);
      state.bugs = [];
      login(OWNER, ORG, ["bug.review"]);
      expect((await get(BUG_PATH)).status).toBe(403);
    });

    it("RLS 조회 오류 → 403 그대로, 짧은 표시와 코드만 남긴다(경로 · 주소 없음)", async () => {
      login(OWNER);
      state.rlsError = true;
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect((await get(TASK_PATH)).status).toBe(403);
      expect(spy).toHaveBeenCalledWith("[request-images] row check failed", { folder: "task-images", code: "XX000" });
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).not.toContain(ORG);
      expect(logged).not.toContain("http");
      spy.mockRestore();
    });

    it("다른 폴더는 RLS 조회를 하지 않는다", async () => {
      login(STRANGER);
      await get(`${ORG}/lost-items/${REC}/a.jpg`);
      expect(state.rlsQueries).toEqual([]);
    });
  });
});
