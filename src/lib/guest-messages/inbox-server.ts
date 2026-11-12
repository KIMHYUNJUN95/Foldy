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
import { buildingBaseFor, loadBuildingGuestInfo, loadBuildingGuestInfos, type BuildingGuestInfo } from "@/lib/guest-messages/guest-info-server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getReservationGuests } from "@/lib/reservation-guests";
import {
  effectiveRowState,
  isRetryableOutbox,
  nightsBetween,
  normalizeGuestLanguage,
  replyBlockReason,
  sortInboxRows,
  strongestOutboxAlert,
  toChannelKey,
  waitingOf,
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
import {
  readGuestMessageSettings,
  type GuestConversationStatus,
  type GuestMessageDirection,
  type GuestMessageSettings,
} from "@/lib/guest-messages/types";

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

export async function loadGuestMessageSettings(db: Client, organizationId: string): Promise<GuestMessageSettings> {
  const { data } = await db
    .from("guest_message_channel_state")
    .select("settings, night_pause, credit_reserve, stall_hours")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return readGuestMessageSettings(data as Parameters<typeof readGuestMessageSettings>[0]);
}

export function toInboxRow(
  row: ConversationDbRow,
  extras: {
    lastLine: InboxConversationRow["lastLine"];
    outboxStatuses: readonly string[];
  },
  settings: GuestMessageSettings,
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
    waiting: waitingOf(row, settings, now),
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
  return text.replace(/[0-9#*]{3,}/g, "••••");
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

/** 대화마다 마지막 손님 말 · 답장 한 줄(내부 메모 · 시스템 줄은 목록에 안 띄운다). DB 함수가 대화마다 한 줄씩(distinct on) 돌려준다. */
async function loadLastLines(db: Client, organizationId: string, ids: readonly string[]) {
  const out = new Map<string, { direction: GuestMessageDirection; body: string }>();
  for (const part of chunks(ids, IN_CHUNK)) {
    const { data, error } = await db.rpc("guest_conversation_last_lines", {
      p_organization_id: organizationId,
      p_conversation_ids: part,
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
  }
  return out;
}

async function loadOpenOutbox(db: Client, organizationId: string, ids: readonly string[]) {
  const out = new Map<string, string[]>();
  for (const part of chunks(ids, IN_CHUNK)) {
    const { data, error } = await db
      .from("guest_message_outbox")
      .select("conversation_id, status")
      .eq("organization_id", organizationId)
      .in("conversation_id", part)
      .in("status", ["queued", "sending", "failed", "uncertain"]);
    if (error) throw new Error(`outbox read failed: ${error.message}`);
    for (const row of (data ?? []) as Array<{
      conversation_id: string;
      status: string;
    }>) {
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
  const [open, done, settings] = await Promise.all([
    db
      .from("guest_conversations")
      .select(CONVERSATION_COLUMNS)
      .eq("organization_id", organizationId)
      .in("status", ["awaiting", "snoozed"])
      .order("last_guest_at", { ascending: true })
      .limit(OPEN_LIMIT),
    db
      .from("guest_conversations")
      .select(CONVERSATION_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("status", "done")
      .order("last_message_at", { ascending: false })
      .limit(DONE_LIMIT),
    loadGuestMessageSettings(db, organizationId),
  ]);
  if (open.error) throw new Error(`conversation read failed: ${open.error.message}`);
  if (done.error) throw new Error(`conversation read failed: ${done.error.message}`);
  const all = [...((open.data ?? []) as ConversationDbRow[]), ...((done.data ?? []) as ConversationDbRow[])];

  const buildings = [...new Set(all.map((row) => row.property_name).filter((name): name is string => !!name))].sort();
  const states = all.map((row) => ({
    row,
    state: effectiveRowState(row, now),
  }));
  const visible = states
    .filter(
      ({ row, state }) =>
        matchesStatusFilter(state, filter.status) &&
        (!filter.building || row.property_name === filter.building) &&
        matchesChannelFilter(toChannelKey(row.channel), channelFilter),
    )
    .map(({ row }) => row);

  const ids = visible.map((row) => row.id);
  const [lastLines, outbox] = await Promise.all([loadLastLines(db, organizationId, ids), loadOpenOutbox(db, organizationId, ids)]);
  if (!visibility.canSeeCodes) {
    // 목록 한 줄은 자동 안내인지 알 수 없다 — 우리 쪽 말(host)은 모두 그 건물 코드를 가린다.
    let buildings: Map<string, BuildingGuestInfo> | null = null;
    try {
      buildings = new Map((await loadBuildingGuestInfos(db, organizationId)).map((building) => [building.canonicalName, building]));
    } catch {
      buildings = null;
    }
    for (const row of visible) {
      const line = lastLines.get(row.id);
      if (!line || line.direction !== "host") continue;
      const base = buildingBaseFor(row.property_name);
      line.body = buildings
        ? maskEntryCodes(line.body, codesOf(base ? (buildings.get(base.canonicalName) ?? null) : null))
        : maskAllCodeLike(line.body);
    }
  }
  const rows = sortInboxRows(
    visible.map((row) =>
      toInboxRow(
        row,
        {
          lastLine: lastLines.get(row.id) ?? null,
          outboxStatuses: outbox.get(row.id) ?? [],
        },
        settings,
        now,
      ),
    ),
  );

  // 머리 숫자는 상태 필터와 무관(건물 · 채널 필터는 따른다) — 「답장 기다림 N」 · 「목표 넘음 N」.
  let awaitingCount = 0;
  let overdueCount = 0;
  for (const { row, state } of states) {
    if (state !== "awaiting") continue;
    if (filter.building && row.property_name !== filter.building) continue;
    if (!matchesChannelFilter(toChannelKey(row.channel), channelFilter)) continue;
    awaitingCount += 1;
    if (waitingOf(row, settings, now).overdue) overdueCount += 1;
  }
  return { rows, awaitingCount, overdueCount, buildings };
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

  const [messagesRes, outboxRes, settings, reservationRes, autoRuns, links] = await Promise.all([
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
    loadGuestMessageSettings(db, organizationId),
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
  const [authors, translations] = await Promise.all([
    loadMemberNames(db, organizationId, authorIds),
    options.locale ? loadTranslations(db, organizationId, guestIds, options.locale) : Promise.resolve(new Map<string, string>()),
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
      attachmentCount: Array.isArray(row.attachments) ? row.attachments.length : 0,
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
    settings,
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
