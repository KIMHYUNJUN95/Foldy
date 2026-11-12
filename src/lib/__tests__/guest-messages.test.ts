import { describe, expect, it, vi } from "vitest";

import { createBeds24GuestMessageAdapter, outboundChannelRefusal } from "@/lib/guest-messages/beds24-adapter";
import {
  classifyGuestChannel,
  extractBeds24WebhookMessages,
  mapBeds24Source,
  parseBeds24Time,
  parseBeds24TimeDetailed,
  redactMessageAttachments,
  resolveOutboundChannel,
} from "@/lib/guest-messages/beds24-normalize";
import { effectiveCreditReserve, estimateBatchCost, knownRemainingCredit } from "@/lib/guest-messages/credit";
import {
  nextConversationState,
  planIngest,
  summarizeAddedMessages,
  type ApplyMessagesParams,
  type ConversationStateFields,
} from "@/lib/guest-messages/ingest-plan";
import { decideMessageOrganization, decideReconcileOrganization } from "@/lib/guest-messages/org-resolve";
import { processOutboxBatch, type OutboxRow } from "@/lib/guest-messages/outbox";
import { computeWaiting, responseTargetCategory, tokyoNightOverlapMs } from "@/lib/guest-messages/response-target";
import {
  DEFAULT_GUEST_MESSAGE_SETTINGS,
  readGuestMessageSettings,
  type GuestMessageChannelAdapter,
  type NormalizedMessage,
  type OutboundItem,
  type SendOutcome,
} from "@/lib/guest-messages/types";
import {
  MAX_CAPTURED_MESSAGES_CHARS,
  prepareCapturedMessagesPayload,
  shouldCaptureWebhookMessages,
} from "@/lib/guest-messages/webhook-ingest";

const RECEIVED = "2026-11-12T03:00:00.000Z";

/** Beds24 명세 `Webhooks - bookings` 봉투(실제 배달은 V1 에서 확인 전). */
const ENVELOPE = {
  timeStamp: "2026-11-12T03:00:00Z",
  booking: {
    id: 93328947,
    apiReference: "HMABC123",
    propertyId: 176431,
    roomId: 708660,
    arrival: "2026-11-20",
    departure: "2026-11-23",
    status: "confirmed",
    channel: "airbnb",
    firstName: "Jane",
    lastName: "Doe",
    lang: "EN",
  },
  invoiceItems: [],
  messages: [
    { id: 5001, bookingId: 93328947, time: "2026-11-12 02:10:00", read: false, source: "guest", message: "Hi, can we check in early?" },
    { id: 5002, bookingId: 93328947, time: "2026-11-12T02:20:00Z", read: true, source: "host", message: "Sure, from 14:00." },
  ],
};

function message(partial: Partial<NormalizedMessage> & { externalId: string }): NormalizedMessage {
  return {
    provider: "beds24",
    providerBookingId: "1",
    direction: "guest",
    providerSource: "guest",
    body: "hello",
    sentAt: "2026-11-12T00:00:00.000Z",
    timeAssumedUtc: false,
    read: false,
    attachments: [],
    externalPropertyId: null,
    externalRoomId: null,
    booking: null,
    ...partial,
  };
}

