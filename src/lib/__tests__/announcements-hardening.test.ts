import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => ({}) }));
vi.mock("@/lib/capabilities-server", () => ({ memberCapabilities: async () => [] }));

import { canSeeConsoleAnnouncement } from "@/lib/admin-announcements";
import { deleteAnnouncementNotifications } from "@/lib/notifications/create";

/**
 * 공지사항 점검(2026-11-12) — 마이그레이션 정적 확인 + 콘솔 보이는 범위 + 알림 정리.
 */
const PATH = "supabase/migrations/202611120003_announcements_hardening.sql";
const SQL = existsSync(PATH) ? readFileSync(PATH, "utf8") : "";

function policyBlock(name: string): string {
  const start = SQL.indexOf(`create policy "${name}"`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  return SQL.slice(start, SQL.indexOf(");\n", start));
}

describe("공지 보강 마이그레이션", () => {
  it("로그인 사용자의 직접 쓰기를 거둔다(쓰기는 service role 서버 액션만)", () => {
    expect(SQL).toMatch(/revoke insert, update, delete, truncate on public\.announcements from anon, authenticated;/);
  });

  it("truncate 도 거둔다(RLS 를 타지 않아 권한만 있으면 표 전체가 비워진다)", () => {
    const revoke = SQL.match(/^revoke [^;]* on public\.announcements from anon, authenticated;/m)?.[0] ?? "";
    expect(revoke).toContain("truncate");
  });

  it("공지 읽기 — 게시 중은 대상만, 초안 · 보관은 작성자 또는 announcement.manage", () => {
    const block = policyBlock("members can read announcements");
    expect(SQL).toContain('drop policy if exists "members can read announcements" on public.announcements;');
    expect(block).toContain("status = 'published'");
    expect(block).toContain("target_scope = 'everyone'");
    expect(block).toContain("status <> 'published'");
    expect(block).toContain("created_by_user_id = (select auth.uid())");
    expect(block).toContain("'announcement.manage'");
    expect(block).toContain("current_user_active_organization_ids()");
  });

  it("댓글 읽기에도 부모 공지의 상태 규칙", () => {
    const block = policyBlock("members can read visible announcement comments");
    expect(block).toContain("deleted_at is null");
    expect(block).toContain("a.status = 'published'");
    expect(block).toContain("a.status <> 'published'");
    expect(block).toContain("'announcement.manage'");
  });

  it("읽음 기록의 신원 칸은 못 바꾼다", () => {
    expect(SQL).toMatch(/create trigger announcement_reads_immutable_identity\s+before update on public\.announcement_reads/);
    for (const col of ["announcement_id", "organization_id", "user_id"]) {
      expect(SQL).toContain(`new.${col}`);
    }
    expect(SQL).toContain("drop trigger if exists announcement_reads_immutable_identity");
  });
});

describe("콘솔에 보일 공지", () => {
  const me = "u-me";
  const viewer = (caps: string[], isPlatformAdmin = false) => ({ isPlatformAdmin, userId: me, caps });

  it("게시 중은 누구나", () => {
    expect(canSeeConsoleAnnouncement({ status: "published", created_by_user_id: "other" }, viewer(["admin_web.access"]))).toBe(true);
  });
  it("남의 초안 · 보관은 관리 권한이 있어야", () => {
    for (const status of ["draft", "archived"] as const) {
      expect(canSeeConsoleAnnouncement({ status, created_by_user_id: "other" }, viewer(["admin_web.access", "announcement.create"]))).toBe(false);
      expect(canSeeConsoleAnnouncement({ status, created_by_user_id: "other" }, viewer(["announcement.manage"]))).toBe(true);
      expect(canSeeConsoleAnnouncement({ status, created_by_user_id: "other" }, viewer([], true))).toBe(true);
    }
  });
  it("내 초안은 보인다", () => {
    expect(canSeeConsoleAnnouncement({ status: "draft", created_by_user_id: me }, viewer(["admin_web.access"]))).toBe(true);
  });
});

describe("deleteAnnouncementNotifications", () => {
  it("그 공지(source_type · source_id · 조직)의 알림만 지운다", async () => {
    const filters: Record<string, unknown> = {};
    let op = "";
    let table = "";
    const chain = {
      delete: () => ((op = "delete"), chain),
      eq: (col: string, value: unknown) => ((filters[col] = value), chain),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
    };
    const client = { from: (t: string) => ((table = t), chain) };
    await deleteAnnouncementNotifications(client as never, { organizationId: "org-1", announcementId: "ann-1" });
    expect(table).toBe("notifications");
    expect(op).toBe("delete");
    expect(filters).toEqual({ organization_id: "org-1", source_type: "announcement", source_id: "ann-1" });
  });

  it("실패해도 던지지 않는다(공지 처리는 그대로)", async () => {
    const chain = {
      delete: () => chain,
      eq: () => chain,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: { message: "boom" } }).then(resolve),
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      deleteAnnouncementNotifications({ from: () => chain } as never, { organizationId: "o", announcementId: "a" }),
    ).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
