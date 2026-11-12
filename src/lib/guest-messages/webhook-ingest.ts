/**
 * Beds24 예약 웹훅 → 손님 메시지 (2026-11-12, 47 §4). `/api/beds24/webhook` 이 예약 처리 **뒤에**, 응답 뒤(`after()`)에 부른다.
 *
 * - Beds24 를 새로 부르지 않는다(크레딧 0). 본문에 실린 `messages` 만 쓴다.
 * - 조직은 예약 처리와 같은 규칙(`org-resolve.ts`). 기본값으로만 정해진 예약은 경고 로그를 남긴다(넣기는 한다).
 * - 메시지가 없어도 그 조직의 `last_webhook_at` 은 고친다(「받는 통로 멈춤」 판단, §6-2).
 * - **절대 던지지 않는다** — 예약 처리는 이미 끝났고, 여기 실패가 웹훅 응답을 바꾸면 안 된다.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Beds24JsonRecord } from "@/lib/beds24/booking-payload";
import type { ProcessWebhookBookingResult } from "@/lib/beds24/process-webhook-booking";
import {
  extractBeds24WebhookMessages,
  hasNonEmptyMessagesArray,
  readBookingContext,
  redactMessageAttachments,
} from "@/lib/guest-messages/beds24-normalize";
import { resolveMessageOrganization, type ResolvedOrganization } from "@/lib/guest-messages/org-resolve";
import {
  groupMessagesByBooking,
  ingestConversationMessages,
  recordChannelState,
  resolveConversationSeed,
} from "@/lib/guest-messages/store";
import type { NormalizedBookingContext, NormalizedMessage } from "@/lib/guest-messages/types";

/**
 * 임시 원문 기록(V1, 47 §3-4) — 환경변수 `BEDS24_WEBHOOK_CAPTURE_MESSAGES=1` 이고 본문에 비어 있지 않은 `messages` 가 있을 때만.
 * 실제 배달 모양을 확인하면 끈다(기본 꺼짐).
 */
export function shouldCaptureWebhookMessages(body: unknown, flag: string | undefined = process.env.BEDS24_WEBHOOK_CAPTURE_MESSAGES): boolean {
  if (flag?.trim() !== "1") return false;
  return hasNonEmptyMessagesArray(body);
}

/** 임시 원문 상한(글자). 넘으면 앞부분 표본 + 길이만(거절 배달 `capRejectedBody` 와 같은 방식, 메시지 이력이 길어 상한은 넉넉히). */
export const MAX_CAPTURED_MESSAGES_CHARS = 60_000;
export const CAPTURED_MESSAGES_SAMPLE_CHARS = 12_000;

/** 임시 원문 기록에 넣을 값 — 첨부는 길이만, 크기 상한. */
export function prepareCapturedMessagesPayload(body: unknown): unknown {
  const redacted = redactMessageAttachments(body);
  let serialized: string;
  try {
    serialized = JSON.stringify(redacted) ?? "";
  } catch {
    return { unserializable: true };
  }
  if (serialized.length <= MAX_CAPTURED_MESSAGES_CHARS) return redacted;
  return { truncated: true, length: serialized.length, sample: serialized.slice(0, CAPTURED_MESSAGES_SAMPLE_CHARS) };
}

/** 시간대 없는 시각을 UTC 로 읽은 메시지 수 — 경고로 남긴다(V1 에서 실제 형식 확인). */
export function warnAssumedUtcTimes(messages: readonly NormalizedMessage[], label: string): number {
  const count = messages.filter((message) => message.timeAssumedUtc).length;
  if (count > 0) console.warn(`[guest-messages/${label}] message times without timezone read as UTC`, { count });
  return count;
}

type BookingEntry = {
  context: NormalizedBookingContext;
  organization: ResolvedOrganization;
  reservationId: string | null;
};

