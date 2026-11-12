/**
 * 자동 안내 계획 · 큐 넣기 — 서버 전용(service_role). docs/product/47-guest-messaging.md §5-6
 *
 * 한 번 돌면:
 * 1. 규칙 · 예약(도쿄 오늘 기준 앞뒤 32일) · 건물 정보 · 기존 실행 줄을 읽는다(Beds24 호출 없음 — 우리 예약 캐시만).
 * 2. 규칙 × 예약마다 `planAutoRun`(순수)으로 바라는 상태를 계산해 실행 줄을 만들거나 고친다 — 날짜가 바뀌면 시각이 따라가고,
 *    취소 · 규칙 꺼짐 · 대상 아님은 cancelled, 직접 예약 · 채널 모름 · 빈 변수 · 본문 없음은 skipped(이유 보임), 직원이 멈춘 것은 paused.
 *    이미 큐에 넣은 줄(queued · sent · failed)은 건드리지 않는다. 고칠 때도 `status in (계획 상태)` 조건 — 그 사이 큐에 들어간 줄을 되돌리지 않게.
 * 3. `enqueue` 일 때만(= 발송 플래그가 켜져 있을 때) 보낼 시각이 된 줄을 큐에 넣는다 — 글을 **그 순간 데이터로 다시** 만들고(빈 변수면 skipped),
 *    대화가 없으면 만들고, DB 함수 `guest_message_enqueue_auto` 가 실행 줄 잠금 + 큐 줄 + 대기 메시지 줄 + queued 를 한 번에.
 *    멱등 키 'auto:' || 실행 번호 — 같은 실행이 두 번 큐에 들어가지 않는다. 보내기는 기존 발송 작업(직원 답장 다음 순위 · 크레딧 선)이 한다.
 *
 * 1,000줄 상한: 범위 예약 · 기존 실행 줄은 끝까지 `.range()` 로 넘긴다(실행 줄은 예약 묶음을 규칙 수로 나눠서). 묶음 예약(`masterId`)은
 * 대표 예약 한 번(방 변수 = 묶음의 방 전부). 범위 밖 예약의 보낼 차례 줄은 큐 넣기 때 따로 읽는다. 47 §5-6 「독립 리뷰 반영」.
 *
 * 발송 플래그가 꺼져 있으면 큐에 넣지 않는다 — 꺼진 동안 쌓인 「내일 체크인 안내」가 나중에 한꺼번에 나가지 않게. 보낼 시각에서 6시간이
 * 지나면 past_due 로 건너뛴다(`AUTO_LATE_GRACE_MS`).
 *
 * 본문 · 손님 이름 · 출입 코드는 로그에 남기지 않는다.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  AUTO_LATE_GRACE_MS,
  AUTO_PLAN_AHEAD_DAYS,
  AUTO_PLAN_BEHIND_DAYS,
  autoBookingStatus,
  autoRunPatch,
  buildAutoMessage,
  isAutoRunDue,
  isAutoTrigger,
  planAutoRun,
  toAutoRule,
  type AutoBooking,
  type AutoFillContext,
  type AutoRule,
  type AutoRunStatus,
  type AutoSkipReason,
  type DesiredAutoRun,
  type ExistingAutoRun,
} from "@/lib/guest-messages/auto-model";
import { classifyGuestChannel, resolveOutboundChannel } from "@/lib/guest-messages/beds24-normalize";
import { GUEST_LANGS, type GuestLang, type Localized } from "@/lib/guest-messages/guest-info-model";
import { loadBuildingGuestInfos, type BuildingGuestInfo } from "@/lib/guest-messages/guest-info-server";
import { nightsBetween, normalizeGuestLanguage, toChannelKey } from "@/lib/guest-messages/inbox-model";
import { ensureConversationForBooking, resolveConversationSeed } from "@/lib/guest-messages/store";
import { getDictionary } from "@/lib/i18n";
import type { PropertyAccessInfo } from "@/lib/property-map-links";
import { getReservationGuests } from "@/lib/reservation-guests";
import {
  CANONICAL_TO_BUILDING_KEY,
  getCanonicalPropertyName,
  localizeBuildingName,
  localizeRoomPlaceLabel,
} from "@/lib/room-label-normalization";
import { tokyoDateOf, ymdShift } from "@/lib/tokyo-date";

type Client = SupabaseClient<Database>;

export const RULE_COLUMNS =
  "id, name, trigger, offset_days, send_time, target_buildings, target_channels, target_statuses, body_ko, body_ja, body_en, enabled, enabled_at, sort_order, updated_at, created_at";

const RUN_COLUMNS =
  "id, rule_id, provider_booking_id, status, scheduled_at, skip_reason, missing_variables, paused_at, rule_trigger, reservation_id, " +
  "property_name, room_label, guest_name, check_in_date, check_out_date, channel";

const RESERVATION_COLUMNS =
  "id, status, source, source_reservation_id, property_name, room_label, guest_name, check_in_date, check_out_date, created_at, " +
  "bid:raw_payload->>id, book_id:raw_payload->>bookId, raw_status:raw_payload->>status, raw_channel:raw_payload->>channel, " +
  "raw_referer:raw_payload->>referer, raw_api_source:raw_payload->>apiSource, raw_lang:raw_payload->>lang, " +
  "num_adult:raw_payload->>numAdult, num_child:raw_payload->>numChild, master_id:raw_payload->>masterId, booking_time:raw_payload->>bookingTime";

const PAGE = 1000;
const MAX_RESERVATIONS = 6000;
const IN_CHUNK = 150;
const ENQUEUE_LIMIT = 100;
/** 계획이 고치는 상태(큐에 넣은 뒤는 아님). */
const PLAN_STATUSES: readonly AutoRunStatus[] = ["scheduled", "skipped", "paused", "cancelled"];

