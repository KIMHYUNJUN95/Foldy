/**
 * Beds24 채널 어댑터 — `receive` · `send` · `markRead`. docs/product/47-guest-messaging.md §3 · §4 · §4-1
 *
 * - `receive`: 웹훅 본문만 읽는다(Beds24 호출 없음 · 크레딧 0) — `beds24-normalize.ts`.
 * - `send`: `POST /bookings/messages` 에 `[{ bookingId, message }]` 를 **한 번에**(배열).
 *   **OTA 허용 목록**(`OTA_SENDABLE_CHANNELS`)만 보낸다 — 직접 예약은 `direct_booking`, 채널을 모르면 `unknown_channel`(호출하지 않음).
 * - `markRead`: 같은 엔드포인트에 `[{ id, read: true }]`(다시 보내도 같은 결과라 안전).
 * - 부르기 전에 `gate` 를 본다(Beds24 동기화 멈춤 · 계정 쿨다운) — 막혀 있으면 부르지 않고 `rate_limited`.
 * - 응답마다 크레딧 헤더(`readBeds24Credits`)를 `onCredit` 으로 넘긴다. 429 는 `resets-in` 으로 다시 시도 시각을 정하고 `onRateLimited`.
 * - **보내기는 멱등이 아니다**: 요청이 나간 뒤의 실패(네트워크 끊김 · 5xx · 응답 줄 빠짐)는 `uncertain` — 발송 큐가 다시 보내지 않는다.
 *
 * 토큰은 기존 캐시(`access-token.ts`). 토큰 · 본문은 로그에 남기지 않는다.
 */

import { resolveBeds24AccessToken, type Beds24TokenState } from "@/lib/beds24/access-token";
import { readBeds24Credits } from "@/lib/beds24/credits";
import { isBeds24SyncPaused } from "@/lib/beds24/sync-control";
import { resolveCooldownSeconds } from "@/lib/beds24/sync-locks";
import { getOptionalBeds24ApiEnv } from "@/lib/env";
import { extractBeds24WebhookMessages } from "@/lib/guest-messages/beds24-normalize";
import {
  OTA_SENDABLE_CHANNELS,
  type ChannelCreditSnapshot,
  type GuestMessageChannelAdapter,
  type MarkReadOutcome,
  type OutboundItem,
  type SendItemResult,
  type SendOutcome,
} from "@/lib/guest-messages/types";

/** 부르기 전 확인. 막혀 있으면 몇 초 뒤에 다시. */
export type Beds24CallGate = () => Promise<{ blocked: false } | { blocked: true; retryAfterSec: number; reason: string }>;

export type Beds24AdapterDeps = {
  fetchImpl?: typeof fetch;
  resolveToken?: () => Promise<Beds24TokenState>;
  baseUrl?: string | null;
  now?: () => number;
  /** 기본: `BEDS24_SYNC_PAUSED` 만. 서버용(`adapter-server.ts`)은 계정 쿨다운도 본다. */
  gate?: Beds24CallGate;
  /** 응답마다 받은 크레딧 헤더(기록용). 실패해도 보내기 결과에 영향 없음. */
  onCredit?: (credit: ChannelCreditSnapshot) => Promise<void> | void;
  /** 429 — 계정 전체 쿨다운을 켤 때. */
  onRateLimited?: (resetsInSec: number | null) => Promise<void> | void;
};

const PAUSED_RETRY_SEC = 300;

export const defaultBeds24Gate: Beds24CallGate = async () =>
  isBeds24SyncPaused() ? { blocked: true, retryAfterSec: PAUSED_RETRY_SEC, reason: "paused" } : { blocked: false };

/** 이 채널로 보낼 수 있나 — 허용 목록. 거절 이유도 같이. */
export function outboundChannelRefusal(channel: OutboundItem["channel"]): "direct_booking" | "unknown_channel" | null {
  if (channel === "direct") return "direct_booking";
  if (!channel || !OTA_SENDABLE_CHANNELS.includes(channel)) return "unknown_channel";
  return null;
}

