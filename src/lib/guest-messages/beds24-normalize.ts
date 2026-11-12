/**
 * Beds24 메시지 → 표준 메시지 (**순수**, 통로 호출 없음). docs/product/47-guest-messaging.md §3-2 · §3-3
 *
 * 근거(공식 문서, 2026-11-12 읽음 — 실제 배달 모양은 **아직 확인 전**, V1):
 * - 메시지용 웹훅은 따로 없고 **예약 웹훅 본문에 `messages` 배열**이 실린다. 명세(`Webhooks - bookings`)는 봉투
 *   `{ booking, infoItems, invoiceItems, messages }` 이지만, 예약 객체 안에 `messages` 가 들어오는 경우도 같이 받는다.
 * - 메시지 칸(`GET /bookings/messages` 와 같은 모양): `id` · `bookingId` · `roomId` · `propertyId` · `time` · `read` ·
 *   `message` · `source`(host | guest | internalNote | system) · `authorOwnerId` · `attachment` · `attachmentName` · `attachmentMimeType`.
 *
 * **방어적으로 읽는다** — 칸이 없거나 모양이 달라도 던지지 않는다. 번호(`id`)가 없는 메시지는 중복을 막을 수 없어 버린다.
 */

import {
  beds24LastNightToCheckout,
  readBeds24String,
  toBeds24IsoDate,
  type Beds24JsonRecord,
} from "@/lib/beds24/booking-payload";
import { readBeds24OwnBookingId } from "@/lib/beds24/reservation-id";
import type {
  GuestChannelKey,
  GuestMessageAttachment,
  GuestMessageDirection,
  NormalizedBookingContext,
  NormalizedMessage,
} from "@/lib/guest-messages/types";

const MAX_DEPTH = 8;

function asRecord(value: unknown): Beds24JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Beds24JsonRecord;
}

function readId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return null;
}

/** Beds24 `source` → 방향. 모르는 값 · 빈 값은 `system`(손님 말로 잘못 세어 「답장 기다림」을 만들지 않게). */
export function mapBeds24Source(source: unknown): GuestMessageDirection {
  const value = typeof source === "string" ? source.trim().toLowerCase().replace(/[\s_-]/g, "") : "";
  if (value === "guest") return "guest";
  if (value === "host") return "host";
  if (value === "internalnote" || value === "internal" || value === "note") return "internal";
  return "system";
}

/**
 * Beds24 시각 → ISO. 시간대 표시가 없으면 UTC 로 본다(Beds24 v2 의 시각은 UTC — 실측 전, V1 에서 확인).
 * 숫자는 epoch(10자리 초 · 13자리 ms).
 */
export function parseBeds24TimeDetailed(value: unknown): { iso: string; assumedUtc: boolean } | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : { iso: date.toISOString(), assumedUtc: false };
  }
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  let normalized = raw.replace(" ", "T");
  let assumedUtc = false;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(normalized)) {
    normalized += "Z";
    assumedUtc = true;
  }
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : { iso: date.toISOString(), assumedUtc };
}

export function parseBeds24Time(value: unknown): string | null {
  return parseBeds24TimeDetailed(value)?.iso ?? null;
}

function readBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function readAttachments(record: Beds24JsonRecord): GuestMessageAttachment[] {
  const out: GuestMessageAttachment[] = [];
  const pushOne = (rec: Beds24JsonRecord) => {
    const data = readBeds24String(rec, ["attachment", "url", "attachmentUrl"]);
    const name = readBeds24String(rec, ["attachmentName", "name", "fileName"]);
    const mimeType = readBeds24String(rec, ["attachmentMimeType", "mimeType", "type"]);
    if (!data && !name) return;
    const isUrl = !!data && /^https?:\/\//i.test(data);
    out.push({ name, mimeType, url: isUrl ? data : null, inline: !!data && !isUrl });
  };
  if (readBeds24String(record, ["attachment", "attachmentName"])) pushOne(record);
  const list = record.attachments;
  if (Array.isArray(list)) {
    for (const item of list) {
      const rec = asRecord(item);
      if (rec) pushOne(rec);
    }
  }
  return out;
}

