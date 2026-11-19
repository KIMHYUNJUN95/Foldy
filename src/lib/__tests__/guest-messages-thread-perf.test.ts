import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createFakeSupabase } from "@/lib/__tests__/fake-supabase";
import { loadInboxThread } from "@/lib/guest-messages/inbox-server";

/**
 * 대화 하나 열기(`loadInboxThread`) 성능 — 2026-11-19. 읽기 단계 수 · 동시 실행 · 고른 칸 · 발송 줄 상한을 가짜 DB 로 잰다.
 * 결과 모양은 바꾸기 전 코드로 찍어 둔 스냅숏과 같아야 한다(`__snapshots__/guest-messages-thread-perf.test.ts.snap`).
 * docs/product/47-guest-messaging.md §5-13 「성능 — 읽기 묶음」
 */
type Row = Record<string, unknown>;
type Read = { table: string; columns: string | undefined; rows: number; stage: number; limit: number | null };

const ORG = "00000000-0000-4000-8000-000000000900";
const OTHER_ORG = "00000000-0000-4000-8000-000000000999";
const NOW = new Date("2026-11-19T03:00:00.000Z");
const CONV = "00000000-0000-4000-8000-00000000c001";
const RES = "00000000-0000-4000-8000-00000000a001";
const STAFF = "00000000-0000-4000-8000-00000000b001";
const OUTSIDER = "00000000-0000-4000-8000-00000000b002";
const uuid = (prefix: string, n: number) => `00000000-0000-4000-8000-${prefix}${String(n).padStart(12 - prefix.length, "0")}`;

function conversation(patch: Row = {}): Row {
  return {
    id: CONV,
    organization_id: ORG,
    provider: "beds24",
    provider_booking_id: "93328947",
    reservation_id: RES,
    property_name: "아라키초A",
    room_label: "201",
    channel: "direct",
    booking_status: "confirmed",
    check_in_date: "2026-11-20",
    check_out_date: "2026-11-22",
    guest_name: "Guest",
    guest_language: "en",
    status: "awaiting",
    snooze_until: null,
    last_guest_at: "2026-11-18T05:00:00Z",
    last_reply_at: "2026-11-18T02:00:00Z",
    last_message_at: "2026-11-18T05:00:00Z",
    ...patch,
  };
}

function msg(n: number, patch: Row = {}): Row {
  return {
    id: uuid("d", n),
    organization_id: ORG,
    conversation_id: CONV,
    direction: "guest",
    body: `line ${n}`,
    body_translated: null,
    translated_lang: null,
    body_lang: null,
    sent_at: new Date(Date.UTC(2026, 10, 18, 0, n)).toISOString(),
    author_user_id: null,
    attachments: [],
    outbox_id: null,
    ...patch,
  };
}

function outbox(n: number, patch: Row = {}): Row {
  return {
    id: uuid("e", n),
    organization_id: ORG,
    conversation_id: CONV,
    kind: "reply",
    status: "sent",
    error_code: null,
    next_try_at: null,
    created_at: new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString(),
    ...patch,
  };
}