function toBeds24Id(value: string): number | null {
  if (!/^\d{1,15}$/.test(value.trim())) return null;
  return Number(value.trim());
}

function snapshotFromHeaders(headers: Headers, nowMs: number): ChannelCreditSnapshot {
  const credit = readBeds24Credits(headers);
  return {
    remaining: credit.remaining,
    resetsAt: credit.resetsIn !== null ? nowMs + credit.resetsIn * 1000 : null,
    requestCost: credit.requestCost,
  };
}

async function safeCall(fn: (() => Promise<void> | void) | undefined) {
  if (!fn) return;
  try {
    await fn();
  } catch (error) {
    console.error("[guest-messages/beds24] side effect failed", error instanceof Error ? error.message : "unknown");
  }
}

/**
 * `POST /bookings/messages` 응답 한 줄 → 결과. 모양은 방어적으로. 줄이 없거나 모양을 모르면 `unknown` — 나갔는지 모른다.
 */
export function readBeds24PostResult(
  entry: unknown,
): { status: "ok"; externalId: string | null } | { status: "rejected"; detail: string } | { status: "unknown" } {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return { status: "unknown" };
  const record = entry as Record<string, unknown>;
  const success = record.success;
  if (success === false) {
    const errors = Array.isArray(record.errors) ? record.errors : [];
    const first = errors[0] && typeof errors[0] === "object" ? (errors[0] as Record<string, unknown>).message : null;
    return { status: "rejected", detail: typeof first === "string" ? first.slice(0, 200) : "rejected" };
  }
  const newRecord =
    record.new && typeof record.new === "object" && !Array.isArray(record.new)
      ? (record.new as Record<string, unknown>)
      : null;
  const idValue = newRecord?.id ?? record.id ?? record.messageId;
  const externalId =
    typeof idValue === "number" && Number.isFinite(idValue)
      ? String(idValue)
      : typeof idValue === "string" && idValue.trim()
        ? idValue.trim()
        : null;
  if (success === true || externalId) return { status: "ok", externalId };
  return { status: "unknown" };
}

type PostResult =
  | { kind: "response"; status: number; json: unknown; credit: ChannelCreditSnapshot }
  | { kind: "blocked"; retryAfterSec: number }
  | { kind: "pre_send"; errorCode: string }
  | { kind: "network_error" };