export type ReservationRowForAuto = {
  id: string;
  status: string;
  source: string | null;
  source_reservation_id: string;
  property_name: string | null;
  room_label: string | null;
  guest_name: string | null;
  check_in_date: string | null;
  check_out_date: string | null;
  created_at: string | null;
  bid: string | null;
  book_id: string | null;
  raw_status: string | null;
  raw_channel: string | null;
  raw_referer: string | null;
  raw_api_source: string | null;
  raw_lang: string | null;
  num_adult: string | null;
  num_child: string | null;
  /** Beds24 묶음 예약 대표 번호(없거나 「0」이면 묶음 아님). */
  master_id?: string | null;
  /** Beds24 `bookingTime`(UTC). */
  booking_time?: string | null;
};

function untyped(client: Client): SupabaseClient {
  return client as unknown as SupabaseClient;
}

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < list.length; index += size) out.push(list.slice(index, index + size));
  return out;
}

/** 우리 예약 행 → Beds24 자기 예약 번호(v2 `id` · v1 `bookId` · 없으면 `source_reservation_id` 앞부분). */
export function providerBookingIdOf(row: Pick<ReservationRowForAuto, "bid" | "book_id" | "source_reservation_id">): string | null {
  const direct = row.bid?.trim() || row.book_id?.trim();
  if (direct) return direct;
  const head = row.source_reservation_id?.split("::")[0]?.trim();
  return head && /^\d{1,15}$/.test(head) ? head : null;
}

/** 예약 행(+ 그 예약의 대화 언어 · 채널) → 계획용 예약. 순수(시험용으로 내보냄). */
export function toAutoBooking(
  row: ReservationRowForAuto,
  conversation: { guest_language: string | null; channel: string | null } | null,
): AutoBooking | null {
  const providerBookingId = providerBookingIdOf(row);
  if (!providerBookingId) return null;
  const canonical = row.property_name?.trim() ? getCanonicalPropertyName(row.property_name) : null;
  const classified = classifyGuestChannel({
    channel: row.raw_channel ?? undefined,
    referer: row.raw_referer ?? undefined,
    apiSource: row.raw_api_source ?? undefined,
  } as Record<string, unknown>);
  let channel = resolveOutboundChannel(classified, row.source);
  if (!channel || channel === "other") {
    const fromConversation = toChannelKey(conversation?.channel ?? null);
    if (fromConversation && fromConversation !== "other") channel = fromConversation;
  }
  const guests = getReservationGuests({ numAdult: row.num_adult, numChild: row.num_child });
  return {
    provider: "beds24",
    providerBookingId,
    reservationId: row.id,
    propertyName: canonical,
    buildingKey: canonical ? (CANONICAL_TO_BUILDING_KEY[canonical] ?? null) : null,
    roomLabel: row.room_label?.trim() || null,
    guestName: row.guest_name?.trim() || null,
    guestLanguage: normalizeGuestLanguage(conversation?.guest_language ?? row.raw_lang),
    checkInDate: row.check_in_date,
    checkOutDate: row.check_out_date,
    status: autoBookingStatus(row.status, row.raw_status),
    channel,
    guests: guests.total,
    createdAt: row.created_at,
    bookedAt: row.booking_time?.trim() || null,
  };
}

/** 묶음 키 — Beds24 `masterId`(있고 「0」이 아니면), 아니면 자기 번호. */
export function groupKeyOf(row: Pick<ReservationRowForAuto, "master_id" | "bid" | "book_id" | "source_reservation_id">): string | null {
  const master = row.master_id?.trim();
  if (master && master !== "0" && /^\d{1,15}$/.test(master)) return master;
  return providerBookingIdOf(row);
}

/** 대화의 방 라벨(「201」 또는 「아라키초A 201」) ↔ 출입 코드 방 라벨(답장 칸과 같은 규칙). */
function sameRoom(roomLabel: string | null, codeRoom: string): boolean {
  if (!roomLabel) return false;
  const room = roomLabel.trim();
  const tail = room.includes(" ") ? room.slice(room.lastIndexOf(" ") + 1) : room;
  return room === codeRoom || tail === codeRoom;
}

type Dict = ReturnType<typeof getDictionary>;

function accessLabel(access: PropertyAccessInfo, t: Dict["mobile"]): string {
  const labels: Record<PropertyAccessInfo["labelKey"], string> = {
    doorPassword: t.calendarMapAccessKindDoorPassword,
    keyBox: t.calendarMapAccessKindKeyBox,
    keyBoxPassword: t.calendarMapAccessKindKeyBoxPassword,
    linenStorageEntrancePassword: t.calendarMapAccessKindLinenStorageEntrancePassword,
    roomPassword: t.calendarMapAccessKindRoomPassword,
    storage: t.calendarMapAccessKindStorage,
    storagePassword: t.calendarMapAccessKindStoragePassword,
  };
  const prefix = access.prefixKey === "floor1" ? t.calendarMapAccessFloor1 : null;
  return prefix ? `${prefix} · ${labels[access.labelKey]}` : labels[access.labelKey];
}