/** 대화 하나에 붙는 모든 표 — 예약(큰 원본) · 메시지 · 발송 줄 · 자동 안내 · 업무 링크 · 번역 · 작성자. */
function fullTables(): Record<string, Row[]> {
  return {
    guest_conversations: [conversation()],
    reservations: [
      {
        id: RES,
        organization_id: ORG,
        source: "direct",
        raw_payload: {
          numAdult: 2,
          numChild: "1",
          numInfant: 0,
          apiReference: "HM-123",
          email: " guest@example.com ",
          infoItems: Array.from({ length: 50 }, (_, i) => ({ code: `X${i}`, text: "noise".repeat(20) })),
        },
      },
    ],
    guest_messages: [
      msg(1, { body: "Hi, can I check in early?" }),
      msg(2, { direction: "host", body: "Sure", author_user_id: STAFF, outbox_id: uuid("e", 2), body_lang: "en" }),
      msg(3, { direction: "host", body: "Door code 482193", outbox_id: uuid("e", 3) }),
      msg(4, { direction: "internal", body: "memo", author_user_id: OUTSIDER }),
      msg(5, { body: "Thanks!", body_translated: "고마워요(옛 칸)", translated_lang: "ko" }),
      msg(6, { body: "Another question" }),
      // 다른 조직 줄은 섞이지 않는다.
      msg(7, { organization_id: OTHER_ORG, body: "other org" }),
    ],
    guest_message_outbox: [
      outbox(2),
      outbox(3, { kind: "auto" }),
      outbox(9, { status: "failed", error_code: "beds24_4xx" }),
      outbox(10, { organization_id: OTHER_ORG, status: "uncertain" }),
    ],
    guest_message_translations: [{ organization_id: ORG, message_id: uuid("d", 6), lang: "ko", body: "다른 질문" }],
    memberships: [{ organization_id: ORG, user_id: STAFF }],
    profiles: [
      { id: STAFF, name: "Kim" },
      { id: OUTSIDER, name: "Leak" },
    ],
    auto_message_runs: [
      {
        id: uuid("f", 1),
        organization_id: ORG,
        provider: "beds24",
        provider_booking_id: "93328947",
        rule_id: uuid("f", 9),
        conversation_id: CONV,
        guest_name: "Guest",
        property_name: "아라키초A",
        room_label: "201",
        check_in_date: "2026-11-20",
        check_out_date: "2026-11-22",
        channel: "direct",
        scheduled_at: "2026-11-19T06:00:00Z",
        status: "queued",
        skip_reason: null,
        missing_variables: [],
        paused_at: null,
        outbox_id: uuid("e", 3),
      },
    ],
    auto_message_rules: [{ id: uuid("f", 9), organization_id: ORG, name: "체크인 안내" }],
    guest_message_links: [
      {
        id: uuid("a", 1),
        organization_id: ORG,
        conversation_id: CONV,
        message_id: uuid("d", 1),
        target_type: "maintenance",
        target_id: uuid("a", 9),
        created_at: "2026-11-18T01:00:00Z",
      },
    ],
    maintenance_reports: [
      { id: uuid("a", 9), organization_id: ORG, status: "closed", completed_at: "2026-11-18T06:00:00Z", issue_title: "Leaky tap" },
    ],
    guest_message_saved_replies: [],
  };
}

/**
 * 가짜 DB 감싸기 — 읽기마다 (표 · 고른 칸 · 줄 수 · 단계 · 상한)를 적는다. 모든 응답을 한 틱 늦추고, 읽기를 시작할 때
 * 「이미 끝난 읽기 중 가장 깊은 단계 + 1」을 그 읽기의 단계로 적는다 — 가장 큰 단계 = 차례로 기다린 횟수.
 * `raw_payload->key` 고르기는 PostgREST 처럼 그 키만 돌려준다(고른 칸이 그대로 결과에 드러나게).
 */
function instrument(
  tables: Record<string, Row[]>,
  options: { failTables?: readonly string[]; throwTables?: readonly string[] } = {},
) {
  const fake = createFakeSupabase(tables);
  const reads: Read[] = [];
  let deepestDone = 0;
  const client = {
    ...fake.client,
    from(table: string) {
      if (options.throwTables?.includes(table)) throw new Error(`${table} down`);
      const builder = fake.client.from(table) as unknown as Record<string, unknown> & {
        select: (columns?: string) => unknown;
        limit: (count: number) => unknown;
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise<unknown>;
      };
      let columns: string | undefined;
      let limit: number | null = null;
      const select = builder.select.bind(builder);
      builder.select = (cols?: string) => {
        columns = cols;
        select(cols);
        return builder;
      };
      const limitFn = builder.limit.bind(builder);
      builder.limit = (count: number) => {
        limit = count;
        limitFn(count);
        return builder;
      };
      const then = builder.then.bind(builder);
      builder.then = (resolve, reject) => {
        const stage = deepestDone + 1;
        return new Promise((r) => setTimeout(r, 2)).then(() =>
          then((result) => {
            deepestDone = Math.max(deepestDone, stage);
            let out = result as { data: unknown; error: unknown };
            if (options.failTables?.includes(table)) out = { data: null, error: { message: `${table} boom`, code: "XX000" } };
            else if (columns?.includes("->")) out = { ...out, data: project(out.data, columns) };
            const data = out.data;
            reads.push({ table, columns, rows: Array.isArray(data) ? data.length : data ? 1 : 0, stage, limit });
            return resolve(out);
          }, reject),
        );
      };
      return builder;
    },
  };
  return { client: client as never, reads };
}