describe("Beds24 webhook → normalized messages", () => {
  it("reads the envelope messages with the sibling booking as context", () => {
    const messages = extractBeds24WebhookMessages(ENVELOPE, RECEIVED);
    expect(messages).toHaveLength(2);
    const [guest, host] = messages;
    expect(guest).toMatchObject({
      externalId: "5001",
      providerBookingId: "93328947",
      direction: "guest",
      sentAt: "2026-11-12T02:10:00.000Z",
      read: false,
      externalPropertyId: "176431",
    });
    expect(guest.booking).toMatchObject({
      providerBookingId: "93328947",
      channelReference: "HMABC123",
      channel: "airbnb",
      guestName: "Jane Doe",
      guestLanguage: "en",
      checkInDate: "2026-11-20",
      checkOutDate: "2026-11-23",
      bookingStatus: "confirmed",
    });
    expect(host.direction).toBe("host");
    expect(host.read).toBe(true);
  });

  it("reads messages nested inside the booking object and takes the booking id from it", () => {
    const body = { bookings: [{ ...ENVELOPE.booking, messages: [{ id: 7, source: "guest", message: "Where is the key?" }] }] };
    const [only] = extractBeds24WebhookMessages(body, RECEIVED);
    expect(only.providerBookingId).toBe("93328947");
    expect(only.sentAt).toBe(RECEIVED); // 시각이 없으면 받은 시각
  });

  it("drops messages without an id or booking, and empty bodies; never throws", () => {
    const body = {
      messages: [
        { bookingId: 1, source: "guest", message: "no id" },
        { id: 10, source: "guest", message: "no booking" },
        { id: 11, bookingId: 1, source: "guest", message: "   " },
        "not an object",
        null,
        { id: 12, bookingId: 1, source: "guest", message: "ok", time: "garbage" },
      ],
    };
    const messages = extractBeds24WebhookMessages(body, RECEIVED);
    expect(messages.map((m) => m.externalId)).toEqual(["12"]);
    expect(messages[0].sentAt).toBe(RECEIVED);
    expect(extractBeds24WebhookMessages("raw text", RECEIVED)).toEqual([]);
    expect(extractBeds24WebhookMessages(null, RECEIVED)).toEqual([]);
  });

  it("returns nothing for an empty messages array", () => {
    expect(extractBeds24WebhookMessages({ ...ENVELOPE, messages: [] }, RECEIVED)).toEqual([]);
  });

  it("maps unknown or missing source to system (never counts as a guest message)", () => {
    expect(mapBeds24Source("internalNote")).toBe("internal");
    expect(mapBeds24Source("SYSTEM")).toBe("system");
    expect(mapBeds24Source("ota-bot")).toBe("system");
    expect(mapBeds24Source(undefined)).toBe("system");
    const [m] = extractBeds24WebhookMessages({ messages: [{ id: 1, bookingId: 2, source: "weird", message: "x" }] }, RECEIVED);
    expect(m.direction).toBe("system");
    expect(m.providerSource).toBe("weird");
  });

  it("keeps one copy per message id across envelope levels, preferring the one with booking context", () => {
    const body = [
      { messages: [{ id: 5001, bookingId: 93328947, source: "guest", message: "dup" }] },
      ENVELOPE,
    ];
    const messages = extractBeds24WebhookMessages(body, RECEIVED);
    expect(messages.filter((m) => m.externalId === "5001")).toHaveLength(1);
    expect(messages.find((m) => m.externalId === "5001")?.booking).not.toBeNull();
  });

  it("records attachments without keeping inline data", () => {
    const [m] = extractBeds24WebhookMessages(
      { messages: [{ id: 1, bookingId: 2, source: "guest", message: "", attachment: "aGVsbG8=", attachmentName: "a.jpg", attachmentMimeType: "image/jpeg" }] },
      RECEIVED,
    );
    expect(m.attachments).toEqual([{ name: "a.jpg", mimeType: "image/jpeg", url: null, inline: true }]);
  });

  it("reads timezone-less times as UTC and flags them (V1 unverified)", () => {
    expect(parseBeds24TimeDetailed("2026-11-12 02:10:00")).toEqual({ iso: "2026-11-12T02:10:00.000Z", assumedUtc: true });
    expect(parseBeds24TimeDetailed("2026-11-12T02:10:00Z")).toEqual({ iso: "2026-11-12T02:10:00.000Z", assumedUtc: false });
    const [flagged, explicit] = extractBeds24WebhookMessages(ENVELOPE, RECEIVED);
    expect(flagged.timeAssumedUtc).toBe(true);
    expect(explicit.timeAssumedUtc).toBe(false);
  });

  it("parses Beds24 times defensively", () => {
    expect(parseBeds24Time("2026-11-12 02:10:00")).toBe("2026-11-12T02:10:00.000Z");
    expect(parseBeds24Time("2026-11-12T11:10:00+09:00")).toBe("2026-11-12T02:10:00.000Z");
    expect(parseBeds24Time(1_762_913_400)).toBe(new Date(1_762_913_400_000).toISOString());
    expect(parseBeds24Time("")).toBeNull();
    expect(parseBeds24Time({})).toBeNull();
  });

  it("classifies channels, treating Beds24 booking-page bookings as direct", () => {
    expect(classifyGuestChannel({ channel: "booking" })).toBe("booking");
    expect(classifyGuestChannel({ referer: "Booking.com" })).toBe("booking");
    expect(classifyGuestChannel({ referer: "Booking Page" })).toBe("direct");
    expect(classifyGuestChannel({ channel: "direct" })).toBe("direct");
    expect(classifyGuestChannel({ referer: "Airbnb", apiSource: "beds24" })).toBe("airbnb");
    expect(classifyGuestChannel({})).toBeNull();
  });

  it("no longer treats loose 'beds24' / 'iframe' substrings as a channel (allow-list, V4 finalizes)", () => {
    expect(classifyGuestChannel({ apiSource: "beds24" })).toBe("other");
    expect(classifyGuestChannel({ referer: "iframe widget" })).toBe("other");
    expect(classifyGuestChannel({ referer: "somebookingsite" })).toBe("other");
  });

  it("falls back to the reservation source when the conversation channel is unknown", () => {
    expect(resolveOutboundChannel(null, "Airbnb")).toBe("airbnb");
    expect(resolveOutboundChannel("other", "Booking.com")).toBe("booking");
    expect(resolveOutboundChannel(null, "beds24")).toBeNull();
    expect(resolveOutboundChannel("airbnb", "Booking.com")).toBe("airbnb");
  });
});

describe("planIngest — dedupe and host echo merge", () => {
  it("skips ids already stored and repeats within the batch", () => {
    const plan = planIngest({
      incoming: [message({ externalId: "1" }), message({ externalId: "2" }), message({ externalId: "2" })],
      existingExternalIds: new Set(["1"]),
      sentOutbox: [],
    });
    expect(plan.inserts.map((m) => m.externalId)).toEqual(["2"]);
    expect(plan.duplicates).toBe(2);
  });

  it("merges a host echo into the sent outbox row by external id", () => {
    const plan = planIngest({
      incoming: [message({ externalId: "900", direction: "host", body: "Sure" })],
      existingExternalIds: new Set(),
      sentOutbox: [{ id: "ob1", external_id: "900", body: "different text", sent_at: "2026-11-12T00:00:00Z" }],
    });
    expect(plan.inserts).toHaveLength(0);
    expect(plan.echoMerges).toEqual([expect.objectContaining({ outboxId: "ob1", matchedBy: "external_id" })]);
  });

  it("falls back to body + time match when the send returned no id; guest messages never merge", () => {
    const plan = planIngest({
      incoming: [
        message({ externalId: "901", direction: "host", body: "See you  at 3pm", sentAt: "2026-11-12T01:00:00Z" }),
        message({ externalId: "902", direction: "guest", body: "See you at 3pm" }),
      ],
      existingExternalIds: new Set(),
      sentOutbox: [{ id: "ob2", external_id: null, body: "See you at 3pm", sent_at: "2026-11-12T00:59:00Z" }],
    });
    expect(plan.echoMerges).toEqual([expect.objectContaining({ outboxId: "ob2", matchedBy: "body" })]);
    expect(plan.inserts.map((m) => m.externalId)).toEqual(["902"]);
  });

  it("reports already-stored unread messages that the channel now says are read", () => {
    const plan = planIngest({
      incoming: [message({ externalId: "1", read: true }), message({ externalId: "2", read: true })],
      existingExternalIds: new Set(["1", "2"]),
      existingUnreadExternalIds: new Set(["1"]),
      sentOutbox: [],
    });
    expect(plan.markReadExternalIds).toEqual(["1"]);
  });

  it("merges echoes into outbox rows still sending / uncertain without sent_at (race with the worker)", () => {
    const plan = planIngest({
      incoming: [message({ externalId: "950", direction: "host", body: "On my way", sentAt: "2026-11-12T01:00:00Z" })],
      existingExternalIds: new Set(),
      sentOutbox: [{ id: "ob9", status: "uncertain", external_id: null, body: "On my way", sent_at: null, created_at: "2026-11-12T00:58:00Z" }],
    });
    expect(plan.echoMerges).toEqual([expect.objectContaining({ outboxId: "ob9", matchedBy: "body" })]);
  });

  it("does not body-match an old outbox row outside the window", () => {
    const plan = planIngest({
      incoming: [message({ externalId: "903", direction: "host", body: "ok", sentAt: "2026-11-12T00:00:00Z" })],
      existingExternalIds: new Set(),
      sentOutbox: [{ id: "ob3", external_id: null, body: "ok", sent_at: "2026-11-09T00:00:00Z" }],
    });
    expect(plan.echoMerges).toHaveLength(0);
    expect(plan.inserts).toHaveLength(1);
  });
});

