import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase } from "@/lib/__tests__/fake-supabase";

/**
 * 손님 메시지 6단계 — 메시지 → 업무 한 번에. docs/product/47-guest-messaging.md §6-4 · §5-7
 * 종류(권한) · 미리 채움 · 공용 만들기 함수로 저장(권한 거부 포함) · 링크 한 업무 한 줄 · 조직 분리 · 상태 줄 · 「해결됐어요」 초안은 보내지 않음.
 * 세션 · DB 는 가짜, 각 기능의 만들기 함수는 가짜로 바꿔 「같은 함수를 부르는지」를 본다(그 함수들의 검사는 기존 시험이 본다).
 */
type Session = { organization: { id: string }; user: { id: string }; capabilities: string[] };
const state = vi.hoisted(() => ({
  session: null as null | Session,
  db: null as unknown,
  calls: [] as Array<{ fn: string; input: Record<string, unknown> }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  hasOrganizationContext: (session: { organization: { id: string } }) => session.organization.id !== "platform",
  getCurrentAppSession: vi.fn(async () => state.session),
}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => state.db }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/rooms", () => ({
  getActiveRoomCatalogServer: vi.fn(async () => [
    { propertyName: "아라키초A", displayRoomLabel: "101" },
    { propertyName: "아라키초A", displayRoomLabel: "102" },
  ]),
}));
vi.mock("@/lib/maintenance-create", () => ({
  createMaintenanceRecord: vi.fn(async (_s: unknown, input: Record<string, unknown>) => {
    state.calls.push({ fn: "maintenance", input });
    return { ok: true, id: "11111111-1111-4111-8111-111111111111" };
  }),
}));
vi.mock("@/lib/lost-item-create", () => ({
  createLostItemRecord: vi.fn(async (_s: unknown, input: Record<string, unknown>) => {
    state.calls.push({ fn: "lost_found", input });
    return input.roomLabel ? { ok: true, id: "22222222-2222-4222-8222-222222222222" } : { ok: false, error: "invalid_room" };
  }),
}));
vi.mock("@/lib/task-create", () => ({
  createTaskRecord: vi.fn(async (_s: unknown, input: Record<string, unknown>) => {
    state.calls.push({ fn: "task", input });
    return { ok: true, id: "33333333-3333-4333-8333-333333333333", projectId: null };
  }),
}));
vi.mock("@/lib/complaints", () => ({
  createComplaint: vi.fn(async ({ session, input }: { session: Session; input: Record<string, unknown> }) => {
    // 실제 함수처럼 권한을 스스로 본다(화면 · 액션이 놓쳐도 여기서 막힌다).
    if (!session.capabilities.includes("complaint.write")) throw new Error("forbidden");
    state.calls.push({ fn: "complaint", input });
    return { id: "44444444-4444-4444-8444-444444444444" };
  }),
}));

import { createTaskFromGuestMessage, getGuestMessageLinkForTarget, getTaskFormContext } from "@/actions/guest-message-tasks";
import {
  buildTaskPrefill,
  canCreateKind,
  complaintPlatformFor,
  creatableKinds,
  isStayingNow,
  linkTargetHref,
  linkTargetState,
  pickResolvedLink,
  type ThreadLinkView,
} from "@/lib/guest-messages/task-link-model";
import { buildResolvedDraft, insertGuestMessageLink, isOwnFreshTarget, loadThreadLinks } from "@/lib/guest-messages/task-link-server";
import { setResolvedSavedReply } from "@/lib/guest-messages/saved-replies-server";
import { newIdempotencyKey } from "@/components/guest-messages/gm-format";
import { UUID_RE } from "@/lib/guest-messages/inbox-model";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

