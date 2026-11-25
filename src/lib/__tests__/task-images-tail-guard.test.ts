import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupRemovedTaskImages,
  cleanupRemovedTaskUpdateImages,
  isOrgTaskImageUrl,
  mergeTaskImageUrls,
} from "@/lib/task-images";

/**
 * 사진 주소 꼬리로 동료 파일 지우기 (2026-11-25 할 일 점검 A).
 *
 * `extractRequestImagePath` 는 `?…` · `#…` 를 무시하는데 「다른 할 일이 아직 쓰는가」는 주소 문자열 전체로 비교했다.
 * 동료 사진 주소에 `?x=1` 을 붙여 내 할 일에 저장했다가 떼면 동료의 파일이 지워졌다.
 * 받을 때는 표준 모양이 아닌 주소를 거절하고, 지울 때는 저장소 경로로 비교한다.
 */

const BASE = "https://proj.supabase.co";
const ORG = "org-1";
const pub = (path: string) => `${BASE}/storage/v1/object/public/request-images/${path}`;

type Row = Record<string, unknown> & { image_urls: string[] };

/** select · eq · neq · filter · overlaps · range · storage.remove 만 흉내 낸 서비스 클라이언트. */
type FakeOpts = {
  failOn?: string;
  maxRows?: number;
  /** n 번째(1부터) 읽기만 실패시킨다. */
  failOnRead?: number;
  /** 읽기 한 번이 끝날 때마다(쪽 사이) 부른다 — 그 사이 표를 바꿔 보는 데 쓴다. */
  afterRead?: (n: number) => void;
};

function fakeClient(tables: Record<string, Row[]>, opts: FakeOpts = {}) {
  const removed: string[][] = [];
  const orders: string[] = [];
  let reads = 0;
  const client = {
    from(table: string) {
      let rows = tables[table] ?? [];
      const pick = (r: Row, col: string): unknown =>
        col.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown> | null)?.[key], r);
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => ((rows = rows.filter((r) => pick(r, col) === val)), q),
        neq: (col: string, val: unknown) => (
          (rows = rows.filter((r) => {
            const v = pick(r, col);
            return !(Array.isArray(v) && val === "{}" ? v.length === 0 : v === val);
          })),
          q
        ),
        filter: (col: string, op: string, val: unknown) => (op === "neq" ? q.neq(col, val) : q),
        overlaps: (col: string, vals: string[]) => (
          (rows = rows.filter((r) => (pick(r, col) as string[]).some((v) => vals.includes(v)))), q
        ),
        order: (col: string) => (
          orders.push(`${table}.${col}`),
          (rows = [...rows].sort((a, b) => String(pick(a, col)).localeCompare(String(pick(b, col))))),
          q
        ),
        gt: (col: string, val: string) => ((rows = rows.filter((r) => String(pick(r, col)) > val)), q),
        // 서버의 한 번 최대 줄 수(max rows)가 요청한 쪽 크기보다 작을 수 있다.
        limit: (n: number) => ((rows = rows.slice(0, Math.min(n, opts.maxRows ?? Infinity))), q),
        then: (resolve: (v: unknown) => void) => {
          reads += 1;
          const fail = opts.failOn === table || opts.failOnRead === reads;
          const out = fail ? { data: null, error: { message: "boom" } } : { data: rows.map((r) => ({ ...r })), error: null };
          opts.afterRead?.(reads);
          resolve(out);
        },
      };
      return q;
    },
    storage: { from: () => ({ remove: async (paths: string[]) => (removed.push(paths), { error: null }) }) },
  };
  return { client: client as never, removed, orders };
}