/**
 * 채널 키(2026-11-12 검토 반영 — 느슨한 부분 일치를 줄임). 예약의 `channel` 을 먼저, 없으면 `referer` · `apiSource`.
 * - 알려진 OTA 이름이 보이면 그 채널(airbnb · booking.com · expedia · agoda · vrbo/homeaway).
 * - Beds24 예약 페이지 · 수기 · 전화 · walk-in 은 `direct`.
 * - 그 밖은 `other`, 값이 하나도 없으면 null. 보내기는 OTA 허용 목록만(`OTA_SENDABLE_CHANNELS`) — 실제 값 목록은 V4 에서 확정.
 */
export function classifyGuestChannel(record: Beds24JsonRecord | null): GuestChannelKey | null {
  if (!record) return null;
  const explicit = readBeds24String(record, ["channel"])?.trim().toLowerCase() ?? null;
  const exact: Record<string, GuestChannelKey> = {
    airbnb: "airbnb",
    booking: "booking",
    "booking.com": "booking",
    bookingcom: "booking",
    expedia: "expedia",
    agoda: "agoda",
    vrbo: "vrbo",
    homeaway: "vrbo",
    direct: "direct",
  };
  if (explicit && exact[explicit]) return exact[explicit];
  const parts = [
    explicit,
    readBeds24String(record, ["referer", "referrer"]),
    readBeds24String(record, ["apiSource", "api_source", "subSource", "source"]),
  ]
    .filter((value): value is string => !!value)
    .join(" ")
    .toLowerCase();
  if (!parts) return null;
  if (parts.includes("airbnb")) return "airbnb";
  if (/booking\.com|\bbookingcom\b/.test(parts)) return "booking";
  if (parts.includes("expedia")) return "expedia";
  if (parts.includes("agoda")) return "agoda";
  if (parts.includes("vrbo") || parts.includes("homeaway")) return "vrbo";
  if (/\bbooking ?page\b|\bdirect\b|\bmanual\b|\bphone\b|\bwalk-?in\b/.test(parts)) return "direct";
  return "other";
}

/**
 * 보낼 채널 정하기 — 대화의 채널을 먼저, 모르면(null · other) 우리 예약 행의 출처(`reservations.source`, 예: "Airbnb" ·
 * "Booking.com")로 다시 분류한다. 그래도 모르면 null — 어댑터가 `unknown_channel` 로 거절한다.
 */
export function resolveOutboundChannel(
  conversationChannel: GuestChannelKey | null,
  reservationSource: string | null,
): GuestChannelKey | null {
  if (conversationChannel && conversationChannel !== "other") return conversationChannel;
  const fromReservation = reservationSource ? classifyGuestChannel({ channel: reservationSource }) : null;
  if (fromReservation && fromReservation !== "other") return fromReservation;
  return conversationChannel;
}

/** 예약 객체로 보이는가 — 메시지 배열의 주인을 찾을 때. 메시지 자체(`message` 칸)는 예약이 아니다. */
function looksLikeBookingRecord(record: Beds24JsonRecord): boolean {
  if (typeof record.message === "string") return false;
  if (!readBeds24OwnBookingId(record)) return false;
  return !!readBeds24String(record, [
    "arrival",
    "departure",
    "firstNight",
    "lastNight",
    "apiReference",
    "status",
    "propertyId",
    "propId",
    "roomId",
  ]);
}

export function readBookingContext(record: Beds24JsonRecord): NormalizedBookingContext | null {
  const providerBookingId = readBeds24OwnBookingId(record);
  if (!providerBookingId) return null;
  const first = readBeds24String(record, ["firstName", "guestFirstName", "first_name"]);
  const last = readBeds24String(record, ["lastName", "guestLastName", "last_name"]);
  const full = [first, last].filter(Boolean).join(" ").trim();
  const checkOut =
    beds24LastNightToCheckout(readBeds24String(record, ["lastNight", "last_night"])) ??
    toBeds24IsoDate(readBeds24String(record, ["departure", "checkOut", "check_out"]));
  const language = readBeds24String(record, ["lang", "language", "guestLanguage"]);
  return {
    providerBookingId,
    channelReference: readBeds24String(record, ["apiReference", "api_reference"]),
    externalPropertyId: readBeds24String(record, ["propertyId", "propId", "property_id"]),
    externalRoomId: readBeds24String(record, ["roomId", "room_id", "unitId"]),
    guestName: full.length > 0 ? full : readBeds24String(record, ["guestName", "name"]),
    guestLanguage: language ? language.toLowerCase() : null,
    channel: classifyGuestChannel(record),
    bookingStatus: readBeds24String(record, ["status"])?.toLowerCase() ?? null,
    checkInDate: toBeds24IsoDate(readBeds24String(record, ["arrival", "firstNight", "checkIn", "check_in"])),
    checkOutDate: checkOut,
  };
}

