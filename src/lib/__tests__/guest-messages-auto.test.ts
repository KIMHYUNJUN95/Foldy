import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase } from "@/lib/__tests__/fake-supabase";

/**
 * 손님 메시지 5단계 — 자동 안내. 도쿄 시각 계산(달 · 해 넘김 · 윤년 · 새벽) · 계획(날짜 바뀜 · 취소 · 직접 예약 · 채널 모름 · 빈 변수 ·
 * 멈춤 · 지난 시각 · 확정 직후) · 멱등(같은 규칙 · 같은 예약 한 번) · 큐 넣기(플래그 꺼짐이면 안 넣음) · 우선순위(직원 답장 먼저) · 권한.
 * DB · 세션은 가짜, Beds24 는 부르지 않는다. docs/product/47 §5-6 · §11
 */
type Session = { organization: { id: string }; user: { id: string; preferredLanguage: string }; capabilities: string[] };
const state = vi.hoisted(() => ({ session: null as null | Session, db: null as unknown }));

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
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => state.db }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

import {
  AUTO_LATE_GRACE_MS,
  autoBookingStatus,
  autoRunDisplay,
  buildAutoMessage,
  fillAutoVariables,
  maskEntryCodes,
  parseBeds24Instant,
  planAutoRun,
  scheduledAtFor,
  tokyoInstant,
  validateAutoRuleInput,
  type AutoBooking,
  type AutoFillContext,
  type AutoRule,
  type ExistingAutoRun,
} from "@/lib/guest-messages/auto-model";
import {
  assembleAutoBookings,
  autoFillContextFor,
  planAutoMessagesAfterWebhook,
  runAutoMessagePlanner,
  toAutoBooking,
  type ReservationRowForAuto,
} from "@/lib/guest-messages/auto-scheduler";
import { loadAutoRuleSummaries, setAutoRuleEnabled } from "@/lib/guest-messages/auto-rules-server";
import { processOutboxBatch, type OutboxRow } from "@/lib/guest-messages/outbox";
import { runGuestOutbox } from "@/lib/guest-messages/outbox-runner";
import { emptyGuestInfo } from "@/lib/guest-messages/guest-info-model";
import {
  deleteAutoRuleAction,
  previewAutoRuleAction,
  saveAutoRuleAction,
  setAutoRunPausedAction,
  toggleAutoRuleAction,
} from "@/app/admin/messages/auto-actions";
import { PROPERTY_MAP_META } from "@/lib/property-map-links";

const ORG = "00000000-0000-4000-8000-000000000a00";
const OTHER_ORG = "00000000-0000-4000-8000-000000000a01";
const ME = "00000000-0000-4000-8000-000000000a02";
const RULE_ID = "00000000-0000-4000-8000-000000000a10";

function rule(over: Partial<AutoRule> = {}): AutoRule {
  return {
    id: RULE_ID,
    name: "체크인 방법",
    trigger: "before_checkin",
    offsetDays: 1,
    sendTime: "18:00",
    targetBuildings: [],
    targetChannels: [],
    targetStatuses: ["confirmed"],
    bodies: { ko: "{guest_name}님 내일 체크인", ja: "{guest_name}様 明日チェックイン", en: "Hi {guest_name}, check-in tomorrow" },
    enabled: true,
    enabledAt: "2026-11-01T00:00:00.000Z",
    sortOrder: 0,
    updatedAt: "2026-11-01T00:00:00.000Z",
    createdAt: "2026-11-01T00:00:00.000Z",
    ...over,
  };
}

function booking(over: Partial<AutoBooking> = {}): AutoBooking {
  return {
    provider: "beds24",
    providerBookingId: "70001",
    reservationId: "r-1",
    propertyName: "아라키초A",
    buildingKey: "arakicho_a",
    roomLabel: "201",
    guestName: "Mark Jensen",
    guestLanguage: "en",
    checkInDate: "2026-11-20",
    checkOutDate: "2026-11-22",
    status: "confirmed",
    channel: "airbnb",
    guests: 2,
    createdAt: "2026-11-05T00:00:00.000Z",
    ...over,
  };
}

function ctx(over: Partial<AutoFillContext> = {}): AutoFillContext {
  return {
    guestName: "Mark Jensen",
    checkInDate: "2026-11-20",
    checkOutDate: "2026-11-22",
    nights: 2,
    guests: 2,
    building: { ko: "아라키초A", ja: "荒木町A", en: "Arakicho A" },
    room: { ko: "201", ja: "201", en: "201" },
    guestInfo: emptyGuestInfo(),
    sharedCodes: null,
    roomCode: null,
    ...over,
  };
}

const NOW = new Date("2026-11-12T03:00:00.000Z"); // 도쿄 11/12 12:00

