"use server";

/**
 * 예약 패널 「메시지」 칸 — PC 판매 캘린더 예약 패널 · 모바일 예약 시트 공용(2026-11-26).
 * docs/product/33-calendar-write-features.md → 「예약 패널 — 메시지」 · docs/product/47-guest-messaging.md
 *
 * - 권한은 손님 메시지함과 같은 키: 보기 `guest_messages.view`, 답장은 `view` **와** `reply`. 관리자 웹 권한은 요구하지 않는다
 *   (모바일 판매 캘린더에서도 부른다 — 47 §8 「키가 기준」). 거부는 redirect 없이 `forbidden`.
 * - 예약 ↔ 대화: 먼저 `guest_conversations.reservation_id = reservations.id`, 없으면 Beds24 예약 번호
 *   (`raw_payload.id` / `bookId` / `source_reservation_id` 머리 — `providerBookingIdOf`) = `provider_booking_id`.
 * - 첫 메시지(대화가 아직 없음)는 받기 · 자동 안내와 같은 `ensureConversationForBooking`(고유 제약 + 23505 다시 읽기)으로 만들고,
 *   보내기는 메시지함의 `sendGuestReply` 를 그대로 부른다(발송 큐 · 같은 키 두 번 막기 · 발송 꺼짐이면 「보낼 차례 기다림」).
 * - 조직 id 는 언제나 세션에서 온다. service_role 로 읽으니 조직 필터를 늘 건다.
 */

import { sendGuestReply, type GuestMessageErrorKey } from "@/actions/guest-messages";
import { providerBookingIdOf } from "@/lib/guest-messages/auto-scheduler";
import { resolveOutboundChannel } from "@/lib/guest-messages/beds24-normalize";
import {
  isRetryableOutbox,
  isValidIdempotencyKey,
  MAX_REPLY_CHARS,
  replyBlockReason,
  UUID_RE,
} from "@/lib/guest-messages/inbox-model";
import { isGuestMessageSendEnabled } from "@/lib/guest-messages/outbox-runner";
import { ensureConversationForBooking, resolveConversationSeed } from "@/lib/guest-messages/store";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/** 칸에 보이는 최근 메시지 수. */
const PREVIEW_COUNT = 2;

export type ReservationMessagesErrorKey = GuestMessageErrorKey | "no_booking";
type Failure = { ok: false; errorKey: ReservationMessagesErrorKey };

export type ReservationMessagePreview = {
  id: string;
  direction: "guest" | "host";
  body: string;
  /** 손님 말: 직원 언어 번역(있으면). 우리 답장: 직원이 쓴 원문(번역해서 보냈을 때). */
  bodyTranslated: string | null;
  sentAt: string;
  /** 우리 답장의 발송 큐 상태(없으면 null — 채널에서 직접 쓴 답 등). */
  outbox: { id: string; status: string; retryable: boolean } | null;
};

export type LoadReservationMessagesResult =
  | {
      ok: true;
      /** view = 대화로 가기만, reply = 답장 칸까지. */
      access: "view" | "reply";
      conversationId: string | null;
      /** 최근 것부터 거꾸로 — 화면엔 오래된 것이 위(대화 순서). */
      messages: ReservationMessagePreview[];
      /** 마지막 우리 답장 뒤 손님 메시지 수. */
      unreadCount: number;
      sendEnabled: boolean;
      /** 보낼 수 없는 예약(직접 예약 · 모르는 채널) — 칸은 보이되 답장 칸 대신 안내. */
      blocked: "direct_booking" | "unknown_channel" | null;
    }
  | Failure;

type Gate = { ok: true; organizationId: string; canReply: boolean } | Failure;

async function gate(write: boolean): Promise<Gate> {
  const session = await getCurrentAppSession().catch(() => null);
  if (!session || !hasOrganizationContext(session)) return { ok: false, errorKey: "forbidden" };
  const caps = session.capabilities;
  if (!caps.includes("guest_messages.view")) return { ok: false, errorKey: "forbidden" };
  const canReply = caps.includes("guest_messages.reply");
  if (write && !canReply) return { ok: false, errorKey: "forbidden" };
  return { ok: true, organizationId: session.organization.id, canReply };
}

function db() {
  return getSupabaseServiceClient();
}

type ReservationPick = { id: string; source: string | null; source_reservation_id: string | null; raw_payload: unknown };
type ConversationPick = { id: string; channel: string | null; last_reply_at: string | null };