const ORG = "00000000-0000-4000-8000-000000000a01";
const OTHER_ORG = "00000000-0000-4000-8000-000000000a02";
const ME = "00000000-0000-4000-8000-000000000b01";
const CONV = "00000000-0000-4000-8000-000000000c01";
const OTHER_CONV = "00000000-0000-4000-8000-000000000c02";
const MSG1 = "00000000-0000-4000-8000-000000000d01";
const MSG2 = "00000000-0000-4000-8000-000000000d02";
const HOST_MSG = "00000000-0000-4000-8000-000000000d03";
const FOREIGN_MSG = "00000000-0000-4000-8000-000000000d04";
const RESV = "00000000-0000-4000-8000-000000000e01";
const SUBMIT = "00000000-0000-4000-8000-000000000f01";

const MAINT_ID = "11111111-1111-4111-8111-111111111111";
const LOST_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "33333333-3333-4333-8333-333333333333";
const COMPLAINT_ID = "44444444-4444-4444-8444-444444444444";
const VIEW = ["guest_messages.view"];
const FULL = ["guest_messages.view", "complaint.write"];

function seed() {
  return {
    guest_conversations: [
      {
        id: CONV,
        organization_id: ORG,
        reservation_id: RESV,
        property_id: "prop-1",
        room_id: "room-1",
        property_name: "아라키초A",
        room_label: "101",
        guest_name: "Emma Wilson",
        channel: "airbnb",
        check_in_date: "2026-11-10",
        check_out_date: "2026-11-15",
      },
      { id: OTHER_CONV, organization_id: OTHER_ORG, property_name: "아라키초A", room_label: "102", guest_name: "X", channel: "booking" },
    ],
    guest_messages: [
      { id: MSG1, organization_id: ORG, conversation_id: CONV, direction: "guest", sent_at: "2026-11-12T01:00:00Z" },
      { id: MSG2, organization_id: ORG, conversation_id: CONV, direction: "guest", sent_at: "2026-11-12T00:00:00Z" },
      { id: HOST_MSG, organization_id: ORG, conversation_id: CONV, direction: "host", sent_at: "2026-11-12T02:00:00Z" },
      { id: FOREIGN_MSG, organization_id: OTHER_ORG, conversation_id: OTHER_CONV, direction: "guest", sent_at: "2026-11-12T00:00:00Z" },
    ],
    reservations: [{ id: RESV, organization_id: ORG, property_name: "아라키초A", room_label: "101" }],
    guest_message_links: [] as Array<Record<string, unknown>>,
    guest_message_outbox: [] as Array<Record<string, unknown>>,
    // 가짜 만들기 함수가 돌려주는 업무 — 이 사람이 방금 만든 줄(링크를 넣기 전 확인이 읽는다).
    maintenance_reports: [{ id: MAINT_ID, organization_id: ORG, reported_by_user_id: ME, created_at: new Date().toISOString() }],
    lost_items: [{ id: LOST_ID, organization_id: ORG, reported_by_user_id: ME, created_at: new Date().toISOString() }],
    tasks: [{ id: TASK_ID, organization_id: ORG, created_by_user_id: ME, created_at: new Date().toISOString() }],
    customer_complaints: [{ id: COMPLAINT_ID, organization_id: ORG, created_by_user_id: ME, created_at: new Date().toISOString() }],
  };
}

function input(overrides: Partial<Parameters<typeof createTaskFromGuestMessage>[0]> = {}) {
  return {
    conversationId: CONV,
    kind: "maintenance" as const,
    messageIds: [MSG1, MSG2],
    title: "Shower is cold",
    body: "손님 말(오전 9:42): Shower is cold",
    urgent: true,
    category: "water",
    propertyName: "아라키초A",
    roomLabel: "101",
    buildingOnly: false,
    submissionId: SUBMIT,
    ...overrides,
  };
}

let tables: ReturnType<typeof seed>;
beforeEach(() => {
  tables = seed();
  state.db = createFakeSupabase(tables as unknown as Record<string, Array<Record<string, unknown>>>).client;
  state.session = { organization: { id: ORG }, user: { id: ME }, capabilities: FULL };
  state.calls = [];
});

