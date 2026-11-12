import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase } from "@/lib/__tests__/fake-supabase";

/**
 * 손님 메시지 3 · 4단계 서버 쪽 — 권한 문(manage · property_info.edit) · 설정 저장이 다른 키를 남기는지 · 「지금 확인하기」 간격 ·
 * 건물 손님용 정보 저장(처음 만들기 · 버전 충돌). 세션 · DB · 보정 조회는 가짜, Beds24 는 부르지 않는다. docs/product/47 §6
 */
type Session = { organization: { id: string }; user: { id: string }; capabilities: string[] };
const state = vi.hoisted(() => ({
  session: null as null | Session,
  db: null as unknown,
  reconcileCalls: [] as string[][],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  hasOrganizationContext: (session: { organization: { id: string } }) => session.organization.id !== "platform",
  getCurrentAppSession: vi.fn(async () => state.session),
}));
vi.mock("@/lib/admin-session", () => ({
  getAdminSessionForApi: vi.fn(async () =>
    state.session?.capabilities.includes("admin_web.access") ? { ok: true, session: state.session } : { ok: false, status: 403 },
  ),
}));
vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: () => state.db,
}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/guest-messages/reconcile", () => ({
  reconcileGuestMessages: vi.fn(async (orgs: string[]) => {
    state.reconcileCalls.push(orgs);
    return { pages: 1, fetched: 3, skipped: null, stoppedEarly: null, organizations: { [orgs[0]]: { inserted: 2, merged: 1 } } };
  }),
}));

import { checkGuestMessagesNow } from "@/actions/guest-messages-settings";
import { saveBuildingGuestInfoAction } from "@/app/admin/calendar/actions";
import { deleteSavedReplyAction, saveGuestMessageSettings, saveSavedReplyAction } from "@/app/admin/messages/actions";
import { getComposerInserts } from "@/actions/guest-messages-compose";
import { reorderSavedRepliesAction } from "@/app/admin/messages/actions";
import { saveBuildingGuestInfo } from "@/lib/guest-messages/guest-info-server";
import { savePropertyOperationInfo } from "@/lib/property-operation-info";
import type { AppSession } from "@/lib/session";
import { PROPERTY_MAP_META } from "@/lib/property-map-links";

const ORG = "00000000-0000-4000-8000-000000000900";
const OTHER_ORG = "00000000-0000-4000-8000-000000000901";
const ME = "00000000-0000-4000-8000-000000000800";
const BUILDING = PROPERTY_MAP_META[0].canonicalName;

type Tables = Record<string, Array<Record<string, unknown>>>;
/** DB 함수 거울(SQL 은 로컬 Postgres 에서 따로 확인 — 47 §11). 앱이 함수를 부르고 결과를 읽는 길을 본다. */
const RPC = {
  guest_message_save_settings: (args: Record<string, unknown>, tables: Tables) => {
    const rows = (tables.guest_message_channel_state ??= []);
    let row = rows.find((r) => r.organization_id === args.p_organization_id);
    if (!row) rows.push((row = { organization_id: args.p_organization_id, settings: {} }));
    row.settings = { ...((row.settings as object) ?? {}), responseTargetMinutes: args.p_response_targets };
    Object.assign(row, { night_pause: args.p_night_pause, credit_reserve: args.p_credit_reserve, stall_hours: args.p_stall_hours });
    return { data: null, error: null };
  },
  guest_message_claim_manual_check: (args: Record<string, unknown>, tables: Tables) => {
    const rows = (tables.guest_message_channel_state ??= []);
    let row = rows.find((r) => r.organization_id === args.p_organization_id);
    if (!row) rows.push((row = { organization_id: args.p_organization_id, settings: {} }));
    const settings = (row.settings ?? {}) as Record<string, unknown>;
    const last = typeof settings.lastManualCheckAt === "string" ? Date.parse(settings.lastManualCheckAt) : Number.NaN;
    const now = Date.parse(String(args.p_now));
    if (!Number.isNaN(last) && last > now - Number(args.p_interval_seconds) * 1000) return { data: false, error: null };
    row.settings = { ...settings, lastManualCheckAt: args.p_now };
    return { data: true, error: null };
  },
  guest_message_saved_replies_reorder: (args: Record<string, unknown>, tables: Tables) => {
    const ids = args.p_ids as string[];
    let changed = 0;
    ids.forEach((id, index) => {
      const row = (tables.guest_message_saved_replies ?? []).find((r) => r.id === id && r.organization_id === args.p_organization_id);
      if (row) {
        row.sort_order = index * 10;
        changed += 1;
      }
    });
    return { data: changed, error: null };
  },
};
const fakeDb = (tables: Tables) => createFakeSupabase(tables, RPC);

