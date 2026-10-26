import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { ProcessWebhookBookingResult } from "@/lib/beds24/process-webhook-booking";
import type { Beds24ReservationsBackfillResult } from "@/lib/beds24/reservations-backfill";

// Beds24 수신 관측성. 들어오는 모든 웹훅 배치와 모든
// 재조정 실행을 public.beds24_webhook_events 에 기록해, 누락되었거나
// 처리되지 않은 예약을 조용히 놓치는 대신 감지할 수 있게 한다.
//
// 기록이 호출자를 깨뜨려서는 안 된다: 로깅 실패는 삼키고 서버 콘솔에만
// 남긴다. 웹훅/크론 응답은 영향받지 않는다.

/**
 * 들어온 Beds24 웹훅 배치 하나와 예약별 처리 결과를 기록한다.
 */
export async function recordBeds24WebhookEvent(params: {
  supabase: SupabaseClient<Database>;
  httpStatus: number;
  results: ProcessWebhookBookingResult[];
  organizationId?: string | null;
  errorMessage?: string | null;
  // 재처리할 가치가 있는 실패가 배치에 있을 때만 존재: 원문 본문과 Content-Type 을
  // 저장해 실패한 예약을 다시 처리/디버깅할 수 있게 한다.
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
 * 처리 가능한 예약이 없는 들어온 웹훅 전달 하나를 기록한다
 * (해석 불가한 본문, 알 수 없는 봉투, 또는 빈 후보 목록).
 *
 * 인식하지 못한 전달이 흔적 없이 버려지는 일이 다시는 없게 하려는 것이다
 * (docs/planning/01-decision-log.md → 2026-07-22 참고). 원문 본문 전체와
 * Content-Type 을 저장해 정확한 형태를 디버깅하고 전달을 다시 재생할 수 있다.
 * 그사이 누락된 예약은 일일 재조정이 Beds24 API 에서
 * 다시 채워 준다.
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
      // JSON 직렬화가 가능한지 확인하고, 아니면 문자열 형태로 대체한다.
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
 * 재조정(예약된 크론 또는 수동) 따라잡기 동기화 한 건을 기록한다.
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
