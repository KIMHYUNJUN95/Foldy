import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase } from "@/lib/__tests__/fake-supabase";

/**
 * 예약 패널 「출입 번호」 서버 액션 — 권한 문(view + manage/property_info.edit) · 조직 범위 · 라벨 언어 · 실패 로그에 번호 없음.
 * 세션 · DB 는 가짜, 건물 정보 읽기도 가짜(번호는 000000 같은 가짜 값만). docs/product/47 §6-3 · Q9
 */
type Session = { organization: { id: string }; user: { id: string; preferredLanguage: string }; capabilities: string[] };
const state = vi.hoisted(() => ({
  session: null as null | Session,
  db: null as unknown,
  building: null as unknown,
  buildingThrows: false,
  buildingCalls: [] as Array<{ organizationId: string; propertyName: string | null }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({
  hasOrganizationContext: (session: { organization: { id: string } }) => session.organization.id !== "platform",
  getCurrentAppSession: vi.fn(async () => state.session),
}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => state.db }));
vi.mock("@/lib/guest-messages/guest-info-server", () => ({
  loadBuildingGuestInfo: vi.fn(async (_db: unknown, organizationId: string, propertyName: string | null) => {
    state.buildingCalls.push({ organizationId, propertyName });
    if (state.buildingThrows) throw new Error("property info read failed: 500");
    return state.building;
  }),
}));

import { getConversationAccessCodes } from "@/actions/guest-messages-access-codes";
import { getDictionary } from "@/lib/i18n";

const ORG = "00000000-0000-4000-8000-000000000900";
const OTHER_ORG = "00000000-0000-4000-8000-000000000901";
const CONV = "00000000-0000-4000-8000-0000000000c1";
const OTHER_CONV = "00000000-0000-4000-8000-0000000000c2";

const as = (capabilities: string[], preferredLanguage = "ko"): Session => ({
  organization: { id: ORG },
  user: { id: "00000000-0000-4000-8000-000000000800", preferredLanguage },
  capabilities,
});
const conversation = (id: string, organizationId: string, room: string) => ({
  id,
  organization_id: organizationId,
  provider: "beds24",
  provider_booking_id: "B1",
  property_name: "가부키초",
  room_label: room,
  channel: "airbnb",
  booking_status: "confirmed",
  check_in_date: "2026-11-20",
  check_out_date: "2026-11-22",
  guest_name: "Emma",
  guest_language: "en",
  status: "awaiting",
});
const FAKE_BUILDING = {
  canonicalName: "가부키초",
  sharedAccess: [
    { labelKey: "doorPassword", code: "000000" },
    { labelKey: "keyBox", code: "  " },
  ],
  roomAccess: [
    { roomLabel: "201", code: "111111" },
    { roomLabel: "202", code: "222222" },
  ],
};

beforeEach(() => {
  state.session = null;
  state.building = FAKE_BUILDING;
  state.buildingThrows = false;
  state.buildingCalls = [];
  state.db = createFakeSupabase({
    guest_conversations: [conversation(CONV, ORG, "201"), conversation(OTHER_CONV, OTHER_ORG, "201")],
  }).client;
});

describe("권한 문", () => {
  it("세션 없음 · 플랫폼 세션은 forbidden", async () => {
    expect(await getConversationAccessCodes(CONV)).toEqual({ ok: false, errorKey: "forbidden" });
    state.session = { ...as(["guest_messages.view", "guest_messages.manage"]), organization: { id: "platform" } };
    expect(await getConversationAccessCodes(CONV)).toEqual({ ok: false, errorKey: "forbidden" });
  });

  it("보기 + 답장만 있는 사람(알바 · 야간)은 forbidden — 건물 정보도 읽지 않는다", async () => {
    state.session = as(["guest_messages.view", "guest_messages.reply"]);
    expect(await getConversationAccessCodes(CONV)).toEqual({ ok: false, errorKey: "forbidden" });
    expect(state.buildingCalls).toHaveLength(0);
  });

  it("manage · property_info.edit 가 있어도 guest_messages.view 가 없으면 forbidden", async () => {
    state.session = as(["guest_messages.manage", "property_info.edit"]);
    expect(await getConversationAccessCodes(CONV)).toEqual({ ok: false, errorKey: "forbidden" });
  });

  it("id 가 uuid 가 아니면 invalid", async () => {
    state.session = as(["guest_messages.view", "guest_messages.manage"]);
    expect(await getConversationAccessCodes("not-a-uuid")).toEqual({ ok: false, errorKey: "invalid" });
  });

  it("다른 조직 대화는 not_found — 그 건물 번호를 읽지 않는다", async () => {
    state.session = as(["guest_messages.view", "guest_messages.manage"]);
    expect(await getConversationAccessCodes(OTHER_CONV)).toEqual({ ok: false, errorKey: "not_found" });
    expect(state.buildingCalls).toHaveLength(0);
  });
});

describe("번호 목록", () => {
  it("property_info.edit — 공용(빈 값 빼고) + 이 방만, 라벨은 보는 사람 언어", async () => {
    state.session = as(["guest_messages.view", "property_info.edit"], "en");
    const result = await getConversationAccessCodes(CONV);
    const en = getDictionary("en");
    expect(result).toEqual({
      ok: true,
      codes: [
        { kind: "shared", label: en.mobile.calendarMapAccessKindDoorPassword, code: "000000" },
        { kind: "room", label: en.guestMessages.insertRoomCode.replace("{room}", "201"), code: "111111" },
      ],
    });
    expect(state.buildingCalls).toEqual([{ organizationId: ORG, propertyName: "가부키초" }]);
  });

  it("manage — 건물을 모르면 빈 목록", async () => {
    state.session = as(["guest_messages.view", "guest_messages.manage"]);
    state.building = null;
    expect(await getConversationAccessCodes(CONV)).toEqual({ ok: true, codes: [] });
  });

  it("읽기 실패는 failed — 로그 · 결과에 번호 값이 없다", async () => {
    state.session = as(["guest_messages.view", "guest_messages.manage"]);
    state.buildingThrows = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await getConversationAccessCodes(CONV);
    expect(result).toEqual({ ok: false, errorKey: "failed" });
    const logged = JSON.stringify(spy.mock.calls);
    for (const code of ["000000", "111111", "222222"]) expect(logged).not.toContain(code);
    spy.mockRestore();
  });
});
