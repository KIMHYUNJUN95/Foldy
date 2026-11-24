import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// 가짜 Supabase — 공지 콘솔 서버 액션의 분기(2026-11-12 공지 점검): 다시 게시한 게시 시각 · 동시 수정 충돌 ·
// 지우기 · 보관 뒤 알림 정리. 체인(from → select/update/delete → eq … → maybeSingle 또는 await)을 기록한다.
type Op = "select" | "insert" | "update" | "delete";
type Call = { table: string; op: Op; filters: Record<string, unknown>; payload?: unknown };
type Responder = (call: Call) => { data: unknown; error: { message: string } | null };

let responder: Responder = () => ({ data: null, error: null });
const events: string[] = [];
const calls: Call[] = [];

function builder(table: string) {
  const call: Call = { table, op: "select", filters: {} };
  const finish = () => {
    calls.push({ ...call, filters: { ...call.filters } });
    events.push(`${table}:${call.op}`);
    return Promise.resolve(responder(call));
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    insert: (payload: unknown) => ((call.op = "insert"), (call.payload = payload), chain),
    update: (payload: unknown) => ((call.op = "update"), (call.payload = payload), chain),
    delete: () => ((call.op = "delete"), chain),
    eq: (column: string, value: unknown) => ((call.filters[column] = value), chain),
    in: () => chain,
    maybeSingle: finish,
    single: finish,
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => finish().then(resolve, reject),
  };
  return chain;
}

const removed: string[][] = [];
const serviceClient = {
  from: (table: string) => builder(table),
  storage: {
    from: () => ({
      remove: async (paths: string[]) => {
        removed.push(paths);
        return { error: null };
      },
    }),
  },
};

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/lib/env", () => ({ getPublicSupabaseEnv: () => ({ url: "https://proj.supabase.co" }) }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
  }),
}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => serviceClient }));
let caps: string[] = ["announcement.create", "announcement.manage"];
vi.mock("@/lib/capabilities-server", () => ({
  memberCapabilities: async () => caps,
}));
vi.mock("@/lib/announcements", () => ({ getAnnouncementReadSummary: vi.fn() }));
const notify = vi.fn(async () => undefined);
const cleanupNotifications = vi.fn(async () => {
  events.push("notifications:cleanup");
});
vi.mock("@/lib/notifications/create", () => ({
  createImportantAnnouncementNotifications: (...args: unknown[]) => notify(...(args as [])),
  deleteAnnouncementNotifications: (...args: unknown[]) => cleanupNotifications(...(args as [])),
}));

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ID = "11111111-1111-4111-8111-111111111111";
const V1 = "2026-11-12T01:00:00.000000+00:00";
const OLD_PUBLISHED = "2026-10-01T00:00:00.000Z";
const img = (name: string) => `https://proj.supabase.co/storage/v1/object/public/announcement-images/${ORG}/${ID}/${name}`;

function existingRow(extra: Record<string, unknown> = {}) {
  return {
    id: ID,
    organization_id: ORG,
    title: "옛 제목",
    content: "옛 본문",
    created_by_user_id: USER,
    target_scope: "everyone",
    target_roles: [],
    status: "archived",
    is_important: false,
    is_pinned: false,
    show_popup_on_app_open: false,
    popup_until: null,
    allow_comments: false,
    image_urls: [img("old.jpg")],
    published_at: OLD_PUBLISHED,
    archived_at: "2026-10-20T00:00:00.000Z",
    created_at: OLD_PUBLISHED,
    updated_at: V1,
    ...extra,
  };
}

function scenario(row: Record<string, unknown> | null, write: Responder = () => ({ data: [{ id: ID }], error: null })) {
  responder = (call) => {
    if (call.table === "platform_admins") return { data: null, error: null };
    if (call.table === "announcements" && call.op === "select") return { data: row, error: null };
    return write(call);
  };
}

const baseInput = {
  announcementId: ID,
  organizationId: ORG,
  title: "새 제목",
  content: "새 본문",
  status: "published" as const,
  targetScope: "everyone" as const,
  targetRoles: [],
  imageUrls: [img("old.jpg")],
  isImportant: false,
  isPinned: false,
  showPopup: false,
  popupUntil: null,
};

import {
  deleteAnnouncementConsole,
  saveAnnouncementConsole,
  setAnnouncementStatusConsole,
} from "@/app/admin/announcements/actions";

beforeEach(() => {
  calls.length = 0;
  events.length = 0;
  removed.length = 0;
  notify.mockClear();
  cleanupNotifications.mockClear();
  caps = ["announcement.create", "announcement.manage"];
});