function project(data: unknown, columns: string): unknown {
  const pick = (row: Row) => {
    const out: Row = {};
    for (const part of columns.split(",").map((piece) => piece.trim())) {
      const [alias, path] = part.includes(":") ? part.split(":") : [part, part];
      const arrow = path.indexOf("->");
      if (arrow < 0) out[alias] = row[path];
      else {
        const json = row[path.slice(0, arrow)];
        const value = json && typeof json === "object" && !Array.isArray(json) ? (json as Row)[path.slice(arrow + 2)] : undefined;
        out[alias] = value === undefined ? null : value;
      }
    }
    return out;
  };
  if (Array.isArray(data)) return data.map((row) => pick(row as Row));
  return data ? pick(data as Row) : data;
}

const OPTIONS = {
  now: NOW,
  sendEnabled: true,
  locale: "ko" as const,
  visibility: { canSeeCodes: false, canManageAuto: false },
  viewerUserId: STAFF,
};

describe("대화 열기 — 결과는 바꾸기 전과 같다", () => {
  it("예약 · 메시지 · 자동 안내 · 링크가 다 있는 대화(코드 가림 · 번역 · 작성자 · 해결 초안)", async () => {
    // 건물 정보 읽기가 실패 → 숫자 묶음을 모두 가린다(덜 가리지 않게).
    const db = instrument(fullTables(), { failTables: ["property_operation_infos"] });
    const thread = await loadInboxThread(db.client, ORG, CONV, OPTIONS);
    expect(thread).toMatchSnapshot();
    expect(thread?.messages.find((m) => m.id === uuid("d", 3))?.body).not.toContain("482193");
    expect(thread?.reservation).toMatchObject({ adults: 2, children: 1, totalGuests: 3, channelReference: "HM-123", guestEmail: "guest@example.com" });
    expect(thread?.messages.map((m) => m.authorName)).toEqual([null, "Kim", null, null, null, null]);
  });

  it("예약 없는 대화 · 메시지 0개", async () => {
    const tables = fullTables();
    tables.guest_conversations = [conversation({ reservation_id: null, channel: "airbnb" })];
    tables.guest_messages = [];
    tables.guest_message_outbox = [];
    tables.guest_message_links = [];
    tables.auto_message_runs = [];
    const db = instrument(tables);
    const thread = await loadInboxThread(db.client, ORG, CONV, OPTIONS);
    expect(thread).toMatchSnapshot();
    expect(db.reads.some((read) => read.table === "reservations")).toBe(false);
  });

  it("예약 읽기가 실패해도 대화는 열린다(인원 · 예약 번호 없이)", async () => {
    const db = instrument(fullTables(), { failTables: ["reservations"] });
    const thread = await loadInboxThread(db.client, ORG, CONV, OPTIONS);
    expect(thread).toMatchSnapshot();
    expect(thread?.reservation).toMatchObject({ adults: null, totalGuests: null, channelReference: null, guestEmail: null });
  });

  it("없는 대화면 null, 대화 읽기 실패는 던진다(메시지 읽기 실패보다 먼저)", async () => {
    const missing = instrument({ ...fullTables(), guest_conversations: [] });
    await expect(loadInboxThread(missing.client, ORG, CONV, OPTIONS)).resolves.toBeNull();
    const broken = instrument(fullTables(), { failTables: ["guest_conversations", "guest_messages"] });
    await expect(loadInboxThread(broken.client, ORG, CONV, OPTIONS)).rejects.toThrow(/conversation read failed/);
  });

  it("메시지 · 발송 줄 읽기 실패는 예전처럼 던진다", async () => {
    const messages = instrument(fullTables(), { failTables: ["guest_messages"] });
    await expect(loadInboxThread(messages.client, ORG, CONV, OPTIONS)).rejects.toThrow(/messages read failed/);
    const outboxDb = instrument(fullTables(), { failTables: ["guest_message_outbox"] });
    await expect(loadInboxThread(outboxDb.client, ORG, CONV, OPTIONS)).rejects.toThrow(/outbox read failed/);
  });
});