export function createBeds24GuestMessageAdapter(deps: Beds24AdapterDeps = {}): GuestMessageChannelAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const resolveToken = deps.resolveToken ?? (() => resolveBeds24AccessToken("guest-messages"));
  const now = deps.now ?? Date.now;
  const gate = deps.gate ?? defaultBeds24Gate;
  const baseUrl = (deps.baseUrl !== undefined ? deps.baseUrl : getOptionalBeds24ApiEnv()?.baseUrl ?? null)?.replace(/\/$/, "") ?? null;

  async function post(payload: unknown[]): Promise<PostResult> {
    if (!baseUrl) return { kind: "pre_send", errorCode: "missing_env" };
    const gated = await gate();
    if (gated.blocked) return { kind: "blocked", retryAfterSec: gated.retryAfterSec };
    const token = await resolveToken();
    if (!token.ok) return { kind: "pre_send", errorCode: token.skipped };
    try {
      const response = await fetchImpl(`${baseUrl}/bookings/messages`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", token: token.token },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      const credit = snapshotFromHeaders(response.headers, now());
      await safeCall(() => deps.onCredit?.(credit));
      let json: unknown = null;
      try {
        json = await response.json();
      } catch {
        json = null;
      }
      return { kind: "response", status: response.status, json, credit };
    } catch {
      // 요청이 나갔을 수 있다(시간 초과 · 연결 끊김) — 결과를 모른다.
      return { kind: "network_error" };
    }
  }

  async function rateLimited(credit: ChannelCreditSnapshot) {
    const resetsInSec = credit.resetsAt !== null ? Math.max(0, Math.round((credit.resetsAt - now()) / 1000)) : null;
    await safeCall(() => deps.onRateLimited?.(resetsInSec));
    return resolveCooldownSeconds(resetsInSec);
  }

  return {
    provider: "beds24",

    receive(rawWebhookBody: unknown) {
      return extractBeds24WebhookMessages(rawWebhookBody, new Date(now()).toISOString());
    },

    async send(items: OutboundItem[]): Promise<SendOutcome> {
      const refused: SendItemResult[] = [];
      const sendable: { item: OutboundItem; bookingId: number }[] = [];
      for (const item of items) {
        const refusal = outboundChannelRefusal(item.channel);
        if (refusal) {
          refused.push({ outboxId: item.outboxId, ok: false, reason: refusal });
          continue;
        }
        const bookingId = toBeds24Id(item.providerBookingId);
        if (bookingId === null) {
          refused.push({ outboxId: item.outboxId, ok: false, reason: "invalid_booking_id" });
          continue;
        }
        sendable.push({ item, bookingId });
      }
      const emptyCredit: ChannelCreditSnapshot = { remaining: null, resetsAt: null, requestCost: null };
      if (sendable.length === 0) return { kind: "sent", items: refused, credit: emptyCredit };

      const result = await post(sendable.map(({ item, bookingId }) => ({ bookingId, message: item.body })));
      if (result.kind === "blocked") {
        return { kind: "rate_limited", retryAfterSec: result.retryAfterSec, credit: emptyCredit, items: refused };
      }
      if (result.kind === "pre_send") {
        return { kind: "failed", phase: "pre_send", errorCode: result.errorCode, credit: null, items: refused };
      }
      if (result.kind === "network_error") {
        return { kind: "failed", phase: "uncertain", errorCode: "request_error", credit: null, items: refused };
      }
      if (result.status === 429) {
        return { kind: "rate_limited", retryAfterSec: await rateLimited(result.credit), credit: result.credit, items: refused };
      }
      if (result.status >= 500) {
        return { kind: "failed", phase: "uncertain", errorCode: `http_${result.status}`, credit: result.credit, items: refused };
      }
      if (result.status < 200 || result.status >= 300) {
        return { kind: "failed", phase: "rejected", errorCode: `http_${result.status}`, credit: result.credit, items: refused };
      }

      const rows = Array.isArray(result.json) ? result.json : [];
      const sent: SendItemResult[] = sendable.map(({ item }, index) => {
        const parsed = readBeds24PostResult(rows[index]);
        if (parsed.status === "ok") return { outboxId: item.outboxId, ok: true, externalId: parsed.externalId };
        if (parsed.status === "rejected") {
          return { outboxId: item.outboxId, ok: false, reason: "provider_rejected", detail: parsed.detail };
        }
        return { outboxId: item.outboxId, ok: false, reason: "uncertain" };
      });
      return { kind: "sent", items: [...refused, ...sent], credit: result.credit };
    },

    async markRead(externalIds: string[]): Promise<MarkReadOutcome> {
      const ids = externalIds.map(toBeds24Id).filter((id): id is number => id !== null);
      const emptyCredit: ChannelCreditSnapshot = { remaining: null, resetsAt: null, requestCost: null };
      if (ids.length === 0) return { kind: "ok", credit: emptyCredit };
      const result = await post(ids.map((id) => ({ id, read: true })));
      if (result.kind === "blocked") return { kind: "rate_limited", retryAfterSec: result.retryAfterSec, credit: emptyCredit };
      if (result.kind === "pre_send") return { kind: "failed", errorCode: result.errorCode, credit: null };
      if (result.kind === "network_error") return { kind: "failed", errorCode: "request_error", credit: null };
      if (result.status === 429) {
        return { kind: "rate_limited", retryAfterSec: await rateLimited(result.credit), credit: result.credit };
      }
      if (result.status < 200 || result.status >= 300) {
        return { kind: "failed", errorCode: `http_${result.status}`, credit: result.credit };
      }
      return { kind: "ok", credit: result.credit };
    },
  };
}