describe("만들 수 있는 종류 — 기존 권한 그대로", () => {
  it("메시지를 못 보면 아무것도", () => {
    expect(creatableKinds([])).toEqual([]);
    expect(creatableKinds(["complaint.write"])).toEqual([]);
  });
  it("메시지만 보면 수리 · 분실물 · 할 일, 게스트 피드백은 complaint.write 가 있을 때만", () => {
    expect(creatableKinds(VIEW)).toEqual(["maintenance", "lost_found", "task"]);
    expect(creatableKinds(FULL)).toEqual(["maintenance", "lost_found", "task", "complaint"]);
    expect(canCreateKind(VIEW, "complaint")).toBe(false);
  });
});

describe("미리 채움", () => {
  const labels = { guestSaid: "손님 말({time})", original: "원문" };
  it("제목 = 첫 말(번역 우선)의 첫 줄, 내용 = 말마다 번역 + 다르면 원문", () => {
    const out = buildTaskPrefill(
      [
        { body: "シャワーが冷たい\n二行目", translated: "샤워가 차가워요\n둘째 줄", timeLabel: "오전 9:42" },
        { body: "Thanks", translated: null, timeLabel: "오전 9:50" },
      ],
      labels,
    );
    expect(out.title).toBe("샤워가 차가워요");
    expect(out.body).toBe("손님 말(오전 9:42): 샤워가 차가워요\n둘째 줄\n원문: シャワーが冷たい\n二行目\n\n손님 말(오전 9:50): Thanks");
  });
  it("빈 말은 건너뛰고, 긴 제목은 80자로 자른다", () => {
    expect(buildTaskPrefill([{ body: " ", translated: null, timeLabel: "" }], labels)).toEqual({ title: "", body: "" });
    const long = "a".repeat(200);
    const out = buildTaskPrefill([{ body: long, translated: null, timeLabel: "t" }], labels);
    expect(Array.from(out.title)).toHaveLength(80);
    expect(out.title.endsWith("…")).toBe(true);
  });
  it("피드백 플랫폼 · 숙박 중 판정", () => {
    expect(complaintPlatformFor("airbnb")).toBe("airbnb");
    expect(complaintPlatformFor("expedia" as never)).toBe("other");
    expect(complaintPlatformFor(null)).toBe("other");
    expect(isStayingNow("2026-11-10", "2026-11-15", "2026-11-12")).toBe(true);
    expect(isStayingNow("2026-11-10", "2026-11-12", "2026-11-12")).toBe(false);
  });
});