describe("대화 열기 — 읽기 묶음", () => {
  it("차례로 기다리는 단계는 3번 이하 — 메시지 · 발송 줄 · 링크는 대화 줄과 함께 출발", async () => {
    const db = instrument(fullTables());
    await loadInboxThread(db.client, ORG, CONV, OPTIONS);
    const stageOf = (table: string) => Math.min(...db.reads.filter((read) => read.table === table).map((read) => read.stage));
    expect(Math.max(...db.reads.map((read) => read.stage))).toBeLessThanOrEqual(3);
    expect(stageOf("guest_conversations")).toBe(1);
    expect(stageOf("guest_messages")).toBe(1);
    expect(stageOf("guest_message_links")).toBe(1);
    // 대화 줄이 있어야 아는 것(예약 id · 예약 번호)은 2단계.
    expect(stageOf("reservations")).toBe(2);
    expect(stageOf("auto_message_runs")).toBe(2);
    // 작성자 이름 — 구성원 확인과 이름 읽기를 함께, 번역 · 건물 정보도 같은 단계.
    expect(stageOf("memberships")).toBe(2);
    expect(stageOf("profiles")).toBe(2);
    expect(stageOf("guest_message_translations")).toBe(2);
    expect(stageOf("property_operation_infos")).toBe(2);
  });

  it("예약 원본은 화면이 읽는 키만(JSON 경로) — 통째로 받지 않는다", async () => {
    const db = instrument(fullTables());
    await loadInboxThread(db.client, ORG, CONV, OPTIONS);
    const reservationReads = db.reads.filter((read) => read.table === "reservations");
    expect(reservationReads).toHaveLength(1);
    const columns = reservationReads[0].columns ?? "";
    expect(columns).not.toMatch(/(^|,\s*)raw_payload(\s*,|$)/);
    for (const key of ["numAdult", "numChild", "apiReference", "email", "guestEmail"]) expect(columns).toContain(`raw_payload->${key}`);
    expect(columns).not.toContain("infoItems");
  });

  it("번역 묶음(100개씩)은 동시에", async () => {
    const tables = fullTables();
    tables.guest_messages = Array.from({ length: 250 }, (_, i) => msg(i + 1));
    const db = instrument(tables);
    await loadInboxThread(db.client, ORG, CONV, OPTIONS);
    const translationReads = db.reads.filter((read) => read.table === "guest_message_translations");
    expect(translationReads).toHaveLength(3);
    expect(new Set(translationReads.map((read) => read.stage)).size).toBe(1);
  });

  it("발송 줄은 상한을 두고 읽고, 넘치면 화면이 쓰는 줄(열린 줄 · 보이는 메시지의 줄)만 더 읽는다", async () => {
    const tables = fullTables();
    // 아주 오래된 발송 줄 — 보내지 못함(목록 경고) 하나와 보이는 메시지의 줄 하나, 그 뒤 최근 줄 400개.
    const oldFailed = outbox(0, { status: "failed", error_code: "beds24_4xx", created_at: "2026-01-01T00:00:00Z" });
    const oldSent = outbox(1, { kind: "auto", created_at: "2026-01-01T00:01:00Z" });
    const recent = Array.from({ length: 400 }, (_, i) => outbox(1000 + i, { status: "cancelled" }));
    tables.guest_message_outbox = [oldFailed, oldSent, ...recent];
    tables.guest_messages = [msg(1, { direction: "host", body: "code 482193", outbox_id: oldSent.id })];
    const db = instrument(tables, { failTables: ["property_operation_infos"] });
    const thread = await loadInboxThread(db.client, ORG, CONV, OPTIONS);
    expect(thread).toMatchSnapshot();
    const outboxReads = db.reads.filter((read) => read.table === "guest_message_outbox" && read.columns?.startsWith("id, kind"));
    expect(outboxReads[0].limit).not.toBeNull();
    expect(outboxReads.every((read) => read.rows <= 300)).toBe(true);
    expect(thread?.conversation.outboxAlert).toBe("failed");
    expect(thread?.messages[0].outbox).toMatchObject({ id: oldSent.id, kind: "auto", locked: true });
    expect(thread?.messages[0].body).not.toContain("482193");
  });
});