let dictionaryCache: Record<GuestLang, Dict> | null = null;
function guestDictionaries(): Record<GuestLang, Dict> {
  if (!dictionaryCache) {
    dictionaryCache = Object.fromEntries(GUEST_LANGS.map((lang) => [lang, getDictionary(lang)])) as Record<GuestLang, Dict>;
  }
  return dictionaryCache;
}

function perLang(make: (lang: GuestLang, dict: Dict) => string): Localized {
  const dicts = guestDictionaries();
  return Object.fromEntries(GUEST_LANGS.map((lang) => [lang, make(lang, dicts[lang])])) as Localized;
}

/**
 * 예약 하나의 변수 재료. 건물 · 방은 손님 언어마다(사전), 공용 출입 코드는 하나면 코드만 · 여럿이면 「라벨 코드」를 「 / 」로.
 */
export function autoFillContextFor(booking: AutoBooking, building: BuildingGuestInfo | null): AutoFillContext {
  const sharedCodes = building?.sharedAccess.filter((access) => access.code.trim()) ?? [];
  const codeFor = (label: string | null) =>
    building?.roomAccess.find((room) => room.code.trim() && sameRoom(label, room.roomLabel))?.code.trim() || null;
  // 묶음 대표면 방 전부(「201 / 202」) — 방 코드도 방마다, 하나라도 없으면 빈 값(보내지 않음).
  const rooms = booking.groupRooms && booking.groupRooms.length > 1 ? booking.groupRooms : null;
  if (rooms) {
    const codes = rooms.map((label) => codeFor(label));
    const dicts = guestDictionaries();
    const localizedRooms = perLang((lang) => rooms.map((label) => localizeRoomPlaceLabel(label, dicts[lang].cleaning.buildingLabels)).join(" / "));
    const base = autoFillContextFor({ ...booking, groupRooms: null }, building);
    return {
      ...base,
      room: localizedRooms,
      roomCode: codes.every((code): code is string => !!code) ? rooms.map((label, index) => `${label} ${codes[index]}`).join(" / ") : null,
    };
  }
  const roomCode = codeFor(booking.roomLabel);
  return {
    guestName: booking.guestName,
    checkInDate: booking.checkInDate,
    checkOutDate: booking.checkOutDate,
    nights: nightsBetween(booking.checkInDate, booking.checkOutDate),
    guests: booking.guests,
    building: booking.propertyName ? perLang((_lang, dict) => localizeBuildingName(booking.propertyName as string, dict.cleaning.buildingLabels)) : null,
    room: booking.roomLabel ? perLang((_lang, dict) => localizeRoomPlaceLabel(booking.roomLabel as string, dict.cleaning.buildingLabels)) : null,
    guestInfo: building?.guestInfo ?? null,
    sharedCodes:
      sharedCodes.length === 0
        ? null
        : sharedCodes.length === 1
          ? perLang(() => sharedCodes[0].code.trim())
          : perLang((_lang, dict) => sharedCodes.map((access) => `${accessLabel(access, dict.mobile)} ${access.code.trim()}`).join(" / ")),
    roomCode,
  };
}

export async function loadAutoRules(db: Client, organizationId: string): Promise<AutoRule[]> {
  const { data, error } = await untyped(db)
    .from("auto_message_rules")
    .select(RULE_COLUMNS)
    .eq("organization_id", organizationId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`auto rules read failed: ${error.code ?? error.message}`);
  return ((data ?? []) as Parameters<typeof toAutoRule>[0][]).map(toAutoRule).filter((rule): rule is AutoRule => !!rule);
}