describe("conversation state (mirror of guest_conversation_apply_messages)", () => {
  const base: ConversationStateFields = {
    status: "done",
    snooze_until: null,
    last_guest_at: null,
    last_reply_at: null,
    last_message_at: null,
  };
  const now = new Date("2026-11-12T03:00:00Z");
  const p = (partial: Partial<ApplyMessagesParams>): ApplyMessagesParams => ({
    guestAt: null,
    unreadGuestAt: null,
    replyAt: null,
    messageAt: null,
    ...partial,
  });

  it("a new unread guest message sets awaiting", () => {
    const next = nextConversationState(base, p({ guestAt: "2026-11-12T02:00:00Z", unreadGuestAt: "2026-11-12T02:00:00Z" }), now);
    expect(next).toMatchObject({ status: "awaiting", last_guest_at: "2026-11-12T02:00:00Z" });
  });

  it("an active snooze stays snoozed; an expired snooze goes back to awaiting", () => {
    const guest = p({ guestAt: "2026-11-12T02:00:00Z", unreadGuestAt: "2026-11-12T02:00:00Z" });
    const snoozed = { ...base, status: "snoozed" as const, snooze_until: "2026-11-12T05:00:00Z" };
    expect(nextConversationState(snoozed, guest, now).status).toBe("snoozed");
    const expired = { ...snoozed, snooze_until: "2026-11-12T01:00:00Z" };
    expect(nextConversationState(expired, guest, now)).toMatchObject({ status: "awaiting", snooze_until: null });
  });

  it("a reply to an expired snooze closes it (shown as awaiting); an active snooze stays snoozed", () => {
    const reply = p({ replyAt: "2026-11-12T03:00:00Z", messageAt: "2026-11-12T03:00:00Z" });
    const expired = { ...base, status: "snoozed" as const, snooze_until: "2026-11-12T01:00:00Z", last_guest_at: "2026-11-12T02:00:00Z" };
    expect(nextConversationState(expired, reply, now)).toMatchObject({ status: "done", snooze_until: null });
    const active = { ...expired, snooze_until: "2026-11-12T05:00:00Z" };
    expect(nextConversationState(active, reply, now)).toMatchObject({ status: "snoozed", snooze_until: "2026-11-12T05:00:00Z" });
  });

  it("a host reply after the last guest message closes awaiting; internal notes do not", () => {
    const waiting = { ...base, status: "awaiting" as const, last_guest_at: "2026-11-12T02:00:00Z" };
    expect(nextConversationState(waiting, p({ messageAt: "2026-11-12T02:30:00Z" }), now).status).toBe("awaiting");
    const replied = nextConversationState(waiting, p({ replyAt: "2026-11-12T02:30:00Z" }), now);
    expect(replied).toMatchObject({ status: "done", last_reply_at: "2026-11-12T02:30:00Z" });
  });

  it("a staff 'done' is not reverted by the same or older guest message arriving again (full history webhooks)", () => {
    const staffDone = { ...base, status: "done" as const, last_guest_at: "2026-11-12T02:00:00Z" };
    const again = p({ guestAt: "2026-11-12T02:00:00Z", unreadGuestAt: "2026-11-12T02:00:00Z" });
    expect(nextConversationState(staffDone, again, now).status).toBe("done");
    const newer = p({ guestAt: "2026-11-12T02:40:00Z", unreadGuestAt: "2026-11-12T02:40:00Z" });
    expect(nextConversationState(staffDone, newer, now).status).toBe("awaiting");
  });

  it("never moves timestamps backwards", () => {
    const current = { ...base, last_guest_at: "2026-11-12T02:00:00Z", last_reply_at: "2026-11-12T02:10:00Z", last_message_at: "2026-11-12T02:10:00Z" };
    const next = nextConversationState(current, p({ guestAt: "2026-11-11T00:00:00Z", replyAt: "2026-11-11T00:00:00Z", messageAt: "2026-11-11T00:00:00Z" }), now);
    expect(next).toMatchObject({ last_guest_at: "2026-11-12T02:00:00Z", last_reply_at: "2026-11-12T02:10:00Z", last_message_at: "2026-11-12T02:10:00Z" });
  });

  it("an older guest message arriving late (reconcile) does not reopen a replied conversation", () => {
    const replied = { ...base, last_guest_at: "2026-11-12T01:00:00Z", last_reply_at: "2026-11-12T02:00:00Z" };
    expect(nextConversationState(replied, p({ guestAt: "2026-11-12T01:30:00Z", unreadGuestAt: "2026-11-12T01:30:00Z" }), now).status).toBe("done");
  });
});

describe("summarizeAddedMessages — first webhook flood", () => {
  const now = new Date("2026-11-12T03:00:00Z");

  it("guest messages already read in Beds24 do not create waiting", () => {
    const params = summarizeAddedMessages(
      [{ direction: "guest", sentAt: "2026-11-12T02:00:00Z", read: true }],
      { isNewConversation: false, now },
    );
    expect(params).toEqual({ guestAt: "2026-11-12T02:00:00Z", unreadGuestAt: null, replyAt: null, messageAt: "2026-11-12T02:00:00Z" });
  });

  it("a new conversation whose newest unread guest message is older than 48h stays done", () => {
    const old = [{ direction: "guest" as const, sentAt: "2026-11-09T00:00:00Z", read: false }];
    expect(summarizeAddedMessages(old, { isNewConversation: true, now }).unreadGuestAt).toBeNull();
    // 이미 있던 대화라면 옛 메시지라도 그대로 넘긴다(DB 함수가 「새」 것인지 판정)
    expect(summarizeAddedMessages(old, { isNewConversation: false, now }).unreadGuestAt).toBe("2026-11-09T00:00:00Z");
    const recent = [{ direction: "guest" as const, sentAt: "2026-11-11T12:00:00Z", read: false }];
    expect(summarizeAddedMessages(recent, { isNewConversation: true, now }).unreadGuestAt).toBe("2026-11-11T12:00:00Z");
  });

  it("internal and system lines only move last_message_at", () => {
    const params = summarizeAddedMessages(
      [
        { direction: "internal", sentAt: "2026-11-12T02:30:00Z", read: false },
        { direction: "system", sentAt: "2026-11-12T02:40:00Z", read: false },
      ],
      { isNewConversation: false, now },
    );
    expect(params).toEqual({ guestAt: null, unreadGuestAt: null, replyAt: null, messageAt: "2026-11-12T02:40:00Z" });
  });
});