describe("업무 상태 → 대화 줄", () => {
  it("종류마다 끝남 상태가 다르다(무효 · 폐기 · 취소는 끝남 아님)", () => {
    expect(linkTargetState("maintenance", { status: "closed", doneAt: "x", title: null })).toMatchObject({ status: "closed", done: true, doneAt: "x" });
    expect(linkTargetState("maintenance", { status: "cancelled", doneAt: "x", title: null })).toMatchObject({ done: false, doneAt: null });
    expect(linkTargetState("lost_found", { status: "returned", doneAt: "y", title: null }).done).toBe(true);
    expect(linkTargetState("lost_found", { status: "disposed", doneAt: "y", title: null }).done).toBe(false);
    expect(linkTargetState("task", { status: "completed", doneAt: "z", title: null }).done).toBe(true);
    expect(linkTargetState("task", { status: "cancelled", doneAt: null, title: null }).done).toBe(false);
    expect(linkTargetState("complaint", { status: "resolved", doneAt: "w", title: null }).done).toBe(true);
  });
  it("지워짐(없는 줄 · 할 일 soft delete) · 모르는 상태", () => {
    expect(linkTargetState("maintenance", null)).toMatchObject({ status: "deleted", deleted: true });
    expect(linkTargetState("task", { status: "open", doneAt: null, deletedAt: "2026-11-12", title: "t" })).toMatchObject({ deleted: true });
    expect(linkTargetState("complaint", { status: "weird", doneAt: null, title: null }).status).toBe("unknown");
  });
  it("상세 주소 — PC 는 콘솔 패널, 할 일은 모바일 상세", () => {
    expect(linkTargetHref("maintenance", "a", "admin")).toBe("/admin/maintenance?report=a");
    expect(linkTargetHref("lost_found", "a", "admin")).toBe("/admin/lost-found?item=a");
    expect(linkTargetHref("complaint", "a", "admin")).toBe("/admin/complaints?complaint=a");
    expect(linkTargetHref("task", "a", "admin")).toBe("/mobile/tasks/a");
    expect(linkTargetHref("maintenance", "a", "mobile")).toBe("/mobile/requests/maintenance/a");
    expect(linkTargetHref("lost_found", "a", "mobile")).toBe("/mobile/requests/lost-found/a");
    expect(linkTargetHref("complaint", "a", "mobile")).toBe("/mobile/complaints/a");
  });
  it("대화를 열 때 업무 표에서 상태를 읽는다 — 다른 조직 업무는 지워짐으로, 할 일 제목은 참여자에게만", async () => {
    const db = createFakeSupabase({
      guest_message_links: [
        { id: "l1", organization_id: ORG, conversation_id: CONV, message_id: MSG1, target_type: "maintenance", target_id: "m1", created_at: "2026-11-12T03:00:00Z" },
        { id: "l2", organization_id: ORG, conversation_id: CONV, message_id: null, target_type: "task", target_id: "t1", created_at: "2026-11-12T03:01:00Z" },
        { id: "l3", organization_id: ORG, conversation_id: CONV, message_id: null, target_type: "complaint", target_id: "c-foreign", created_at: "2026-11-12T03:02:00Z" },
        { id: "lx", organization_id: OTHER_ORG, conversation_id: CONV, message_id: null, target_type: "task", target_id: "t1", created_at: "2026-11-12T03:03:00Z" },
      ],
      maintenance_reports: [{ id: "m1", organization_id: ORG, status: "closed", completed_at: "2026-11-12T05:00:00Z", issue_title: "Cold shower" }],
      tasks: [{ id: "t1", organization_id: ORG, status: "open", completed_at: null, deleted_at: null, title: "Private task title" }],
      customer_complaints: [{ id: "c-foreign", organization_id: OTHER_ORG, status: "open", resolved_at: null, title: "secret" }],
      task_participants: [],
    }).client as unknown as SupabaseClient<Database>;
    const links = await loadThreadLinks(db, ORG, CONV, ME);
    expect(links.map((l) => l.id)).toEqual(["l1", "l2", "l3"]);
    expect(links[0]).toMatchObject({ title: "Cold shower", state: { status: "closed", done: true, doneAt: "2026-11-12T05:00:00Z" } });
    expect(links[1]).toMatchObject({ title: null, state: { status: "open" } });
    expect(links[2]).toMatchObject({ title: null, state: { deleted: true } });
  });
});