const as = (capabilities: string[]): Session => ({ organization: { id: ORG }, user: { id: ME }, capabilities });
const MANAGER = ["admin_web.access", "guest_messages.view", "guest_messages.reply", "guest_messages.manage", "property_info.edit"];

const validSettings = {
  responseTargetMinutes: { inquiry: 30, request: 60, staying: 15, other: 180 },
  nightPause: false,
  creditReserve: 20,
  stallHours: 3,
};

beforeEach(() => {
  state.session = null;
  state.reconcileCalls = [];
  state.db = fakeDb({}).client;
});

describe("권한 문", () => {
  it("manage 없으면 설정 · 문구 · 지금 확인하기 모두 forbidden(redirect 없음)", async () => {
    state.session = as(["admin_web.access", "guest_messages.view", "guest_messages.reply"]);
    expect(await saveGuestMessageSettings(validSettings)).toEqual({ ok: false, errorKey: "forbidden" });
    expect(await saveSavedReplyAction({ title: "t", bodies: { ko: "x" } })).toEqual({ ok: false, errorKey: "forbidden" });
    expect(await deleteSavedReplyAction(ORG)).toEqual({ ok: false, errorKey: "forbidden" });
    expect(await checkGuestMessagesNow()).toEqual({ ok: false, errorKey: "forbidden" });
    expect(state.reconcileCalls).toHaveLength(0);
  });

  it("관리자 웹 권한 없으면 PC 탭 액션은 forbidden — 지금 확인하기는 모바일에서도 되므로 manage 만 본다", async () => {
    state.session = as(["guest_messages.view", "guest_messages.manage"]);
    expect(await saveGuestMessageSettings(validSettings)).toEqual({ ok: false, errorKey: "forbidden" });
    expect(await checkGuestMessagesNow()).toMatchObject({ ok: true, added: 2 });
  });

  it("세션 없음 · 플랫폼 세션은 forbidden", async () => {
    expect(await checkGuestMessagesNow()).toEqual({ ok: false, errorKey: "forbidden" });
    state.session = { ...as(MANAGER), organization: { id: "platform" } };
    expect(await saveGuestMessageSettings(validSettings)).toEqual({ ok: false, errorKey: "forbidden" });
  });

  it("건물 손님용 정보 저장은 property_info.edit", async () => {
    state.session = as(["admin_web.access", "guest_messages.manage"]);
    expect(await saveBuildingGuestInfoAction({ canonicalName: BUILDING, guestInfo: {}, expectedUpdatedAt: null })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });
});

describe("설정 저장", () => {
  it("범위를 벗어나면 그 칸을 알려 준다", async () => {
    state.session = as(MANAGER);
    expect(await saveGuestMessageSettings({ ...validSettings, stallHours: 0 })).toEqual({ ok: false, errorKey: "invalid", field: "stallHours" });
  });

  it("다른 settings 키(lastManualCheckAt 등)는 남기고 내 조직 줄만 고친다", async () => {
    state.session = as(MANAGER);
    const fake = fakeDb({
      guest_message_channel_state: [
        { organization_id: ORG, settings: { lastManualCheckAt: "2026-11-12T00:00:00Z", translateTarget: "ja" }, stall_hours: 3 },
        { organization_id: OTHER_ORG, settings: { keep: true }, stall_hours: 9 },
      ],
    });
    state.db = fake.client;
    expect(await saveGuestMessageSettings({ ...validSettings, stallHours: 6, creditReserve: 40 })).toEqual({ ok: true });
    const mine = fake.tables.guest_message_channel_state.find((row) => row.organization_id === ORG);
    expect(mine).toMatchObject({
      stall_hours: 6,
      credit_reserve: 40,
      night_pause: false,
      settings: { lastManualCheckAt: "2026-11-12T00:00:00Z", translateTarget: "ja", responseTargetMinutes: validSettings.responseTargetMinutes },
    });
    const other = fake.tables.guest_message_channel_state.find((row) => row.organization_id === OTHER_ORG);
    expect(other).toMatchObject({ settings: { keep: true }, stall_hours: 9 });
  });
});

describe("지금 확인하기", () => {
  it("1분 안에 다시 누르면 too_soon — 보정 조회를 부르지 않는다", async () => {
    state.session = as(MANAGER);
    const fake = fakeDb({
      guest_message_channel_state: [{ organization_id: ORG, settings: { lastManualCheckAt: new Date(Date.now() - 20_000).toISOString() } }],
    });
    state.db = fake.client;
    expect(await checkGuestMessagesNow()).toEqual({ ok: false, errorKey: "too_soon" });
    expect(state.reconcileCalls).toHaveLength(0);
  });

  it("누른 시각을 먼저 남기고 내 조직만 조회한다", async () => {
    state.session = as(MANAGER);
    const fake = fakeDb({ guest_message_channel_state: [{ organization_id: ORG, settings: { keep: 1 } }] });
    state.db = fake.client;
    expect(await checkGuestMessagesNow()).toEqual({ ok: true, pages: 1, fetched: 3, added: 2, skipped: null, stoppedEarly: null });
    expect(state.reconcileCalls).toEqual([[ORG]]);
    // 바로 또 누르면(동시에 누른 두 번째 사람도) DB 함수가 거절 — 조회는 한 번.
    expect(await checkGuestMessagesNow()).toEqual({ ok: false, errorKey: "too_soon" });
    expect(state.reconcileCalls).toHaveLength(1);
    const row = fake.tables.guest_message_channel_state[0];
    expect((row.settings as Record<string, unknown>).keep).toBe(1);
    expect(typeof (row.settings as Record<string, unknown>).lastManualCheckAt).toBe("string");
  });
});

describe("정해 둔 문구 저장", () => {
  it("빈 문구 · 잘못된 id 는 저장하지 않는다", async () => {
    state.session = as(MANAGER);
    expect(await saveSavedReplyAction({ title: "", bodies: { ko: "x" } })).toEqual({ ok: false, errorKey: "empty" });
    expect(await saveSavedReplyAction({ id: "nope", title: "t", bodies: { ko: "x" } })).toEqual({ ok: false, errorKey: "invalid" });
    expect(await deleteSavedReplyAction("nope")).toEqual({ ok: false, errorKey: "invalid" });
  });
});

describe("건물 손님용 정보 저장", () => {
  const info = { wifiName: "FoldyNet", wifiPassword: "pw", checkIn: { ko: "15시", ja: "", en: "3pm" } };

  it("모르는 건물은 거절", async () => {
    const fake = createFakeSupabase({});
    expect(await saveBuildingGuestInfo(fake.client as never, ORG, { canonicalName: "없는 건물", guestInfo: info, expectedUpdatedAt: null })).toEqual({
      ok: false,
      error: "invalid_property",
    });
    expect(fake.writes).toHaveLength(0);
  });

  it("줄이 없으면 기본 출입 정보와 함께 만든다", async () => {
    const fake = createFakeSupabase({ property_operation_infos: [] });
    const result = await saveBuildingGuestInfo(fake.client as never, ORG, { canonicalName: BUILDING, guestInfo: info, expectedUpdatedAt: null });
    expect(result.ok).toBe(true);
    const row = fake.tables.property_operation_infos[0];
    expect(row).toMatchObject({ organization_id: ORG, canonical_name: BUILDING });
    expect(row.guest_info).toMatchObject({ wifiName: "FoldyNet", checkIn: { ko: "15시", ja: "", en: "3pm" } });
    expect(Array.isArray(row.shared_access)).toBe(true);
  });

  it("직원 칸만 있는 줄(손님용 버전 없음)은 guest_info_updated_at is null 일 때만 고친다", async () => {
    // 이미 줄이 있으면 넣기가 겹침(23505) — 그 뒤 「손님용 버전이 비었을 때만」 고친다.
    const fake = createFakeSupabase({
      property_operation_infos: [{ organization_id: ORG, canonical_name: BUILDING, note: "staff", guest_info: {}, guest_info_updated_at: null }],
    });
    const client = {
      from(table: string) {
        const builder = fake.client.from(table) as Record<string, unknown>;
        if (table === "property_operation_infos") {
          builder.insert = () => {
            const chain = {
              select: () => chain,
              maybeSingle: () => chain,
              then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: null, error: { code: "23505" } })),
            };
            return chain;
          };
        }
        return builder;
      },
    };
    const result = await saveBuildingGuestInfo(client as never, ORG, { canonicalName: BUILDING, guestInfo: info, expectedUpdatedAt: null });
    expect(result.ok).toBe(true);
    expect(fake.tables.property_operation_infos[0]).toMatchObject({ note: "staff", guest_info: { wifiName: "FoldyNet" } });
  });

  it("본 버전이 아니면 충돌 + 최신 값, 덮어쓰지 않는다", async () => {
    const fake = createFakeSupabase({
      property_operation_infos: [
        { organization_id: ORG, canonical_name: BUILDING, guest_info: { wifiName: "Newer" }, guest_info_updated_at: "2026-11-12T05:00:00Z" },
      ],
    });
    const result = await saveBuildingGuestInfo(fake.client as never, ORG, {
      canonicalName: BUILDING,
      guestInfo: info,
      expectedUpdatedAt: "2026-11-12T04:00:00Z",
    });
    expect(result).toMatchObject({ ok: false, error: "conflict" });
    if (!result.ok && result.error === "conflict") expect(result.current.guestInfo.wifiName).toBe("Newer");
    expect(fake.tables.property_operation_infos[0].guest_info).toEqual({ wifiName: "Newer" });
  });

  it("같은 버전이면 저장 · 다른 조직 줄은 건드리지 않는다", async () => {
    const fake = createFakeSupabase({
      property_operation_infos: [
        { organization_id: ORG, canonical_name: BUILDING, guest_info: {}, guest_info_updated_at: "2026-11-12T05:00:00Z" },
        { organization_id: OTHER_ORG, canonical_name: BUILDING, guest_info: { wifiName: "Theirs" }, guest_info_updated_at: "2026-11-12T05:00:00Z" },
      ],
    });
    const result = await saveBuildingGuestInfo(fake.client as never, ORG, {
      canonicalName: BUILDING,
      guestInfo: info,
      expectedUpdatedAt: "2026-11-12T05:00:00Z",
    });
    expect(result.ok).toBe(true);
    expect(fake.tables.property_operation_infos[1].guest_info).toEqual({ wifiName: "Theirs" });
  });

  it("너무 긴 값은 잘라 넣지 않고 거절", async () => {
    const fake = createFakeSupabase({ property_operation_infos: [] });
    expect(
      await saveBuildingGuestInfo(fake.client as never, ORG, { canonicalName: BUILDING, guestInfo: { wifiName: "x".repeat(200) }, expectedUpdatedAt: null }),
    ).toEqual({ ok: false, error: "too_long" });
    expect(fake.writes).toHaveLength(0);
  });
});