function row(partial: Partial<OutboxRow> & { id: string }): OutboxRow {
  return {
    kind: "reply",
    status: "queued",
    attempts: 0,
    next_try_at: "2026-11-12T00:00:00Z",
    created_at: "2026-11-12T00:00:00Z",
    body: "hello",
    provider_booking_id: "123",
    channel: "airbnb",
    ...partial,
  };
}

function fakeAdapter(outcome: (items: OutboundItem[]) => SendOutcome) {
  const calls: OutboundItem[][] = [];
  const adapter: Pick<GuestMessageChannelAdapter, "send"> = {
    send: async (items) => {
      calls.push(items);
      return outcome(items);
    },
  };
  return { adapter, calls };
}

const okOutcome = (remaining: number | null = 90) => (items: OutboundItem[]): SendOutcome => ({
  kind: "sent",
  items: items.map((item) => ({ outboxId: item.outboxId, ok: true, externalId: `x-${item.outboxId}` })),
  credit: { remaining, resetsAt: null, requestCost: 1 },
});

describe("processOutboxBatch", () => {
  const now = new Date("2026-11-12T03:00:00Z");
  const unknownCredit = { remaining: null, resetsAt: null, requestCost: null };

  it("sends staff replies before auto messages, skipping rows not yet due", async () => {
    const { adapter, calls } = fakeAdapter(okOutcome());
    const result = await processOutboxBatch({
      rows: [
        row({ id: "a1", kind: "auto", created_at: "2026-11-11T00:00:00Z" }),
        row({ id: "r1", kind: "reply", created_at: "2026-11-12T01:00:00Z" }),
        row({ id: "r2", kind: "reply", next_try_at: "2026-11-12T04:00:00Z" }),
      ],
      adapter,
      creditReserve: 20,
      credit: unknownCredit,
      now,
    });
    expect(calls.map((c) => c.map((i) => i.outboxId))).toEqual([["r1"], ["a1"]]);
    expect(result.updates.map((u) => [u.id, u.status, u.external_id])).toEqual([
      ["r1", "sent", "x-r1"],
      ["a1", "sent", "x-a1"],
    ]);
  });

  it("holds auto messages below the credit reserve but still sends staff replies", async () => {
    const { adapter, calls } = fakeAdapter(okOutcome(15));
    const result = await processOutboxBatch({
      rows: [row({ id: "r1" }), row({ id: "a1", kind: "auto" })],
      adapter,
      creditReserve: 20,
      credit: { remaining: 25, resetsAt: now.getTime() + 120_000, requestCost: 1 },
      now,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0][0].outboxId).toBe("r1");
    expect(result.stoppedReason).toBe("credit_reserve");
    expect(result.deferredIds).toEqual(["a1"]);
  });

  it("estimates auto batch cost per item and never uses a reserve below the account low-credit line", async () => {
    // 남은 30 · 선 20 · 자동 안내 12건 → 30 − 12 < 20 이라 미룬다(건당 비용 1, 묶음 비용을 1 로 보지 않는다).
    const many = Array.from({ length: 12 }, (_, i) => row({ id: `a${i}`, kind: "auto" }));
    const first = fakeAdapter(okOutcome());
    const held = await processOutboxBatch({
      rows: many,
      adapter: first.adapter,
      creditReserve: 20,
      credit: { remaining: 30, resetsAt: now.getTime() + 60_000, requestCost: 1 },
      now,
    });
    expect(first.calls).toHaveLength(0);
    expect(held.stoppedReason).toBe("credit_reserve");
    // 설정 선이 0 이어도 계정 저크레딧 선(10)은 지킨다.
    const second = fakeAdapter(okOutcome());
    await processOutboxBatch({
      rows: [row({ id: "a1", kind: "auto" })],
      adapter: second.adapter,
      creditReserve: 0,
      credit: { remaining: 10, resetsAt: now.getTime() + 60_000, requestCost: 1 },
      now,
    });
    expect(second.calls).toHaveLength(0);
  });

  it("ignores a stale remaining-credit reading after the window reset, or with no reset time", async () => {
    const { adapter, calls } = fakeAdapter(okOutcome());
    await processOutboxBatch({
      rows: [row({ id: "a1", kind: "auto" })],
      adapter,
      creditReserve: 20,
      credit: { remaining: 3, resetsAt: now.getTime() - 1000, requestCost: 1 },
      now,
    });
    await processOutboxBatch({
      rows: [row({ id: "a2", kind: "auto" })],
      adapter,
      creditReserve: 20,
      credit: { remaining: 3, resetsAt: null, requestCost: 1 },
      now,
    });
    expect(calls).toHaveLength(2);
  });

  it("on 429 re-queues the batch after retry-after (attempts unchanged) and stops", async () => {
    const { adapter, calls } = fakeAdapter(() => ({
      kind: "rate_limited",
      retryAfterSec: 120,
      credit: { remaining: 0, resetsAt: now.getTime() + 118_000, requestCost: null },
      items: [],
    }));
    const result = await processOutboxBatch({
      rows: [row({ id: "r1", attempts: 2 }), row({ id: "a1", kind: "auto" })],
      adapter,
      creditReserve: 20,
      credit: unknownCredit,
      now,
    });
    expect(calls).toHaveLength(1);
    expect(result.stoppedReason).toBe("rate_limited");
    expect(result.updates).toEqual([
      expect.objectContaining({ id: "r1", status: "queued", attempts: 2, error_code: "rate_limited", next_try_at: "2026-11-12T03:02:00.000Z" }),
    ]);
    expect(result.deferredIds).toEqual(["a1"]);
  });

  it("does not re-send after the request went out: network error / 5xx become uncertain", async () => {
    for (const errorCode of ["request_error", "http_502"]) {
      const { adapter } = fakeAdapter(() => ({ kind: "failed", phase: "uncertain", errorCode, credit: null, items: [] }));
      const result = await processOutboxBatch({ rows: [row({ id: "r1", attempts: 0 })], adapter, creditReserve: 20, credit: unknownCredit, now });
      expect(result.updates).toEqual([expect.objectContaining({ id: "r1", status: "uncertain", attempts: 1, error_code: errorCode })]);
    }
  });

  it("a row missing from a 2xx response is uncertain, not sent", async () => {
    const { adapter } = fakeAdapter((items) => ({
      kind: "sent",
      items: [{ outboxId: items[0].outboxId, ok: false, reason: "uncertain" }],
      credit: unknownCredit,
    }));
    const result = await processOutboxBatch({ rows: [row({ id: "r1" })], adapter, creditReserve: 20, credit: unknownCredit, now });
    expect(result.updates).toEqual([expect.objectContaining({ id: "r1", status: "uncertain" })]);
  });

  it("pre-send failures (env / token) re-queue without counting an attempt and stop the round", async () => {
    const { adapter, calls } = fakeAdapter(() => ({ kind: "failed", phase: "pre_send", errorCode: "guest-messages:missing-token", credit: null, items: [] }));
    const result = await processOutboxBatch({
      rows: [row({ id: "r1", attempts: 3 }), row({ id: "a1", kind: "auto" })],
      adapter,
      creditReserve: 20,
      credit: unknownCredit,
      now,
    });
    expect(calls).toHaveLength(1);
    expect(result.updates).toEqual([
      expect.objectContaining({ id: "r1", status: "queued", attempts: 3, next_try_at: "2026-11-12T03:05:00.000Z" }),
    ]);
    expect(result.stoppedReason).toBe("pre_send");
    expect(result.deferredIds).toEqual(["a1"]);
  });

  it("a 4xx rejection fails without retry", async () => {
    const { adapter } = fakeAdapter(() => ({ kind: "failed", phase: "rejected", errorCode: "http_400", credit: null, items: [] }));
    const result = await processOutboxBatch({ rows: [row({ id: "r1" })], adapter, creditReserve: 20, credit: unknownCredit, now });
    expect(result.updates).toEqual([expect.objectContaining({ id: "r1", status: "failed", error_code: "http_400" })]);
  });

  it("direct and unknown-channel bookings are refused by the Beds24 adapter without calling Beds24", async () => {
    const fetchImpl = vi.fn();
    const adapter = createBeds24GuestMessageAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolveToken: async () => ({ ok: true, token: "t" }),
      baseUrl: "https://beds24.test/api/v2",
      gate: async () => ({ blocked: false }),
    });
    const result = await processOutboxBatch({
      rows: [row({ id: "d1", channel: "direct" }), row({ id: "u1", channel: null }), row({ id: "o1", channel: "other" })],
      adapter,
      creditReserve: 20,
      credit: unknownCredit,
      now,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.updates.map((u) => [u.id, u.status, u.error_code])).toEqual([
      ["d1", "failed", "direct_booking"],
      ["u1", "failed", "unknown_channel"],
      ["o1", "failed", "unknown_channel"],
    ]);
  });
});

