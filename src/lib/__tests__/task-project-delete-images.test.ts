import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupRemovedTaskUpdateImages, collectProjectImageUrls } from "@/lib/task-images";

const BASE = "https://proj.supabase.co";
const ORG = "org-1";
const pub = (path: string) => `${BASE}/storage/v1/object/public/request-images/${path}`;

type Row = Record<string, unknown> & { image_urls: string[] };

/** 이 테스트에 필요한 만큼만 흉내 낸 서비스 클라이언트 — select · eq · in · overlaps · storage.remove. */
function fakeClient(tables: Record<string, Row[]>, opts: { failOn?: string } = {}) {
  const removed: string[][] = [];
  const client = {
    from(table: string) {
      let rows = tables[table] ?? [];
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => ((rows = rows.filter((r) => r[col] === val)), q),
        in: (col: string, vals: unknown[]) => ((rows = rows.filter((r) => vals.includes(r[col]))), q),
        overlaps: (col: string, vals: string[]) => (
          (rows = rows.filter((r) => (r[col] as string[]).some((v) => vals.includes(v)))), q
        ),
        then: (resolve: (v: unknown) => void) =>
          resolve(opts.failOn === table ? { data: null, error: { message: "boom" } } : { data: rows, error: null }),
      };
      return q;
    },
    storage: { from: () => ({ remove: async (paths: string[]) => (removed.push(paths), { error: null }) }) },
  };
  return { client: client as never, removed };
}

describe("프로젝트 삭제 — 메모 사진도 정리 (2026-10-29)", () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev;
  });

  it("프로젝트 할 일의 할 일 사진과 메모 사진을 따로 모은다", async () => {
    const t1 = pub(`${ORG}/task-images/r/a.jpg`);
    const u1 = pub(`${ORG}/task-update-images/r/b.jpg`);
    const { client } = fakeClient({
      tasks: [
        { id: "t1", project_id: "p1", organization_id: ORG, image_urls: [t1] },
        { id: "t2", project_id: "p2", organization_id: ORG, image_urls: [pub(`${ORG}/task-images/r/x.jpg`)] },
      ],
      task_updates: [
        { task_id: "t1", image_urls: [u1] },
        { task_id: "t2", image_urls: [pub(`${ORG}/task-update-images/r/y.jpg`)] },
      ],
    });
    expect(await collectProjectImageUrls(client, "p1", ORG)).toEqual({ taskImageUrls: [t1], updateImageUrls: [u1] });
  });

  it("메모 사진은 우리 조직 task-update-images 것만, 아직 다른 메모가 쓰면 남긴다", async () => {
    const gone = pub(`${ORG}/task-update-images/r/gone.jpg`);
    const kept = pub(`${ORG}/task-update-images/r/kept.jpg`);
    const { client, removed } = fakeClient({ task_updates: [{ task_id: "other", image_urls: [kept] }] });
    await cleanupRemovedTaskUpdateImages(
      client,
      [gone, kept, pub(`org-2/task-update-images/r/z.jpg`), pub(`${ORG}/task-images/r/t.jpg`)],
      ORG,
    );
    expect(removed).toEqual([[`${ORG}/task-update-images/r/gone.jpg`]]);
  });

  it("참조 확인이 실패하면 아무것도 지우지 않는다", async () => {
    const { client, removed } = fakeClient({ task_updates: [] }, { failOn: "task_updates" });
    await cleanupRemovedTaskUpdateImages(client, [pub(`${ORG}/task-update-images/r/a.jpg`)], ORG);
    expect(removed).toEqual([]);
  });
});
