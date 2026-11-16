import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase } from "@/lib/__tests__/fake-supabase";

/**
 * 손님 메시지 실시간 서버 액션(47 §5-9) — 신호의 id 는 힌트일 뿐이라 권한 · 조직은 서버가 다시 본다.
 * `guest_messages.view` 가 없으면 `forbidden`(redirect 없음), 다른 조직 id 는 `missing` 으로만, 자동 안내 줄은 `guest_messages.manage` 만.
 */
type Session = { organization: { id: string }; user: { id: string; preferredLanguage: "ko" }; capabilities: string[] };
const state = vi.hoisted(() => ({ session: null as null | Session, db: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/session", () => ({
  hasOrganizationContext: (session: { organization: { id: string } }) => session.organization.id !== "platform",
  getCurrentAppSession: vi.fn(async () => state.session),
}));
vi.mock("@/lib/admin-session", () => ({
  getAdminSessionForApi: vi.fn(async () =>
    state.session?.capabilities.includes("admin_web.access") ? { ok: true, session: state.session } : { ok: false, status: 403 },
  ),
}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => state.db }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

import { getGuestConversationRows } from "@/actions/guest-messages";
import { getAutoRunsByIdsAction, listAutoRuleSummariesAction } from "@/app/admin/messages/auto-actions";

const ORG = "00000000-0000-4000-8000-000000000900";
const OTHER_ORG = "00000000-0000-4000-8000-000000000901";
const ME = "00000000-0000-4000-8000-000000000800";
const MINE = "00000000-0000-4000-8000-000000000001";
const THEIRS = "00000000-0000-4000-8000-000000000002";

function sessionWith(capabilities: string[]): Session {
  return { organization: { id: ORG }, user: { id: ME, preferredLanguage: "ko" }, capabilities };
}

function conversation(id: string, organizationId: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    organization_id: organizationId,
    provider: "beds24",
    provider_booking_id: `b-${id.slice(-3)}`,
    reservation_id: null,
    property_name: "아라키초A",
    room_label: "201",
    channel: "airbnb",
    booking_status: "confirmed",
    check_in_date: "2026-11-20",
    check_out_date: "2026-11-22",
    guest_name: "Guest",
    guest_language: "en",
    status: "awaiting",
    snooze_until: null,
    last_guest_at: "2026-11-13T00:00:00Z",
    last_reply_at: null,
    last_message_at: "2026-11-13T00:00:00Z",
    ...patch,
  };
}

beforeEach(() => {
  state.session = null;
  state.db = createFakeSupabase(
    {
      guest_conversations: [conversation(MINE, ORG), conversation(THEIRS, OTHER_ORG)],
      guest_message_outbox: [],
      guest_message_channel_state: [],
    },
    { guest_conversation_last_lines: () => ({ data: [], error: null }) },
  ).client;
});

describe("getGuestConversationRows — 실시간 목록 줄 다시 읽기", () => {
  it("로그인 없음 · 볼 권한 없음은 forbidden", async () => {
    expect(await getGuestConversationRows({ ids: [MINE] })).toEqual({ ok: false, errorKey: "forbidden" });
    state.session = sessionWith(["guest_messages.reply", "admin_web.access"]);
    expect(await getGuestConversationRows({ ids: [MINE] })).toEqual({ ok: false, errorKey: "forbidden" });
  });

  it("id 가 아니거나 비었거나 너무 많으면 invalid", async () => {
    state.session = sessionWith(["guest_messages.view"]);
    expect(await getGuestConversationRows({ ids: [] })).toEqual({ ok: false, errorKey: "invalid" });
    expect(await getGuestConversationRows({ ids: ["x; drop"] })).toEqual({ ok: false, errorKey: "invalid" });
    const many = Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(await getGuestConversationRows({ ids: many })).toEqual({ ok: false, errorKey: "invalid" });
  });

  it("status 가 없거나 잘못되면 전체(all) — 답장 기다림 줄도 목록에 맞는다", async () => {
    state.session = sessionWith(["guest_messages.view", "guest_messages.manage"]);
    for (const status of [undefined, "bogus"]) {
      const result = await getGuestConversationRows({ ids: [MINE], status });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.updates[0].matches).toBe(true);
    }
  });

  it("볼 권한이면 이 조직 줄만 — 다른 조직 id 는 missing, 필터 판정 · 머리 숫자 같이", async () => {
    state.session = sessionWith(["guest_messages.view", "guest_messages.manage"]);
    const result = await getGuestConversationRows({ ids: [MINE, THEIRS], status: "done" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updates.map((u) => u.row.id)).toEqual([MINE]);
    expect(result.updates[0].matches).toBe(false);
    expect(result.missing).toEqual([THEIRS]);
    expect(result.awaitingCount).toBe(1);
  });
});

describe("getGuestConversationRows — 목록과 같은 창", () => {
  it("처리 끝은 최근 200개 안일 때만 matches(목록에 없는 옛 처리 끝은 들어오지 않는다)", async () => {
    const done = Array.from({ length: 201 }, (_, i) =>
      conversation(`00000000-0000-4000-8000-1${String(i).padStart(11, "0")}`, ORG, {
        status: "done",
        last_message_at: new Date(Date.UTC(2026, 10, 1) + i * 60_000).toISOString(),
      }),
    );
    state.db = createFakeSupabase(
      { guest_conversations: done, guest_message_outbox: [], guest_message_channel_state: [] },
      { guest_conversation_last_lines: () => ({ data: [], error: null }) },
    ).client;
    state.session = sessionWith(["guest_messages.view", "guest_messages.manage"]);
    const oldest = done[0].id;
    const newest = done[200].id;
    const result = await getGuestConversationRows({ ids: [oldest, newest], status: "done" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byId = new Map(result.updates.map((u) => [u.row.id, u.matches]));
    expect(byId.get(newest)).toBe(true);
    expect(byId.get(oldest)).toBe(false);
  });
});

describe("자동 안내 실시간 액션 — 관리 권한만", () => {
  it("manage 가 없으면 forbidden", async () => {
    state.session = sessionWith(["guest_messages.view", "guest_messages.reply", "admin_web.access"]);
    expect(await getAutoRunsByIdsAction([MINE])).toEqual({ ok: false, errorKey: "forbidden" });
    expect(await listAutoRuleSummariesAction()).toEqual({ ok: false, errorKey: "forbidden" });
  });

  it("manage 여도 id 가 아니면 invalid", async () => {
    state.session = sessionWith(["guest_messages.view", "guest_messages.manage", "admin_web.access"]);
    expect(await getAutoRunsByIdsAction(["nope"])).toEqual({ ok: false, errorKey: "invalid" });
  });
});