describe("credit helpers", () => {
  const nowMs = Date.parse("2026-11-12T03:00:00Z");
  it("known remaining is null when the reset time is unknown or past", () => {
    expect(knownRemainingCredit({ remaining: 50, resetsAt: nowMs + 1, requestCost: 1 }, nowMs)).toBe(50);
    expect(knownRemainingCredit({ remaining: 50, resetsAt: null, requestCost: 1 }, nowMs)).toBeNull();
    expect(knownRemainingCredit({ remaining: 50, resetsAt: nowMs, requestCost: 1 }, nowMs)).toBeNull();
    expect(knownRemainingCredit(null, nowMs)).toBeNull();
  });
  it("reserve and cost estimates", () => {
    expect(effectiveCreditReserve(20)).toBe(20);
    expect(effectiveCreditReserve(3)).toBe(10);
    expect(estimateBatchCost(5, null)).toBe(5);
    expect(estimateBatchCost(5, 2)).toBe(10);
    expect(estimateBatchCost(0, null)).toBe(1);
  });
  it("only allow-listed OTA channels may be sent to", () => {
    expect(outboundChannelRefusal("airbnb")).toBeNull();
    expect(outboundChannelRefusal("booking")).toBeNull();
    expect(outboundChannelRefusal("direct")).toBe("direct_booking");
    expect(outboundChannelRefusal(null)).toBe("unknown_channel");
    expect(outboundChannelRefusal("other")).toBe("unknown_channel");
  });
});