describe("「해결됐어요」 초안 — 띄우기만, 보내지 않는다", () => {
  const link = (over: Partial<ThreadLinkView> = {}): ThreadLinkView => ({
    id: "l1",
    targetType: "maintenance",
    targetId: "m1",
    messageId: null,
    createdAt: "2026-11-12T03:00:00Z",
    title: null,
    state: { status: "closed", done: true, doneAt: "2026-11-12T05:00:00Z", deleted: false },
    ...over,
  });
  it("끝난 뒤 우리 답장이 없을 때만", () => {
    expect(pickResolvedLink([link()], [{ direction: "host", sentAt: "2026-11-12T04:00:00Z" }])?.id).toBe("l1");
    expect(pickResolvedLink([link()], [{ direction: "host", sentAt: "2026-11-12T06:00:00Z" }])).toBeNull();
    expect(pickResolvedLink([link({ state: { status: "open", done: false, doneAt: null, deleted: false } })], [])).toBeNull();
  });
  it("여러 개면 가장 최근에 끝난 것", () => {
    const later = link({ id: "l2", state: { status: "resolved", done: true, doneAt: "2026-11-12T07:00:00Z", deleted: false }, targetType: "complaint" });
    expect(pickResolvedLink([link(), later], [])?.id).toBe("l2");
  });
  it("정해 둔 문구가 없으면 사전 기본 문구(언어마다) — 발송 큐에 아무것도 넣지 않는다", async () => {
    const db = createFakeSupabase(tables as unknown as Record<string, Array<Record<string, unknown>>>);
    const draft = await buildResolvedDraft(
      db.client as unknown as SupabaseClient<Database>,
      ORG,
      { property_name: "아라키초A", room_label: "101", guest_name: "Emma", check_in_date: null, check_out_date: null },
      link(),
    );
    expect(draft.fromSavedReply).toBe(false);
    expect(draft.texts.ko).toMatch(/고쳤어요/);
    expect(draft.texts.en).toMatch(/fixed/);
    expect(draft.texts.ja.length).toBeGreaterThan(0);
    expect(db.writes).toEqual([]);
  });
  it("「해결됐어요」로 표시한 문구가 있으면 그 문구(변수 채움)", async () => {
    const db = createFakeSupabase({
      guest_message_saved_replies: [
        { id: "r1", organization_id: ORG, purpose: "resolved", body_ko: "{guest_name}님, 해결했어요", body_ja: "", body_en: "Done, {guest_name}!" },
        { id: "r2", organization_id: OTHER_ORG, purpose: "resolved", body_ko: "다른 조직", body_ja: "", body_en: "other" },
      ],
    });
    const draft = await buildResolvedDraft(
      db.client as unknown as SupabaseClient<Database>,
      ORG,
      { property_name: "아라키초A", room_label: "101", guest_name: "Emma", check_in_date: null, check_out_date: null },
      link(),
    );
    expect(draft.fromSavedReply).toBe(true);
    expect(draft.texts.ko).toBe("Emma님, 해결했어요");
    expect(draft.texts.en).toBe("Done, Emma!");
    expect(db.writes).toEqual([]);
  });
});

describe("링크 — 업무 하나에 한 줄", () => {
  /** guest_message_links 에 unique (organization_id, target_type, target_id) 를 흉내 내는 작은 DB. */
  function uniqueDb(rows: Array<Record<string, unknown>>) {
    const fake = createFakeSupabase({ guest_message_links: rows }).client;
    return {
      from(table: string) {
        const b = fake.from(table) as unknown as Record<string, (...args: unknown[]) => unknown>;
        if (table !== "guest_message_links") return b;
        const insert = b.insert.bind(b);
        b.insert = (value: unknown) => {
          const row = value as Record<string, unknown>;
          if (rows.some((r) => r.organization_id === row.organization_id && r.target_type === row.target_type && r.target_id === row.target_id)) {
            return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate" } });
          }
          return insert(value);
        };
        return b;
      },
    } as unknown as SupabaseClient<Database>;
  }
  const base = { organizationId: ORG, conversationId: CONV, messageId: MSG1, targetType: "maintenance" as const, targetId: "m1", createdBy: ME };

  it("처음엔 넣고, 같은 대화로 다시 오면 그대로 성공(중복 없음)", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const db = uniqueDb(rows);
    expect(await insertGuestMessageLink(db, base)).toEqual({ ok: true, duplicate: false });
    expect(await insertGuestMessageLink(db, base)).toEqual({ ok: true, duplicate: true });
    expect(rows).toHaveLength(1);
  });
  it("다른 대화에 이미 붙은 업무는 conflict", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const db = uniqueDb(rows);
    await insertGuestMessageLink(db, base);
    expect(await insertGuestMessageLink(db, { ...base, conversationId: OTHER_CONV })).toEqual({ ok: false, error: "conflict" });
  });
  it("같은 id 라도 다른 조직이면 따로(조직마다 유일)", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const db = uniqueDb(rows);
    await insertGuestMessageLink(db, base);
    expect(await insertGuestMessageLink(db, { ...base, organizationId: OTHER_ORG, conversationId: OTHER_CONV })).toEqual({ ok: true, duplicate: false });
  });
});

