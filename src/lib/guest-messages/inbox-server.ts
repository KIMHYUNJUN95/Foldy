/**
 * 손님 메시지함 읽기 — 서버 전용(service_role + **조직 필터를 항상 명시**). docs/product/47-guest-messaging.md §5 · §8
 *
 * 권한 확인은 부르는 쪽(서버 액션 · 페이지)이 먼저 한다(`guest_messages.view`). 여기는 그 조직의 줄만 읽는다.
 * Beds24 를 부르지 않는다(크레딧 0 — 화면은 DB 만 읽는다, §4).
 */

import "server-only";
import { buildResolvedDraft, loadThreadLinks } from "@/lib/guest-messages/task-link-server";
import { pickResolvedLink, type ResolvedDraft, type ThreadLinkView } from "@/lib/guest-messages/task-link-model";

import { loadBookingAutoRuns } from "@/lib/guest-messages/auto-rules-server";
import { maskEntryCodes } from "@/lib/guest-messages/auto-model";
import {
  buildSearchArgs,
  CODE_LIKE_SOURCE,
  pickSearchMatches,
  SEARCH_FETCH_LIMIT,
  SEARCH_RESULT_LIMIT,
  type InboxSearchMatch,
  type SearchRpcRow,
} from "@/lib/guest-messages/inbox-search";
import { dictionaries } from "@/lib/i18n";
import { buildingBaseFor, loadBuildingGuestInfo, loadBuildingGuestInfos, type BuildingGuestInfo } from "@/lib/guest-messages/guest-info-server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getReservationGuests } from "@/lib/reservation-guests";
import { signGuestMessageMedia } from "@/lib/guest-messages/media-copy-server";
import { imageViewsFor, providerAttachmentCount } from "@/lib/guest-messages/message-media";
import {
  effectiveRowState,
  isRetryableOutbox,
  nightsBetween,
  normalizeGuestLanguage,
  replyBlockReason,
  sortInboxRows,
  strongestOutboxAlert,
  toChannelKey,
  type InboxConversationRow,
  type InboxListData,
  type InboxMessage,
  type InboxStatusFilter,
  type InboxThread,
  type OutboxDisplayStatus,
  matchesStatusFilter,
  matchesChannelFilter,
  type InboxChannelFilter,
} from "@/lib/guest-messages/inbox-model";
import type { GuestConversationStatus, GuestMessageDirection } from "@/lib/guest-messages/types";

type Client = SupabaseClient<Database>;

export const CONVERSATION_COLUMNS =
  "id, organization_id, provider, provider_booking_id, reservation_id, property_name, room_label, channel, booking_status, check_in_date, check_out_date, guest_name, guest_language, status, snooze_until, last_guest_at, last_reply_at, last_message_at";

export type ConversationDbRow = {
  id: string;
  organization_id: string;
  provider: string;
  provider_booking_id: string;
  reservation_id: string | null;
  property_name: string | null;
  room_label: string | null;
  channel: string | null;
  booking_status: string | null;
  check_in_date: string | null;
  check_out_date: string | null;
  guest_name: string | null;
  guest_language: string | null;
  status: GuestConversationStatus;
  snooze_until: string | null;
  last_guest_at: string | null;
  last_reply_at: string | null;
  last_message_at: string | null;
};

/** 열린 대화(기다림 · 나중에)는 다 읽고, 처리 끝은 최근 것만. */
const OPEN_LIMIT = 500;
const DONE_LIMIT = 200;
const THREAD_MESSAGE_LIMIT = 300;
const IN_CHUNK = 100;