describe("사진 주소는 표준 모양만 받는다 (2026-11-25)", () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev;
  });

  const peer = pub(`${ORG}/task-images/req/peer.jpg`);

  it("표준 주소는 그대로 받는다", () => {
    expect(isOrgTaskImageUrl(peer, ORG)).toBe(true);
    expect(isOrgTaskImageUrl(pub(`${ORG}/task-update-images/r/a.png`), ORG, "task-update-images")).toBe(true);
  });

  it("쿼리 · 해시 · 사용자 정보 · 포트가 붙은 주소는 거절한다", () => {
    expect(isOrgTaskImageUrl(`${peer}?x=1`, ORG)).toBe(false);
    expect(isOrgTaskImageUrl(`${peer}?`, ORG)).toBe(false);
    expect(isOrgTaskImageUrl(`${peer}#a`, ORG)).toBe(false);
    expect(isOrgTaskImageUrl(peer.replace("https://", "https://u:p@"), ORG)).toBe(false);
    expect(isOrgTaskImageUrl(peer.replace("supabase.co", "supabase.co:443"), ORG)).toBe(false);
    expect(isOrgTaskImageUrl(peer.replace("supabase.co", "supabase.co:8443"), ORG)).toBe(false);
  });

  it("같은 경로를 퍼센트 인코딩 · 대문자 호스트 · 겹 빗금으로 달리 쓴 주소도 거절한다", () => {
    expect(isOrgTaskImageUrl(peer.replace("peer.jpg", "%70eer.jpg"), ORG)).toBe(false);
    expect(isOrgTaskImageUrl(peer.replace("/req/", "%2Freq%2F"), ORG)).toBe(false);
    expect(isOrgTaskImageUrl(peer.replace("proj.supabase.co", "PROJ.supabase.co"), ORG)).toBe(false);
    expect(isOrgTaskImageUrl(peer.replace("/req/", "/req//"), ORG)).toBe(false);
  });

  it("편집 merge 는 꼬리 붙은 새 주소를 버린다", () => {
    expect(mergeTaskImageUrls([], [`${peer}?x=1`, peer], false, ORG)).toEqual([peer]);
  });
});

describe("지울 때는 저장소 경로로 참조를 비교한다 (2026-11-25)", () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev;
  });

  const peer = pub(`${ORG}/task-images/req/peer.jpg`);
  const peerPath = `${ORG}/task-images/req/peer.jpg`;

  it("내 할 일에서 뗀 꼬리 붙은 주소는 동료 파일을 지우지 않는다(이미 DB 에 들어간 경우)", async () => {
    const { client, removed } = fakeClient({
      tasks: [{ id: "peer-task", organization_id: ORG, image_urls: [peer] }],
    });
    await cleanupRemovedTaskImages(client, [`${peer}?x=1`], ORG);
    expect(removed).toEqual([]);
  });

  it("다른 할 일이 꼬리 붙은 주소로 같은 파일을 쓰고 있으면 지우지 않는다", async () => {
    const { client, removed } = fakeClient({
      tasks: [{ id: "other", organization_id: ORG, image_urls: [`${peer}?x=1`] }],
    });
    await cleanupRemovedTaskImages(client, [peer], ORG);
    expect(removed).toEqual([]);
  });

  it("아무도 쓰지 않는 표준 주소는 지운다", async () => {
    const { client, removed } = fakeClient({
      tasks: [{ id: "other", organization_id: ORG, image_urls: [pub(`${ORG}/task-images/req/else.jpg`)] }],
    });
    await cleanupRemovedTaskImages(client, [peer], ORG);
    expect(removed).toEqual([[peerPath]]);
  });

  it("참조 확인이 실패하면 아무것도 지우지 않는다", async () => {
    const { client, removed } = fakeClient({ tasks: [] }, { failOn: "tasks" });
    await cleanupRemovedTaskImages(client, [peer], ORG);
    expect(removed).toEqual([]);
  });

  it("메모 사진도 같은 규칙 — 꼬리 붙은 참조가 남아 있으면 지우지 않는다", async () => {
    const memo = pub(`${ORG}/task-update-images/r/m.jpg`);
    const { client, removed } = fakeClient({
      task_updates: [{ task_id: "t2", image_urls: [`${memo}#x`], tasks: { organization_id: ORG } }],
    });
    await cleanupRemovedTaskUpdateImages(client, [memo], ORG);
    expect(removed).toEqual([]);
  });

  it("메모 사진 — 꼬리 붙은 후보는 지우지 않는다", async () => {
    const memo = pub(`${ORG}/task-update-images/r/m.jpg`);
    const { client, removed } = fakeClient({ task_updates: [] });
    await cleanupRemovedTaskUpdateImages(client, [`${memo}?x=1`], ORG);
    expect(removed).toEqual([]);
  });
});