describe("createTaskFromGuestMessage — 공용 만들기 함수 · 권한", () => {
  it("메시지 권한이 없으면 forbidden(아무것도 만들지 않음)", async () => {
    state.session = { organization: { id: ORG }, user: { id: ME }, capabilities: ["complaint.write"] };
    expect(await createTaskFromGuestMessage(input())).toEqual({ ok: false, errorKey: "forbidden" });
    expect(state.calls).toEqual([]);
    expect(tables.guest_message_links).toEqual([]);
  });
  it("complaint.write 가 없으면 게스트 피드백은 forbidden", async () => {
    state.session = { organization: { id: ORG }, user: { id: ME }, capabilities: VIEW };
    expect(await createTaskFromGuestMessage(input({ kind: "complaint" }))).toEqual({ ok: false, errorKey: "forbidden" });
    expect(state.calls).toEqual([]);
  });
  it("수리 · 점검 — 공용 함수에 대화의 예약을 잇고, 링크의 메시지는 가장 이른 손님 말", async () => {
    const result = await createTaskFromGuestMessage(input());
    expect(result).toMatchObject({ ok: true, kind: "maintenance", adminHref: "/admin/maintenance?report=11111111-1111-4111-8111-111111111111", linkFailed: false });
    expect(state.calls[0]).toMatchObject({
      fn: "maintenance",
      input: { id: SUBMIT, propertyName: "아라키초A", roomLabel: "101", priority: "urgent", category: "water", imageUrls: [], reservationId: RESV },
    });
    expect(tables.guest_message_links).toHaveLength(1);
    expect(tables.guest_message_links[0]).toMatchObject({ organization_id: ORG, conversation_id: CONV, message_id: MSG2, target_type: "maintenance", created_by: ME });
  });
  it("직원이 다른 방을 고르면 예약은 잇지 않는다(그 기능 검사가 막지 않게)", async () => {
    await createTaskFromGuestMessage(input({ roomLabel: "102" }));
    expect(state.calls[0].input).toMatchObject({ roomLabel: "102", reservationId: null });
  });
  it("분실물 — 기능 검사 실패는 그 코드로 돌려주고 링크를 만들지 않는다", async () => {
    expect(await createTaskFromGuestMessage(input({ kind: "lost_found", roomLabel: null }))).toEqual({ ok: false, errorKey: "invalid_room" });
    expect(tables.guest_message_links).toEqual([]);
  });
  it("할 일 · 게스트 피드백 — 대화의 건물 · 방 · 예약 · 손님을 서버가 다시 읽어 넣는다", async () => {
    await createTaskFromGuestMessage(input({ kind: "task", propertyName: "아무거나", roomLabel: "999" }));
    expect(state.calls[0]).toMatchObject({
      fn: "task",
      input: { id: SUBMIT, ctxPropertyId: "prop-1", ctxRoomId: "room-1", ctxReservationId: RESV, ctxGuestName: "Emma Wilson", priority: "urgent", imageUrls: [] },
    });
    await createTaskFromGuestMessage(input({ kind: "complaint", submissionId: "00000000-0000-4000-8000-000000000f02" }));
    expect(state.calls[1]).toMatchObject({
      fn: "complaint",
      // 건물 · 방은 정본 꼴(예약 → 대화) — 피드백 폼이 만든 줄과 같은 꼴.
      input: { platform: "airbnb", reservationId: RESV, guestName: "Emma Wilson", imageUrls: [], propertyName: "아라키초A", roomLabel: "101" },
    });
    expect(tables.guest_message_links.map((l) => l.target_type)).toEqual(["task", "complaint"]);
  });
  it("다른 조직 대화 · 다른 조직 메시지 · 우리 답장은 거절", async () => {
    expect(await createTaskFromGuestMessage(input({ conversationId: OTHER_CONV }))).toEqual({ ok: false, errorKey: "not_found" });
    expect(await createTaskFromGuestMessage(input({ messageIds: [MSG1, FOREIGN_MSG] }))).toEqual({ ok: false, errorKey: "invalid" });
    expect(await createTaskFromGuestMessage(input({ messageIds: [HOST_MSG] }))).toEqual({ ok: false, errorKey: "invalid" });
    expect(state.calls).toEqual([]);
  });
  it("제목 없음 · 잘못된 종류 · 잘못된 id", async () => {
    expect(await createTaskFromGuestMessage(input({ title: "  " }))).toEqual({ ok: false, errorKey: "missing_title" });
    expect(await createTaskFromGuestMessage(input({ kind: "order" as never }))).toEqual({ ok: false, errorKey: "invalid" });
    expect(await createTaskFromGuestMessage(input({ submissionId: "x" }))).toEqual({ ok: false, errorKey: "invalid" });
  });
  it("만들기 칸 — 종류는 권한대로, 대화의 자리는 카탈로그에 있을 때만", async () => {
    state.session = { organization: { id: ORG }, user: { id: ME }, capabilities: VIEW };
    const ctx = await getTaskFormContext(CONV);
    expect(ctx).toMatchObject({ ok: true, kinds: ["maintenance", "lost_found", "task"], place: { propertyName: "아라키초A", roomLabel: "101" } });
    expect(await getTaskFormContext(OTHER_CONV)).toEqual({ ok: false, errorKey: "not_found" });
  });
});