/** 23505 를 흉내 — 이미 줄이 있는데 넣으려 하면 겹침 오류(실제 unique (organization_id, canonical_name)). */
function withUniqueBuildingRows(fake: ReturnType<typeof createFakeSupabase>) {
  return {
    ...fake.client,
    from(table: string) {
      const builder = fake.client.from(table) as Record<string, unknown> & { insert: (value: unknown) => unknown };
      if (table !== "property_operation_infos") return builder;
      const originalInsert = builder.insert.bind(builder);
      builder.insert = (value: unknown) => {
        const row = value as Record<string, unknown>;
        const exists = (fake.tables.property_operation_infos ?? []).some(
          (r) => r.organization_id === row.organization_id && r.canonical_name === row.canonical_name,
        );
        if (!exists) return originalInsert({ staff_info_saved: true, ...row });
        const chain = {
          select: () => chain,
          single: () => chain,
          maybeSingle: () => chain,
          then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ data: null, error: { code: "23505" } })),
        };
        return chain;
      };
      return builder;
    },
  };
}

describe("출입 코드 저장 ↔ 손님용 정보 저장 — 어느 쪽이 먼저든 막히지 않는다", () => {
  const base = PROPERTY_MAP_META.find((item) => item.canonicalName === "아라키초B")!;
  const staffInput = {
    address: base.address,
    note: "현관 왼쪽",
    roomAccess: base.roomAccess ?? [],
    sharedAccess: base.sharedAccess.map((access, index) => (index === 0 ? { ...access, code: "123456" } : access)),
  };
  const session = { organization: { id: ORG } } as unknown as AppSession;

  it("손님용 정보가 먼저 줄을 만들면, 「줄 없음」 화면의 출입 코드 저장은 충돌이 아니라 그 줄을 고친다", async () => {
    const fake = createFakeSupabase({ property_operation_infos: [] });
    const db = withUniqueBuildingRows(fake);
    state.db = db;
    const guest = await saveBuildingGuestInfo(db as never, ORG, { canonicalName: base.canonicalName, guestInfo: { wifiName: "Net" }, expectedUpdatedAt: null });
    expect(guest.ok).toBe(true);
    expect(fake.tables.property_operation_infos[0].staff_info_saved).toBe(false);

    const staff = await savePropertyOperationInfo({ canonicalName: base.canonicalName, data: staffInput, expectedUpdatedAt: null, session });
    expect(staff.ok).toBe(true);
    expect(fake.tables.property_operation_infos).toHaveLength(1);
    expect(fake.tables.property_operation_infos[0]).toMatchObject({ note: "현관 왼쪽", guest_info: { wifiName: "Net" } });
  });

  it("출입 코드가 먼저 저장된 줄이면 「줄 없음」 화면의 저장은 지금처럼 충돌(덮지 않음)", async () => {
    const fake = createFakeSupabase({ property_operation_infos: [] });
    const db = withUniqueBuildingRows(fake);
    state.db = db;
    const first = await savePropertyOperationInfo({ canonicalName: base.canonicalName, data: staffInput, expectedUpdatedAt: null, session });
    expect(first.ok).toBe(true);
    const stale = await savePropertyOperationInfo({
      canonicalName: base.canonicalName,
      data: { ...staffInput, note: "옛 화면" },
      expectedUpdatedAt: null,
      session,
    });
    expect(stale).toMatchObject({ ok: false, error: "conflict" });
    expect(fake.tables.property_operation_infos[0].note).toBe("현관 왼쪽");

    // 그 뒤 손님용 정보 저장(아직 손님 버전 없음)은 직원 칸을 건드리지 않고 붙는다.
    fake.tables.property_operation_infos[0].guest_info_updated_at = null;
    const guest = await saveBuildingGuestInfo(db as never, ORG, { canonicalName: base.canonicalName, guestInfo: { wifiName: "Net" }, expectedUpdatedAt: null });
    expect(guest.ok).toBe(true);
    expect(fake.tables.property_operation_infos[0]).toMatchObject({ note: "현관 왼쪽", guest_info: { wifiName: "Net" } });
  });

  it("패널로 가는 값에는 출입 코드 값이 없다(개수만)", async () => {
    state.session = as(MANAGER);
    const fake = createFakeSupabase({ property_operation_infos: [] });
    state.db = withUniqueBuildingRows(fake);
    const result = await saveBuildingGuestInfoAction({ canonicalName: base.canonicalName, guestInfo: { wifiName: "Net" }, expectedUpdatedAt: null });
    expect(result.ok).toBe(true);
    const text = JSON.stringify(result);
    for (const access of base.sharedAccess) if (access.code.trim()) expect(text).not.toContain(`"${access.code}"`);
    if (result.ok) expect(result.building.sharedCodeCount).toBe(base.sharedAccess.filter((a) => a.code.trim()).length);
  });
});

