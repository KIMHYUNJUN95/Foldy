/**
 * 손님 메시지 보정 조회 — 웹훅이 놓친 손님 말을 채운다. docs/product/47-guest-messaging.md §4-0-1 · §4-1(순위 4)
 *
 * **한 번 실행 = 계정 전체를 한 번 읽기**(2026-11-12 검토 반영): `GET /bookings/messages?filter=unread&maxAge=2&page=N` 을 읽고,
 * 예약마다 조직을 정해(웹훅과 같은 매핑 규칙) 웹훅과 **같은 함수**(`ingestConversationMessages`)로 넣는다.
 *
 * 조직 정하기: 매핑(건물 · 객실 → 조직)이 먼저. 매핑이 없으면 그 예약의 기존 대화가 있는 조직(하나일 때), 그래도 없으면 서버 기본값(경고).
 * 매핑 조직과 기존 대화 조직이 다르면 **넣지 않고 로그**(조직 섞임 방지).
 *
 * 크레딧:
 * - Beds24 동기화 멈춤 · 계정 쿨다운이면 부르지 않는다.
 * - 계정 전체 마지막 기록(`readBeds24AccountCredit`, 리셋 전만 믿음)이 남겨 둘 선(`effectiveCreditReserve`) 아래면 부르지 않는다.
 * - 페이지마다 헤더를 기록하고(계정 + 조직 사본, 저크레딧이면 계정 쿨다운), 선 아래로 내려가면 남은 페이지를 미룬다. 429 면 계정 쿨다운.
 * - `last_reconcile_at` 은 한 페이지라도 읽었을 때만, 실패 이유는 `last_reconcile_error`.
 *
 * 주기는 V1 확인 뒤 정한다(10~15분 예정). 아직 정기 실행에 넣지 않았다.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { readBeds24AccountCredit } from "@/lib/beds24/account-credit";
import { resolveBeds24AccessToken, type Beds24TokenState } from "@/lib/beds24/access-token";
import { readBeds24Credits } from "@/lib/beds24/credits";
import { isBeds24SyncPaused } from "@/lib/beds24/sync-control";
import { activateBeds24Cooldown, getBeds24Cooldown } from "@/lib/beds24/sync-locks";
import { getOptionalBeds24ApiEnv } from "@/lib/env";
import { recordGuestMessageCredit } from "@/lib/guest-messages/adapter-server";
import { normalizeBeds24Message } from "@/lib/guest-messages/beds24-normalize";
import { effectiveCreditReserve, knownRemainingCredit } from "@/lib/guest-messages/credit";
import { decideReconcileOrganization } from "@/lib/guest-messages/org-resolve";
import { readMappedOrganizationIds } from "@/lib/beds24/webhook-organization";
import {
  groupMessagesByBooking,
  ingestConversationMessages,
  recordChannelState,
  resolveConversationSeed,
} from "@/lib/guest-messages/store";
import { readGuestMessageSettings, type NormalizedMessage } from "@/lib/guest-messages/types";
import { warnAssumedUtcTimes } from "@/lib/guest-messages/webhook-ingest";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const RECONCILE_MAX_AGE_DAYS = 2;
export const RECONCILE_MAX_PAGES = 10;

export type ReconcileSkip = "paused" | "cooldown" | "low_credit" | "missing_env" | "token";
export type ReconcileStop = "low_credit" | "rate_limited" | "http_error" | "request_error";

export type ReconcileResult = {
  attempted: boolean;
  skipped: ReconcileSkip | null;
  pages: number;
  fetched: number;
  stoppedEarly: ReconcileStop | null;
  creditsRemaining: number | null;
  organizations: Record<string, { inserted: number; merged: number }>;
  otherOrganization: number;
  noOrganization: number;
  organizationMismatch: number;
  viaFallbackOrganization: number;
  failedBookings: number;
  assumedUtcTimes: number;
};

/** 응답 한 페이지 → 메시지 원본 목록 + 다음 페이지 여부. 모양이 달라도 던지지 않는다. */
export function parseBeds24MessagesPage(json: unknown): { rows: unknown[]; nextPageExists: boolean } {
  if (Array.isArray(json)) return { rows: json, nextPageExists: false };
  if (!json || typeof json !== "object") return { rows: [], nextPageExists: false };
  const record = json as { data?: unknown; pages?: { nextPageExists?: unknown } };
  return {
    rows: Array.isArray(record.data) ? record.data : [],
    nextPageExists: record.pages?.nextPageExists === true,
  };
}