describe("saveAnnouncementConsole — 수정", () => {
  it("보관 공지를 수정 화면에서 게시하면 게시 시각을 지금으로", async () => {
    scenario(existingRow());
    const result = await saveAnnouncementConsole({ ...baseInput, expectedUpdatedAt: V1 });
    expect(result).toEqual({ ok: true });
    const update = calls.find((c) => c.op === "update");
    const payload = update?.payload as { published_at: string; archived_at: null };
    expect(payload.published_at).not.toBe(OLD_PUBLISHED);
    expect(Date.parse(payload.published_at)).toBeGreaterThan(Date.parse(OLD_PUBLISHED));
    expect(payload.archived_at).toBeNull();
  });

  it("게시 중 공지를 고치면 원래 게시 시각 그대로", async () => {
    scenario(existingRow({ status: "published", archived_at: null }));
    await saveAnnouncementConsole({ ...baseInput, expectedUpdatedAt: V1 });
    const payload = calls.find((c) => c.op === "update")?.payload as { published_at: string };
    expect(payload.published_at).toBe(OLD_PUBLISHED);
  });

  it("불러온 updated_at 으로만 고친다 — 0줄이면 conflict 이고 새로 올린 사진을 치운다", async () => {
    scenario(existingRow({ status: "published", archived_at: null }), () => ({ data: [], error: null }));
    const result = await saveAnnouncementConsole({
      ...baseInput,
      imageUrls: [img("old.jpg"), img("new.jpg")],
      expectedUpdatedAt: V1,
    });
    expect(result).toEqual({ ok: false, error: "conflict" });
    const update = calls.find((c) => c.op === "update");
    expect(update?.filters).toMatchObject({ id: ID, updated_at: V1 });
    expect(removed).toEqual([[`${ORG}/${ID}/new.jpg`]]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("입력이 틀리면(제목 없음) 수정 중 새로 올린 사진만 치운다 — 원래 사진은 그대로", async () => {
    scenario(existingRow({ status: "published" }));
    const result = await saveAnnouncementConsole({
      ...baseInput,
      title: "  ",
      imageUrls: [img("old.jpg"), img("new.jpg")],
      expectedUpdatedAt: V1,
    });
    expect(result).toEqual({ ok: false, error: "invalid_announcement" });
    expect(removed).toEqual([[`${ORG}/${ID}/new.jpg`]]);
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });
});

describe("saveAnnouncementConsole — 새 공지 입력 오류", () => {
  it("그 조직 작성 권한이 있으면 올린 사진을 치운다", async () => {
    scenario(null);
    await saveAnnouncementConsole({ ...baseInput, title: "", imageUrls: [img("new.jpg")] });
    expect(removed).toEqual([[`${ORG}/${ID}/new.jpg`]]);
  });

  it("작성 권한이 없으면 치우지 않는다(남의 폴더를 지우는 통로 막기)", async () => {
    caps = [];
    scenario(null);
    const result = await saveAnnouncementConsole({ ...baseInput, title: "", imageUrls: [img("new.jpg")] });
    expect(result).toEqual({ ok: false, error: "invalid_announcement" });
    expect(removed).toEqual([]);
  });
});

describe("지우기 · 보관 — 알림 정리", () => {
  it("지우기가 성공한 뒤에 그 공지 알림을 지운다", async () => {
    scenario(existingRow());
    expect(await deleteAnnouncementConsole(ID)).toEqual({ ok: true });
    expect(cleanupNotifications).toHaveBeenCalledWith(serviceClient, { organizationId: ORG, announcementId: ID });
    expect(events.indexOf("notifications:cleanup")).toBeGreaterThan(events.indexOf("announcements:delete"));
  });

  it("지우기가 실패하면 알림을 건드리지 않는다", async () => {
    scenario(existingRow(), () => ({ data: null, error: { message: "boom" } }));
    expect(await deleteAnnouncementConsole(ID)).toEqual({ ok: false, error: "save_failed" });
    expect(cleanupNotifications).not.toHaveBeenCalled();
  });

  it("게시 중 공지를 보관하거나 초안으로 내리면 알림을 지운다", async () => {
    for (const next of ["archived", "draft"] as const) {
      cleanupNotifications.mockClear();
      events.length = 0;
      scenario(existingRow({ status: "published" }));
      expect(await setAnnouncementStatusConsole(ID, next)).toEqual({ ok: true });
      expect(cleanupNotifications).toHaveBeenCalledTimes(1);
      expect(events.indexOf("notifications:cleanup")).toBeGreaterThan(events.indexOf("announcements:update"));
    }
  });

  it("게시하거나, 게시 중이 아니던 공지끼리 옮길 때 · 상태 변경이 실패하면 지우지 않는다", async () => {
    scenario(existingRow({ status: "archived" }));
    await setAnnouncementStatusConsole(ID, "published");
    await setAnnouncementStatusConsole(ID, "draft");
    scenario(existingRow({ status: "published" }), () => ({ data: null, error: { message: "boom" } }));
    expect(await setAnnouncementStatusConsole(ID, "archived")).toEqual({ ok: false, error: "save_failed" });
    expect(cleanupNotifications).not.toHaveBeenCalled();
  });
});
