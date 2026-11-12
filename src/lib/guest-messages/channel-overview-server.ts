/**
 * 설정 탭 「Beds24 연결」 · 목록 위 「받는 통로 멈춤」 — 기록된 값만 읽는다(서버 전용, Beds24 호출 없음 — 크레딧 0).
 * docs/product/47-guest-messaging.md §6-2. 권한(`guest_messages.manage`)은 부르는 쪽이 먼저 본다.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { readBeds24AccountCredit } from "@/lib/beds24/account-credit";
import { channelStallState, creditBarModel, type ChannelStall, type CreditBar } from "@/lib/guest-messages/settings-model";
import { readGuestMessageSettings, type GuestMessageSettings } from "@/lib/guest-messages/types";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type ChannelStateRow = {
  last_webhook_at: string | null;
  last_message_webhook_at: string | null;
  last_reconcile_at: string | null;
  last_reconcile_error: string | null;
  last_credit_remaining: number | null;
  last_credit_reset_at: string | null;
  last_request_cost: number | null;
  settings: unknown;
  night_pause: boolean | null;
  credit_reserve: number | null;
  stall_hours: number | null;
};

const STATE_COLUMNS =
  "last_webhook_at, last_message_webhook_at, last_reconcile_at, last_reconcile_error, last_credit_remaining, last_credit_reset_at, last_request_cost, settings, night_pause, credit_reserve, stall_hours";

export async function loadChannelStateRow(db: Client, organizationId: string): Promise<ChannelStateRow | null> {
  const { data, error } = await db.from("guest_message_channel_state").select(STATE_COLUMNS).eq("organization_id", organizationId).maybeSingle();
  if (error) throw new Error(`channel state read failed: ${error.code ?? error.message}`);
  return (data as ChannelStateRow | null) ?? null;
}

/** 목록 위 경고 줄에 필요한 것만. 읽기 실패면 null(경고를 지어내지 않는다). */
export type StallNotice = ChannelStall & { lastWebhookAt: string | null; lastReconcileAt: string | null; stallHours: number };

export async function loadStallNotice(db: Client, organizationId: string, now: Date = new Date()): Promise<StallNotice | null> {
  try {
    const row = await loadChannelStateRow(db, organizationId);
    const settings = readGuestMessageSettings(row);
    return {
      ...channelStallState(row?.last_webhook_at ?? null, settings.stallHours, now),
      lastWebhookAt: row?.last_webhook_at ?? null,
      lastReconcileAt: row?.last_reconcile_at ?? null,
      stallHours: settings.stallHours,
    };
  } catch (error) {
    console.error("[guest-messages] stall read failed", error instanceof Error ? error.message : "unknown");
    return null;
  }
}

export type ChannelOverview = {
  settings: GuestMessageSettings;
  lastWebhookAt: string | null;
  lastMessageWebhookAt: string | null;
  lastReconcileAt: string | null;
  lastReconcileError: string | null;
  stall: ChannelStall;
  credit: CreditBar;
  /** 크레딧 기록이 계정 전체 기록에서 왔나(아니면 이 기능 사본). */
  creditSource: "account" | "channel" | null;
  queuedCount: number;
  failed: { count: number; latestAt: string | null; conversationId: string | null };
  nowMs: number;
};

const FAILED_WINDOW_MS = 7 * 24 * 3_600_000;

export async function loadChannelOverview(db: Client, organizationId: string, now: Date = new Date()): Promise<ChannelOverview> {
  const nowMs = now.getTime();
  const since = new Date(nowMs - FAILED_WINDOW_MS).toISOString();
  const [row, account, queued, failed] = await Promise.all([
    loadChannelStateRow(db, organizationId),
    readBeds24AccountCredit(db, nowMs).catch(() => null),
    db
      .from("guest_message_outbox")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .in("status", ["queued", "sending"]),
    db
      .from("guest_message_outbox")
      .select("conversation_id, updated_at", { count: "exact" })
      .eq("organization_id", organizationId)
      .in("status", ["failed", "uncertain"])
      .gte("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(1),
  ]);
  if (queued.error) throw new Error(`outbox count failed: ${queued.error.message}`);
  if (failed.error) throw new Error(`outbox failed read: ${failed.error.message}`);
  const settings = readGuestMessageSettings(row);
  const channelCredit = row
    ? {
        remaining: row.last_credit_remaining,
        resetsAt: row.last_credit_reset_at ? Date.parse(row.last_credit_reset_at) : null,
        requestCost: row.last_request_cost,
      }
    : null;
  // 계정 전체 기록이 기준(다른 작업도 같은 5분 창을 쓴다). 없거나 지났으면 이 기능 사본.
  const accountBar = account ? creditBarModel(account, settings.creditReserve, nowMs) : ({ known: false } as CreditBar);
  const channelBar = creditBarModel(channelCredit, settings.creditReserve, nowMs);
  const latest = ((failed.data ?? []) as Array<{ conversation_id: string; updated_at: string }>)[0] ?? null;
  return {
    settings,
    lastWebhookAt: row?.last_webhook_at ?? null,
    lastMessageWebhookAt: row?.last_message_webhook_at ?? null,
    lastReconcileAt: row?.last_reconcile_at ?? null,
    lastReconcileError: row?.last_reconcile_error ?? null,
    stall: channelStallState(row?.last_webhook_at ?? null, settings.stallHours, now),
    credit: accountBar.known ? accountBar : channelBar,
    creditSource: accountBar.known ? "account" : channelBar.known ? "channel" : null,
    queuedCount: queued.count ?? 0,
    failed: { count: failed.count ?? 0, latestAt: latest?.updated_at ?? null, conversationId: latest?.conversation_id ?? null },
    nowMs,
  };
}