export async function reconcileGuestMessages(
  organizationIds: readonly string[],
  deps: {
    supabase?: SupabaseClient<Database>;
    fetchImpl?: typeof fetch;
    resolveToken?: () => Promise<Beds24TokenState>;
    baseUrl?: string | null;
    now?: () => Date;
    maxPages?: number;
  } = {},
): Promise<ReconcileResult> {
  const supabase = deps.supabase ?? getSupabaseServiceClient();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => new Date());
  const maxPages = deps.maxPages ?? RECONCILE_MAX_PAGES;
  const result: ReconcileResult = {
    attempted: false,
    skipped: null,
    pages: 0,
    fetched: 0,
    stoppedEarly: null,
    creditsRemaining: null,
    organizations: Object.fromEntries(organizationIds.map((id) => [id, { inserted: 0, merged: 0 }])),
    otherOrganization: 0,
    noOrganization: 0,
    organizationMismatch: 0,
    viaFallbackOrganization: 0,
    failedBookings: 0,
    assumedUtcTimes: 0,
  };

  const finish = async () => {
    const nowIso = now().toISOString();
    const error = result.stoppedEarly ?? result.skipped ?? (result.failedBookings > 0 ? "failed_bookings" : null);
    for (const organizationId of organizationIds) {
      await recordChannelState(supabase, organizationId, {
        ...(result.pages > 0 ? { last_reconcile_at: nowIso } : {}),
        last_reconcile_error: error,
      });
    }
    return result;
  };

  const baseUrl = (deps.baseUrl !== undefined ? deps.baseUrl : getOptionalBeds24ApiEnv()?.baseUrl ?? null)?.replace(/\/$/, "");
  if (!baseUrl) {
    result.skipped = "missing_env";
    return finish();
  }
  if (isBeds24SyncPaused()) {
    result.skipped = "paused";
    return finish();
  }
  const cooldown = await getBeds24Cooldown(supabase);
  if (cooldown.active) {
    result.skipped = "cooldown";
    return finish();
  }

  // 남겨 둘 선 — 조직 설정 중 가장 큰 값과 계정 저크레딧 선 중 큰 쪽(계정 단위 크레딧이라).
  const states = organizationIds.length
    ? await supabase
        .from("guest_message_channel_state")
        .select("organization_id, settings, night_pause, credit_reserve, stall_hours")
        .in("organization_id", [...organizationIds])
    : { data: [] as Array<{ credit_reserve: number }> };
  const reserves = ((states.data ?? []) as Array<Parameters<typeof readGuestMessageSettings>[0]>).map(
    (row) => readGuestMessageSettings(row).creditReserve,
  );
  const reserve = effectiveCreditReserve(Math.max(readGuestMessageSettings(null).creditReserve, ...reserves));

  const nowMs = now().getTime();
  const account = await readBeds24AccountCredit(supabase, nowMs);
  const remainingBefore = knownRemainingCredit(account, nowMs);
  if (remainingBefore !== null && remainingBefore < reserve) {
    result.skipped = "low_credit";
    result.creditsRemaining = remainingBefore;
    return finish();
  }

  const token = await (deps.resolveToken ?? (() => resolveBeds24AccessToken("guest-messages-reconcile")))();
  if (!token.ok) {
    result.skipped = "token";
    return finish();
  }
  result.attempted = true;

  const collected: NormalizedMessage[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const url = `${baseUrl}/bookings/messages?filter=unread&maxAge=${RECONCILE_MAX_AGE_DAYS}&page=${page}`;
    let response: Response;
    try {
      response = await fetchImpl(url, { headers: { accept: "application/json", token: token.token }, cache: "no-store" });
    } catch {
      result.stoppedEarly = "request_error";
      break;
    }
    const headerCredit = readBeds24Credits(response.headers);
    const pageMs = now().getTime();
    const credit = {
      remaining: headerCredit.remaining,
      resetsAt: headerCredit.resetsIn !== null ? pageMs + headerCredit.resetsIn * 1000 : null,
      requestCost: headerCredit.requestCost,
      ...(headerCredit.limit !== undefined ? { limit: headerCredit.limit } : {}),
    };
    await recordGuestMessageCredit(supabase, organizationIds, credit, "guest-messages-reconcile", pageMs);
    result.creditsRemaining = credit.remaining;
    if (response.status === 429) {
      await activateBeds24Cooldown(supabase, { reason: "rate_limit", resetInSec: headerCredit.resetsIn });
      result.stoppedEarly = "rate_limited";
      break;
    }
    if (!response.ok) {
      result.stoppedEarly = "http_error";
      break;
    }
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    const parsed = parseBeds24MessagesPage(json);
    result.pages += 1;
    const receivedAt = now().toISOString();
    for (const row of parsed.rows) {
      const message = normalizeBeds24Message(row, { receivedAt });
      if (message) collected.push(message);
    }
    if (!parsed.nextPageExists) break;
    const remaining = knownRemainingCredit(credit, pageMs);
    if (remaining !== null && remaining < reserve) {
      result.stoppedEarly = "low_credit";
      break;
    }
  }
  result.fetched = collected.length;
  result.assumedUtcTimes = warnAssumedUtcTimes(collected, "reconcile");

  const fallbackOrganizationId = process.env.BEDS24_DEFAULT_ORGANIZATION_ID?.trim() || null;
  const wanted = new Set(organizationIds);
  for (const [providerBookingId, group] of groupMessagesByBooking(collected)) {
    const first = group[0];
    try {
      const mapped = await readMappedOrganizationIds(supabase, {
        externalPropertyId: first.externalPropertyId,
        externalRoomId: first.externalRoomId,
      });
      const existing = await supabase
        .from("guest_conversations")
        .select("organization_id")
        .eq("provider", "beds24")
        .eq("provider_booking_id", providerBookingId);
      if (existing.error) throw new Error(`conversation owner lookup failed: ${existing.error.message}`);
      const decision = decideReconcileOrganization({
        mapped,
        existing: ((existing.data ?? []) as Array<{ organization_id: string }>).map((row) => row.organization_id),
        fallback: fallbackOrganizationId,
      });
      if (decision.mismatch) {
        result.organizationMismatch += group.length;
        console.warn("[guest-messages/reconcile] organization mismatch — skipped", { providerBookingId });
        continue;
      }
      const organizationId = decision.organizationId;
      if (!organizationId) {
        result.noOrganization += group.length;
        continue;
      }
      if (!wanted.has(organizationId)) {
        result.otherOrganization += group.length;
        continue;
      }
      if (decision.viaFallback) {
        result.viaFallbackOrganization += 1;
        console.warn("[guest-messages/reconcile] organization only from BEDS24_DEFAULT_ORGANIZATION_ID", { providerBookingId });
      }
      const seed = await resolveConversationSeed(supabase, {
        organizationId,
        providerBookingId,
        booking: null,
        externalPropertyId: first.externalPropertyId,
        externalRoomId: first.externalRoomId,
      });
      const ingest = await ingestConversationMessages(supabase, {
        organizationId,
        provider: "beds24",
        providerBookingId,
        seed,
        messages: group,
        now: now(),
      });
      const bucket = result.organizations[organizationId] ?? { inserted: 0, merged: 0 };
      bucket.inserted += ingest.inserted;
      bucket.merged += ingest.merged;
      result.organizations[organizationId] = bucket;
    } catch (error) {
      result.failedBookings += 1;
      console.error("[guest-messages/reconcile] booking ingest failed", {
        providerBookingId,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return finish();
}

/** 라우트가 실패로 볼 결과인가. */
export function isReconcileFailure(result: ReconcileResult): boolean {
  return (
    result.stoppedEarly === "http_error" ||
    result.stoppedEarly === "request_error" ||
    result.skipped === "token" ||
    result.failedBookings > 0
  );
}