describe("정해 둔 문구 — 버전 · 순서", () => {
  const R1 = "00000000-0000-4000-8000-000000000001";
  const R2 = "00000000-0000-4000-8000-000000000002";
  const reply = (id: string, sort: number, updatedAt = "2026-11-13T00:00:00Z") => ({
    id,
    organization_id: ORG,
    title: "t" + sort,
    body_ko: "안녕",
    body_ja: "",
    body_en: "",
    sort_order: sort,
    created_at: "2026-11-13T00:00:00Z",
    updated_at: updatedAt,
  });

  it("고칠 때 본 버전이 아니면 충돌 + 최신 값, 덮지 않는다", async () => {
    state.session = as(MANAGER);
    const fake = fakeDb({ guest_message_saved_replies: [reply(R1, 0, "2026-11-13T05:00:00Z")] });
    state.db = fake.client;
    const result = await saveSavedReplyAction({ id: R1, title: "새 제목", bodies: { ko: "새 글" }, expectedUpdatedAt: "2026-11-13T04:00:00Z" });
    expect(result).toMatchObject({ ok: false, errorKey: "conflict", current: { id: R1, title: "t0", updatedAt: "2026-11-13T05:00:00Z" } });
    expect(fake.tables.guest_message_saved_replies[0].title).toBe("t0");

    const ok = await saveSavedReplyAction({ id: R1, title: "새 제목", bodies: { ko: "새 글" }, expectedUpdatedAt: "2026-11-13T05:00:00Z" });
    expect(ok.ok).toBe(true);
    expect(fake.tables.guest_message_saved_replies[0].title).toBe("새 제목");
  });

  it("고칠 때 버전이 없으면 거절(invalid)", async () => {
    state.session = as(MANAGER);
    state.db = fakeDb({ guest_message_saved_replies: [reply(R1, 0)] }).client;
    expect(await saveSavedReplyAction({ id: R1, title: "x", bodies: { ko: "y" } })).toEqual({ ok: false, errorKey: "invalid" });
  });

  it("순서는 DB 함수 한 번 — 빠진 줄은 뒤로, 다른 조직 줄은 안 바뀜", async () => {
    state.session = as(MANAGER);
    const other = { ...reply("00000000-0000-4000-8000-000000000003", 0), organization_id: OTHER_ORG };
    const fake = fakeDb({ guest_message_saved_replies: [reply(R1, 0), reply(R2, 10), other] });
    state.db = fake.client;
    expect(await reorderSavedRepliesAction([R2])).toEqual({ ok: true });
    expect(fake.rpcCalls).toEqual([{ name: "guest_message_saved_replies_reorder", args: { p_organization_id: ORG, p_ids: [R2, R1] } }]);
    const sort = Object.fromEntries(fake.tables.guest_message_saved_replies.map((r) => [r.id, r.sort_order]));
    expect(sort[R2]).toBe(0);
    expect(sort[R1]).toBe(10);
    expect(sort[other.id]).toBe(0);
  });
});