function rawString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** 예약 행 → Beds24 예약 번호(대화의 `provider_booking_id`). 순수 — 시험용으로 내보내지 않고 아래에서만 쓴다. */
function bookingIdOf(row: ReservationPick): string | null {
  return providerBookingIdOf({
    bid: rawString(row.raw_payload, "id"),
    book_id: rawString(row.raw_payload, "bookId"),
    source_reservation_id: row.source_reservation_id ?? "",
  });
}

async function loadReservation(organizationId: string, reservationId: string): Promise<ReservationPick | null> {
  const found = await db()
    .from("reservations")
    .select("id, source, source_reservation_id, raw_payload")
    .eq("organization_id", organizationId)
    .eq("id", reservationId)
    .maybeSingle();
  if (found.error) throw new Error(`reservation read failed: ${found.error.message}`);
  return (found.data as ReservationPick | null) ?? null;
}

async function findConversation(
  organizationId: string,
  reservation: ReservationPick,
  bookingId: string | null,
): Promise<ConversationPick | null> {
  const columns = "id, channel, last_reply_at";
  const byReservation = await db()
    .from("guest_conversations")
    .select(columns)
    .eq("organization_id", organizationId)
    .eq("reservation_id", reservation.id)
    .order("last_message_at", { ascending: false })
    .limit(1);
  if (byReservation.error) throw new Error(`conversation read failed: ${byReservation.error.message}`);
  const first = ((byReservation.data ?? []) as ConversationPick[])[0];
  if (first) return first;
  if (!bookingId) return null;
  const byBooking = await db()
    .from("guest_conversations")
    .select(columns)
    .eq("organization_id", organizationId)
    .eq("provider", "beds24")
    .eq("provider_booking_id", bookingId)
    .maybeSingle();
  if (byBooking.error) throw new Error(`conversation read failed: ${byBooking.error.message}`);
  return (byBooking.data as ConversationPick | null) ?? null;
}

/**
 * 보낼 수 있는가 — 대화가 있으면 그 대화의 채널(메시지함 `sendGuestReply` 와 같은 기준), 없으면 새로 만들 때 쓸 채널
 * (예약 출처에서 분류)로 본다. 두 판정이 어긋나면 「보낼 수 있다」고 보였다가 보내기에서 막힌다.
 */
function blockOf(conversation: ConversationPick | null, reservationSource: string | null) {
  if (conversation) return replyBlockReason(conversation.channel);
  return replyBlockReason(resolveOutboundChannel(null, reservationSource));
}

/** 예약 패널을 열 때(칸이 보일 때) 한 번 — 최근 메시지 2개 · 안 읽음 · 답장 가능 여부. */
export async function loadReservationMessages(reservationId: string): Promise<LoadReservationMessagesResult> {
  const auth = await gate(false);
  if (!auth.ok) return auth;
  if (typeof reservationId !== "string" || !UUID_RE.test(reservationId)) return { ok: false, errorKey: "invalid" };

  try {
    const reservation = await loadReservation(auth.organizationId, reservationId);
    if (!reservation) return { ok: false, errorKey: "not_found" };
    const bookingId = bookingIdOf(reservation);
    const conversation = await findConversation(auth.organizationId, reservation, bookingId);
    const sendEnabled = isGuestMessageSendEnabled();
    const access = auth.canReply ? "reply" : "view";
    // 직접 · 수기 예약은 Beds24 번호가 없어도 「직접 예약」 안내가 맞다 — 「채널 모름」은 채널도 모를 때만(2026-11-26).
    const blocked = blockOf(conversation, reservation.source) ?? (bookingId ? null : "unknown_channel");

    if (!conversation) {
      return { ok: true, access, conversationId: null, messages: [], unreadCount: 0, sendEnabled, blocked };
    }

    const recent = await db()
      .from("guest_messages")
      .select("id, direction, body, body_translated, sent_at, outbox_id")
      .eq("organization_id", auth.organizationId)
      .eq("conversation_id", conversation.id)
      .in("direction", ["guest", "host"])
      .order("sent_at", { ascending: false })
      .limit(PREVIEW_COUNT);
    if (recent.error) throw new Error(`messages read failed: ${recent.error.message}`);
    const rows = (recent.data ?? []) as Array<{
      id: string;
      direction: "guest" | "host";
      body: string;
      body_translated: string | null;
      sent_at: string;
      outbox_id: string | null;
    }>;

    // 안 읽음 = 마지막 우리 답장 뒤 손님 메시지 — 대화에 저장된 수가 없으니 따로 센다(최근 몇 줄만 세면 모자란다, 2026-11-26).
    let unreadQuery = db()
      .from("guest_messages")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", auth.organizationId)
      .eq("conversation_id", conversation.id)
      .eq("direction", "guest");
    if (conversation.last_reply_at) unreadQuery = unreadQuery.gt("sent_at", conversation.last_reply_at);
    const unread = await unreadQuery;
    if (unread.error) throw new Error(`unread count failed: ${unread.error.message}`);
    const unreadCount = unread.count ?? 0;

    const preview = rows;
    const outboxIds = preview.map((row) => row.outbox_id).filter((id): id is string => !!id);
    const outboxById = new Map<string, { id: string; status: string; error_code: string | null }>();
    if (outboxIds.length > 0) {
      const outbox = await db()
        .from("guest_message_outbox")
        .select("id, status, error_code")
        .eq("organization_id", auth.organizationId)
        .in("id", outboxIds);
      if (outbox.error) throw new Error(`outbox read failed: ${outbox.error.message}`);
      for (const row of (outbox.data ?? []) as Array<{ id: string; status: string; error_code: string | null }>)
        outboxById.set(row.id, row);
    }

    const messages: ReservationMessagePreview[] = preview.reverse().map((row) => {
      const box = row.outbox_id ? outboxById.get(row.outbox_id) : undefined;
      return {
        id: row.id,
        direction: row.direction,
        body: row.body,
        bodyTranslated: row.body_translated,
        sentAt: row.sent_at,
        outbox: box ? { id: box.id, status: box.status, retryable: isRetryableOutbox(box.status, box.error_code) } : null,
      };
    });

    return { ok: true, access, conversationId: conversation.id, messages, unreadCount, sendEnabled, blocked };
  } catch (error) {
    console.error("[reservation-messages] load", error instanceof Error ? error.message : "unknown");
    return { ok: false, errorKey: "failed" };
  }
}

