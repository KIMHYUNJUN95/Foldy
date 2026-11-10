import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "./fake-supabase";

/**
 * 모바일 분실물 처리(`updateLostItemHandling`) — 동시 저장(2026-11-10).
 * 두 사람이 같은 상태에서 사진 · 메모를 동시에 저장하면, 나중 사람이 먼저 사람의 사진을 지우지 않고 conflict 를 받는다
 * (수리 처리와 같은 `updated_at` 조건). 실제 DB 는 부르지 않는다(가짜 Supabase).
 */

const ORG = "org-1";
const USER = "11111111-1111-4111-8111-111111111111";
const ITEM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let fake = createFakeSupabase({});
let beforeUpdate: (() => void) | null = null;

function client() {
  return {
    ...fake.client,
    from(table: string) {
      const builder = fake.client.from(table) as unknown as Record<string, (...args: unknown[]) => unknown>;
      const originalUpdate = builder.update;
      builder.update = (value: unknown) => {
        const hook = beforeUpdate;
        beforeUpdate = null;
        hook?.();
        return originalUpdate(value);
      };
      return builder;
    },
  };
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: async () => client() }));
vi.mock("@/lib/session", () => ({
  getCurrentAppSession: async () => ({
    capabilities: ["lost_found.handle"],
    organization: { id: ORG },
    user: { id: USER, role: "field_manager" },
  }),
}));

const { updateLostItemHandling } = await import("@/app/mobile/requests/lost-found/actions");

const READ_AT = "2026-11-10T01:00:00.000Z";

function row() {
  return {
    handled_at: null,
    handled_by: null,
    handling_image_urls: ["mine-earlier"],
    handling_memo: null,
    id: ITEM,
    organization_id: ORG,
    status: "stored",
    updated_at: READ_AT,
  };
}

/** 가짜 표는 읽은 행을 참조로 돌려주므로, 「다른 사람이 바꿈」은 새 객체로 갈아 끼워 흉내 낸다. */
function replaceRow(patch: Record<string, unknown>) {
  fake.tables.lost_items[0] = { ...fake.tables.lost_items[0], ...patch };
}

const input = { handlingImageUrls: [], itemId: ITEM, memo: "메모", status: "stored" as const };

beforeEach(() => {
  beforeUpdate = null;
  fake = createFakeSupabase({ lost_items: [row()] });
});

describe("모바일 분실물 처리 — 동시 저장", () => {
  it("아무도 안 바꿨으면 저장한다", async () => {
    expect(await updateLostItemHandling(input)).toEqual({ ok: true });
    expect(fake.tables.lost_items[0].handling_memo).toBe("메모");
  });

  it("상태는 같아도 그 사이 다른 사람이 사진을 올렸으면 덮어쓰지 않고 conflict", async () => {
    beforeUpdate = () => {
      replaceRow({ handling_image_urls: ["mine-earlier", "other-person"], updated_at: "2026-11-10T01:00:05.000Z" });
    };
    expect(await updateLostItemHandling(input)).toEqual({ ok: false, error: "conflict" });
    expect(fake.tables.lost_items[0].handling_image_urls).toEqual(["mine-earlier", "other-person"]);
    expect(fake.tables.lost_items[0].handling_memo).toBeNull();
  });

  it("그 사이 상태가 바뀌었어도 conflict", async () => {
    beforeUpdate = () => {
      replaceRow({ status: "returned", updated_at: "2026-11-10T01:00:05.000Z" });
    };
    expect(await updateLostItemHandling(input)).toEqual({ ok: false, error: "conflict" });
  });
});