describe("답장 칸 넣기 목록", () => {
  const CONV = "00000000-0000-4000-8000-0000000000c1";
  const conversation = (property: string, room: string) => ({
    id: CONV,
    organization_id: ORG,
    provider: "beds24",
    provider_booking_id: "B1",
    property_name: property,
    room_label: room,
    channel: "airbnb",
    booking_status: "confirmed",
    check_in_date: "2026-11-20",
    check_out_date: "2026-11-22",
    guest_name: "Emma",
    guest_language: "ja",
    status: "awaiting",
  });

  it("{room} 은 언어마다 — 한 채 건물(방 라벨 = 건물 이름)이 일본어 · 영어 답장에 한국어로 나가지 않는다", async () => {
    state.session = as(["guest_messages.view", "guest_messages.reply"]);
    state.db = fakeDb({
      guest_conversations: [conversation("아라키초A", "아라키초A")],
      property_operation_infos: [],
      guest_message_saved_replies: [
        { id: "00000000-0000-4000-8000-000000000011", organization_id: ORG, title: "t", body_ko: "{room}", body_ja: "{room}", body_en: "{room}", sort_order: 0, created_at: "x", updated_at: "x" },
      ],
    }).client;
    const result = await getComposerInserts(CONV);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byLang = result.data.replies[0].byLang;
    expect(byLang.ko?.text).toBe("아라키초A");
    expect(byLang.ja?.text).not.toBe("아라키초A");
    expect(byLang.en?.text).not.toBe("아라키초A");
    expect(byLang.en?.text).toMatch(/[A-Za-z]/);
  });

  it("출입 코드는 manage 또는 property_info.edit 가 있는 사람만(임시 — 47 §6-3 · Q9)", async () => {
    const tables = () => ({ guest_conversations: [conversation("가부키초", "202")], property_operation_infos: [], guest_message_saved_replies: [] });
    state.session = as(["guest_messages.view", "guest_messages.reply"]);
    state.db = fakeDb(tables()).client;
    const plain = await getComposerInserts(CONV);
    expect(plain.ok && plain.data.building?.staffCodes).toEqual([]);

    state.session = as(["guest_messages.view", "guest_messages.reply", "property_info.edit"]);
    state.db = fakeDb(tables()).client;
    const editor = await getComposerInserts(CONV);
    expect(editor.ok && editor.data.building?.staffCodes.some((code) => code.code === "2020117*")).toBe(true);

    state.session = as(["guest_messages.view", "guest_messages.reply", "guest_messages.manage"]);
    state.db = fakeDb(tables()).client;
    const manager = await getComposerInserts(CONV);
    expect(manager.ok && (manager.data.building?.staffCodes.length ?? 0) > 0).toBe(true);
  });

  it("답장 권한이 없으면 forbidden", async () => {
    state.session = as(["guest_messages.view"]);
    expect(await getComposerInserts(CONV)).toEqual({ ok: false, errorKey: "forbidden" });
  });
});