/** PostgREST 는 한 번에 1,000줄까지만 준다 — 끝까지 `.range()` 로 넘긴다(상한 `maxPages`). */
async function readAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>,
  label: string,
  maxPages = 50,
): Promise<T[]> {
  const out: T[] = [];
  for (let index = 0; index < maxPages; index += 1) {
    const from = index * PAGE;
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`${label} read failed: ${error.code ?? error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
  return out;
}

/** 계획 범위의 예약(취소 포함 — 취소된 예약의 실행을 빼야 하므로). `reservationIds` 면 그 예약 + 같은 묶음의 방. */
export async function loadAutoReservations(
  db: Client,
  organizationId: string,
  today: string,
  options: { reservationIds?: readonly string[] } = {},
): Promise<ReservationRowForAuto[]> {
  if (options.reservationIds) {
    const out: ReservationRowForAuto[] = [];
    for (const part of chunks([...new Set(options.reservationIds)], IN_CHUNK)) {
      const { data, error } = await untyped(db).from("reservations").select(RESERVATION_COLUMNS).eq("organization_id", organizationId).in("id", part);
      if (error) throw new Error(`auto reservations read failed: ${error.code ?? error.message}`);
      out.push(...((data ?? []) as unknown as ReservationRowForAuto[]));
    }
    return expandGroups(db, organizationId, out);
  }
  return readAllPages<ReservationRowForAuto>(
    (from, to) =>
      untyped(db)
        .from("reservations")
        .select(RESERVATION_COLUMNS)
        .eq("organization_id", organizationId)
        .gte("check_out_date", ymdShift(today, -AUTO_PLAN_BEHIND_DAYS))
        .lte("check_in_date", ymdShift(today, AUTO_PLAN_AHEAD_DAYS))
        .order("check_in_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    "auto reservations",
    MAX_RESERVATIONS / PAGE,
  );
}

/** 묶음 예약의 다른 방 · 대표 예약을 더 읽는다(웹훅 · 범위 밖 실행은 한 방만 들어오므로 — 방 변수에 묶음 전부가 들어가게). */
async function expandGroups(db: Client, organizationId: string, rows: ReservationRowForAuto[]): Promise<ReservationRowForAuto[]> {
  const masters = [
    ...new Set(rows.map((row) => row.master_id?.trim()).filter((id): id is string => !!id && id !== "0" && /^\d{1,15}$/.test(id))),
  ];
  if (masters.length === 0) return rows;
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const part of chunks(masters, IN_CHUNK)) {
    for (const column of ["raw_payload->>masterId", "raw_payload->>id"]) {
      const { data, error } = await untyped(db)
        .from("reservations")
        .select(RESERVATION_COLUMNS)
        .eq("organization_id", organizationId)
        .in(column, part)
        .limit(PAGE);
      if (error) throw new Error(`auto group read failed: ${error.code ?? error.message}`);
      for (const row of (data ?? []) as unknown as ReservationRowForAuto[]) if (!byId.has(row.id)) byId.set(row.id, row);
    }
  }
  return [...byId.values()];
}

type ConversationHint = { guest_language: string | null; channel: string | null };

async function loadConversationHints(db: Client, organizationId: string, bookingIds: readonly string[]): Promise<Map<string, ConversationHint>> {
  const out = new Map<string, ConversationHint>();
  for (const part of chunks([...new Set(bookingIds)], IN_CHUNK)) {
    const { data, error } = await db
      .from("guest_conversations")
      .select("provider_booking_id, guest_language, channel")
      .eq("organization_id", organizationId)
      .eq("provider", "beds24")
      .in("provider_booking_id", part);
    if (error) throw new Error(`auto conversations read failed: ${error.message}`);
    for (const row of (data ?? []) as Array<{ provider_booking_id: string } & ConversationHint>) out.set(row.provider_booking_id, row);
  }
  return out;
}

type LoadedBooking = { booking: AutoBooking; ctx: AutoFillContext };

const byNumber = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

/**
 * 예약 행 → 예약 번호마다 계획용 예약(+ 변수 재료). 같은 번호의 행이 여럿이면(방 나눔 사본) 살아 있는 행 · 먼저 들어온 행.
 * **묶음 예약**(같은 `masterId`)은 한 번만 보낸다 — 대표(살아 있는 대표 예약, 없으면 살아 있는 방 중 번호가 가장 작은 것)에 묶음의 방 전부 ·
 * 인원 합을 싣고, 나머지는 `groupMember`(실행 줄을 만들지 않고, 있던 줄은 cancelled). 임시 결정 — 47 §5-6.
 */
export function assembleAutoBookings(
  rows: readonly ReservationRowForAuto[],
  conversations: ReadonlyMap<string, ConversationHint>,
  buildings: ReadonlyMap<string, BuildingGuestInfo>,
): Map<string, LoadedBooking> {
  const perId = new Map<string, { booking: AutoBooking; group: string }>();
  for (const row of rows) {
    const booking = toAutoBooking(row, conversations.get(providerBookingIdOf(row) ?? "") ?? null);
    if (!booking) continue;
    const prev = perId.get(booking.providerBookingId);
    if (prev && !(prev.booking.status === "cancelled" && booking.status !== "cancelled")) continue;
    perId.set(booking.providerBookingId, { booking, group: groupKeyOf(row) ?? booking.providerBookingId });
  }
  const groups = new Map<string, AutoBooking[]>();
  for (const { booking, group } of perId.values()) {
    const list = groups.get(group) ?? [];
    list.push(booking);
    groups.set(group, list);
  }
  const out = new Map<string, LoadedBooking>();
  for (const [key, members] of groups) {
    let finalMembers = members;
    if (members.length > 1) {
      const alive = members.filter((member) => member.status !== "cancelled").sort((a, b) => byNumber(a.providerBookingId, b.providerBookingId));
      const master = members.find((member) => member.providerBookingId === key) ?? null;
      const representative =
        (master && master.status !== "cancelled" ? master : null) ?? alive[0] ?? master ?? [...members].sort((a, b) => byNumber(a.providerBookingId, b.providerBookingId))[0];
      const rooms = [...new Set(alive.map((member) => member.roomLabel).filter((label): label is string => !!label))].sort(byNumber);
      const guestCounts = alive.map((member) => member.guests).filter((count): count is number => typeof count === "number" && count > 0);
      finalMembers = members.map((member) =>
        member === representative
          ? { ...member, groupRooms: rooms.length > 1 ? rooms : null, guests: guestCounts.length > 0 ? guestCounts.reduce((a, b) => a + b, 0) : member.guests }
          : { ...member, groupMember: true },
      );
    }
    for (const booking of finalMembers) {
      const building = booking.propertyName ? (buildings.get(booking.propertyName) ?? null) : null;
      out.set(booking.providerBookingId, { booking, ctx: autoFillContextFor(booking, building) });
    }
  }
  return out;
}

async function loadBookingsFromRows(db: Client, organizationId: string, rows: ReservationRowForAuto[]): Promise<Map<string, LoadedBooking>> {
  if (rows.length === 0) return new Map();
  const buildings = new Map((await loadBuildingGuestInfos(db, organizationId)).map((building) => [building.canonicalName, building]));
  const ids = rows.map(providerBookingIdOf).filter((id): id is string => !!id);
  const conversations = await loadConversationHints(db, organizationId, ids);
  return assembleAutoBookings(rows, conversations, buildings);
}

type RunRow = {
  id: string;
  rule_id: string;
  provider_booking_id: string;
  status: AutoRunStatus;
  scheduled_at: string;
  skip_reason: AutoSkipReason | null;
  missing_variables: string[] | null;
  paused_at: string | null;
  rule_trigger: string | null;
  reservation_id: string | null;
  property_name: string | null;
  room_label: string | null;
  guest_name: string | null;
  check_in_date: string | null;
  check_out_date: string | null;
  channel: string | null;
};

type KnownRun = ExistingAutoRun & { ruleId: string; row: RunRow };

function toKnownRun(row: RunRow): KnownRun {
  return {
    id: row.id,
    ruleId: row.rule_id,
    status: row.status,
    scheduledAt: row.scheduled_at,
    skipReason: row.skip_reason,
    missingVariables: row.missing_variables ?? [],
    pausedAt: row.paused_at,
    trigger: isAutoTrigger(row.rule_trigger) ? row.rule_trigger : null,
    row,
  };
}

/**
 * 기존 실행 줄 — 규칙 × 예약. **1,000줄 상한에 잘리지 않게** 예약 묶음 크기를 규칙 수로 나누고(한 묶음이 1,000줄을 넘지 않게),
 * 그래도 끝까지 `.range()` 로 넘긴다. 잘린 채 계획하면 「없는 줄」로 보고 새로 넣으려 하거나(고유 키가 막음) 날짜 바뀜을 놓친다.
 */
async function loadExistingRuns(
  db: Client,
  organizationId: string,
  ruleIds: readonly string[],
  bookingIds: readonly string[],
): Promise<Map<string, KnownRun>> {
  const out = new Map<string, KnownRun>();
  if (ruleIds.length === 0 || bookingIds.length === 0) return out;
  const perChunk = Math.max(1, Math.min(IN_CHUNK, Math.floor(PAGE / ruleIds.length)));
  for (const part of chunks(bookingIds, perChunk)) {
    const rows = await readAllPages<RunRow>(
      (from, to) =>
        untyped(db)
          .from("auto_message_runs")
          .select(RUN_COLUMNS)
          .eq("organization_id", organizationId)
          .eq("provider", "beds24")
          .in("rule_id", [...ruleIds])
          .in("provider_booking_id", part)
          .order("id", { ascending: true })
          .range(from, to),
      "auto runs",
    );
    for (const row of rows) out.set(`${row.rule_id}|${row.provider_booking_id}`, toKnownRun(row));
  }
  return out;
}

export type AutoPlannerResult = {
  rules: number;
  bookings: number;
  created: number;
  updated: number;
  enqueued: number;
  skippedAtEnqueue: number;
  writeErrors: number;
};

function snapshotOf(booking: AutoBooking) {
  return {
    reservation_id: booking.reservationId,
    property_name: booking.propertyName,
    room_label: booking.groupRooms && booking.groupRooms.length > 1 ? booking.groupRooms.join(" / ") : booking.roomLabel,
    guest_name: booking.guestName,
    check_in_date: booking.checkInDate,
    check_out_date: booking.checkOutDate,
    channel: booking.channel,
  };
}

/** 사본 칸 중 바뀐 것만(상태 · 시각이 그대로여도 손님 이름 · 방이 바뀌면 고친다). */
function snapshotDiff(row: RunRow, booking: AutoBooking): Record<string, unknown> {
  const next = snapshotOf(booking);
  const diff: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if ((row[key as keyof RunRow] ?? null) !== (value ?? null)) diff[key] = value;
  }
  return diff;
}

type PlannedUpdate = { run: KnownRun; update: Record<string, unknown>; desired: DesiredAutoRun | null };

/**
 * 고칠 줄을 바뀐 내용이 같은 것끼리 묶어 `.in('id', …)` 한 번씩(규칙을 끄면 수백 줄이 같은 「cancelled · rule_disabled」).
 * 조건: 계획 상태일 때만 + **읽을 때의 멈춤 상태 그대로**(그 사이 직원이 멈추거나 다시 보내면 0줄 — 다음 바퀴가 새 값으로).
 */
async function applyRunUpdates(
  db: Client,
  organizationId: string,
  planned: PlannedUpdate[],
  nowIso: string,
): Promise<{ updated: number; errors: number }> {
  const counts = { updated: 0, errors: 0 };
  const groups = new Map<string, PlannedUpdate[]>();
  for (const item of planned) {
    const key = JSON.stringify([item.update, item.run.pausedAt ? "paused" : "free"]);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  for (const items of groups.values()) {
    const { update } = items[0];
    const paused = !!items[0].run.pausedAt;
    for (const part of chunks(items, IN_CHUNK)) {
      let query = untyped(db)
        .from("auto_message_runs")
        .update({ ...update, updated_at: nowIso })
        .eq("organization_id", organizationId)
        .in(
          "id",
          part.map((item) => item.run.id),
        )
        .in("status", PLAN_STATUSES as string[]);
      query = paused ? query.not("paused_at", "is", null) : query.is("paused_at", null);
      const result = await query.select("id");
      if (result.error) {
        counts.errors += 1;
        console.error("[guest-messages/auto] run update failed", { rows: part.length, code: result.error.code });
        continue;
      }
      const done = new Set(((result.data ?? []) as Array<{ id: string }>).map((row) => row.id));
      counts.updated += done.size;
      for (const item of part) {
        if (!done.has(item.run.id) || !item.desired) continue;
        Object.assign(item.run, {
          status: item.desired.status,
          scheduledAt: item.desired.scheduledAt,
          skipReason: item.desired.skipReason,
          missingVariables: item.desired.missingVariables,
        });
        Object.assign(item.run.row, update);
      }
    }
  }
  return counts;
}

/** 계획 → 줄에 쓸 바뀐 칸(상태 · 시각 · 이유 · 빈 변수 · 트리거 · 사본). 바뀐 것이 없으면 null. */
function plannedUpdateFor(rule: AutoRule, booking: AutoBooking, run: KnownRun, desired: DesiredAutoRun): PlannedUpdate | null {
  const update: Record<string, unknown> = { ...(autoRunPatch(run, desired) ?? {}), ...snapshotDiff(run.row, booking) };
  if (run.row.rule_trigger !== rule.trigger) update.rule_trigger = rule.trigger;
  return Object.keys(update).length > 0 ? { run, update, desired } : null;
}

/**
 * 계획 한 바퀴(+ `enqueue` 면 큐 넣기). `reservationIds` 를 주면 그 예약(+ 같은 묶음)만(웹훅 직후). 던지면 아무것도 고치지 않은 것이
 * 아닐 수 있다 — 줄마다 조건부로 쓰므로 다음 바퀴가 이어서 바로잡는다.
 */
export async function runAutoMessagePlanner(
  db: Client,
  organizationId: string,
  options: { now?: Date; reservationIds?: readonly string[]; enqueue?: boolean } = {},
): Promise<AutoPlannerResult> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const result: AutoPlannerResult = { rules: 0, bookings: 0, created: 0, updated: 0, enqueued: 0, skippedAtEnqueue: 0, writeErrors: 0 };
  const rules = await loadAutoRules(db, organizationId);
  result.rules = rules.length;
  if (rules.length === 0) return result;

  // 전체 바퀴: 범위 밖으로 밀려 아무도 다시 보지 않는 「지난 보낼 예정」을 한 번에 past_due 로(큐 넣기 목록을 막지 않게).
  if (!options.reservationIds) {
    const swept = await untyped(db)
      .from("auto_message_runs")
      .update({ status: "skipped", skip_reason: "past_due", missing_variables: [], updated_at: nowIso })
      .eq("organization_id", organizationId)
      .eq("status", "scheduled")
      .lt("scheduled_at", new Date(now.getTime() - AUTO_LATE_GRACE_MS).toISOString());
    if (swept.error) result.writeErrors += 1;
  }

  const today = tokyoDateOf(nowIso) as string;
  const reservations = await loadAutoReservations(db, organizationId, today, { reservationIds: options.reservationIds });
  const loaded = await loadBookingsFromRows(db, organizationId, reservations);
  result.bookings = loaded.size;

  const existing = await loadExistingRuns(
    db,
    organizationId,
    rules.map((rule) => rule.id),
    [...loaded.keys()],
  );

  const inserts: Array<Record<string, unknown>> = [];
  const planned: PlannedUpdate[] = [];
  for (const rule of rules) {
    for (const { booking, ctx } of loaded.values()) {
      const current = existing.get(`${rule.id}|${booking.providerBookingId}`) ?? null;
      const desired = planAutoRun({ rule, booking, existing: current, ctx, now });
      if (desired === null) continue;
      if (desired === "keep") {
        // 큐에 넣은 뒤라도 사본(손님 이름 · 방)은 맞춘다 — 목록 표시용.
        if (current) {
          const diff = snapshotDiff(current.row, booking);
          if (Object.keys(diff).length > 0) {
            const saved = await untyped(db)
              .from("auto_message_runs")
              .update({ ...diff, updated_at: nowIso })
              .eq("organization_id", organizationId)
              .eq("id", current.id);
            if (saved.error) result.writeErrors += 1;
          }
        }
        continue;
      }
      if (!current) {
        inserts.push({
          organization_id: organizationId,
          rule_id: rule.id,
          provider: booking.provider,
          provider_booking_id: booking.providerBookingId,
          rule_trigger: rule.trigger,
          scheduled_at: desired.scheduledAt,
          status: desired.status,
          skip_reason: desired.skipReason,
          missing_variables: desired.missingVariables,
          ...snapshotOf(booking),
        });
        continue;
      }
      const item = plannedUpdateFor(rule, booking, current, desired);
      if (item) planned.push(item);
    }
  }
  const applied = await applyRunUpdates(db, organizationId, planned, nowIso);
  result.updated += applied.updated;
  result.writeErrors += applied.errors;

  for (const part of chunks(inserts, 200)) {
    const inserted = await untyped(db)
      .from("auto_message_runs")
      .upsert(part, { onConflict: "rule_id,provider,provider_booking_id", ignoreDuplicates: true })
      .select("id");
    if (inserted.error) {
      result.writeErrors += 1;
      console.error("[guest-messages/auto] run insert failed", { code: inserted.error.code, rows: part.length });
    } else {
      result.created += (inserted.data ?? []).length;
    }
  }

  if (options.enqueue) {
    const enqueued = await enqueueDueAutoRuns(db, organizationId, { now, rules, loaded });
    result.enqueued = enqueued.enqueued;
    result.skippedAtEnqueue = enqueued.skipped;
    result.writeErrors += enqueued.errors;
  }
  return result;
}

/**
 * 보낼 시각이 된 실행 → 발송 큐. 보낼 시각에서 6시간 안의 것만 읽는다(그보다 늦은 줄이 목록 앞을 막지 않게 — 전체 바퀴가 past_due 로 치운다).
 * 이번 범위에 없는 예약(확정 직후 · 먼 미래 예약 · 지워진 예약)은 실행 줄의 예약 번호로 따로 읽는다 — 없으면 cancelled.
 * 넣기 직전에 지금 데이터로 다시 계획해서 **바라는 시각이 줄의 시각과 같고 · 지금 보낼 차례일 때만** 넣는다(다르면 줄만 고치고 다음 바퀴).
 * 글은 지금 데이터로 다시 만든다(그 사이 건물 정보가 지워졌으면 skipped).
 */
async function enqueueDueAutoRuns(
  db: Client,
  organizationId: string,
  args: { now: Date; rules: AutoRule[]; loaded: Map<string, LoadedBooking> },
): Promise<{ enqueued: number; skipped: number; errors: number }> {
  const counts = { enqueued: 0, skipped: 0, errors: 0 };
  const nowIso = args.now.toISOString();
  const { data, error } = await untyped(db)
    .from("auto_message_runs")
    .select(RUN_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("status", "scheduled")
    .is("paused_at", null)
    .gte("scheduled_at", new Date(args.now.getTime() - AUTO_LATE_GRACE_MS).toISOString())
    .lte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(ENQUEUE_LIMIT);
  if (error) throw new Error(`auto due read failed: ${error.code ?? error.message}`);
  const dueRows = (data ?? []) as unknown as RunRow[];
  const rulesById = new Map(args.rules.map((rule) => [rule.id, rule]));

  // 이번 범위에 없는 예약 — 실행 줄이 가리키는 예약 행으로 따로(+ 같은 묶음).
  const outside = dueRows.filter((row) => !args.loaded.has(row.provider_booking_id));
  let extra = new Map<string, LoadedBooking>();
  const outsideReservationIds = [...new Set(outside.map((row) => row.reservation_id).filter((id): id is string => !!id))];
  if (outsideReservationIds.length > 0) {
    const rows = await loadAutoReservations(db, organizationId, tokyoDateOf(nowIso) as string, { reservationIds: outsideReservationIds });
    extra = await loadBookingsFromRows(db, organizationId, rows);
  }

  const patch = async (run: KnownRun, update: Record<string, unknown>): Promise<boolean> => {
    const saved = await untyped(db)
      .from("auto_message_runs")
      .update({ ...update, updated_at: nowIso })
      .eq("organization_id", organizationId)
      .eq("id", run.id)
      .eq("status", "scheduled")
      .is("paused_at", null)
      .select("id");
    if (saved.error) {
      counts.errors += 1;
      return false;
    }
    return (saved.data ?? []).length > 0;
  };

  for (const row of dueRows) {
    const rule = rulesById.get(row.rule_id);
    if (!rule) continue;
    const run = toKnownRun(row);
    const entry = args.loaded.get(row.provider_booking_id) ?? extra.get(row.provider_booking_id);
    if (!entry) {
      // 예약 행이 없다(지워짐) — 보낼 곳을 확인할 수 없으니 보내지 않는다.
      if (await patch(run, { status: "cancelled", skip_reason: "cancelled", missing_variables: [] })) counts.skipped += 1;
      continue;
    }
    const desired = planAutoRun({ rule, booking: entry.booking, existing: run, ctx: entry.ctx, now: args.now });
    if (desired === "keep" || desired === null) continue;
    if (desired.status !== "scheduled" || Date.parse(desired.scheduledAt) !== Date.parse(row.scheduled_at)) {
      const item = plannedUpdateFor(rule, entry.booking, run, desired);
      if (item && (await patch(run, item.update)) && desired.status !== "scheduled") counts.skipped += 1;
      continue;
    }
    if (!isAutoRunDue(desired.scheduledAt, args.now)) continue;
    const built = buildAutoMessage(rule.bodies, entry.booking.guestLanguage, entry.ctx);
    if (!built.ok) {
      if (await patch(run, { status: "skipped", skip_reason: built.reason, missing_variables: built.reason === "empty_variable" ? built.missing : [] })) {
        counts.skipped += 1;
      }
      continue;
    }
    try {
      const seed = await resolveConversationSeed(db, {
        organizationId,
        providerBookingId: row.provider_booking_id,
        booking: null,
        externalPropertyId: null,
        externalRoomId: null,
        reservationId: entry.booking.reservationId,
      });
      seed.channel = entry.booking.channel ?? seed.channel;
      seed.guest_language = seed.guest_language ?? entry.booking.guestLanguage;
      seed.guest_name = seed.guest_name ?? entry.booking.guestName;
      const conversation = await ensureConversationForBooking(db, {
        organizationId,
        provider: "beds24",
        providerBookingId: row.provider_booking_id,
        seed,
      });
      const queued = await db.rpc("guest_message_enqueue_auto", {
        p_organization_id: organizationId,
        p_run_id: row.id,
        p_conversation_id: conversation.id,
        p_provider: "beds24",
        p_body: built.text,
        p_now: nowIso,
      });
      if (queued.error) throw new Error(queued.error.message);
      const result = ((queued.data ?? []) as Array<{ outbox_id: string | null; enqueued: boolean }>)[0];
      if (result?.enqueued) counts.enqueued += 1;
    } catch (cause) {
      counts.errors += 1;
      console.error("[guest-messages/auto] enqueue failed", { runId: row.id, error: cause instanceof Error ? cause.message : "unknown" });
    }
  }
  return counts;
}

const SOURCE_ID_RE = /^\d{1,15}$/;

/** 켜 둔 자동 안내 규칙이 하나라도 있는 조직. 읽기 실패(표 없음 포함)는 빈 집합 — 웹훅 뒤 계획을 건너뛴다. */
async function loadOrgsWithEnabledRules(db: Client): Promise<Set<string>> {
  const { data, error } = await untyped(db).from("auto_message_rules").select("organization_id").eq("enabled", true).limit(PAGE);
  if (error) return new Set();
  return new Set(((data ?? []) as Array<{ organization_id: string }>).map((row) => row.organization_id));
}

/**
 * 예약 웹훅 직후(`after()`) — 들어온 예약만 다시 계획한다(큐에는 넣지 않음 · Beds24 호출 없음). 던지지 않는다.
 * 큐 넣기 · 보내기는 `/api/guest-messages/auto` 가 한다 — 정기 실행은 Supabase pg_cron 5분(`202611130006`, 운영 미적용).
 * 원본 예약 번호로 찾을 때는 방 나눔 사본(`70001::room::201`)까지 — 앞부분이 같은 행 전부.
 */
export async function planAutoMessagesAfterWebhook(
  db: Client,
  results: ReadonlyArray<{ ok: boolean; reservationId?: string | null; sourceReservationId?: string | null }>,
  now: Date = new Date(),
): Promise<void> {
  try {
    // 켜 둔 규칙이 있는 조직만 — 하나도 없으면(기본값 · 대부분의 웹훅) 예약 조회 · 앞부분 LIKE 를 아예 하지 않는다.
    // 표가 아직 없으면(202611130004 전) 여기서 조용히 끝난다.
    const enabledOrgs = await loadOrgsWithEnabledRules(db);
    if (enabledOrgs.size === 0) return;
    const reservationIds = new Set<string>();
    const sourceIds = new Set<string>();
    for (const result of results) {
      if (!result.ok) continue;
      if (result.reservationId) reservationIds.add(result.reservationId);
      else if (result.sourceReservationId) sourceIds.add(result.sourceReservationId);
    }
    const byOrg = new Map<string, Set<string>>();
    const collect = (rows: Array<{ id: string; organization_id: string }>) => {
      for (const row of rows) {
        const set = byOrg.get(row.organization_id) ?? new Set<string>();
        set.add(row.id);
        byOrg.set(row.organization_id, set);
      }
    };
    for (const part of chunks([...reservationIds], IN_CHUNK)) {
      const { data, error } = await db.from("reservations").select("id, organization_id").in("id", part);
      if (error) throw new Error(error.message);
      collect((data ?? []) as Array<{ id: string; organization_id: string }>);
    }
    for (const part of chunks([...sourceIds], IN_CHUNK)) {
      const { data, error } = await db.from("reservations").select("id, organization_id").in("source_reservation_id", part);
      if (error) throw new Error(error.message);
      collect((data ?? []) as Array<{ id: string; organization_id: string }>);
    }
    for (const id of sourceIds) {
      // 숫자 번호만 앞부분 찾기에 쓴다(LIKE 의 % · _ 가 섞이지 않게).
      const head = id.split("::")[0]?.trim() ?? "";
      if (!SOURCE_ID_RE.test(head)) continue;
      const { data, error } = await untyped(db).from("reservations").select("id, organization_id").like("source_reservation_id", `${head}::%`).limit(PAGE);
      if (error) throw new Error(error.message);
      collect((data ?? []) as Array<{ id: string; organization_id: string }>);
    }
    for (const [organizationId, ids] of byOrg) {
      if (!enabledOrgs.has(organizationId)) continue;
      try {
        await runAutoMessagePlanner(db, organizationId, { now, reservationIds: [...ids], enqueue: false });
      } catch (error) {
        // 표가 아직 없으면(202611130004 전) 조용히 넘어간다 — 웹훅 · 예약 처리와 무관.
        console.error("[guest-messages/auto] webhook plan failed", error instanceof Error ? error.message : "unknown");
      }
    }
  } catch (error) {
    console.error("[guest-messages/auto] webhook plan failed", error instanceof Error ? error.message : "unknown");
  }
}