/**
 * 메시지 한 건. 번호가 없거나 예약 번호를 알 수 없으면 null.
 * `receivedAt` — 통로가 시각을 주지 않았을 때 쓰는 받은 시각(ISO).
 */
export function normalizeBeds24Message(
  raw: unknown,
  options: { booking?: NormalizedBookingContext | null; receivedAt: string },
): NormalizedMessage | null {
  const record = asRecord(raw);
  if (!record) return null;
  const externalId = readId(record.id) ?? readId(record.messageId);
  if (!externalId) return null;
  const booking = options.booking ?? null;
  const providerBookingId = readId(record.bookingId) ?? readId(record.bookId) ?? booking?.providerBookingId ?? null;
  if (!providerBookingId) return null;
  const bodyValue = record.message ?? record.text ?? record.body;
  const body = typeof bodyValue === "string" ? bodyValue : "";
  const attachments = readAttachments(record);
  if (!body.trim() && attachments.length === 0) return null;
  const providerSource = typeof record.source === "string" ? record.source : null;
  const time = parseBeds24TimeDetailed(record.time ?? record.createdAt ?? record.date);
  return {
    provider: "beds24",
    externalId,
    providerBookingId,
    direction: mapBeds24Source(record.source),
    providerSource,
    body,
    sentAt: time?.iso ?? options.receivedAt,
    timeAssumedUtc: time?.assumedUtc ?? false,
    read: readBool(record.read),
    attachments,
    externalPropertyId: readId(record.propertyId) ?? booking?.externalPropertyId ?? null,
    externalRoomId: readId(record.roomId) ?? booking?.externalRoomId ?? null,
    // 다른 예약의 메시지에 이 예약 정보를 붙이지 않는다.
    booking: booking && booking.providerBookingId === providerBookingId ? booking : null,
  };
}

function collect(
  value: unknown,
  depth: number,
  receivedAt: string,
  out: NormalizedMessage[],
): void {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) collect(item, depth + 1, receivedAt, out);
    return;
  }
  const record = asRecord(value);
  if (!record) return;

  if (Array.isArray(record.messages)) {
    // 배열의 주인: 봉투면 `booking`, 예약 객체 안이면 그 객체.
    const owner = asRecord(record.booking) ?? (looksLikeBookingRecord(record) ? record : null);
    const booking = owner ? readBookingContext(owner) : null;
    for (const item of record.messages) {
      const message = normalizeBeds24Message(item, { booking, receivedAt });
      if (message) out.push(message);
    }
  }
  for (const key of Object.keys(record)) {
    if (key === "messages") continue;
    const child = record[key];
    if (child !== null && typeof child === "object") collect(child, depth + 1, receivedAt, out);
  }
}

/** 웹훅 본문 전체 → 표준 메시지(같은 번호는 하나만, 예약 정보가 있는 쪽을 남긴다). */
export function extractBeds24WebhookMessages(body: unknown, receivedAt: string = new Date().toISOString()): NormalizedMessage[] {
  const all: NormalizedMessage[] = [];
  try {
    collect(body, 0, receivedAt, all);
  } catch {
    return [];
  }
  const byId = new Map<string, NormalizedMessage>();
  for (const message of all) {
    const prev = byId.get(message.externalId);
    if (!prev || (!prev.booking && message.booking)) byId.set(message.externalId, message);
  }
  return [...byId.values()];
}

/** 본문 어딘가에 비어 있지 않은 `messages` 배열이 있는가(임시 원문 기록 V1 의 조건). */
export function hasNonEmptyMessagesArray(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasNonEmptyMessagesArray(item, depth + 1));
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.messages) && record.messages.length > 0) return true;
  return Object.values(record).some((child) => hasNonEmptyMessagesArray(child, depth + 1));
}

/**
 * 임시 원문 기록용 사본(47 §3-4) — `messages` 안 첨부 값(base64 일 수 있다)을 **길이만** 남긴다. 원본은 바꾸지 않는다.
 */
export function redactMessageAttachments(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redactMessageAttachments(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "attachment" && typeof child === "string") {
      out[key] = { redactedLength: child.length };
    } else {
      out[key] = redactMessageAttachments(child, depth + 1);
    }
  }
  return out;
}