export function toInboxRow(
  row: ConversationDbRow,
  extras: {
    lastLine: InboxConversationRow["lastLine"];
    outboxStatuses: readonly string[];
  },
  now: Date,
): InboxConversationRow {
  const channel = toChannelKey(row.channel);
  return {
    id: row.id,
    guestName: row.guest_name,
    channel,
    state: effectiveRowState(row, now),
    snoozeUntil: row.snooze_until,
    propertyName: row.property_name,
    roomLabel: row.room_label,
    bookingStatus: row.booking_status,
    checkInDate: row.check_in_date,
    checkOutDate: row.check_out_date,
    guestLanguage: normalizeGuestLanguage(row.guest_language),
    lastMessageAt: row.last_message_at,
    lastGuestAt: row.last_guest_at,
    lastLine: extras.lastLine,
    status: row.status,
    lastReplyAt: row.last_reply_at,
    outboxAlert: strongestOutboxAlert(extras.outboxStatuses),
    replyBlock: replyBlockReason(channel),
  };
}

/** 건물의 출입 코드 값 전부(공용 + 방). */
function codesOf(building: BuildingGuestInfo | null): string[] {
  if (!building) return [];
  return [...building.sharedAccess.map((access) => access.code), ...building.roomAccess.map((room) => room.code)].filter((code) => code.trim());
}

/** 코드 값을 못 읽었을 때 — 세 자리 이상 숫자 · 기호 묶음을 모두 가린다(덜 가리는 것보다 더 가리는 쪽). */
function maskAllCodeLike(text: string): string {
  return text.replace(new RegExp(CODE_LIKE_SOURCE, "g"), "••••");
}

/**
 * 출입 코드 가리기(대화에서 코드를 볼 권한이 없는 사람 — `guest_messages.manage` 또는 `property_info.edit` 가 없으면). 47 §5-6 임시 결정.
 * 손님에게 나간 글은 그대로이고, 화면에 싣는 글만 가린다.
 */
export type CodeVisibility = { canSeeCodes: boolean; canManageAuto: boolean };

function chunks<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/**
 * 대화마다 마지막 손님 말 · 답장 한 줄(내부 메모 · 시스템 줄은 목록에 안 띄운다). DB 함수가 대화마다 한 줄씩 돌려준다.
 * RPC 는 POST 본문이라 URL 길이 걱정이 없다 — 100개씩 나눠 차례로 부르지 않고 **한 번에** 부른다(2026-11-19 성능).
 */
async function loadLastLines(db: Client, organizationId: string, ids: readonly string[]) {
  const out = new Map<string, { direction: GuestMessageDirection; body: string }>();
  if (ids.length === 0) return out;
  const { data, error } = await db.rpc("guest_conversation_last_lines", {
    p_organization_id: organizationId,
    p_conversation_ids: [...ids],
  });
  if (error) throw new Error(`last lines read failed: ${error.message}`);
  for (const row of (data ?? []) as Array<{
    conversation_id: string;
    direction: GuestMessageDirection;
    body: string;
  }>) {
    if (!out.has(row.conversation_id))
      out.set(row.conversation_id, {
        direction: row.direction,
        body: row.body,
      });
  }
  return out;
}

/** 열린 발송 줄 — `.in()` 은 GET 주소에 실리니 100개씩 나누되, 묶음은 **동시에** 읽는다(차례로 기다리지 않는다). */
async function loadOpenOutbox(db: Client, organizationId: string, ids: readonly string[]) {
  const out = new Map<string, string[]>();
  const parts = await Promise.all(
    chunks(ids, IN_CHUNK).map(async (part) => {
      const { data, error } = await db
        .from("guest_message_outbox")
        .select("conversation_id, status")
        .eq("organization_id", organizationId)
        .in("conversation_id", part)
        .in("status", ["queued", "sending", "failed", "uncertain"]);
      if (error) throw new Error(`outbox read failed: ${error.message}`);
      return (data ?? []) as Array<{ conversation_id: string; status: string }>;
    }),
  );
  for (const rows of parts) {
    for (const row of rows) {
      const list = out.get(row.conversation_id) ?? [];
      list.push(row.status);
      out.set(row.conversation_id, list);
    }
  }
  return out;
}