describe("업무 상세의 「손님 메시지에서」", () => {
  beforeEach(() => {
    tables.guest_message_links.push({ id: "l1", organization_id: ORG, conversation_id: CONV, target_type: "maintenance", target_id: "11111111-1111-4111-8111-111111111111" });
  });
  it("메시지를 볼 수 있으면 대화와 손님 이름", async () => {
    expect(await getGuestMessageLinkForTarget("maintenance", "11111111-1111-4111-8111-111111111111")).toEqual({ ok: true, conversationId: CONV, guestName: "Emma Wilson" });
  });
  it("메시지 권한이 없거나 다른 조직이면 없음", async () => {
    state.session = { organization: { id: ORG }, user: { id: ME }, capabilities: ["complaint.write"] };
    expect(await getGuestMessageLinkForTarget("maintenance", "11111111-1111-4111-8111-111111111111")).toEqual({ ok: false });
    state.session = { organization: { id: OTHER_ORG }, user: { id: ME }, capabilities: FULL };
    expect(await getGuestMessageLinkForTarget("maintenance", "11111111-1111-4111-8111-111111111111")).toEqual({ ok: false });
  });
});

describe("검토 반영(2026-11-13) — 멱등 · 남의 업무 · 원자성 · 요청 id", () => {
  it("만들기 함수가 남의 업무(같은 요청 id)를 돌려주면 대화에 잇지 않고 conflict", async () => {
    tables.customer_complaints[0].created_by_user_id = "00000000-0000-4000-8000-00000000beef";
    expect(await createTaskFromGuestMessage(input({ kind: "complaint" }))).toEqual({ ok: false, errorKey: "conflict" });
    expect(tables.guest_message_links).toEqual([]);
  });
  it("10분보다 오래된 업무도 conflict", async () => {
    tables.maintenance_reports[0].created_at = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    expect(await createTaskFromGuestMessage(input())).toEqual({ ok: false, errorKey: "conflict" });
    expect(tables.guest_message_links).toEqual([]);
  });
  it("isOwnFreshTarget — 다른 조직 · 없는 줄 · 남의 줄은 false", async () => {
    const db = createFakeSupabase(tables as unknown as Record<string, Array<Record<string, unknown>>>).client as unknown as SupabaseClient<Database>;
    const base = { organizationId: ORG, targetType: "task" as const, targetId: TASK_ID, userId: ME };
    expect(await isOwnFreshTarget(db, base)).toBe(true);
    expect(await isOwnFreshTarget(db, { ...base, organizationId: OTHER_ORG })).toBe(false);
    expect(await isOwnFreshTarget(db, { ...base, targetId: "nope" })).toBe(false);
    expect(await isOwnFreshTarget(db, { ...base, userId: "someone" })).toBe(false);
  });
  it("같은 요청 id 로 두 번 와도 링크는 한 줄", async () => {
    // 가짜 DB 에 고유 키가 없어 두 번째 넣기를 23505 로 흉내 낸다.
    const fake = createFakeSupabase(tables as unknown as Record<string, Array<Record<string, unknown>>>).client;
    state.db = {
      from(table: string) {
        const b = fake.from(table) as unknown as Record<string, (...args: unknown[]) => unknown>;
        if (table !== "guest_message_links") return b;
        const insert = b.insert.bind(b);
        b.insert = (value: unknown) => {
          const row = value as Record<string, unknown>;
          if (tables.guest_message_links.some((r) => r.target_type === row.target_type && r.target_id === row.target_id && r.organization_id === row.organization_id)) {
            return Promise.resolve({ data: null, error: { code: "23505" } });
          }
          return insert(value);
        };
        return b;
      },
    };
    const first = await createTaskFromGuestMessage(input({ kind: "task" }));
    const second = await createTaskFromGuestMessage(input({ kind: "task" }));
    expect(first).toMatchObject({ ok: true, linkFailed: false });
    expect(second).toMatchObject({ ok: true, linkFailed: false, targetId: TASK_ID });
    expect(tables.guest_message_links).toHaveLength(1);
    // 두 번 다 같은 요청 id 로 공용 함수에 넘긴다(함수가 같은 줄을 돌려준다 — task-create 시험).
    expect(state.calls.map((c) => c.input.id)).toEqual([SUBMIT, SUBMIT]);
  });
  it("「해결됐어요」 문구 바꾸기는 DB 함수 한 번(지우기 + 붙이기 한 트랜잭션)", async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    const db = { rpc: async (name: string, args: unknown) => (calls.push({ name, args }), { data: name === "guest_message_set_resolved_reply", error: null }) };
    expect(await setResolvedSavedReply(db as unknown as SupabaseClient<Database>, ORG, "r1")).toEqual({ ok: true });
    expect(calls).toEqual([{ name: "guest_message_set_resolved_reply", args: { p_organization_id: ORG, p_id: "r1" } }]);
    const missing = { rpc: async () => ({ data: false, error: null }) };
    expect(await setResolvedSavedReply(missing as unknown as SupabaseClient<Database>, ORG, "x")).toEqual({ ok: false, error: "not_found" });
    const broken = { rpc: async () => ({ data: null, error: { code: "XX000" } }) };
    expect(await setResolvedSavedReply(broken as unknown as SupabaseClient<Database>, ORG, null)).toEqual({ ok: false, error: "save_failed" });
  });
  it("randomUUID 가 없는 곳에서도 요청 id 는 서버가 받는 uuid 꼴", () => {
    const original = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      const key = newIdempotencyKey();
      expect(key).toMatch(UUID_RE);
      expect(key[14]).toBe("4");
      expect(newIdempotencyKey()).not.toBe(key);
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: original, configurable: true });
    }
  });
});