export type WebhookIngestSummary = {
  messages: number;
  inserted: number;
  merged: number;
  duplicates: number;
  skippedNoOrganization: number;
  viaFallbackOrganization: number;
  assumedUtcTimes: number;
  failedBookings: number;
};

export async function ingestBeds24WebhookMessages(args: {
  supabase: SupabaseClient<Database>;
  body: unknown;
  bookingPayloads: readonly Beds24JsonRecord[];
  results: readonly ProcessWebhookBookingResult[];
  organizationIdDefault: string | null;
  now?: Date;
}): Promise<WebhookIngestSummary> {
  const summary: WebhookIngestSummary = {
    messages: 0,
    inserted: 0,
    merged: 0,
    duplicates: 0,
    skippedNoOrganization: 0,
    viaFallbackOrganization: 0,
    assumedUtcTimes: 0,
    failedBookings: 0,
  };
  try {
    const now = args.now ?? new Date();
    const nowIso = now.toISOString();
    const messages = extractBeds24WebhookMessages(args.body, nowIso);
    summary.messages = messages.length;
    summary.assumedUtcTimes = warnAssumedUtcTimes(messages, "webhook");

    const resolveOrg = (externalPropertyId: string | null, externalRoomId: string | null) =>
      resolveMessageOrganization(args.supabase, { externalPropertyId, externalRoomId }, args.organizationIdDefault);

    const bookings = new Map<string, BookingEntry>();
    for (let index = 0; index < args.bookingPayloads.length; index += 1) {
      const context = readBookingContext(args.bookingPayloads[index]);
      if (!context || bookings.has(context.providerBookingId)) continue;
      const result = args.results[index];
      bookings.set(context.providerBookingId, {
        context,
        organization: await resolveOrg(context.externalPropertyId, context.externalRoomId),
        reservationId: result && result.ok ? result.reservationId ?? null : null,
      });
    }

    const touched = new Map<string, boolean>();
    for (const entry of bookings.values()) {
      const id = entry.organization.organizationId;
      if (id) touched.set(id, touched.get(id) ?? false);
    }

    for (const [providerBookingId, group] of groupMessagesByBooking(messages)) {
      const entry = bookings.get(providerBookingId) ?? null;
      const first = group[0];
      const context = entry?.context ?? group.find((message) => message.booking)?.booking ?? null;
      const organization = entry?.organization ?? (await resolveOrg(first.externalPropertyId, first.externalRoomId));
      const organizationId = organization.organizationId;
      if (!organizationId) {
        summary.skippedNoOrganization += group.length;
        console.warn("[guest-messages/webhook] no organization for booking — skipped", { providerBookingId, messages: group.length });
        continue;
      }
      if (organization.viaFallback) {
        summary.viaFallbackOrganization += 1;
        console.warn("[guest-messages/webhook] organization only from BEDS24_DEFAULT_ORGANIZATION_ID", { providerBookingId });
      }
      touched.set(organizationId, true);
      try {
        const seed = await resolveConversationSeed(args.supabase, {
          organizationId,
          providerBookingId,
          booking: context,
          externalPropertyId: first.externalPropertyId,
          externalRoomId: first.externalRoomId,
          reservationId: entry?.reservationId ?? null,
        });
        const result = await ingestConversationMessages(args.supabase, {
          organizationId,
          provider: "beds24",
          providerBookingId,
          seed,
          messages: group,
          now,
        });
        summary.inserted += result.inserted;
        summary.merged += result.merged;
        summary.duplicates += result.duplicates;
      } catch (error) {
        summary.failedBookings += 1;
        console.error("[guest-messages/webhook] booking ingest failed", {
          providerBookingId,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }

    for (const [organizationId, hadMessages] of touched) {
      await recordChannelState(args.supabase, organizationId, {
        last_webhook_at: nowIso,
        ...(hadMessages ? { last_message_webhook_at: nowIso } : {}),
      });
    }
  } catch (error) {
    console.error("[guest-messages/webhook] ingest failed", error instanceof Error ? error.message : "unknown");
  }
  return summary;
}
