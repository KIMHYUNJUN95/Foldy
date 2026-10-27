import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/staff-documents/server", () => ({ STAFF_DOCUMENT_BUCKET: "staff-documents" }));

import { cleanupOrphanIdUploads, ORPHAN_UPLOAD_GRACE_MS } from "@/lib/staff-documents/retention";

/** 행 없는 서류 사진 폴더 정리(docs/product/41 「R4 구현」) — 가짜 저장소 · 가짜 표. */
const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const KEPT = "33333333-3333-4333-8333-333333333333";
const OLD = "44444444-4444-4444-8444-444444444444";
const FRESH = "55555555-5555-4555-8555-555555555555";
const NOW = Date.parse("2026-10-27T03:00:00Z");
const old = new Date(NOW - ORPHAN_UPLOAD_GRACE_MS - 60_000).toISOString();
const fresh = new Date(NOW - 60_000).toISOString();

function fake() {
  const tree: Record<string, { name: string; id: string | null; updated_at?: string }[]> = {
    "": [{ name: ORG, id: null }],
    [ORG]: [{ name: USER, id: null }],
    [`${ORG}/${USER}`]: [
      { name: KEPT, id: null },
      { name: OLD, id: null },
      { name: FRESH, id: null },
    ],
    [`${ORG}/${USER}/${KEPT}`]: [{ name: "front-a.jpg", id: "f1", updated_at: old }],
    [`${ORG}/${USER}/${OLD}`]: [
      { name: "front-b.jpg", id: "f2", updated_at: old },
      { name: "back-b.jpg", id: "f3", updated_at: old },
    ],
    [`${ORG}/${USER}/${FRESH}`]: [
      { name: "front-c.jpg", id: "f4", updated_at: old },
      { name: "back-c.jpg", id: "f5", updated_at: fresh },
    ],
  };
  const removed: string[][] = [];
  const bucket = {
    list: async (prefix: string) => ({ data: tree[prefix] ?? [], error: null }),
    remove: async (paths: string[]) => {
      removed.push(paths);
      return { error: null };
    },
  };
  const query = {
    select: () => query,
    eq: () => query,
    in: async (_col: string, ids: string[]) => ({ data: ids.filter((id) => id === KEPT).map((id) => ({ id })), error: null }),
  };
  const service = { storage: { from: () => bucket }, from: () => query };
  return { service, removed };
}

describe("cleanupOrphanIdUploads", () => {
  it("행 없고 모두 24시간 지난 폴더만 지운다 — 행 있는 폴더 · 방금 올린 사진이 있는 폴더는 그대로", async () => {
    const { service, removed } = fake();
    const res = await cleanupOrphanIdUploads(service as never, NOW);
    expect(res).toEqual({ checked: true, removed: 1 });
    expect(removed).toEqual([[`${ORG}/${USER}/${OLD}/front-b.jpg`, `${ORG}/${USER}/${OLD}/back-b.jpg`]]);
  });
});