describe("Beds24 adapter send / markRead", () => {
  const nowMs = Date.parse("2026-11-12T03:00:00Z");
  const open = async () => ({ blocked: false as const });

  function response(status: number, json: unknown, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json", ...headers } });
  }

  function adapterWith(fetchImpl: unknown, extra: Partial<Parameters<typeof createBeds24GuestMessageAdapter>[0]> = {}) {
    return createBeds24GuestMessageAdapter({
      fetchImpl: fetchImpl as typeof fetch,
      resolveToken: async () => ({ ok: true, token: "t" }),
      baseUrl: "https://beds24.test/api/v2/",
      now: () => nowMs,
      gate: open,
      ...extra,
    });
  }

  it("posts one array, reads new ids, marks missing rows uncertain and records credit headers", async () => {
    const onCredit = vi.fn();
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual([
        { bookingId: 111, message: "a" },
        { bookingId: 222, message: "b" },
        { bookingId: 333, message: "c" },
      ]);
      return response(200, [{ success: true, new: { id: 9001 } }, { success: false, errors: [{ message: "not allowed" }] }], {
        "x-five-min-limit-remaining": "88",
        "x-five-min-limit-resets-in": "200",
        "x-request-cost": "1",
      });
    });
    const outcome = await adapterWith(fetchImpl, { onCredit }).send([
      { outboxId: "o1", providerBookingId: "111", body: "a", channel: "airbnb" },
      { outboxId: "o2", providerBookingId: "222", body: "b", channel: "booking" },
      { outboxId: "o3", providerBookingId: "333", body: "c", channel: "expedia" },
    ]);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://beds24.test/api/v2/bookings/messages");
    expect(outcome.kind).toBe("sent");
    expect(outcome.items).toEqual([
      { outboxId: "o1", ok: true, externalId: "9001" },
      { outboxId: "o2", ok: false, reason: "provider_rejected", detail: "not allowed" },
      { outboxId: "o3", ok: false, reason: "uncertain" },
    ]);
    expect(onCredit).toHaveBeenCalledWith({ remaining: 88, resetsAt: nowMs + 200_000, requestCost: 1 });
  });

  it("network errors and 5xx after sending are uncertain; 4xx is rejected", async () => {
    const thrown = await adapterWith(async () => {
      throw new Error("socket hang up");
    }).send([{ outboxId: "o1", providerBookingId: "111", body: "a", channel: "airbnb" }]);
    expect(thrown).toMatchObject({ kind: "failed", phase: "uncertain", errorCode: "request_error" });
    const fiveHundred = await adapterWith(async () => response(503, {})).send([{ outboxId: "o1", providerBookingId: "111", body: "a", channel: "airbnb" }]);
    expect(fiveHundred).toMatchObject({ kind: "failed", phase: "uncertain", errorCode: "http_503" });
    const bad = await adapterWith(async () => response(400, {})).send([{ outboxId: "o1", providerBookingId: "111", body: "a", channel: "airbnb" }]);
    expect(bad).toMatchObject({ kind: "failed", phase: "rejected", errorCode: "http_400" });
  });

  it("429 returns retry-after from resets-in and triggers the account cooldown", async () => {
    const onRateLimited = vi.fn();
    const adapter = adapterWith(
      async () =>
        response(429, { error: "Usage limit exceeded in last 5 minutes" }, {
          "x-five-min-limit-remaining": "0",
          "x-five-min-limit-resets-in": "40",
        }),
      { onRateLimited },
    );
    const send = await adapter.send([{ outboxId: "o1", providerBookingId: "111", body: "a", channel: "booking" }]);
    expect(send).toMatchObject({ kind: "rate_limited", retryAfterSec: 42 });
    expect(onRateLimited).toHaveBeenCalledWith(40);
    const read = await adapter.markRead(["5001"]);
    expect(read).toMatchObject({ kind: "rate_limited", retryAfterSec: 42 });
  });

  it("does not call Beds24 while paused or cooling down (gate)", async () => {
    const fetchImpl = vi.fn();
    const adapter = adapterWith(fetchImpl, { gate: async () => ({ blocked: true, retryAfterSec: 90, reason: "cooldown" }) });
    const send = await adapter.send([{ outboxId: "o1", providerBookingId: "111", body: "a", channel: "airbnb" }]);
    expect(send).toMatchObject({ kind: "rate_limited", retryAfterSec: 90 });
    expect(await adapter.markRead(["1"])).toMatchObject({ kind: "rate_limited", retryAfterSec: 90 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails before sending without a token and never calls Beds24", async () => {
    const fetchImpl = vi.fn();
    const outcome = await adapterWith(fetchImpl, {
      resolveToken: async () => ({ ok: false, skipped: "guest-messages:missing-token" }),
    }).send([{ outboxId: "o1", providerBookingId: "111", body: "a", channel: "airbnb" }]);
    expect(outcome).toMatchObject({ kind: "failed", phase: "pre_send", errorCode: "guest-messages:missing-token" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("organization routing", () => {
  const A = "org-a";
  const B = "org-b";
  it("flags organizations decided only by the default fallback", () => {
    expect(decideMessageOrganization([A], B)).toEqual({ organizationId: A, viaFallback: false });
    expect(decideMessageOrganization([], B)).toEqual({ organizationId: B, viaFallback: true });
    expect(decideMessageOrganization([], null)).toEqual({ organizationId: null, viaFallback: false });
  });
  it("reconcile: mapping wins, an existing conversation in another org is a mismatch (skipped)", () => {
    expect(decideReconcileOrganization({ mapped: [A], existing: [A], fallback: null })).toEqual({ organizationId: A, viaFallback: false, mismatch: false });
    expect(decideReconcileOrganization({ mapped: [A], existing: [B], fallback: null })).toEqual({ organizationId: null, viaFallback: false, mismatch: true });
    expect(decideReconcileOrganization({ mapped: [], existing: [B], fallback: A })).toEqual({ organizationId: B, viaFallback: false, mismatch: false });
    expect(decideReconcileOrganization({ mapped: [], existing: [A, B], fallback: null })).toMatchObject({ organizationId: null, mismatch: true });
    expect(decideReconcileOrganization({ mapped: [], existing: [], fallback: A })).toEqual({ organizationId: A, viaFallback: true, mismatch: false });
  });
});

describe("computeWaiting (Tokyo)", () => {
  const settings = { responseTargetMinutes: DEFAULT_GUEST_MESSAGE_SETTINGS.responseTargetMinutes, nightPause: false };
  const conv = {
    status: "awaiting" as const,
    snooze_until: null,
    last_guest_at: "2026-11-12T01:00:00Z", // 도쿄 10:00
    last_reply_at: null,
    booking_status: "confirmed",
    check_in_date: "2026-11-20",
    check_out_date: "2026-11-23",
  };

  it("counts minutes since the last guest message against the category target", () => {
    const result = computeWaiting(conv, settings, new Date("2026-11-12T01:45:00Z"));
    expect(result).toEqual({ waitingMinutes: 45, targetMinutes: 120, ratio: 45 / 120, overdue: false });
    const inquiry = computeWaiting({ ...conv, booking_status: "inquiry" }, settings, new Date("2026-11-12T01:45:00Z"));
    expect(inquiry).toMatchObject({ targetMinutes: 30, overdue: true });
  });

  it("is zero when replied, done, or snoozed into the future; restarts from an expired snooze", () => {
    const now = new Date("2026-11-12T03:00:00Z");
    expect(computeWaiting({ ...conv, last_reply_at: "2026-11-12T01:10:00Z" }, settings, now).waitingMinutes).toBe(0);
    expect(computeWaiting({ ...conv, status: "done" }, settings, now).waitingMinutes).toBe(0);
    expect(computeWaiting({ ...conv, status: "snoozed", snooze_until: "2026-11-12T04:00:00Z" }, settings, now).waitingMinutes).toBe(0);
    expect(computeWaiting({ ...conv, status: "snoozed", snooze_until: "2026-11-12T02:30:00Z" }, settings, now).waitingMinutes).toBe(30);
  });

  it("classifies staying by Tokyo date, not UTC date", () => {
    // 2026-11-19T15:30Z = 도쿄 11-20 00:30 → 숙박 중(UTC 날짜로는 아직 19일)
    expect(responseTargetCategory(conv, new Date("2026-11-19T15:30:00Z"))).toBe("staying");
    expect(responseTargetCategory(conv, new Date("2026-11-19T14:30:00Z"))).toBe("other");
    // 체크아웃 날(도쿄)은 숙박 중이 아니다
    expect(responseTargetCategory(conv, new Date("2026-11-23T00:30:00Z"))).toBe("other");
  });

  it("night pause skips 23:00–07:00 Tokyo across midnight", () => {
    // 도쿄 22:00 → 다음 날 08:00 = 10시간, 밤 8시간 제외 → 120분
    const night = { ...conv, last_guest_at: "2026-11-12T13:00:00Z" };
    const now = new Date("2026-11-12T23:00:00Z");
    expect(computeWaiting(night, settings, now).waitingMinutes).toBe(600);
    expect(computeWaiting(night, { ...settings, nightPause: true }, now).waitingMinutes).toBe(120);
  });

  it("night pause crosses a month boundary in Tokyo (10/31 → 11/1)", () => {
    // 도쿄 10-31 22:30 = UTC 10-31 13:30, 도쿄 11-01 07:30 = UTC 10-31 22:30 → 9시간, 밤 8시간 → 60분
    const night = { ...conv, last_guest_at: "2026-10-31T13:30:00Z" };
    const result = computeWaiting(night, { ...settings, nightPause: true }, new Date("2026-10-31T22:30:00Z"));
    expect(result.waitingMinutes).toBe(60);
  });

  it("night overlap over several days and fully inside the night", () => {
    // 도쿄 11-12 00:00 ~ 11-14 00:00(48시간) — 밤: 12일 0~7, 12일 23~13일 7, 13일 23~24 = 7+8+1 = 16시간
    const start = Date.parse("2026-11-12T00:00:00+09:00");
    const end = Date.parse("2026-11-14T00:00:00+09:00");
    expect(tokyoNightOverlapMs(start, end)).toBe(16 * 3_600_000);
    const inside = computeWaiting(
      { ...conv, last_guest_at: "2026-11-12T15:00:00Z" }, // 도쿄 00:00
      { ...settings, nightPause: true },
      new Date("2026-11-12T17:00:00Z"), // 도쿄 02:00
    );
    expect(inside.waitingMinutes).toBe(0);
  });
});

describe("settings + capture flag", () => {
  it("reads settings with defaults for missing or bad values", () => {
    expect(readGuestMessageSettings(null)).toEqual(DEFAULT_GUEST_MESSAGE_SETTINGS);
    const settings = readGuestMessageSettings({
      settings: { responseTargetMinutes: { inquiry: 15, staying: -1, other: "x" } },
      night_pause: true,
      credit_reserve: 30,
      stall_hours: 6,
    });
    expect(settings.responseTargetMinutes).toEqual({ inquiry: 15, request: 30, staying: 60, other: 120 });
    expect(settings).toMatchObject({ nightPause: true, creditReserve: 30, stallHours: 6 });
  });

  it("captured payloads keep only attachment lengths and are size-capped", () => {
    const body = { messages: [{ id: 1, bookingId: 2, source: "guest", message: "pic", attachment: "A".repeat(500), attachmentName: "a.jpg" }] };
    const captured = prepareCapturedMessagesPayload(body) as { messages: Array<Record<string, unknown>> };
    expect(captured.messages[0].attachment).toEqual({ redactedLength: 500 });
    expect(captured.messages[0].attachmentName).toBe("a.jpg");
    expect(body.messages[0].attachment).toHaveLength(500); // 원본은 그대로
    expect(redactMessageAttachments("x")).toBe("x");
    const huge = { messages: [{ id: 1, bookingId: 2, source: "guest", message: "x".repeat(MAX_CAPTURED_MESSAGES_CHARS + 10) }] };
    expect(prepareCapturedMessagesPayload(huge)).toMatchObject({ truncated: true });
  });

  it("captures raw payloads only when the flag is 1 and messages are present", () => {
    expect(shouldCaptureWebhookMessages(ENVELOPE, "1")).toBe(true);
    expect(shouldCaptureWebhookMessages(ENVELOPE, undefined)).toBe(false);
    expect(shouldCaptureWebhookMessages(ENVELOPE, "0")).toBe(false);
    expect(shouldCaptureWebhookMessages({ ...ENVELOPE, messages: [] }, "1")).toBe(false);
    expect(shouldCaptureWebhookMessages({ booking: { id: 1 } }, "1")).toBe(false);
  });
});

describe("webhook ingest never throws", () => {
  it("swallows database failures so reservation processing is unaffected", async () => {
    const { ingestBeds24WebhookMessages } = await import("@/lib/guest-messages/webhook-ingest");
    const broken = {
      from: () => {
        throw new Error("db down");
      },
    } as unknown as Parameters<typeof ingestBeds24WebhookMessages>[0]["supabase"];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      ingestBeds24WebhookMessages({
        supabase: broken,
        body: ENVELOPE,
        bookingPayloads: [ENVELOPE.booking],
        results: [],
        organizationIdDefault: "00000000-0000-4000-8000-000000000001",
      }),
    ).resolves.toMatchObject({ messages: 2 });
    errorSpy.mockRestore();
  });
});

// ── store: 가짜 Supabase 로 쓰기 순서 · 오류 처리 · 조직 필터 확인 ────────────────
type Call = { table: string; op: string; filters: Array<[string, string, unknown]>; payload?: unknown; options?: unknown };
type Reply = { data?: unknown; error?: { message: string; code?: string } | null };

function fakeSupabase(handler: (call: Call) => Reply) {
  const calls: Call[] = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const builder = (table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    const run = () => {
      calls.push(call);
      const reply = handler(call);
      return { data: reply.data ?? null, error: reply.error ?? null };
    };
    const b: Record<string, unknown> = {};
    const chain = (name: string) => (...args: unknown[]) => {
      if (["insert", "upsert", "update", "delete"].includes(name)) {
        call.op = name;
        call.payload = args[0];
        call.options = args[1];
      } else if (["eq", "in", "is", "gte", "filter"].includes(name)) {
        call.filters.push(name === "filter" ? [String(args[0]), String(args[1]), args[2]] : [String(args[0]), name, args[1]]);
      }
      return b;
    };
    for (const name of ["select", "eq", "in", "is", "gte", "filter", "limit", "order", "insert", "upsert", "update", "delete"]) b[name] = chain(name);
    b.maybeSingle = async () => run();
    b.single = async () => run();
    b.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject);
    return b;
  };
  const client = {
    from: (table: string) => builder(table),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: [], error: null };
    },
  };
  return { client: client as unknown as Parameters<typeof import("@/lib/guest-messages/store").ingestConversationMessages>[0], calls, rpcCalls };
}

describe("ingestConversationMessages (fake DB)", () => {
  const ORG = "00000000-0000-4000-8000-0000000000aa";
  const now = new Date("2026-11-12T03:00:00Z");
  const conversationRow = {
    id: "conv-1",
    status: "done",
    snooze_until: null,
    last_guest_at: null,
    last_reply_at: null,
    last_message_at: null,
  };

  it("filters by organization, upserts on (organization_id, provider, external_id), fills read_at for duplicates, applies state via RPC", async () => {
    const { ingestConversationMessages, EMPTY_SEED } = await import("@/lib/guest-messages/store");
    const { client, calls, rpcCalls } = fakeSupabase((call) => {
      if (call.table === "guest_conversations" && call.op === "select") return { data: conversationRow };
      if (call.table === "guest_messages" && call.op === "select") return { data: [{ external_id: "1", read_at: null }] };
      if (call.table === "guest_messages" && call.op === "upsert") return { data: [{ external_id: "2" }] };
      if (call.table === "guest_messages" && call.op === "update") return { data: [{ id: "m1" }] };
      return { data: [] };
    });
    const result = await ingestConversationMessages(client, {
      organizationId: ORG,
      provider: "beds24",
      providerBookingId: "93328947",
      seed: EMPTY_SEED,
      messages: [
        message({ externalId: "1", read: true, sentAt: "2026-11-12T02:00:00Z" }),
        message({ externalId: "2", read: false, sentAt: "2026-11-12T02:30:00Z" }),
      ],
      now,
    });
    const existing = calls.find((c) => c.table === "guest_messages" && c.op === "select")!;
    expect(existing.filters).toContainEqual(["organization_id", "eq", ORG]);
    const upsert = calls.find((c) => c.op === "upsert")!;
    expect(upsert.options).toMatchObject({ onConflict: "organization_id,provider,external_id", ignoreDuplicates: true });
    const readUpdate = calls.find((c) => c.table === "guest_messages" && c.op === "update")!;
    expect(readUpdate.filters).toContainEqual(["external_id", "in", ["1"]]);
    expect(readUpdate.filters).toContainEqual(["organization_id", "eq", ORG]);
    expect(result).toMatchObject({ inserted: 1, markedRead: 1, created: false });
    expect(rpcCalls).toEqual([
      {
        fn: "guest_conversation_apply_messages",
        args: expect.objectContaining({
          p_organization_id: ORG,
          p_guest_at: "2026-11-12T02:30:00Z",
          p_unread_guest_at: "2026-11-12T02:30:00Z",
        }),
      },
    ]);
  });

  it("throws when the conversation re-read after a unique conflict fails (counted as a failed booking)", async () => {
    const { ingestConversationMessages, EMPTY_SEED } = await import("@/lib/guest-messages/store");
    let reads = 0;
    const { client } = fakeSupabase((call) => {
      if (call.table === "guest_conversations" && call.op === "select") {
        reads += 1;
        return reads === 1 ? { data: null } : { error: { message: "timeout" } };
      }
      if (call.table === "guest_conversations" && call.op === "insert") return { error: { message: "dup", code: "23505" } };
      return { data: [] };
    });
    await expect(
      ingestConversationMessages(client, { organizationId: ORG, provider: "beds24", providerBookingId: "1", seed: EMPTY_SEED, messages: [message({ externalId: "9" })], now }),
    ).rejects.toThrow(/re-read failed/);
  });

  it("does not count an echo merge when its writes fail; 23505 on insert links to the existing row", async () => {
    const { ingestConversationMessages, EMPTY_SEED } = await import("@/lib/guest-messages/store");
    const outbox = [{ id: "ob1", status: "sending", external_id: null, body: "Sure", sent_at: null, created_at: "2026-11-12T02:55:00Z" }];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = fakeSupabase((call) => {
      if (call.table === "guest_conversations") return { data: conversationRow };
      if (call.table === "guest_message_outbox" && call.op === "select") return { data: outbox };
      if (call.table === "guest_messages" && call.op === "select") return { data: [] };
      if (call.table === "guest_messages" && call.op === "insert") return { error: { message: "boom", code: "XX000" } };
      return { data: [] };
    });
    const failed = await ingestConversationMessages(failing.client, {
      organizationId: ORG, provider: "beds24", providerBookingId: "1", seed: EMPTY_SEED,
      messages: [message({ externalId: "777", direction: "host", body: "Sure", sentAt: "2026-11-12T02:56:00Z" })], now,
    });
    expect(failed).toMatchObject({ merged: 0, failedMerges: 1 });
    const outboxSelect = failing.calls.find((c) => c.table === "guest_message_outbox" && c.op === "select")!;
    expect(outboxSelect.filters).toContainEqual(["status", "in", ["sent", "sending", "uncertain"]]);

    const linking = fakeSupabase((call) => {
      if (call.table === "guest_conversations") return { data: conversationRow };
      if (call.table === "guest_message_outbox" && call.op === "select") return { data: outbox };
      if (call.table === "guest_messages" && call.op === "select") return { data: [] };
      if (call.table === "guest_messages" && call.op === "insert") return { error: { message: "dup", code: "23505" } };
      return { data: [] };
    });
    const linked = await ingestConversationMessages(linking.client, {
      organizationId: ORG, provider: "beds24", providerBookingId: "1", seed: EMPTY_SEED,
      messages: [message({ externalId: "777", direction: "host", body: "Sure", sentAt: "2026-11-12T02:56:00Z" })], now,
    });
    expect(linked).toMatchObject({ merged: 1, failedMerges: 0 });
    const link = linking.calls.find((c) => c.table === "guest_messages" && c.op === "update")!;
    expect(link.payload).toEqual({ outbox_id: "ob1" });
    const settle = linking.calls.find((c) => c.table === "guest_message_outbox" && c.op === "update" && (c.payload as { status?: string }).status === "sent");
    expect(settle?.filters).toContainEqual(["status", "in", ["sending", "uncertain"]]);
    errorSpy.mockRestore();
  });
});