describe("참조 읽기는 끝까지 · 정해진 순서로 (2026-11-25)", () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev;
  });

  const target = pub(`${ORG}/task-images/req/target.jpg`);
  const filler = (n: number): Row[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `t-${String(i).padStart(5, "0")}`,
      organization_id: ORG,
      image_urls: [pub(`${ORG}/task-images/f/${i}.jpg`)],
    }));

  it("서버가 한 번에 300줄만 돌려줘도 뒤쪽 참조를 찾는다", async () => {
    const rows = [...filler(700), { id: "t-99999", organization_id: ORG, image_urls: [target] }];
    const { client, removed } = fakeClient({ tasks: rows }, { maxRows: 300 });
    await cleanupRemovedTaskImages(client, [target], ORG);
    expect(removed).toEqual([]);
  });

  it("쪽 사이에 앞쪽 줄이 지워져도 뒤쪽 참조를 놓치지 않는다", async () => {
    const rows = [...filler(1500), { id: "t-99999", organization_id: ORG, image_urls: [target] }];
    const tables = { tasks: rows };
    // 첫 쪽(1,000줄)을 읽은 뒤 앞쪽 10줄이 지워진다 — 건너뛸 줄 수로 넘기면 1,000~1,009번째를 놓친다.
    const late = pub(`${ORG}/task-images/f/1005.jpg`);
    const { client, removed } = fakeClient(tables, { afterRead: (n) => n === 1 && void rows.splice(0, 10) });
    await cleanupRemovedTaskImages(client, [late, target], ORG);
    expect(removed).toEqual([]);
  });

  it("두 번째 쪽에서 오류가 나면 아무것도 지우지 않는다", async () => {
    const gone = pub(`${ORG}/task-images/req/gone.jpg`);
    const { client, removed } = fakeClient({ tasks: filler(1200) }, { failOnRead: 2 });
    await cleanupRemovedTaskImages(client, [gone], ORG);
    expect(removed).toEqual([]);
  });

  it("나눠 읽기에 id 순서를 건다(할 일 · 메모 둘 다)", async () => {
    const a = fakeClient({ tasks: filler(2) });
    await cleanupRemovedTaskImages(a.client, [target], ORG);
    expect(a.orders).toContain("tasks.id");
    const memo = pub(`${ORG}/task-update-images/r/m.jpg`);
    const b = fakeClient({ task_updates: [] });
    await cleanupRemovedTaskUpdateImages(b.client, [memo], ORG);
    expect(b.orders).toContain("task_updates.id");
  });
});

describe("업로드가 만든 주소는 늘 받는다 (2026-11-25)", () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev;
  });

  it("확장자 대신 MIME 꼬리(svg+xml)를 쓴 이름도 getPublicUrl 주소 그대로 통과", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const storage = createClient(BASE, "anon-key-for-test").storage.from("request-images");
    for (const name of ["a.svg+xml", "a.x-icon", "a.jpeg"]) {
      const url = storage.getPublicUrl(`${ORG}/task-images/req/${name}`).data.publicUrl;
      expect(isOrgTaskImageUrl(url, ORG)).toBe(true);
    }
    const plus = storage.getPublicUrl(`${ORG}/task-images/req/a.svg+xml`).data.publicUrl;
    expect(isOrgTaskImageUrl(plus.replace("+", "%2B"), ORG)).toBe(false);
    expect(isOrgTaskImageUrl(`${plus}?x=1`, ORG)).toBe(false);
  });
});