describe("자동 안내 — 도쿄 보낼 시각", () => {
  it("도쿄 날짜 + 시각 → UTC(+09:00 고정, 서머타임 없음)", () => {
    expect(new Date(tokyoInstant("2026-11-19", "18:00")!).toISOString()).toBe("2026-11-19T09:00:00.000Z");
    // 새벽 시각은 UTC 로 전날
    expect(new Date(tokyoInstant("2026-11-19", "00:30")!).toISOString()).toBe("2026-11-18T15:30:00.000Z");
    // 7월(다른 나라라면 서머타임)도 같은 +9
    expect(new Date(tokyoInstant("2026-07-01", "09:00")!).toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(tokyoInstant("2026-02-30", "10:00")).toBeNull();
    expect(tokyoInstant("2026-02-10", "24:00")).toBeNull();
  });

  it("트리거마다 — 체크인 N일 전 · 당일 · 체크아웃 N일 전 · 당일 · 뒤 · 확정 직후", () => {
    const b = { checkInDate: "2026-11-20", checkOutDate: "2026-11-22" };
    expect(scheduledAtFor(rule({ trigger: "before_checkin", offsetDays: 1, sendTime: "18:00" }), b, "x")).toBe("2026-11-19T09:00:00.000Z");
    expect(scheduledAtFor(rule({ trigger: "day_of_checkin", offsetDays: 0, sendTime: "10:00" }), b, "x")).toBe("2026-11-20T01:00:00.000Z");
    expect(scheduledAtFor(rule({ trigger: "before_checkout", offsetDays: 1, sendTime: "20:00" }), b, "x")).toBe("2026-11-21T11:00:00.000Z");
    expect(scheduledAtFor(rule({ trigger: "before_checkout", offsetDays: 0, sendTime: "08:00" }), b, "x")).toBe("2026-11-21T23:00:00.000Z");
    expect(scheduledAtFor(rule({ trigger: "after_checkout", offsetDays: 1, sendTime: "12:00" }), b, "x")).toBe("2026-11-23T03:00:00.000Z");
    expect(scheduledAtFor(rule({ trigger: "confirmed", offsetDays: 0, sendTime: null }), b, "2026-11-12T03:00:00.000Z")).toBe(
      "2026-11-12T03:00:00.000Z",
    );
  });

  it("달 · 해 넘김 · 윤년", () => {
    const before = (checkIn: string, n: number) => scheduledAtFor(rule({ offsetDays: n }), { checkInDate: checkIn, checkOutDate: null }, "x");
    expect(before("2026-03-01", 1)).toBe("2026-02-28T09:00:00.000Z");
    expect(before("2028-03-01", 1)).toBe("2028-02-29T09:00:00.000Z");
    expect(before("2027-01-01", 3)).toBe("2026-12-29T09:00:00.000Z");
    expect(before("2026-12-01", 30)).toBe("2026-11-01T09:00:00.000Z");
    expect(
      scheduledAtFor(rule({ trigger: "after_checkout", offsetDays: 1, sendTime: "12:00" }), { checkInDate: null, checkOutDate: "2026-12-31" }, "x"),
    ).toBe("2027-01-01T03:00:00.000Z");
    expect(before("bad", 1)).toBeNull();
  });
});

describe("자동 안내 — 규칙 검사", () => {
  const base = { name: "체크인", trigger: "before_checkin", offsetDays: 1, sendTime: "18:00", bodies: { en: "Hi" }, targetStatuses: ["confirmed"] };
  it("날 수 · 시각 · 빈 글", () => {
    expect(validateAutoRuleInput(base).ok).toBe(true);
    expect(validateAutoRuleInput({ ...base, offsetDays: 0 })).toEqual({ ok: false, error: "invalid_offset" });
    expect(validateAutoRuleInput({ ...base, offsetDays: 31 })).toEqual({ ok: false, error: "invalid_offset" });
    expect(validateAutoRuleInput({ ...base, trigger: "before_checkout", offsetDays: 0 }).ok).toBe(true);
    expect(validateAutoRuleInput({ ...base, sendTime: "25:00" })).toEqual({ ok: false, error: "invalid_time" });
    expect(validateAutoRuleInput({ ...base, bodies: { en: " " } })).toEqual({ ok: false, error: "empty" });
    expect(validateAutoRuleInput({ ...base, targetChannels: ["direct"] })).toEqual({ ok: false, error: "invalid_input" });
    expect(validateAutoRuleInput({ ...base, targetStatuses: [] })).toEqual({ ok: false, error: "invalid_input" });
    const confirmed = validateAutoRuleInput({ ...base, trigger: "confirmed", offsetDays: 5, sendTime: "09:00" });
    expect(confirmed.ok && confirmed.value).toMatchObject({ offsetDays: 0, sendTime: null });
  });
});

describe("자동 안내 — 변수 · 언어", () => {
  it("손님 언어 본문(그 밖 언어 = 영어) · 빈 변수 막기 · 출입 코드", () => {
    const built = buildAutoMessage(rule().bodies, "ja", ctx());
    expect(built).toEqual({ ok: true, text: "Mark Jensen様 明日チェックイン", lang: "ja" });
    expect(buildAutoMessage(rule().bodies, "fr", ctx())).toMatchObject({ ok: true, lang: "en" });
    expect(buildAutoMessage({ ko: "한국어만", ja: "", en: "" }, "en", ctx())).toEqual({ ok: false, reason: "no_body", lang: "en" });
    const blocked = buildAutoMessage({ ko: "", ja: "", en: "Code {entry_code_shared} · Wi-Fi {wifi_password}" }, "en", ctx());
    expect(blocked).toMatchObject({ ok: false, reason: "empty_variable", missing: ["entry_code_shared", "wifi_password"] });
    const info = emptyGuestInfo();
    info.wifiPassword = "pw123";
    info.checkIn = { ko: "15시부터", ja: "", en: "From 3pm" };
    const filled = fillAutoVariables("{entry_code_shared} {entry_code_room} {wifi_password} {checkin_time} {guests} {building} {unknown}", ctx({ guestInfo: info, sharedCodes: { ko: "519", ja: "519", en: "519" }, roomCode: "2010*" }), "ja");
    // ja 체크인 값이 비면 영어 · 모르는 변수는 그대로(변수 아님)
    expect(filled).toEqual({ text: "519 2010* pw123 From 3pm 2 荒木町A {unknown}", missing: [] });
  });

  it("예약 → 계획용 예약: 채널 · 언어 · 인원 · 건물 키, 취소 · 문의 · 검정", () => {
    const row = {
      id: "r-1",
      status: "confirmed",
      source: "Airbnb",
      source_reservation_id: "70001::room::201",
      property_name: "아라키초A",
      room_label: "201",
      guest_name: "Mark",
      check_in_date: "2026-11-20",
      check_out_date: "2026-11-22",
      created_at: "2026-11-05T00:00:00Z",
      bid: null,
      book_id: null,
      raw_status: "new",
      raw_channel: null,
      raw_referer: null,
      raw_api_source: null,
      raw_lang: "JA",
      num_adult: "2",
      num_child: "1",
    };
    expect(toAutoBooking(row, null)).toMatchObject({ providerBookingId: "70001", channel: "airbnb", guestLanguage: "ja", guests: 3, buildingKey: "arakicho_a", status: "confirmed" });
    expect(autoBookingStatus("cancelled", "confirmed")).toBe("cancelled");
    expect(autoBookingStatus("confirmed", "request")).toBe("request");
    expect(autoBookingStatus("confirmed", "black")).toBe("black");
    const building = { canonicalName: "아라키초A", guestInfo: emptyGuestInfo(), guestInfoUpdatedAt: null, sharedAccess: [{ labelKey: "storage" as const, code: "519" }], roomAccess: [{ roomLabel: "201", code: "2010*" }], hasNote: false };
    const filled = autoFillContextFor(toAutoBooking(row, null)!, building);
    expect(filled.sharedCodes?.en).toBe("519");
    expect(filled.roomCode).toBe("2010*");
    expect(filled.building?.en).toBe("Arakicho A");
  });
});

describe("자동 안내 — 계획", () => {
  const existing = (over: Partial<ExistingAutoRun> = {}): ExistingAutoRun => ({
    id: "run-1",
    status: "scheduled",
    scheduledAt: "2026-11-19T09:00:00.000Z",
    skipReason: null,
    missingVariables: [],
    pausedAt: null,
    ...over,
  });

  it("새 예약 → 보낼 예정, 날짜가 바뀌면 시각도 바뀐다", () => {
    expect(planAutoRun({ rule: rule(), booking: booking(), existing: null, ctx: ctx(), now: NOW })).toEqual({
      status: "scheduled",
      scheduledAt: "2026-11-19T09:00:00.000Z",
      skipReason: null,
      missingVariables: [],
    });
    const moved = planAutoRun({ rule: rule(), booking: booking({ checkInDate: "2026-12-01" }), existing: existing(), ctx: ctx(), now: NOW });
    expect(moved).toMatchObject({ status: "scheduled", scheduledAt: "2026-11-30T09:00:00.000Z" });
  });

  it("취소 → cancelled(없으면 만들지 않음), 규칙 꺼짐 · 대상 아님", () => {
    expect(planAutoRun({ rule: rule(), booking: booking({ status: "cancelled" }), existing: existing(), ctx: ctx(), now: NOW })).toMatchObject({
      status: "cancelled",
      skipReason: "cancelled",
    });
    expect(planAutoRun({ rule: rule(), booking: booking({ status: "cancelled" }), existing: null, ctx: ctx(), now: NOW })).toBeNull();
    expect(planAutoRun({ rule: rule({ enabled: false }), booking: booking(), existing: existing(), ctx: ctx(), now: NOW })).toMatchObject({
      status: "cancelled",
      skipReason: "rule_disabled",
    });
    expect(planAutoRun({ rule: rule({ targetBuildings: ["okubo_a"] }), booking: booking(), existing: null, ctx: ctx(), now: NOW })).toBeNull();
    expect(planAutoRun({ rule: rule({ targetChannels: ["booking"] }), booking: booking(), existing: existing(), ctx: ctx(), now: NOW })).toMatchObject({
      status: "cancelled",
      skipReason: "not_target",
    });
    expect(planAutoRun({ rule: rule(), booking: booking({ status: "request" }), existing: null, ctx: ctx(), now: NOW })).toBeNull();
    expect(planAutoRun({ rule: rule({ targetStatuses: ["request"] }), booking: booking({ status: "request" }), existing: null, ctx: ctx(), now: NOW })).toMatchObject({
      status: "scheduled",
    });
  });

  it("직접 예약 · 채널 모름 → skipped(이유 보임)", () => {
    expect(planAutoRun({ rule: rule(), booking: booking({ channel: "direct" }), existing: null, ctx: ctx(), now: NOW })).toMatchObject({
      status: "skipped",
      skipReason: "direct_booking",
    });
    expect(planAutoRun({ rule: rule(), booking: booking({ channel: null }), existing: null, ctx: ctx(), now: NOW })).toMatchObject({
      status: "skipped",
      skipReason: "unknown_channel",
    });
    expect(planAutoRun({ rule: rule(), booking: booking({ channel: "other" }), existing: null, ctx: ctx(), now: NOW })).toMatchObject({
      skipReason: "unknown_channel",
    });
  });

  it("빈 변수 → skipped empty_variable, 채우면 다시 보낼 예정", () => {
    const withCode = rule({ bodies: { ko: "", ja: "", en: "Code {entry_code_shared}" } });
    expect(planAutoRun({ rule: withCode, booking: booking(), existing: null, ctx: ctx(), now: NOW })).toEqual({
      status: "skipped",
      scheduledAt: "2026-11-19T09:00:00.000Z",
      skipReason: "empty_variable",
      missingVariables: ["entry_code_shared"],
    });
    const filled = ctx({ sharedCodes: { ko: "519", ja: "519", en: "519" } });
    expect(
      planAutoRun({ rule: withCode, booking: booking(), existing: existing({ status: "skipped", skipReason: "empty_variable", missingVariables: ["entry_code_shared"] }), ctx: filled, now: NOW }),
    ).toMatchObject({ status: "scheduled", skipReason: null, missingVariables: [] });
  });

  it("멈춤은 남는다 · 큐에 넣은 뒤는 건드리지 않는다", () => {
    expect(planAutoRun({ rule: rule(), booking: booking({ checkInDate: "2026-11-25" }), existing: existing({ status: "paused", pausedAt: NOW.toISOString() }), ctx: ctx(), now: NOW })).toMatchObject({
      status: "paused",
      scheduledAt: "2026-11-24T09:00:00.000Z",
    });
    for (const status of ["queued", "sent", "failed"] as const) {
      expect(planAutoRun({ rule: rule(), booking: booking({ status: "cancelled" }), existing: existing({ status }), ctx: ctx(), now: NOW })).toBe("keep");
    }
  });

  it("지난 시각 — 처음이면 만들지 않고, 있던 것은 past_due(6시간 넘게 늦으면)", () => {
    const today = booking({ checkInDate: "2026-11-12", checkOutDate: "2026-11-14" });
    expect(planAutoRun({ rule: rule(), booking: today, existing: null, ctx: ctx(), now: NOW })).toBeNull();
    expect(planAutoRun({ rule: rule(), booking: today, existing: existing({ scheduledAt: "2026-11-11T09:00:00.000Z" }), ctx: ctx(), now: NOW })).toMatchObject({
      status: "skipped",
      skipReason: "past_due",
    });
    // 늦음 한도 안이면 그대로 보낼 예정(곧 큐로)
    const justDue = new Date(Date.parse("2026-11-19T09:00:00.000Z") + AUTO_LATE_GRACE_MS - 60_000);
    expect(planAutoRun({ rule: rule(), booking: booking(), existing: existing(), ctx: ctx(), now: justDue })).toMatchObject({ status: "scheduled" });
  });

  it("확정 직후 — 켠 뒤에 들어온 예약만, 처음 본 순간 · 있던 시각 그대로", () => {
    const confirmed = rule({ trigger: "confirmed", offsetDays: 0, sendTime: null, enabledAt: "2026-11-10T00:00:00.000Z" });
    expect(planAutoRun({ rule: confirmed, booking: booking({ createdAt: "2026-11-09T00:00:00.000Z" }), existing: null, ctx: ctx(), now: NOW })).toBeNull();
    expect(planAutoRun({ rule: confirmed, booking: booking({ createdAt: "2026-11-11T00:00:00.000Z" }), existing: null, ctx: ctx(), now: NOW })).toMatchObject({
      status: "scheduled",
      scheduledAt: NOW.toISOString(),
    });
    expect(
      planAutoRun({ rule: confirmed, booking: booking(), existing: existing({ scheduledAt: "2026-11-12T02:59:00.000Z" }), ctx: ctx(), now: NOW }),
    ).toMatchObject({ scheduledAt: "2026-11-12T02:59:00.000Z" });
  });

  it("화면 상태 — 큐 뒤는 큐 상태, 빈 변수는 막힘", () => {
    expect(autoRunDisplay({ status: "skipped", skipReason: "empty_variable", outboxStatus: null })).toBe("blocked");
    expect(autoRunDisplay({ status: "queued", skipReason: null, outboxStatus: "uncertain" })).toBe("uncertain");
    expect(autoRunDisplay({ status: "queued", skipReason: null, outboxStatus: "sending" })).toBe("queued");
  });
});

// ── 서버 바퀴(가짜 DB) ──────────────────────────────────────────────────────

type Tables = Record<string, Array<Record<string, unknown>>>;

function ruleRow(over: Record<string, unknown> = {}) {
  return {
    id: RULE_ID,
    organization_id: ORG,
    name: "체크인 방법",
    trigger: "before_checkin",
    offset_days: 1,
    send_time: "18:00",
    target_buildings: [],
    target_channels: [],
    target_statuses: ["confirmed"],
    body_ko: "",
    body_ja: "",
    body_en: "Hi {guest_name}, room {room}",
    enabled: true,
    enabled_at: "2026-11-01T00:00:00Z",
    sort_order: 0,
    updated_at: "2026-11-01T00:00:00Z",
    created_at: "2026-11-01T00:00:00Z",
    ...over,
  };
}

function reservationRow(over: Record<string, unknown> = {}) {
  return {
    id: "res-1",
    organization_id: ORG,
    status: "confirmed",
    source: "Airbnb",
    source_reservation_id: "70001::room::201",
    property_name: PROPERTY_MAP_META[0].canonicalName,
    room_label: "201",
    guest_name: "Mark",
    check_in_date: "2026-11-20",
    check_out_date: "2026-11-22",
    created_at: "2026-11-05T00:00:00Z",
    bid: "70001",
    raw_status: "confirmed",
    raw_lang: "en",
    ...over,
  };
}

/** DB 함수 `guest_message_enqueue_auto` 의 거울(SQL 은 로컬 Postgres 에서 따로 확인). */
const ENQUEUE_RPC = {
  guest_message_enqueue_auto: (args: Record<string, unknown>, tables: Tables) => {
    const run = (tables.auto_message_runs ?? []).find((r) => r.id === args.p_run_id && r.organization_id === args.p_organization_id);
    if (!run || run.status !== "scheduled") return { data: [{ outbox_id: null, enqueued: false }], error: null };
    const key = `auto:${String(args.p_run_id)}`;
    const outbox = (tables.guest_message_outbox ??= []);
    let row = outbox.find((r) => r.idempotency_key === key && r.organization_id === args.p_organization_id);
    if (!row) {
      row = {
        id: `ob-${outbox.length + 1}`,
        organization_id: args.p_organization_id,
        conversation_id: args.p_conversation_id,
        kind: "auto",
        rule_id: run.rule_id,
        body: args.p_body,
        status: "queued",
        attempts: 0,
        next_try_at: args.p_now,
        created_at: args.p_now,
        idempotency_key: key,
      };
      outbox.push(row);
      (tables.guest_messages ??= []).push({ id: `m-${outbox.length}`, organization_id: args.p_organization_id, conversation_id: args.p_conversation_id, direction: "host", body: args.p_body, outbox_id: row.id });
    }
    Object.assign(run, { status: "queued", outbox_id: row.id, conversation_id: args.p_conversation_id });
    return { data: [{ outbox_id: row.id, enqueued: true }], error: null };
  },
};

function makeDb(over: Partial<Tables> = {}) {
  return createFakeSupabase(
    {
      auto_message_rules: [ruleRow()],
      reservations: [reservationRow()],
      property_operation_infos: [],
      guest_conversations: [],
      auto_message_runs: [],
      ...over,
    } as Tables,
    ENQUEUE_RPC,
  );
}

describe("자동 안내 — 계획 바퀴 · 큐 넣기", () => {
  it("만들고, 다시 돌려도 같은 규칙 · 같은 예약은 한 줄(멱등)", async () => {
    const fake = makeDb();
    const db = fake.client as never;
    const first = await runAutoMessagePlanner(db, ORG, { now: NOW });
    expect(first).toMatchObject({ rules: 1, bookings: 1, created: 1, updated: 0 });
    const second = await runAutoMessagePlanner(db, ORG, { now: NOW });
    expect(second).toMatchObject({ created: 0, updated: 0 });
    expect(fake.tables.auto_message_runs).toHaveLength(1);
    expect(fake.tables.auto_message_runs[0]).toMatchObject({ status: "scheduled", scheduled_at: "2026-11-19T09:00:00.000Z", provider_booking_id: "70001" });
  });

  it("날짜가 바뀌면 다시 계획, 취소되면 cancelled", async () => {
    const fake = makeDb();
    const db = fake.client as never;
    await runAutoMessagePlanner(db, ORG, { now: NOW });
    fake.tables.reservations[0].check_in_date = "2026-11-25";
    await runAutoMessagePlanner(db, ORG, { now: NOW });
    expect(fake.tables.auto_message_runs[0].scheduled_at).toBe("2026-11-24T09:00:00.000Z");
    fake.tables.reservations[0].status = "cancelled";
    await runAutoMessagePlanner(db, ORG, { now: NOW });
    expect(fake.tables.auto_message_runs[0]).toMatchObject({ status: "cancelled", skip_reason: "cancelled" });
  });

  it("보낼 시각 — 발송 꺼짐(enqueue 없음)이면 큐에 안 넣고, 켜지면 한 번만 넣는다", async () => {
    const fake = makeDb();
    const db = fake.client as never;
    await runAutoMessagePlanner(db, ORG, { now: NOW });
    const due = new Date("2026-11-19T09:01:00.000Z");
    const off = await runAutoMessagePlanner(db, ORG, { now: due, enqueue: false });
    expect(off.enqueued).toBe(0);
    expect(fake.tables.guest_message_outbox ?? []).toHaveLength(0);
    const on = await runAutoMessagePlanner(db, ORG, { now: due, enqueue: true });
    expect(on.enqueued).toBe(1);
    const again = await runAutoMessagePlanner(db, ORG, { now: due, enqueue: true });
    expect(again.enqueued).toBe(0);
    expect(fake.tables.guest_message_outbox).toHaveLength(1);
    expect(fake.tables.guest_message_outbox[0]).toMatchObject({ kind: "auto", body: "Hi Mark, room 201", idempotency_key: `auto:${String(fake.tables.auto_message_runs[0].id)}` });
    expect(fake.tables.guest_conversations).toHaveLength(1);
    expect(fake.tables.guest_conversations[0]).toMatchObject({ provider_booking_id: "70001", channel: "airbnb", status: "done" });
    expect(fake.tables.auto_message_runs[0].status).toBe("queued");
  });

  it("6시간 넘게 늦은 줄은 큐에 넣지 않고 past_due", async () => {
    const fake = makeDb();
    const db = fake.client as never;
    await runAutoMessagePlanner(db, ORG, { now: NOW });
    const late = new Date(Date.parse("2026-11-19T09:00:00.000Z") + AUTO_LATE_GRACE_MS + 60_000);
    const result = await runAutoMessagePlanner(db, ORG, { now: late, enqueue: true });
    expect(result.enqueued).toBe(0);
    expect(fake.tables.auto_message_runs[0]).toMatchObject({ status: "skipped", skip_reason: "past_due" });
  });

  it("멈춘 줄은 보낼 시각이 돼도 큐에 안 들어간다 · 다른 조직 줄은 안 건드림", async () => {
    const fake = makeDb({ reservations: [reservationRow(), reservationRow({ id: "res-x", organization_id: OTHER_ORG, bid: "99999" })] });
    const db = fake.client as never;
    await runAutoMessagePlanner(db, ORG, { now: NOW });
    expect(fake.tables.auto_message_runs.every((run) => run.organization_id === ORG)).toBe(true);
    Object.assign(fake.tables.auto_message_runs[0], { status: "paused", paused_at: NOW.toISOString() });
    const result = await runAutoMessagePlanner(db, ORG, { now: new Date("2026-11-19T09:01:00.000Z"), enqueue: true });
    expect(result.enqueued).toBe(0);
    expect(fake.tables.auto_message_runs[0].status).toBe("paused");
  });

  it("빈 변수(출입 코드 없음 · 기본값도 없는 건물)는 skipped 로 보인다", async () => {
    const fake = makeDb({ auto_message_rules: [ruleRow({ body_en: "Code {entry_code_room}" })], reservations: [reservationRow({ room_label: "999" })] });
    await runAutoMessagePlanner(fake.client as never, ORG, { now: NOW });
    expect(fake.tables.auto_message_runs[0]).toMatchObject({ status: "skipped", skip_reason: "empty_variable", missing_variables: ["entry_code_room"] });
  });
});

describe("자동 안내 — 발송 우선순위", () => {
  const row = (id: string, kind: "reply" | "auto", created: string): OutboxRow => ({
    id,
    kind,
    status: "queued",
    attempts: 0,
    next_try_at: "2026-11-12T00:00:00.000Z",
    created_at: created,
    body: id,
    provider_booking_id: "70001",
    channel: "airbnb",
  });

  it("직원 답장이 먼저(자동 안내가 먼저 들어왔어도) · 자동 안내는 한 POST 로 묶음 · 크레딧 선 아래면 자동 안내만 남김", async () => {
    const calls: string[][] = [];
    let after = 99;
    const adapter = {
      send: async (items: Array<{ outboxId: string }>) => {
        calls.push(items.map((item) => item.outboxId));
        return { kind: "sent" as const, items: items.map((item) => ({ outboxId: item.outboxId, ok: true as const, externalId: null })), credit: { remaining: after, resetsAt: Date.parse("2026-11-12T03:04:00Z"), requestCost: 1 } };
      },
    };
    const rows = [row("a1", "auto", "2026-11-12T00:00:00Z"), row("a2", "auto", "2026-11-12T00:00:01Z"), row("r1", "reply", "2026-11-12T00:01:00Z")];
    const plenty = await processOutboxBatch({ rows, adapter, creditReserve: 20, credit: { remaining: 100, resetsAt: Date.parse("2026-11-12T03:04:00Z"), requestCost: 1 }, now: NOW });
    expect(calls).toEqual([["r1"], ["a1", "a2"]]);
    expect(plenty.updates.filter((u) => u.status === "sent")).toHaveLength(3);

    calls.length = 0;
    after = 20;
    const low = await processOutboxBatch({ rows, adapter, creditReserve: 20, credit: { remaining: 21, resetsAt: Date.parse("2026-11-12T03:04:00Z"), requestCost: 1 }, now: NOW });
    expect(calls).toEqual([["r1"]]);
    expect(low.deferredIds).toEqual(["a1", "a2"]);
    expect(low.stoppedReason).toBe("credit_reserve");
  });

  it("발송 플래그가 꺼져 있으면 발송 작업은 아무것도 안 한다(큐 줄은 queued 그대로)", async () => {
    const fake = createFakeSupabase({ guest_message_outbox: [{ id: "ob-1", organization_id: ORG, kind: "auto", status: "queued", next_try_at: "2026-11-01T00:00:00Z" }] });
    const result = await runGuestOutbox(fake.client as never, ORG, { enabled: false });
    expect(result).toEqual({ ran: false, reason: "disabled" });
    expect(fake.tables.guest_message_outbox[0].status).toBe("queued");
  });

  it("자동 안내를 보내면 실행 줄이 sent, 대화는 「처리 끝」으로 닫지 않는다(답장 시각 없음)", async () => {
    const fake = createFakeSupabase({
      guest_message_outbox: [{ id: "ob-1", organization_id: ORG, conversation_id: "c-1", kind: "auto", status: "queued", attempts: 0, body: "Hi", next_try_at: "2026-11-01T00:00:00Z", created_at: "2026-11-01T00:00:00Z" }],
      guest_conversations: [{ id: "c-1", organization_id: ORG, provider: "beds24", provider_booking_id: "70001", channel: "airbnb" }],
      guest_message_channel_state: [],
      guest_messages: [{ id: "m-1", organization_id: ORG, conversation_id: "c-1", outbox_id: "ob-1", direction: "host", body: "Hi" }],
      auto_message_runs: [{ id: "run-1", organization_id: ORG, status: "queued", outbox_id: "ob-1" }],
    });
    const adapter = {
      send: async (items: Array<{ outboxId: string }>) => ({
        kind: "sent" as const,
        items: items.map((item) => ({ outboxId: item.outboxId, ok: true as const, externalId: "ext-1" })),
        credit: { remaining: 90, resetsAt: null, requestCost: 1 },
      }),
    };
    const result = await runGuestOutbox(fake.client as never, ORG, { enabled: true, adapter, now: NOW });
    expect(result).toMatchObject({ ran: true, sent: 1 });
    expect(fake.tables.auto_message_runs[0].status).toBe("sent");
    const apply = fake.rpcCalls.find((call) => call.name === "guest_conversation_apply_messages");
    expect((apply?.args as Record<string, unknown>).p_reply_at).toBeNull();
  });
});

describe("자동 안내 — 권한", () => {
  const session = (caps: string[], org = ORG): Session => ({ organization: { id: org }, user: { id: ME, preferredLanguage: "ko" }, capabilities: caps });
  const input = { name: "체크인", trigger: "before_checkin", offsetDays: 1, sendTime: "18:00", bodies: { en: "Hi" }, targetStatuses: ["confirmed"] };

  beforeEach(() => {
    state.db = makeDb({ auto_message_rules: [], auto_message_runs: [{ id: "00000000-0000-4000-8000-000000000a20", organization_id: ORG, rule_id: RULE_ID, status: "scheduled" }] }).client;
  });

  it("규칙 쓰기 · 미리 보기는 manage 만, 관리자 웹 없으면 forbidden", async () => {
    state.session = session(["admin_web.access", "guest_messages.view", "guest_messages.reply"]);
    expect(await saveAutoRuleAction(input)).toEqual({ ok: false, errorKey: "forbidden" });
    expect(await toggleAutoRuleAction(RULE_ID, true)).toEqual({ ok: false, errorKey: "forbidden" });
    expect(await deleteAutoRuleAction(RULE_ID)).toEqual({ ok: false, errorKey: "forbidden" });
    expect(await previewAutoRuleAction({ bodies: { en: "x" }, lang: "en", providerBookingId: "70001" })).toEqual({ ok: false, errorKey: "forbidden" });
    state.session = session(["guest_messages.view", "guest_messages.manage"]);
    expect(await saveAutoRuleAction(input)).toEqual({ ok: false, errorKey: "forbidden" });
  });

  it("manage 면 만든다(꺼진 채) · 조직은 세션에서", async () => {
    state.session = session(["admin_web.access", "guest_messages.view", "guest_messages.manage"]);
    const result = await saveAutoRuleAction({ ...input, organization_id: OTHER_ORG });
    expect(result.ok).toBe(true);
    const rows = (state.db as { from: (t: string) => unknown }) && (await (state.db as ReturnType<typeof createFakeSupabase>["client"]).from("auto_message_rules").select());
    expect((rows as { data: Array<Record<string, unknown>> }).data[0]).toMatchObject({ organization_id: ORG, enabled: false, created_by: ME });
  });

  it("멈추기는 manage 또는 view + reply, view 만이면 forbidden · 다른 조직 실행은 not_found", async () => {
    const run = "00000000-0000-4000-8000-000000000a20";
    state.session = session(["admin_web.access", "guest_messages.view"]);
    expect(await setAutoRunPausedAction(run, true)).toEqual({ ok: false, errorKey: "forbidden" });
    state.session = session(["admin_web.access", "guest_messages.view", "guest_messages.reply"]);
    expect(await setAutoRunPausedAction(run, true)).toEqual({ ok: true });
    state.session = session(["admin_web.access", "guest_messages.view", "guest_messages.reply"], OTHER_ORG);
    expect(await setAutoRunPausedAction(run, false)).toEqual({ ok: false, errorKey: "not_found" });
  });
});

// ── 독립 리뷰 반영(2026-11-13) ────────────────────────────────────────────────

describe("자동 안내 리뷰 — 1,000줄 상한 · 범위 밖 · 멈춤 경합 · 사본", () => {
  it("기존 실행 줄이 1,000줄을 넘어도 잘리지 않는다(두 번째 바퀴 새 줄 0 · 날짜 바뀌면 전부 다시)", async () => {
    const rules = Array.from({ length: 25 }, (_, i) => ruleRow({ id: `00000000-0000-4000-8000-0000000011${String(i).padStart(2, "0")}`, sort_order: i }));
    const reservations = Array.from({ length: 60 }, (_, i) =>
      reservationRow({ id: `res-${i}`, bid: String(80000 + i), source_reservation_id: `${80000 + i}::room::201` }),
    );
    const fake = makeDb({ auto_message_rules: rules, reservations });
    const db = fake.client as never;
    expect(await runAutoMessagePlanner(db, ORG, { now: NOW })).toMatchObject({ created: 1500, writeErrors: 0 });
    expect(await runAutoMessagePlanner(db, ORG, { now: NOW })).toMatchObject({ created: 0, updated: 0, writeErrors: 0 });
    for (const row of fake.tables.reservations) row.check_in_date = "2026-11-25";
    expect(await runAutoMessagePlanner(db, ORG, { now: NOW })).toMatchObject({ created: 0, updated: 1500 });
    expect(new Set(fake.tables.auto_message_runs.map((run) => run.scheduled_at))).toEqual(new Set(["2026-11-24T09:00:00.000Z"]));
  });

  it("규칙 요약 숫자도 1,000줄에서 잘리지 않는다", async () => {
    const runs = Array.from({ length: 1200 }, (_, i) => ({
      id: `run-${String(i).padStart(5, "0")}`,
      organization_id: ORG,
      rule_id: RULE_ID,
      status: "scheduled",
      scheduled_at: "2026-11-19T09:00:00.000Z",
      skip_reason: null,
    }));
    const fake = makeDb({ auto_message_runs: runs });
    const [summary] = await loadAutoRuleSummaries(fake.client as never, ORG, NOW);
    expect(summary.scheduledCount).toBe(1200);
  });

  it("확정 직후 — 계획 범위 밖(먼 미래) 예약도 웹훅 뒤 계획 → 큐 넣기까지 간다", async () => {
    const confirmed = ruleRow({ trigger: "confirmed", offset_days: 0, send_time: null, enabled_at: "2026-11-10T00:00:00Z" });
    const far = reservationRow({ id: "res-far", bid: "90001", source_reservation_id: "90001::room::201", check_in_date: "2027-03-01", check_out_date: "2027-03-03", created_at: "2026-11-12T02:00:00Z" });
    const fake = makeDb({ auto_message_rules: [confirmed], reservations: [far] });
    const db = fake.client as never;
    await planAutoMessagesAfterWebhook(db, [{ ok: true, reservationId: "res-far" }], NOW);
    expect(fake.tables.auto_message_runs).toHaveLength(1);
    const result = await runAutoMessagePlanner(db, ORG, { now: new Date(NOW.getTime() + 60_000), enqueue: true });
    expect(result.enqueued).toBe(1);
    expect(fake.tables.auto_message_runs[0].status).toBe("queued");
  });

  it("지워진 예약의 보낼 차례 줄은 cancelled, 6시간 넘게 지난 범위 밖 줄은 전체 바퀴가 past_due 로 치운다", async () => {
    const fake = makeDb({
      reservations: [],
      auto_message_runs: [
        { id: "run-gone", organization_id: ORG, rule_id: RULE_ID, provider: "beds24", provider_booking_id: "99999", reservation_id: null, status: "scheduled", scheduled_at: "2026-11-12T02:30:00.000Z", paused_at: null, missing_variables: [] },
        { id: "run-old", organization_id: ORG, rule_id: RULE_ID, provider: "beds24", provider_booking_id: "99998", reservation_id: null, status: "scheduled", scheduled_at: "2026-09-01T00:00:00.000Z", paused_at: null, missing_variables: [] },
      ],
    });
    const result = await runAutoMessagePlanner(fake.client as never, ORG, { now: NOW, enqueue: true });
    expect(result.enqueued).toBe(0);
    const byId = Object.fromEntries(fake.tables.auto_message_runs.map((run) => [run.id, run]));
    expect(byId["run-gone"]).toMatchObject({ status: "cancelled", skip_reason: "cancelled" });
    expect(byId["run-old"]).toMatchObject({ status: "skipped", skip_reason: "past_due" });
  });

  it("멈춤 경합 — status 가 scheduled 로 되돌아갔어도 멈춤 표시가 있으면 큐에 넣지 않고 다시 paused", async () => {
    const fake = makeDb();
    const db = fake.client as never;
    await runAutoMessagePlanner(db, ORG, { now: NOW });
    Object.assign(fake.tables.auto_message_runs[0], { status: "scheduled", paused_at: NOW.toISOString() });
    const due = new Date("2026-11-19T09:01:00.000Z");
    expect((await runAutoMessagePlanner(db, ORG, { now: due, enqueue: true })).enqueued).toBe(0);
    expect(fake.tables.auto_message_runs[0].status).toBe("paused");
    expect(fake.tables.guest_message_outbox ?? []).toHaveLength(0);
  });

  it("상태 · 시각이 그대로여도 손님 이름 · 방 사본은 고친다", async () => {
    const fake = makeDb();
    const db = fake.client as never;
    await runAutoMessagePlanner(db, ORG, { now: NOW });
    Object.assign(fake.tables.reservations[0], { guest_name: "Mark J.", room_label: "202" });
    expect((await runAutoMessagePlanner(db, ORG, { now: NOW })).updated).toBe(1);
    expect(fake.tables.auto_message_runs[0]).toMatchObject({ status: "scheduled", guest_name: "Mark J.", room_label: "202" });
  });

  it("웹훅이 원본 번호만 줘도 방 나눔 사본(70001::room::201)을 찾는다", async () => {
    const fake = makeDb({ reservations: [reservationRow({ bid: null, source_reservation_id: "70001::room::201" })] });
    await planAutoMessagesAfterWebhook(fake.client as never, [{ ok: true, sourceReservationId: "70001" }], NOW);
    expect(fake.tables.auto_message_runs).toHaveLength(1);
    expect(fake.tables.auto_message_runs[0].provider_booking_id).toBe("70001");
  });
});

describe("자동 안내 리뷰 — 확정 직후 · 트리거 바뀜 · 숫자 상태 · 묶음 예약", () => {
  const confirmedRule = rule({ trigger: "confirmed", offsetDays: 0, sendTime: null, enabledAt: "2026-11-10T00:00:00.000Z" });

  it("확정 직후는 Beds24 예약 시각이 켠 뒤일 때만 · 체크아웃이 지난 예약은 안 보낸다", () => {
    const old = booking({ createdAt: "2026-11-11T00:00:00.000Z", bookedAt: "2026-11-01T00:00:00Z" });
    expect(planAutoRun({ rule: confirmedRule, booking: old, existing: null, ctx: ctx(), now: NOW })).toBeNull();
    const fresh = booking({ createdAt: "2026-11-11T00:00:00.000Z", bookedAt: "2026-11-11 05:00:00" });
    expect(planAutoRun({ rule: confirmedRule, booking: fresh, existing: null, ctx: ctx(), now: NOW })).toMatchObject({ status: "scheduled" });
    const past = booking({ createdAt: "2026-11-11T00:00:00.000Z", checkInDate: "2026-11-08", checkOutDate: "2026-11-11" });
    expect(planAutoRun({ rule: confirmedRule, booking: past, existing: null, ctx: ctx(), now: NOW })).toBeNull();
    expect(parseBeds24Instant("2026-11-11 05:00:00")).toBe(Date.parse("2026-11-11T05:00:00Z"));
    expect(parseBeds24Instant("nope")).toBeNull();
  });

  it("규칙의 트리거가 바뀌면 보낼 시각을 처음부터(확정 직후 = 지금)", () => {
    const existing: ExistingAutoRun = { id: "run-1", status: "scheduled", scheduledAt: "2026-11-19T09:00:00.000Z", skipReason: null, missingVariables: [], pausedAt: null, trigger: "before_checkin" };
    const fresh = booking({ createdAt: "2026-11-11T00:00:00.000Z" });
    expect(planAutoRun({ rule: confirmedRule, booking: fresh, existing, ctx: ctx(), now: NOW })).toMatchObject({ status: "scheduled", scheduledAt: NOW.toISOString() });
    // 같은 트리거면 처음 본 시각 그대로
    expect(planAutoRun({ rule: confirmedRule, booking: fresh, existing: { ...existing, trigger: "confirmed" }, ctx: ctx(), now: NOW })).toMatchObject({ scheduledAt: "2026-11-19T09:00:00.000Z" });
  });

  it("Beds24 숫자 상태 3 = 요청 · 5 = 문의", () => {
    expect(autoBookingStatus("confirmed", "3")).toBe("request");
    expect(autoBookingStatus("confirmed", "5")).toBe("inquiry");
    expect(autoBookingStatus("confirmed", "1")).toBe("confirmed");
  });

  it("묶음 예약 — 대표 예약 한 번, 방 변수는 묶음의 방 전부, 다른 방은 보내지 않음(임시 결정)", () => {
    const base = {
      status: "confirmed",
      source: "Airbnb",
      property_name: "아라키초A",
      guest_name: "Mark",
      check_in_date: "2026-11-20",
      check_out_date: "2026-11-22",
      created_at: "2026-11-05T00:00:00Z",
      book_id: null,
      raw_status: "confirmed",
      raw_channel: null,
      raw_referer: null,
      raw_api_source: null,
      raw_lang: "en",
      num_adult: "2",
      num_child: null,
    };
    const rows: ReservationRowForAuto[] = [
      { ...base, id: "r-a", bid: "70002", source_reservation_id: "70002::room::202", room_label: "202", master_id: "70001" },
      { ...base, id: "r-m", bid: "70001", source_reservation_id: "70001::room::201", room_label: "201", master_id: null },
    ];
    const buildingInfo = { canonicalName: "아라키초A", guestInfo: emptyGuestInfo(), guestInfoUpdatedAt: null, sharedAccess: [], roomAccess: [{ roomLabel: "201", code: "2010*" }, { roomLabel: "202", code: "2020*" }], hasNote: false };
    const loaded = assembleAutoBookings(rows, new Map(), new Map([["아라키초A", buildingInfo]]));
    const master = loaded.get("70001")!;
    const member = loaded.get("70002")!;
    expect(master.booking).toMatchObject({ groupRooms: ["201", "202"], guests: 4 });
    expect(master.ctx.room?.en).toBe("201 / 202");
    expect(master.ctx.roomCode).toBe("201 2010* / 202 2020*");
    expect(member.booking.groupMember).toBe(true);
    expect(planAutoRun({ rule: rule(), booking: member.booking, existing: null, ctx: member.ctx, now: NOW })).toBeNull();
    expect(planAutoRun({ rule: rule(), booking: member.booking, existing: { id: "x", status: "scheduled", scheduledAt: "2026-11-19T09:00:00.000Z", skipReason: null, missingVariables: [], pausedAt: null }, ctx: member.ctx, now: NOW })).toMatchObject({ status: "cancelled", skipReason: "not_target" });
    // 한 방 코드가 없으면 방 코드 변수는 비어서 막힌다
    const partial = assembleAutoBookings(rows, new Map(), new Map([["아라키초A", { ...buildingInfo, roomAccess: [{ roomLabel: "201", code: "2010*" }] }]]));
    expect(partial.get("70001")!.ctx.roomCode).toBeNull();
  });

  it("묶음의 한 방만 웹훅으로 와도 대표 예약에 묶음 방 전부로 계획한다", async () => {
    const member = reservationRow({ id: "res-b", bid: "70002", source_reservation_id: "70002::room::202", room_label: "202", master_id: "70001", raw_payload: { id: "70002", masterId: "70001" } });
    const master = reservationRow({ id: "res-a", bid: "70001", source_reservation_id: "70001::room::201", room_label: "201", raw_payload: { id: "70001" } });
    const fake = makeDb({ reservations: [master, member] });
    await planAutoMessagesAfterWebhook(fake.client as never, [{ ok: true, reservationId: "res-b" }], NOW);
    expect(fake.tables.auto_message_runs).toHaveLength(1);
    expect(fake.tables.auto_message_runs[0]).toMatchObject({ provider_booking_id: "70001", room_label: "201 / 202" });
  });

  it("코드 가리기 — 긴 값부터 · 2자 이하는 그대로", () => {
    expect(maskEntryCodes("Door 519, room 2010* (no 12)", ["519", "2010*", "12"])).toBe("Door ••••, room •••• (no 12)");
    expect(maskEntryCodes("2010 and 201", ["201", "2010"])).toBe("•••• and ••••");
  });
});

describe("자동 안내 리뷰 — 발송 작업", () => {
  const conv = { id: "c-1", organization_id: ORG, provider: "beds24", provider_booking_id: "70001", channel: "airbnb" };
  const okAdapter = () => {
    const calls: string[][] = [];
    return {
      calls,
      adapter: {
        send: async (items: Array<{ outboxId: string }>) => {
          calls.push(items.map((item) => item.outboxId));
          return { kind: "sent" as const, items: items.map((item) => ({ outboxId: item.outboxId, ok: true as const, externalId: null })), credit: { remaining: 900, resetsAt: null, requestCost: 1 } };
        },
      },
    };
  };

  it("보내기 직전 — 6시간 넘게 밀린 자동 안내 · 취소된 예약은 보내지 않고 큐 · 실행 줄을 닫는다", async () => {
    const fake = createFakeSupabase({
      guest_message_outbox: [
        { id: "ob-late", organization_id: ORG, conversation_id: "c-1", kind: "auto", status: "queued", attempts: 0, body: "late", next_try_at: "2026-11-11T00:00:00Z", created_at: "2026-11-11T00:00:00Z" },
        { id: "ob-cxl", organization_id: ORG, conversation_id: "c-1", kind: "auto", status: "queued", attempts: 0, body: "cxl", next_try_at: "2026-11-12T02:00:00Z", created_at: "2026-11-12T02:00:00Z" },
        { id: "ob-ok", organization_id: ORG, conversation_id: "c-1", kind: "auto", status: "queued", attempts: 0, body: "ok", next_try_at: "2026-11-12T02:30:00Z", created_at: "2026-11-12T02:30:00Z" },
      ],
      guest_conversations: [conv],
      guest_message_channel_state: [],
      guest_messages: [
        { id: "m-late", organization_id: ORG, conversation_id: "c-1", outbox_id: "ob-late", external_id: null, direction: "host", body: "late" },
        { id: "m-ok", organization_id: ORG, conversation_id: "c-1", outbox_id: "ob-ok", external_id: null, direction: "host", body: "ok" },
      ],
      reservations: [
        { id: "res-1", organization_id: ORG, status: "confirmed", raw_status: "confirmed" },
        { id: "res-2", organization_id: ORG, status: "cancelled", raw_status: "cancelled" },
      ],
      auto_message_runs: [
        { id: "run-late", organization_id: ORG, outbox_id: "ob-late", status: "queued", scheduled_at: "2026-11-11T00:00:00.000Z", reservation_id: "res-1" },
        { id: "run-cxl", organization_id: ORG, outbox_id: "ob-cxl", status: "queued", scheduled_at: "2026-11-12T02:00:00.000Z", reservation_id: "res-2" },
        { id: "run-ok", organization_id: ORG, outbox_id: "ob-ok", status: "queued", scheduled_at: "2026-11-12T02:30:00.000Z", reservation_id: "res-1" },
      ],
    });
    const { calls, adapter } = okAdapter();
    const result = await runGuestOutbox(fake.client as never, ORG, { enabled: true, adapter, now: NOW });
    expect(result).toMatchObject({ ran: true, sent: 1 });
    expect(calls).toEqual([["ob-ok"]]);
    const ob = Object.fromEntries(fake.tables.guest_message_outbox.map((row) => [row.id, row]));
    expect(ob["ob-late"]).toMatchObject({ status: "cancelled", error_code: "auto_past_due" });
    expect(ob["ob-cxl"]).toMatchObject({ status: "cancelled", error_code: "auto_cancelled" });
    const runs = Object.fromEntries(fake.tables.auto_message_runs.map((row) => [row.id, row]));
    expect(runs["run-late"]).toMatchObject({ status: "skipped", skip_reason: "past_due" });
    expect(runs["run-cxl"]).toMatchObject({ status: "cancelled", skip_reason: "cancelled" });
    expect(runs["run-ok"].status).toBe("sent");
    expect(fake.tables.guest_messages.map((m) => m.id)).toEqual(["m-ok"]);
  });

  it("직원 답장을 먼저 읽는다 — 자동 안내가 자리를 다 채울 만큼 밀려 있어도", async () => {
    const autos = Array.from({ length: 100 }, (_, i) => ({
      id: `ob-a${String(i).padStart(3, "0")}`,
      organization_id: ORG,
      conversation_id: "c-1",
      kind: "auto",
      status: "queued",
      attempts: 0,
      body: "a",
      next_try_at: "2026-11-12T00:00:00Z",
      created_at: `2026-11-12T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z`,
    }));
    const fake = createFakeSupabase({
      guest_message_outbox: [...autos, { id: "ob-reply", organization_id: ORG, conversation_id: "c-1", kind: "reply", status: "queued", attempts: 0, body: "r", next_try_at: "2026-11-12T00:00:00Z", created_at: "2026-11-12T02:59:00Z" }],
      guest_conversations: [conv],
      guest_message_channel_state: [],
      guest_messages: [],
      auto_message_runs: [],
    });
    const { calls, adapter } = okAdapter();
    await runGuestOutbox(fake.client as never, ORG, { enabled: true, adapter, now: NOW });
    expect(calls[0]).toEqual(["ob-reply"]);
  });
});

describe("자동 안내 — 6단계 점검 3차", () => {
  /** `from(표)` 를 부른 순서를 남긴다 — 웹훅 뒤 계획이 어디까지 읽었는지 본다. */
  function trackTables(client: { from: (table: string) => unknown }) {
    const touched: string[] = [];
    const from = client.from.bind(client);
    client.from = (table: string) => {
      touched.push(table);
      return from(table);
    };
    return touched;
  }

  it("켜 둔 규칙이 하나도 없으면 웹훅 뒤 계획은 예약을 읽지 않고 끝난다", async () => {
    const fake = makeDb({ auto_message_rules: [ruleRow({ enabled: false })] });
    const touched = trackTables(fake.client as never);
    await planAutoMessagesAfterWebhook(fake.client as never, [{ ok: true, reservationId: "res-1" }, { ok: true, sourceReservationId: "70001" }], NOW);
    expect(touched).toEqual(["auto_message_rules"]);
    expect(fake.tables.auto_message_runs).toHaveLength(0);
  });

  it("규칙을 켠 조직의 예약만 계획한다 — 다른 조직 예약은 건너뛴다", async () => {
    const other = reservationRow({ id: "res-other", organization_id: "org-other", bid: "80001" });
    const fake = makeDb({ reservations: [reservationRow(), other] });
    await planAutoMessagesAfterWebhook(fake.client as never, [{ ok: true, reservationId: "res-1" }, { ok: true, reservationId: "res-other" }], NOW);
    expect(fake.tables.auto_message_runs).toHaveLength(1);
    expect(fake.tables.auto_message_runs[0].organization_id).toBe(ORG);
  });

  it("못 보내서 failed 였던 실행 줄도 다시 보내기로 보내지면 sent 가 된다", async () => {
    const conv = { id: "c-1", organization_id: ORG, provider: "beds24", provider_booking_id: "70001", channel: "airbnb" };
    const fake = createFakeSupabase({
      guest_message_outbox: [
        { id: "ob-retry", organization_id: ORG, conversation_id: "c-1", kind: "auto", status: "queued", attempts: 1, body: "again", next_try_at: "2026-11-12T02:30:00Z", created_at: "2026-11-12T02:30:00Z" },
      ],
      guest_conversations: [conv],
      guest_message_channel_state: [],
      guest_messages: [],
      reservations: [{ id: "res-1", organization_id: ORG, status: "confirmed", raw_status: "confirmed" }],
      auto_message_runs: [
        { id: "run-retry", organization_id: ORG, outbox_id: "ob-retry", status: "failed", scheduled_at: "2026-11-12T02:30:00.000Z", reservation_id: "res-1" },
      ],
    } as never);
    const adapter = {
      send: async (items: Array<{ outboxId: string }>) => ({
        kind: "sent" as const,
        items: items.map((item) => ({ outboxId: item.outboxId, ok: true as const, externalId: null })),
        credit: { remaining: 900, resetsAt: null, requestCost: 1 },
      }),
    };
    const result = await runGuestOutbox(fake.client as never, ORG, { enabled: true, adapter: adapter as never, now: NOW });
    expect(result).toMatchObject({ ran: true, sent: 1 });
    expect(fake.tables.auto_message_runs[0].status).toBe("sent");
  });

  it("못 보냄은 이미 sent 인 실행 줄을 되돌리지 않는다(queued 줄만)", async () => {
    const conv = { id: "c-1", organization_id: ORG, provider: "beds24", provider_booking_id: "70001", channel: "airbnb" };
    const fake = createFakeSupabase({
      guest_message_outbox: [
        { id: "ob-x", organization_id: ORG, conversation_id: "c-1", kind: "auto", status: "queued", attempts: 0, body: "x", next_try_at: "2026-11-12T02:30:00Z", created_at: "2026-11-12T02:30:00Z" },
      ],
      guest_conversations: [conv],
      guest_message_channel_state: [],
      guest_messages: [],
      reservations: [{ id: "res-1", organization_id: ORG, status: "confirmed", raw_status: "confirmed" }],
      auto_message_runs: [
        { id: "run-x", organization_id: ORG, outbox_id: "ob-x", status: "sent", scheduled_at: "2026-11-12T02:30:00.000Z", reservation_id: "res-1" },
      ],
    } as never);
    const adapter = {
      send: async (items: Array<{ outboxId: string }>) => ({
        kind: "sent" as const,
        items: items.map((item) => ({ outboxId: item.outboxId, ok: false as const, errorCode: "rejected", permanent: true })),
        credit: { remaining: 900, resetsAt: null, requestCost: 1 },
      }),
    };
    await runGuestOutbox(fake.client as never, ORG, { enabled: true, adapter: adapter as never, now: NOW });
    expect(fake.tables.auto_message_runs[0].status).toBe("sent");
  });
});

describe("자동 안내 — 규칙 끄기", () => {
  const run = (id: string, status: string, ruleId = RULE_ID, org = ORG) => ({
    id, organization_id: org, rule_id: ruleId, status, skip_reason: null, missing_variables: ["room"], scheduled_at: "2026-11-19T09:00:00.000Z",
  });

  it("끄면 그 규칙의 안 나간 줄(scheduled · skipped · paused)만 cancelled + rule_disabled — 큐 · 보냄 · 못 보냄 · 다른 규칙 · 다른 조직은 그대로", async () => {
    const fake = makeDb({
      auto_message_runs: [
        run("r-sched", "scheduled"), run("r-skip", "skipped"), run("r-pause", "paused"),
        run("r-queued", "queued"), run("r-sent", "sent"), run("r-failed", "failed"),
        run("r-other-rule", "scheduled", "rule-other"), run("r-other-org", "scheduled", RULE_ID, "org-other"),
      ],
    });
    const result = await setAutoRuleEnabled(fake.client as never, ORG, RULE_ID, false);
    expect(result && result !== "failed" ? result.enabled : null).toBe(false);
    const byId = Object.fromEntries(fake.tables.auto_message_runs.map((row) => [row.id, row]));
    for (const id of ["r-sched", "r-skip", "r-pause"]) expect(byId[id]).toMatchObject({ status: "cancelled", skip_reason: "rule_disabled", missing_variables: [] });
    expect(byId["r-queued"].status).toBe("queued");
    expect(byId["r-sent"].status).toBe("sent");
    expect(byId["r-failed"].status).toBe("failed");
    expect(byId["r-other-rule"].status).toBe("scheduled");
    expect(byId["r-other-org"].status).toBe("scheduled");
  });

  it("켜기는 실행 줄을 건드리지 않는다(다음 계획 바퀴가 다시 만든다)", async () => {
    const fake = makeDb({ auto_message_rules: [ruleRow({ enabled: false })], auto_message_runs: [run("r-c", "cancelled")] });
    await setAutoRuleEnabled(fake.client as never, ORG, RULE_ID, true);
    expect(fake.tables.auto_message_runs[0].status).toBe("cancelled");
  });
});