export async function loadInboxList(
  db: Client,
  organizationId: string,
  filter: {
    status: InboxStatusFilter;
    building: string | null;
    channel?: InboxChannelFilter;
  },
  now: Date = new Date(),
  visibility: CodeVisibility = { canSeeCodes: true, canManageAuto: true },
): Promise<InboxListData> {
  const channelFilter = filter.channel ?? "all";
  const [open, done] = await Promise.all([
    db
      .from("guest_conversations")
      .select(CONVERSATION_COLUMNS)
      .eq("organization_id", organizationId)
      .in("status", ["awaiting", "snoozed"])
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .limit(OPEN_LIMIT),
    db
      .from("guest_conversations")
      .select(CONVERSATION_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("status", "done")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .limit(DONE_LIMIT),
  ]);
  if (open.error) throw new Error(`conversation read failed: ${open.error.message}`);
  if (done.error) throw new Error(`conversation read failed: ${done.error.message}`);
  const all = [...((open.data ?? []) as ConversationDbRow[]), ...((done.data ?? []) as ConversationDbRow[])];

  const buildings = [...new Set(all.map((row) => row.property_name).filter((name): name is string => !!name))].sort();
  const visible = all.filter((row) => matchesInboxFilter(row, { ...filter, channel: channelFilter }, now));

  const ids = visible.map((row) => row.id);
  const [lastLines, outbox] = await Promise.all([loadLastLines(db, organizationId, ids), loadOpenOutbox(db, organizationId, ids)]);
  if (!visibility.canSeeCodes) await maskHostLines(db, organizationId, visible, lastLines);
  const rows = sortInboxRows(
    visible.map((row) =>
      toInboxRow(
        row,
        {
          lastLine: lastLines.get(row.id) ?? null,
          outboxStatuses: outbox.get(row.id) ?? [],
        },
        now,
      ),
    ),
  );

  return { rows, ...headerCounts(all, filter, now), buildings };
}

type InboxFilter = { status: InboxStatusFilter; building: string | null; channel?: InboxChannelFilter };

/** 지금 보는 필터(상태 · 건물 · 채널)에 드는 줄인가 — 목록 · 실시간 줄 다시 읽기가 같은 판정을 쓴다. */
function matchesInboxFilter(row: ConversationDbRow, filter: InboxFilter, now: Date): boolean {
  return (
    matchesStatusFilter(effectiveRowState(row, now), filter.status) &&
    (!filter.building || row.property_name === filter.building) &&
    matchesChannelFilter(toChannelKey(row.channel), filter.channel ?? "all")
  );
}

/** 실시간 줄 다시 읽기가 열린 대화에서 읽는 칸 — 창 판정(id) · 머리 숫자(`headerCounts`)에 쓰는 것만. */
const OPEN_WINDOW_COLUMNS = "id, status, snooze_until, property_name, channel, last_message_at";
type OpenWindowColumn = "id" | "status" | "snooze_until" | "property_name" | "channel" | "last_message_at";

type WindowKey = { id: string; last_message_at: string | null };

/** 시각을 마이크로초까지(Postgres timestamptz 정밀도) — `Date.parse` 는 밀리초에서 자른다. */
function microsOf(value: string): bigint | null {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  const fraction = /\.(\d+)/.exec(value)?.[1] ?? "";
  return BigInt(ms) * BigInt(1000) + BigInt(Number((fraction + "000000").slice(3, 6)));
}

/**
 * 목록 창 순서(`last_message_at desc nulls last, id asc`)에서 a 가 b 보다 앞이면 음수. `loadInboxList` 의 order 와 같아야 한다.
 * id 는 소문자 uuid 라 글자 순 = Postgres uuid 순.
 */
function compareWindowKey(a: WindowKey, b: WindowKey): number {
  const left = a.last_message_at ? microsOf(a.last_message_at) : null;
  const right = b.last_message_at ? microsOf(b.last_message_at) : null;
  if ((left === null) !== (right === null)) return left === null ? 1 : -1;
  if (left !== null && right !== null && left !== right) return left > right ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 머리 숫자는 상태 필터와 무관(건물 · 채널 필터는 따른다) — 「답장 기다림 N」 · 「목표 넘음 N」. */
function headerCounts(
  rows: ReadonlyArray<Pick<ConversationDbRow, "status" | "snooze_until" | "property_name" | "channel">>,
  filter: InboxFilter,
  now: Date,
) {
  let awaitingCount = 0;
  for (const row of rows) {
    if (effectiveRowState(row, now) !== "awaiting") continue;
    if (filter.building && row.property_name !== filter.building) continue;
    if (!matchesChannelFilter(toChannelKey(row.channel), filter.channel ?? "all")) continue;
    awaitingCount += 1;
  }
  return { awaitingCount };
}

/** 목록 한 줄은 자동 안내인지 알 수 없다 — 우리 쪽 말(host)은 모두 그 건물 코드를 가린다. */
async function maskHostLines(
  db: Client,
  organizationId: string,
  rows: readonly ConversationDbRow[],
  lastLines: Map<string, { direction: GuestMessageDirection; body: string }>,
) {
  let buildings: Map<string, BuildingGuestInfo> | null = null;
  try {
    buildings = new Map((await loadBuildingGuestInfos(db, organizationId)).map((building) => [building.canonicalName, building]));
  } catch {
    buildings = null;
  }
  for (const row of rows) {
    const line = lastLines.get(row.id);
    if (!line || line.direction !== "host") continue;
    const base = buildingBaseFor(row.property_name);
    line.body = buildings
      ? maskEntryCodes(line.body, codesOf(base ? (buildings.get(base.canonicalName) ?? null) : null))
      : maskAllCodeLike(line.body);
  }
}

export type InboxRowsResult = {
  /** 이 조직에 있는 줄 — `matches` 는 지금 필터에 드는지. */
  updates: Array<{ row: InboxConversationRow; matches: boolean }>;
  /** 이 조직에 없는 id(지워짐 · 다른 조직 — 어느 쪽인지 알리지 않는다). */
  missing: string[];
  awaitingCount: number;
};

/**
 * 실시간 — 신호가 온 대화 몇 개만 목록 줄 모양으로 다시 읽는다(47 §5-9). 목록 전체를 다시 읽지 않고, 머리 숫자는 열린 대화만 세어 고친다.
 * 조직 필터는 언제나 여기서(신호의 id 는 힌트일 뿐 — 다른 조직 id 가 와도 `missing`).
 */
export async function loadInboxRowsByIds(
  db: Client,
  organizationId: string,
  ids: readonly string[],
  filter: InboxFilter,
  now: Date = new Date(),
  visibility: CodeVisibility = { canSeeCodes: true, canManageAuto: true },
): Promise<InboxRowsResult> {
  // 목록과 같은 창 — 열린 대화는 최근 메시지 500개, 처리 끝은 최근 200개. 그 밖의 줄은 목록에도 없으니 `matches` 도 아니다.
  // 2026-11-19 성능: 창 전체(전체 칸 500줄 + id 200줄)를 다시 읽지 않는다.
  //  - 열린 대화: 머리 숫자(끝난 · 시각 없는 「나중에」 = 기다림, 건물 · 채널 필터)와 창 판정에 필요한 **좁은 칸**만 — 열린 대화는 작은 집합.
  //  - 처리 끝: 200번째 줄(경계) **한 줄**만 읽고, 신호 온 줄이 그 앞이면 창 안(목록과 같은 순서 · 같은 동점 규칙).
  const [found, open, doneEdge] = await Promise.all([
    db.from("guest_conversations").select(CONVERSATION_COLUMNS).eq("organization_id", organizationId).in("id", [...ids]),
    db
      .from("guest_conversations")
      .select(OPEN_WINDOW_COLUMNS)
      .eq("organization_id", organizationId)
      .in("status", ["awaiting", "snoozed"])
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .limit(OPEN_LIMIT),
    db
      .from("guest_conversations")
      .select("id, last_message_at")
      .eq("organization_id", organizationId)
      .eq("status", "done")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .range(DONE_LIMIT - 1, DONE_LIMIT - 1)
      .maybeSingle(),
  ]);
  if (found.error) throw new Error(`conversation read failed: ${found.error.message}`);
  if (open.error) throw new Error(`conversation read failed: ${open.error.message}`);
  if (doneEdge.error) throw new Error(`conversation read failed: ${doneEdge.error.message}`);
  const openRows = (open.data ?? []) as Array<Pick<ConversationDbRow, OpenWindowColumn>>;
  const openIds = new Set(openRows.map((row) => row.id));
  const edge = (doneEdge.data ?? null) as WindowKey | null;
  const inWindow = (row: ConversationDbRow) =>
    row.status === "done" ? !edge || compareWindowKey(row, edge) <= 0 : openIds.has(row.id);
  const rows = (found.data ?? []) as ConversationDbRow[];
  const foundIds = rows.map((row) => row.id);
  const [lastLines, outbox] = await Promise.all([
    loadLastLines(db, organizationId, foundIds),
    loadOpenOutbox(db, organizationId, foundIds),
  ]);
  if (!visibility.canSeeCodes) await maskHostLines(db, organizationId, rows, lastLines);
  const seen = new Set(foundIds);
  return {
    updates: rows.map((row) => ({
      row: toInboxRow(row, { lastLine: lastLines.get(row.id) ?? null, outboxStatuses: outbox.get(row.id) ?? [] }, now),
      matches: inWindow(row) && matchesInboxFilter(row, filter, now),
    })),
    missing: ids.filter((id) => !seen.has(id)),
    ...headerCounts(openRows, filter, now),
  };
}

export type InboxSearchResult = {
  results: Array<{ row: InboxConversationRow; match: InboxSearchMatch }>;
  /** DB 후보가 받은 만큼 꽉 찼다 — 더 있을 수 있다(말을 더 넣어 좁히기). */
  truncated: boolean;
  /** 2글자 검색어라 메시지 내용은 최근 90일만 봤다(`bodySinceFor`). */
  bodyRecentOnly: boolean;
};

const BUILDING_LABEL_SETS = Object.values(dictionaries).map((dictionary) => dictionary.cleaning.buildingLabels as Record<string, string>);

/**
 * 검색 — 그 조직의 대화 전체에서(목록 창 500 · 200 과 무관) 이름 · 예약번호 · 건물 · 방 · 전화 · 이메일 · 메시지 내용. 47 §5-10.
 * `query` 는 `normalizeSearchQuery` 를 거친 값. 결과는 마지막 메시지 최신순 50개, 줄 모양은 목록과 같다(코드 가리기 포함).
 */
export async function searchInbox(
  db: Client,
  organizationId: string,
  query: string,
  filter: InboxFilter,
  now: Date = new Date(),
  visibility: CodeVisibility = { canSeeCodes: true, canManageAuto: true },
): Promise<InboxSearchResult> {
  // 코드를 못 보는 사람 — 조직의 모든 건물 코드를 모아 우리 쪽 말에서 가린 뒤에 맞춘다(코드 숫자로 찾아 코드를 알아내지 못하게).
  let codes: string[] | null = [];
  if (!visibility.canSeeCodes) {
    try {
      codes = (await loadBuildingGuestInfos(db, organizationId)).flatMap((building) => codesOf(building));
    } catch {
      codes = null;
    }
  }
  const args = buildSearchArgs(query, { labelSets: BUILDING_LABEL_SETS, canSeeCodes: visibility.canSeeCodes, codes, now });
  const bodyRecentOnly = args.p_body_since !== null;
  const { data, error } = await db.rpc("guest_conversation_search", {
    p_organization_id: organizationId,
    ...args,
    p_reference: args.p_reference ?? undefined,
    p_phone_pattern: args.p_phone_pattern ?? undefined,
    p_email: args.p_email ?? undefined,
    p_body_since: args.p_body_since ?? undefined,
    p_code_mask: args.p_code_mask ?? undefined,
    p_status: filter.status,
    p_building: filter.building ?? undefined,
    p_channel: filter.channel ?? "all",
    p_now: now.toISOString(),
    p_limit: SEARCH_FETCH_LIMIT,
  });
  if (error) throw new Error(`conversation search failed: ${error.code ?? "unknown"}`);
  const candidates = (data ?? []) as SearchRpcRow[];
  const picked = pickSearchMatches(candidates, query, { canSeeCodes: visibility.canSeeCodes, codes });
  const truncated = candidates.length >= SEARCH_FETCH_LIMIT || picked.length >= SEARCH_RESULT_LIMIT;
  if (picked.length === 0) return { results: [], truncated, bodyRecentOnly };

  const ids = picked.map((item) => item.id);
  const found = await db.from("guest_conversations").select(CONVERSATION_COLUMNS).eq("organization_id", organizationId).in("id", ids);
  if (found.error) throw new Error(`conversation read failed: ${found.error.message}`);
  const rows = (found.data ?? []) as ConversationDbRow[];
  const [lastLines, outbox] = await Promise.all([loadLastLines(db, organizationId, ids), loadOpenOutbox(db, organizationId, ids)]);
  if (!visibility.canSeeCodes) await maskHostLines(db, organizationId, rows, lastLines);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const results: InboxSearchResult["results"] = [];
  for (const item of picked) {
    const row = byId.get(item.id);
    if (!row) continue;
    results.push({
      row: toInboxRow(row, { lastLine: lastLines.get(row.id) ?? null, outboxStatuses: outbox.get(row.id) ?? [] }, now),
      match: item.match,
    });
  }
  return { results, truncated, bodyRecentOnly };
}

/** 메뉴 · 탭 숫자 — 답장 기다림(끝난 「나중에」 포함). 실패하면 0. */
export async function countAwaitingConversations(db: Client, organizationId: string, now: Date = new Date()): Promise<number> {
  try {
    const { count, error } = await db
      .from("guest_conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .or(`status.eq.awaiting,and(status.eq.snoozed,snooze_until.lte.${now.toISOString()})`);
    return error ? 0 : (count ?? 0);
  } catch {
    return 0;
  }
}

export async function loadConversationRow(db: Client, organizationId: string, conversationId: string): Promise<ConversationDbRow | null> {
  const { data, error } = await db
    .from("guest_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new Error(`conversation read failed: ${error.message}`);
  return (data as ConversationDbRow | null) ?? null;
}

type MessageDbRow = {
  id: string;
  direction: GuestMessageDirection;
  body: string;
  body_translated: string | null;
  translated_lang: string | null;
  body_lang: string | null;
  sent_at: string;
  author_user_id: string | null;
  attachments: unknown;
  outbox_id: string | null;
};

function readString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

/** 작성자 이름 — **이 조직 구성원만**(다른 조직 사람 이름이 새지 않게). 탈퇴한 사람은 이름 없이. */
async function loadMemberNames(db: Client, organizationId: string, userIds: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (userIds.length === 0) return names;
  const members = await db
    .from("memberships")
    .select("user_id")
    .eq("organization_id", organizationId)
    .in("user_id", [...userIds]);
  if (members.error) return names;
  const memberIds = [...new Set(((members.data ?? []) as Array<{ user_id: string }>).map((row) => row.user_id))];
  if (memberIds.length === 0) return names;
  const { data } = await db.from("profiles").select("id, name").in("id", memberIds);
  for (const row of (data ?? []) as Array<{ id: string; name: string }>) names.set(row.id, row.name);
  return names;
}

/** 손님 말 번역(보는 사람 언어) — 표가 아직 없으면(202611130001 전) 빈 맵. */
async function loadTranslations(
  db: Client,
  organizationId: string,
  messageIds: readonly string[],
  lang: "ko" | "ja" | "en",
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const part of chunks(messageIds, IN_CHUNK)) {
    const { data, error } = await db
      .from("guest_message_translations")
      .select("message_id, body")
      .eq("organization_id", organizationId)
      .eq("lang", lang)
      .in("message_id", part);
    if (error) return out;
    for (const row of (data ?? []) as Array<{
      message_id: string;
      body: string;
    }>)
      out.set(row.message_id, row.body);
  }
  return out;
}

export async function loadInboxThread(
  db: Client,
  organizationId: string,
  conversationId: string,
  options: {
    now?: Date;
    sendEnabled: boolean;
    locale?: "ko" | "ja" | "en";
    visibility?: CodeVisibility;
    /** 할 일 제목을 보일지(참여자만) 가리는 데 쓴다. */
    viewerUserId?: string | null;
  },
): Promise<InboxThread | null> {
  const visibility = options.visibility ?? { canSeeCodes: true, canManageAuto: true };
  const now = options.now ?? new Date();
  const conversation = await loadConversationRow(db, organizationId, conversationId);
  if (!conversation) return null;

  const [messagesRes, outboxRes, reservationRes, autoRuns, links] = await Promise.all([
    db
      .from("guest_messages")
      .select("id, direction, body, body_translated, translated_lang, body_lang, sent_at, author_user_id, attachments, outbox_id")
      .eq("organization_id", organizationId)
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: false })
      .limit(THREAD_MESSAGE_LIMIT),
    db
      .from("guest_message_outbox")
      .select("id, kind, status, error_code, next_try_at")
      .eq("organization_id", organizationId)
      .eq("conversation_id", conversationId),
    conversation.reservation_id
      ? db
          .from("reservations")
          .select("id, raw_payload, source")
          .eq("organization_id", organizationId)
          .eq("id", conversation.reservation_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    loadBookingAutoRuns(db, organizationId, conversation.provider_booking_id),
    loadThreadLinks(db, organizationId, conversationId, options.viewerUserId ?? null).catch(() => []),
  ]);
  if (messagesRes.error) throw new Error(`messages read failed: ${messagesRes.error.message}`);
  if (outboxRes.error) throw new Error(`outbox read failed: ${outboxRes.error.message}`);

  const messageRows = ((messagesRes.data ?? []) as MessageDbRow[]).reverse();
  const outboxById = new Map(
    (
      (outboxRes.data ?? []) as Array<{
        id: string;
        kind: "reply" | "auto";
        status: OutboxDisplayStatus;
        error_code: string | null;
        next_try_at: string | null;
      }>
    ).map((row) => [row.id, row]),
  );

  const authorIds = [...new Set(messageRows.map((row) => row.author_user_id).filter((id): id is string => !!id))];
  const guestIds = messageRows.filter((row) => row.direction === "guest").map((row) => row.id);
  // 사진 사본(47 §5-8) — 대화 하나 = 서명 한 번(service_role 저장소). 실패 · 사본 없음이면 Airbnb `?im_w=` 주소로 보인다.
  const [authors, translations, signedMedia] = await Promise.all([
    loadMemberNames(db, organizationId, authorIds),
    options.locale ? loadTranslations(db, organizationId, guestIds, options.locale) : Promise.resolve(new Map<string, string>()),
    signGuestMessageMedia(db, organizationId, messageRows),
  ]);

  // 자동 안내 글의 출입 코드 — 볼 권한이 없으면 가린다(코드를 못 읽으면 숫자 묶음을 모두 가린다).
  const hasAuto = messageRows.some((row) => row.outbox_id && outboxById.get(row.outbox_id)?.kind === "auto");
  let mask: ((text: string) => string) | null = null;
  if (!visibility.canSeeCodes && hasAuto) {
    try {
      const codes = codesOf(await loadBuildingGuestInfo(db, organizationId, conversation.property_name));
      mask = (text) => maskEntryCodes(text, codes);
    } catch {
      mask = maskAllCodeLike;
    }
  }

  const messages: InboxMessage[] = messageRows.map((row) => {
    const outbox = row.outbox_id ? outboxById.get(row.outbox_id) : undefined;
    const isAuto = outbox?.kind === "auto";
    const hide = (text: string | null) => (text && isAuto && mask ? mask(text) : text);
    return {
      id: row.id,
      direction: row.direction,
      body: hide(row.body) as string,
      // 손님 말은 보는 사람 언어의 번역(언어별 캐시)을 먼저 — 없으면 옛 칸. 답장은 직원이 쓴 원문(옛 칸 그대로).
      bodyTranslated: hide((row.direction === "guest" ? translations.get(row.id) : undefined) ?? row.body_translated),
      translatedLang: row.direction === "guest" && translations.has(row.id) ? (options.locale ?? null) : row.translated_lang,
      bodyLang: row.direction === "host" ? (row.body_lang ?? null) : null,
      sentAt: row.sent_at,
      authorName: row.author_user_id ? (authors.get(row.author_user_id) ?? null) : null,
      attachmentCount: providerAttachmentCount(row.attachments),
      images: imageViewsFor(row.body, signedMedia.get(row.id) ?? null),
      outbox: outbox
        ? {
            id: outbox.id,
            kind: outbox.kind === "auto" ? "auto" : "reply",
            status: outbox.status,
            errorCode: outbox.error_code,
            nextTryAt: outbox.next_try_at,
            retryable: isRetryableOutbox(outbox.status, outbox.error_code),
            locked: isAuto && !visibility.canManageAuto,
          }
        : null,
    };
  });

  const lastLine = [...messages].reverse().find((m) => m.direction === "guest" || m.direction === "host");
  const row = toInboxRow(
    conversation,
    {
      lastLine: lastLine ? { direction: lastLine.direction, body: lastLine.body } : null,
      outboxStatuses: [...outboxById.values()].map((o) => o.status),
    },
    now,
  );

  const reservation = (reservationRes.data ?? null) as {
    id: string;
    raw_payload: unknown;
    source: string;
  } | null;
  const payload =
    reservation?.raw_payload && typeof reservation.raw_payload === "object" && !Array.isArray(reservation.raw_payload)
      ? (reservation.raw_payload as Record<string, unknown>)
      : {};
  const guests = getReservationGuests(payload);

  return {
    conversation: row,
    messages,
    reservation: {
      reservationId: conversation.reservation_id,
      propertyName: conversation.property_name,
      roomLabel: conversation.room_label,
      checkInDate: conversation.check_in_date,
      checkOutDate: conversation.check_out_date,
      nights: nightsBetween(conversation.check_in_date, conversation.check_out_date),
      adults: guests.adults,
      children: guests.children,
      totalGuests: guests.total,
      bookingStatus: conversation.booking_status,
      channel: row.channel,
      guestLanguage: row.guestLanguage,
      bookingNumber: conversation.provider_booking_id,
      channelReference: readString(payload, ["apiReference", "api_reference"]),
      // 손님 이메일은 답장할 길이 없을 때(직접 예약)만 보인다 — 개인정보를 필요한 자리에만.
      guestEmail: row.replyBlock === "direct_booking" ? readString(payload, ["email", "guestEmail"]) : null,
    },
    sendEnabled: options.sendEnabled,
    autoRuns,
    links,
    resolvedDraft: await resolvedDraftFor(db, organizationId, conversation, links, messages),
  };
}

/** 끝난 업무가 있고 그 뒤 답장이 없을 때만 초안을 만든다(실패하면 초안 없이 — 대화는 그대로 열린다). */
async function resolvedDraftFor(
  db: Client,
  organizationId: string,
  conversation: ConversationDbRow,
  links: ThreadLinkView[],
  messages: InboxMessage[],
): Promise<ResolvedDraft | null> {
  const link = pickResolvedLink(links, messages);
  if (!link) return null;
  try {
    return await buildResolvedDraft(db, organizationId, conversation, link);
  } catch {
    return null;
  }
}
