import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 분실물 자동 삭제 — 폐기 후 도쿄 기준 90일 지난 행을 사진 먼저 · 행 나중으로 지운다(2026-11-26).
 * 사진 삭제가 실패한 행은 남겨 다음 날 다시 찾게 한다.
 */
const ORG = "org-1";
const OTHER_ORG = "org-2";
const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "33333333-3333-4333-8333-333333333333";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const BASE = "https://proj.supabase.co";
const url = (folder: string, name: string, id = ID, org = ORG) =>
  `${BASE}/storage/v1/object/public/request-images/${org}/${folder}/${id}/${name}`;

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  removeErrorFor: null as null | string,
  removed: [] as string[][],
  deletedIds: [] as string[],
  deleteFilters: [] as Array<Record<string, unknown>>,
}));

vi.mock("server-only", () => ({}));

function fakeService() {
  return {
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.lt = () => chain;
      chain.not = () => chain;
      chain.order = () => chain;
      chain.limit = async () => ({ data: state.rows, error: null });
      chain.delete = () => {
        const filters: Record<string, unknown> = {};
        const del: Record<string, unknown> = {};
        del.eq = (col: string, value: unknown) => {
          filters[col] = value;
          return del;
        };
        del.select = async () => {
          state.deleteFilters.push(filters);
          state.deletedIds.push(filters.id as string);
          return { data: [{ id: filters.id }], error: null };
        };
        return del;
      };
      return chain;
    },
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          state.removed.push(paths);
          if (state.removeErrorFor && paths.some((p) => p.includes(state.removeErrorFor!))) {
            return { data: null, error: { message: "storage down" } };
          }
          return { data: [], error: null };
        },
      }),
    },
  };
}

vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => fakeService() }));

import { isLostItemPurgeDue, purgeDisposedLostItems } from "@/lib/lost-found-purge";
import { LOST_ITEM_PHOTO_COLUMNS, requestPhotoPaths } from "@/lib/request-photos";
import { GET } from "@/app/api/lost-found/purge/route";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
  process.env.CRON_SECRET = "cron-test-secret";
  state.rows = [];
  state.removeErrorFor = null;
  state.removed = [];
  state.deletedIds = [];
  state.deleteFilters = [];
});

describe("90일 판정(도쿄 날짜)", () => {
  it("도쿄 날짜 + 90 이 오늘보다 앞일 때만", () => {
    // 2026-08-27 도쿄 + 90 = 2026-11-25
    expect(isLostItemPurgeDue("2026-08-27T03:00:00+09:00", "2026-11-26")).toBe(true);
    expect(isLostItemPurgeDue("2026-08-28T03:00:00+09:00", "2026-11-26")).toBe(false); // +90 = 오늘
  });

  it("UTC 로는 전날이어도 도쿄 날짜로 판정", () => {
    // UTC 2026-08-27 16:00 = 도쿄 2026-08-28 01:00 → +90 = 2026-11-26(오늘) → 아직
    expect(isLostItemPurgeDue("2026-08-27T16:00:00Z", "2026-11-26")).toBe(false);
    // UTC 2026-08-27 14:00 = 도쿄 2026-08-27 23:00 → +90 = 2026-11-25 → 대상
    expect(isLostItemPurgeDue("2026-08-27T14:00:00Z", "2026-11-26")).toBe(true);
  });

  it("handled_at 이 없으면 지우지 않는다", () => {
    expect(isLostItemPurgeDue(null, "2026-11-26")).toBe(false);
  });
});

describe("경로 고르기", () => {
  it("이 조직 · 이 기록 폴더 아래 파일만", () => {
    const paths = requestPhotoPaths(
      {
        image_urls: [url("lost-items", "a.jpg"), url("lost-items", "b.jpg", ID, OTHER_ORG), url("lost-items", "c.jpg", OTHER_ID)],
        handling_image_urls: [url("lost-found-handling", "d.jpg"), url("lost-items", "e.jpg").replace("lost-items", "maintenance-reports")],
      },
      LOST_ITEM_PHOTO_COLUMNS,
      ORG,
      ID,
    );
    expect(paths).toEqual([`${ORG}/lost-items/${ID}/a.jpg`, `${ORG}/lost-found-handling/${ID}/d.jpg`]);
  });
});

describe("purgeDisposedLostItems", () => {
  const today = "2026-11-26";
  const old = "2026-08-01T03:00:00+09:00";

  it("사진 먼저 지우고 행을 status='disposed' 조건으로 지운다", async () => {
    state.rows = [
      { id: ID, organization_id: ORG, handled_at: old, image_urls: [url("lost-items", "a.jpg")], handling_image_urls: [] },
      { id: ID2, organization_id: ORG, handled_at: old, image_urls: [], handling_image_urls: [] },
    ];
    const result = await purgeDisposedLostItems(fakeService() as never, today);
    expect(state.removed).toEqual([[`${ORG}/lost-items/${ID}/a.jpg`]]);
    expect(state.deletedIds).toEqual([ID, ID2]);
    expect(state.deleteFilters[0]).toMatchObject({ id: ID, organization_id: ORG, status: "disposed" });
    expect(result).toEqual({ checked: 2, deleted: 2, photosRemoved: 1, photoFailures: 0, deleteFailures: 0 });
  });

  it("사진 삭제가 실패한 행은 지우지 않는다", async () => {
    state.rows = [
      { id: ID, organization_id: ORG, handled_at: old, image_urls: [url("lost-items", "a.jpg")], handling_image_urls: [] },
      { id: ID2, organization_id: ORG, handled_at: old, image_urls: [url("lost-items", "b.jpg", ID2)], handling_image_urls: [] },
    ];
    state.removeErrorFor = ID;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await purgeDisposedLostItems(fakeService() as never, today);
    spy.mockRestore();
    expect(state.deletedIds).toEqual([ID2]);
    expect(result).toMatchObject({ checked: 2, deleted: 1, photoFailures: 1 });
  });

  it("아직 90일이 안 된 행은 읽혀도 건드리지 않는다", async () => {
    state.rows = [{ id: ID, organization_id: ORG, handled_at: "2026-11-01T03:00:00+09:00", image_urls: [url("lost-items", "a.jpg")], handling_image_urls: [] }];
    const result = await purgeDisposedLostItems(fakeService() as never, today);
    expect(state.removed).toEqual([]);
    expect(state.deletedIds).toEqual([]);
    expect(result).toMatchObject({ checked: 0, deleted: 0 });
  });
});

describe("/api/lost-found/purge 인증", () => {
  it("헤더가 없으면 돌지 않는다", async () => {
    const res = await GET(new NextRequest("http://localhost/api/lost-found/purge"));
    expect(res.status).toBe(403);
    expect(state.removed).toEqual([]);
  });

  it("주소의 ?secret= 은 받지 않는다", async () => {
    const res = await GET(new NextRequest("http://localhost/api/lost-found/purge?secret=cron-test-secret"));
    expect(res.status).toBe(403);
  });

  it("CRON_SECRET 이 없으면 닫혀 있다(404)", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(new NextRequest("http://localhost/api/lost-found/purge", { headers: { authorization: "Bearer x" } }));
    expect(res.status).toBe(404);
  });

  it("Bearer 헤더면 돌고 개수만 돌려준다", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/lost-found/purge", { headers: { authorization: "Bearer cron-test-secret" } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, checked: 0, deleted: 0, photosRemoved: 0, photoFailures: 0, deleteFailures: 0 });
  });
});
