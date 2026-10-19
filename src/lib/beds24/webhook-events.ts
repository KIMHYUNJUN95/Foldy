import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { ProcessWebhookBookingResult } from "@/lib/beds24/process-webhook-booking";
import type { Beds24ReservationsBackfillResult } from "@/lib/beds24/reservations-backfill";

// Observability for Beds24 ingestion. Every inbound webhook batch and every
// reconciliation run is recorded in public.beds24_webhook_events so that a dropped
// or never-processed booking is detectable instead of silently missing.
//
// Recording must never break the caller: a logging failure is swallowed and logged
// to the server console only. The webhook/cron response is unaffected.

/**
 * Record one inbound Beds24 webhook batch and its per-booking processing results.
 */
export async function recordBeds24WebhookEvent(params: {
  supabase: SupabaseClient<Database>;
  httpStatus: number;
  results: ProcessWebhookBookingResult[];
  organizationId?: string | null;
  errorMessage?: string | null;
  // Present only when the batch had failures worth replaying: the raw body and its
  // Content-Type are persisted so a failed booking can be re-processed/debugged.
  rawBody?: unknown;
  contentType?: string | null;
  /** 요청을 받은 때부터 응답 직전까지(ms). 응답 뒤 작업(after)은 포함하지 않는다. */
  durationMs?: number | null;
}): Promise<void> {
  try {
    const { results } = params;
    const succeeded = results.filter((result) => result.ok).length;
    const failed = results.length - succeeded;
    const modes = Array.from(new Set(results.map((result) => result.mode)));
    const bookingSummary = results.map((result) => ({
      bookId: result.ok ? result.originalReservationId ?? result.sourceReservationId : result.sourceReservationId,
      status: result.ok ? result.mappedStatus : null,
      mode: result.mode,
    }));

    let rawPayload: unknown = null;
    if (params.rawBody !== undefined) {
      try {
        rawPayload = JSON.parse(JSON.stringify(params.rawBody));
      } catch {
        rawPayload = { raw: String(params.rawBody ?? "") };
      }
    }

    await params.supabase.from("beds24_webhook_events").insert({
      organization_id: params.organizationId ?? null,
      trigger_source: "webhook",
      http_status: params.httpStatus,
      processed_count: results.length,
      succeeded_count: succeeded,
      failed_count: failed,
      modes,
      booking_summary: bookingSummary,
      // 웹훅 원문은 임의 구조라 `unknown` 으로 들고 다니다가 저장 시점에만 Json 으로 좁힌다.
      raw_payload: rawPayload as Json,
      content_type: params.contentType ?? null,
      duration_ms: params.durationMs ?? null,
      error_message: params.errorMessage ?? null,
    });
  } catch (error) {
    console.error("[beds24/webhook-events] failed to record webhook event", error);
  }
}

/**
 * Record one inbound webhook delivery that produced NO processable booking
 * (unparseable body, unknown envelope, or empty candidate list).
 *
 * This exists so an unrecognized delivery is never dropped without a trace again
 * (see docs/planning/01-decision-log.md → 2026-07-22). The full raw body and
 * Content-Type are persisted so the exact shape is debuggable and the delivery is
 * replayable; the daily reconciliation still heals the missed reservation from the
 * Beds24 API in the meantime.
 */
export async function recordBeds24WebhookRejection(params: {
  supabase: SupabaseClient<Database>;
  httpStatus: number;
  reason: string;
  rawBody: unknown;
  contentType: string | null;
}): Promise<void> {
  try {
    let rawPayload: unknown = params.rawBody;
    try {
      // Ensure it is JSON-serializable; fall back to a string form otherwise.
      rawPayload = JSON.parse(JSON.stringify(params.rawBody));
    } catch {
      rawPayload = { raw: String(params.rawBody ?? "") };
    }

    await params.supabase.from("beds24_webhook_events").insert({
      trigger_source: "webhook",
      http_status: params.httpStatus,
      processed_count: 0,
      succeeded_count: 0,
      failed_count: 0,
      modes: [params.reason],
      booking_summary: [],
      // 웹훅 원문은 임의 구조라 `unknown` 으로 들고 다니다가 저장 시점에만 Json 으로 좁힌다.
      raw_payload: rawPayload as Json,
      content_type: params.contentType ?? null,
      error_message: params.reason,
    });
  } catch (error) {
    console.error("[beds24/webhook-events] failed to record webhook rejection", error);
  }
}

/**
 * Record one reconciliation (scheduled cron or manual) catch-up sync.
 */
export async function recordBeds24ReconciliationEvent(params: {
  supabase: SupabaseClient<Database>;
  httpStatus: number;
  result: Beds24ReservationsBackfillResult;
  organizationId?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  try {
    const { result } = params;
    const modes = ["reconciliation"];
    if (result.partial) modes.push("partial");
    if (!result.attempted) modes.push("not_attempted");

    const bookingSummary = {
      window: { from: result.from, toExclusive: result.toExclusive },
      upsertedRows: result.upsertedRows,
      cancelledUpsertedRows: result.cancelledUpsertedRows,
      recoveredRows: result.recoveredRows,
      skipped: result.skipped,
      skippedReasons: result.skippedReasons,
    };

    await params.supabase.from("beds24_webhook_events").insert({
      organization_id: params.organizationId ?? null,
      trigger_source: "reconciliation",
      http_status: params.httpStatus,
      processed_count: result.fetchedRows,
      succeeded_count: result.upsertedRows,
      failed_count: result.skippedRows,
      modes,
      booking_summary: bookingSummary,
      error_message: params.errorMessage ?? null,
    });
  } catch (error) {
    console.error("[beds24/webhook-events] failed to record reconciliation event", error);
  }
}