export type SendReservationMessageResult =
  | { ok: true; conversationId: string; outboxId: string; duplicate: boolean; sendEnabled: boolean }
  | Failure;

/**
 * 예약 패널에서 보내기 — 대화가 없으면 먼저 만들고(첫 메시지), 메시지함과 같은 발송 큐에 넣는다.
 * 같은 `idempotencyKey` 로 다시 오면(다시 보내기 · 두 번 누름) 첫 줄을 돌려준다(`sendGuestReply`).
 */
export async function sendReservationMessage(input: {
  reservationId: string;
  body: string;
  idempotencyKey: string;
}): Promise<SendReservationMessageResult> {
  const auth = await gate(true);
  if (!auth.ok) return auth;
  if (typeof input?.reservationId !== "string" || !UUID_RE.test(input.reservationId)) return { ok: false, errorKey: "invalid" };
  // 메시지함 `sendGuestReply` 와 같은 검사를 **대화를 만들기 전에** — 틀린 요청이 빈 대화만 남기지 않게(2026-11-26).
  if (!isValidIdempotencyKey(input.idempotencyKey)) return { ok: false, errorKey: "invalid" };
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) return { ok: false, errorKey: "invalid" };
  if (Array.from(body).length > MAX_REPLY_CHARS) return { ok: false, errorKey: "too_long" };

  let conversationId: string;
  try {
    const reservation = await loadReservation(auth.organizationId, input.reservationId);
    if (!reservation) return { ok: false, errorKey: "not_found" };
    const bookingId = bookingIdOf(reservation);
    const existing = await findConversation(auth.organizationId, reservation, bookingId);
    // 보낼 수 없는 예약이면 빈 대화를 만들지 않는다. 직접 예약은 번호가 없어도 「직접 예약」으로 답한다.
    const block = blockOf(existing, reservation.source);
    if (block) return { ok: false, errorKey: block };
    if (!bookingId) return { ok: false, errorKey: "no_booking" };
    if (existing) {
      conversationId = existing.id;
    } else {
      const supabase = db();
      const seed = await resolveConversationSeed(supabase, {
        organizationId: auth.organizationId,
        providerBookingId: bookingId,
        booking: null,
        externalPropertyId: null,
        externalRoomId: null,
        reservationId: reservation.id,
      });
      const created = await ensureConversationForBooking(supabase, {
        organizationId: auth.organizationId,
        provider: "beds24",
        providerBookingId: bookingId,
        seed,
      });
      conversationId = created.id;
    }
  } catch (error) {
    console.error("[reservation-messages] send", error instanceof Error ? error.message : "unknown");
    return { ok: false, errorKey: "failed" };
  }

  const sent = await sendGuestReply({ conversationId, body: input.body, idempotencyKey: input.idempotencyKey });
  if (!sent.ok) return sent;
  return { ok: true, conversationId, outboxId: sent.outboxId, duplicate: sent.duplicate, sendEnabled: sent.sendEnabled };
}
