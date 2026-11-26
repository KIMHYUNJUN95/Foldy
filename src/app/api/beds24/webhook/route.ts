import { after, NextResponse, type NextRequest } from "next/server";
import { extractBeds24WebhookBookingCandidates } from "@/lib/beds24/booking-payload";
import { processBeds24WebhookBooking, type ProcessWebhookBookingResult } from "@/lib/beds24/process-webhook-booking";
import { extractPriceWebhookSignal, processBeds24PriceWebhook } from "@/lib/beds24/price-webhook";
import { readBeds24OwnBookingId } from "@/lib/beds24/reservation-id";
import { readBeds24AccountCredit } from "@/lib/beds24/account-credit";
import { createBeds24VerifyGate, guardBeds24WebhookBooking } from "@/lib/beds24/webhook-booking-guard";
import { isBeds24SyncPaused } from "@/lib/beds24/sync-control";
import {
  recordBeds24WebhookEvent,
  recordBeds24WebhookRejection,
} from "@/lib/beds24/webhook-events";
import { forwardBeds24Delivery, parseForwardTargets } from "@/lib/beds24/webhook-forward";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requestMatchesSecret } from "@/lib/api-secret";
import { planAutoMessagesAfterWebhook } from "@/lib/guest-messages/auto-scheduler";
import { copyPendingGuestMessageMedia } from "@/lib/guest-messages/media-copy-server";
import {
  ingestBeds24WebhookMessages,
  prepareCapturedMessagesPayload,
  shouldCaptureWebhookMessages,
} from "@/lib/guest-messages/webhook-ingest";

/**
 * 가격 웹훅이 건물 다시 읽기(「창이 끝나면 한 번 더」면 최대 20초 대기 + 건물 하나 동기화)를 응답
 * 뒤에 돌린다. 그 시간이 이 안에 들어와야 한다.
 */
export const maxDuration = 60;

/**
 * 한 배달에서 처리할 예약 수 상한(2026-11-26). Beds24 는 보통 한 배달에 예약 하나(그룹 예약도 방마다)를 싣는다.
 * 넘는 것은 처리하지 않고 `over_delivery_cap` 실패로 남긴다 — 매일 정합 작업(`modifiedFrom`)이 복구한다.
 * 실제 상한은 아래 시간 예산이 먼저 건다 — 10 은 확인이 필요 없는 빠른 배달의 행 수 상한이다.
 */
export const BEDS24_WEBHOOK_MAX_BOOKINGS = 10;

/**
 * 처리 중 이 시간을 넘기면 남은 예약은 같은 실패로 넘긴다 — 60초(`maxDuration`)에 잘려 결과 기록까지 잃지 않게.
 * 20초 근거: 예산 직전에 시작한 마지막 한 건이 확인 읽기 5초 + DB 왕복 ~2초 → 루프 최대 ~27초.
 * 응답 뒤(`after()`) 일 = 결과 기록 ~1초 + 메시지 받기 ~3초 + 사진 복사 예산 20초 ≈ 24초. 합 ~51초 — 60초 안에 ~9초 여유.
 */
export const BOOKING_LOOP_BUDGET_MS = 20_000;

/**
 * 받은 **가격** 배달을 다른 수신처로 넘긴다 — **기본 꺼짐**. 예약 배달(손님 전화 · 메일 · 주소)은 절대 넘기지 않는다
 * (2026-11-26) — 부르는 쪽이 예약이 없고 가격 신호(`extractPriceWebhookSignal`)가 있을 때만 부른다.
 *
 * 전환일에 Beds24 재고 웹훅의 주인을 우리로 가져오면서 저쪽 프로젝트를 계속 살려두기 위한
 * 스위치다. 설계·근거는 `src/lib/beds24/webhook-forward.ts`.
 *
 * `after()` 로 **응답을 보낸 뒤에** 돈다. 저쪽이 느리거나 죽어도 Beds24 에게는 이미 2xx 를
 * 준 뒤라 재배달이 일어나지 않는다.
 */
function scheduleForward(args: {
  request: NextRequest;
  method: "GET" | "POST";
  rawBody?: string;
  contentType?: string | null;
}) {
  const targets = parseForwardTargets(process.env.BEDS24_PRICE_WEBHOOK_FORWARD_URL);
  if (targets.length === 0) return;

  // `after()` 밖에서 미리 읽어 둔다 — 응답 후에는 요청 객체를 건드릴 수 없다.
  const search = new URLSearchParams(args.request.nextUrl.searchParams);

  after(async () => {
    const outcomes = await forwardBeds24Delivery({
      targets,
      method: args.method,
      search,
      rawBody: args.rawBody,
      contentType: args.contentType,
    });
    const failed = outcomes.filter((outcome) => !outcome.ok);
    if (failed.length > 0) {
      // 주소는 남기지 않는다(경로에 토큰이 들어 있을 수 있다) — 몇 건 실패했는지만 남긴다.
      console.warn("[beds24/webhook] forward failed", {
        total: outcomes.length,
        failed: failed.length,
        statuses: failed.map((outcome) => outcome.status ?? outcome.error),
      });
    }
  });
}

/**
 * 응답 뒤에 할 일 — 건물 다시 읽기(지금 읽기 · 「창이 끝나면 한 번 더 읽기」 둘 다)를 `after()` 로
 * 돌린다(`price-webhook.ts`). Beds24 에는 바로 200 을 준다 — 12개월 읽기를 기다렸다 주면 늦어서
 * 재배달이 온다. 응답에 함수는 싣지 않는다.
 */
function schedulePriceDeferred<T extends object>(result: T) {
  if (!("deferred" in result) || typeof result.deferred !== "function") return result;
  const { deferred, ...rest } = result as T & { deferred: () => Promise<void> };
  after(async () => {
    try {
      await deferred();
    } catch (error) {
      console.error("[beds24/webhook] deferred price refresh failed", error);
    }
  });
  return rest;
}

/** 거절 · 미분류 · 실패 배치 원문 저장 상한(글자). 넘으면 앞부분 표본과 길이만 남긴다(2026-10-26, 실패 배치 2026-11-26). */
const MAX_STORED_REJECTED_BODY_CHARS = 20_000;
const REJECTED_BODY_SAMPLE_CHARS = 4_000;

function capRejectedBody(body: unknown, rawText: string): unknown {
  let serialized: string;
  try {
    serialized = JSON.stringify(body ?? rawText) ?? "";
  } catch {
    serialized = rawText;
  }
  if (serialized.length <= MAX_STORED_REJECTED_BODY_CHARS) return body ?? rawText;
  return {
    truncated: true,
    length: serialized.length,
    sample: serialized.slice(0, REJECTED_BODY_SAMPLE_CHARS),
  };
}

/**
 * 수신한 웹훅 본문을 방어적으로 파싱한다. Beds24 전송은 계정/설정에 따라
 * JSON 으로도, `application/x-www-form-urlencoded` 로도(필드 값 자체가 JSON 문자열인 경우도)
 * 온 적이 있다. 원문 텍스트를 한 번 읽어
 * 두 방식을 모두 시도하므로 수신 경로가 단지
 * 전송 인코딩 때문에 전달을 거부하는 일이 없다.
 */
function parseWebhookBody(raw: string): { body: unknown; parsed: boolean } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { body: null, parsed: false };

  // 1) JSON (Beds24 API v2 웹훅).
  try {
    return { body: JSON.parse(trimmed), parsed: true };
  } catch {
    // 다음 단계로 넘어감
  }

  // 2) 폼 인코딩. 각 필드 값이 JSON 일 수도 있다.
  try {
    const params = new URLSearchParams(trimmed);
    const keys = Array.from(params.keys());
    if (keys.length > 0) {
      const obj: Record<string, unknown> = {};
      for (const [key, value] of params) {
        try {
          obj[key] = JSON.parse(value);
        } catch {
          obj[key] = value;
        }
      }
      return { body: obj, parsed: true };
    }
  } catch {
    // 다음 단계로 넘어감
  }

  return { body: trimmed, parsed: false };
}

/**
 * 비밀값이 서버에 없으면 닫는다(503, 2026-11-13) — 예전엔 열린 채 통과해 누구나 가짜 예약을 upsert 할 수 있었다.
 * 상수 시간 비교 · 헤더 / Bearer / `?secret=` 중 하나라도 맞으면 통과(api-secret). 쿼리는 Beds24 배달 호환으로 유지.
 */
function authorize(request: NextRequest): NextResponse | null {
  const requiredSecret = process.env.BEDS24_WEBHOOK_SECRET?.trim();
  if (!requiredSecret) {
    console.error("[beds24/webhook] BEDS24_WEBHOOK_SECRET is not configured — rejecting delivery");
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }
  const ok = requestMatchesSecret(request, [requiredSecret], {
    headers: ["x-beds24-webhook-secret"],
    query: true,
  });
  return ok ? null : NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
}

/**
 * **재고(가격) 웹훅의 V1 배달** — `GET ?roomId=…&action=…&propId=…`.
 *
 * Beds24 는 재고 웹훅을 `GET` + 질의 파라미터로도 보낸다(저쪽 원본 `functions/index.js`
 * → `priceWebhook`: `const data = method === "GET" ? req.query : req.body`). 여기가 없으면
 * 그런 배달은 **405 로 떨어지고, Beds24 는 실패를 화면에 알려주지 않는다** — 가격 알림이
 * 통째로 사라진 것을 아무도 모른 채 요금이 주기 동기화로만 갱신된다(즉시 → 15분).
 *
 * 예약은 `GET` 으로 오지 않는다. 그래서 여기서는 **가격 배달만** 처리하고, 나머지는
 * 원문을 남긴 뒤 2xx 로 받아준다(재배달 폭주 방지 — `POST` 쪽과 같은 원칙).
 */
export async function GET(request: NextRequest) {
  if (isBeds24SyncPaused()) {
    return NextResponse.json({ ok: true, paused: true }, { status: 202 });
  }
  const denied = authorize(request);
  if (denied) return denied;

  // 질의 파라미터가 곧 페이로드다. 우리 시크릿은 배달 내용이 아니므로 뺀다.
  const body: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams) {
    if (key.toLowerCase() === "secret") continue;
    body[key] = value;
  }

  if (extractPriceWebhookSignal(body)) scheduleForward({ request, method: "GET" });

  const supabase = getSupabaseServiceClient();
  const priceResult = await processBeds24PriceWebhook({ body, supabase });
  if (priceResult.handled) {
    const price = schedulePriceDeferred(priceResult);
    console.log("[beds24/webhook] price delivery (GET)", price);
    return NextResponse.json({ ok: true, accepted: true, price }, { status: 200 });
  }

  console.warn("[beds24/webhook] GET delivery was not a price signal", { keys: Object.keys(body) });
  await recordBeds24WebhookRejection({
    supabase,
    httpStatus: 200,
    reason: `get_not_price_delivery:${priceResult.reason}`,
    rawBody: capRejectedBody(body, ""),
    contentType: null,
  });
  return NextResponse.json(
    { ok: true, accepted: true, processed: 0, note: priceResult.reason },
    { status: 200 },
  );
}

export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  if (isBeds24SyncPaused()) {
    return NextResponse.json({ ok: true, paused: true }, { status: 202 });
  }
  const denied = authorize(request);
  if (denied) return denied;

  const contentType = request.headers.get("content-type");
  const rawText = await request.text();
  const { body } = parseWebhookBody(rawText);

  const supabase = getSupabaseServiceClient();
  const bookingPayloads = extractBeds24WebhookBookingCandidates(body);

  if (bookingPayloads.length === 0 && extractPriceWebhookSignal(body)) {
    scheduleForward({ request, method: "POST", rawBody: rawText, contentType });
  }

  // 예약이 없는 배달 중 **가격 변경 웹훅**을 먼저 걸러낸다 (2026-09-17).
  //
  // Beds24 는 가격 변경을 같은 엔드포인트로 보내는데 실린 것은 `roomId` 와 `action` 뿐이다.
  // 이걸 「알 수 없는 배달」로 처리하면 (1) 에러 로그가 쌓이고 (2) **요금 표가 갱신되지 않아**
  // 판매 캘린더가 없는 가격을 보여준다.
  // 저쪽도 같은 이유로 `priceWebhook` 을 따로 둔다.
  if (bookingPayloads.length === 0) {
    const priceResult = await processBeds24PriceWebhook({ body, supabase });
    if (priceResult.handled) {
      const price = schedulePriceDeferred(priceResult);
      console.log("[beds24/webhook] price delivery", price);
      return NextResponse.json({ ok: true, accepted: true, price }, { status: 200 });
    }
  }

  // 예약을 추출하지 못했다 (파싱 불가 본문이거나 알 수 없는 봉투 형식).
  // 절대 조용히 버리지 말 것: 원문 본문을 저장해 형태를 디버깅하고
  // 전달을 재생할 수 있게 한 뒤, Beds24 가 재시도 폭주를 하지 않도록 ACK 한다. 그 사이 누락된 예약은
  // 매일 하는 정합 작업이 Beds24 API 에서 복구한다.
  if (bookingPayloads.length === 0) {
    console.error("[beds24/webhook] no booking candidates in delivery", {
      contentType,
      topLevelKeys:
        body && typeof body === "object" && !Array.isArray(body)
          ? Object.keys(body as Record<string, unknown>)
          : Array.isArray(body)
            ? "(array)"
            : typeof body,
      // 원문 표본은 남기지 않는다(2026-10-26) — 예약자 개인정보가 로그에 흐르지 않게 키 · 길이만.
      rawLength: rawText.length,
    });
    await recordBeds24WebhookRejection({
      supabase,
      httpStatus: 200,
      reason: "no_booking_candidates",
      rawBody: capRejectedBody(body, rawText),
      contentType,
    });
    return NextResponse.json(
      { ok: true, accepted: true, processed: 0, note: "no_booking_candidates_captured" },
      { status: 200 },
    );
  }

  const organizationIdDefault = process.env.BEDS24_DEFAULT_ORGANIZATION_ID?.trim() ?? null;

  // 결과는 `bookingPayloads` 와 같은 순서 · 같은 길이다(메시지 받기가 번호로 짝짓는다).
  const results: ProcessWebhookBookingResult[] = [];
  let stale = 0;
  let verified = 0;
  let verifyUnavailableApplied = 0;
  let overCap = 0;
  // 확인하지 못하고 적용한 것 · 없는 예약 취소는 자동 안내를 계획하지 않는다.
  const noAutoMessages = new Set<ProcessWebhookBookingResult>();
  const verifyGate = createBeds24VerifyGate(async () => (await readBeds24AccountCredit(supabase))?.remaining ?? null);
  for (const [index, payload] of bookingPayloads.entries()) {
    if (index >= BEDS24_WEBHOOK_MAX_BOOKINGS || performance.now() - startedAt > BOOKING_LOOP_BUDGET_MS) {
      overCap += 1;
      results.push({
        ok: false,
        mode: "over_delivery_cap",
        sourceReservationId: readBeds24OwnBookingId(payload),
      });
      continue;
    }
    let guard: Awaited<ReturnType<typeof guardBeds24WebhookBooking>>;
    try {
      guard = await guardBeds24WebhookBooking({
        payload,
        organizationIdDefault,
        supabase,
        gate: verifyGate,
      });
    } catch (error) {
      console.error("[beds24/webhook] booking guard failed", error instanceof Error ? error.message : "unknown");
      results.push({
        ok: false,
        mode: "upsert_failed",
        sourceReservationId: readBeds24OwnBookingId(payload),
        error: "guard_failed",
      });
      continue;
    }
    if (guard.kind === "stale") {
      stale += 1;
      const bookingId = readBeds24OwnBookingId(payload) ?? "";
      console.warn("[beds24/webhook] skip:stale_delivery", {
        bookingId,
        incomingModifiedTime: guard.incomingModifiedTime,
      });
      results.push({
        ok: true,
        mode: "skipped_stale",
        sourceReservationId: bookingId,
        originalReservationId: bookingId,
        mappedStatus: guard.status,
      });
      continue;
    }
    if (guard.kind === "verify_failed") {
      console.warn("[beds24/webhook] skip:verify_failed", {
        bookingId: readBeds24OwnBookingId(payload),
        mode: guard.mode,
        reason: guard.reason,
      });
      results.push({
        ok: false,
        mode: guard.mode,
        sourceReservationId: readBeds24OwnBookingId(payload),
      });
      continue;
    }
    if (guard.verified) verified += 1;
    if (guard.fallback) {
      if (guard.fallback === "verify_unavailable") verifyUnavailableApplied += 1;
      const tag = guard.fallback === "verify_unavailable" ? "verify_unavailable_applied" : "verify_not_found_cancelled";
      console.warn(`[beds24/webhook] ${tag}`, { bookingId: readBeds24OwnBookingId(payload) });
    }
    const unverifiedAt =
      guard.fallback === "verify_unavailable" ? new Date().toISOString() : (guard.carryUnverifiedAt ?? null);
    const result = await processBeds24WebhookBooking({
      payload: guard.payload,
      organizationIdDefault,
      supabase,
      unverifiedAt,
    });
    if (guard.fallback) noAutoMessages.add(result);
    results.push(result);
  }
  if (overCap > 0) {
    console.warn("[beds24/webhook] skip:over_delivery_cap", {
      total: bookingPayloads.length,
      skipped: overCap,
    });
  }

  const succeeded = results.filter((result) => result.ok).length;
  const failed = results.length - succeeded;

  if (process.env.NODE_ENV === "development") {
    console.log("[beds24/webhook] batch processed", {
      total: results.length,
      succeeded,
      failed,
      modes: results.map((result) => result.mode),
    });
  }

  // 관측성: 배치 결과를 저장해 누락/실패한 예약을 추적할 수 있게 한다
  // (public.beds24_webhook_events 참고). 응답 뒤(`after()`)에 기록하므로
  // 웹훅 지연에 DB 왕복이 더해지지 않는다.
  // 일부 예약 처리에 실패하면 재생/디버깅을 위해 그 원문 본문을 보관한다.
  const anyFailed = failed > 0;
  const durationMs = Math.round(performance.now() - startedAt);
  // 손님 메시지 임시 원문 기록(V1, docs/product/47 §3-4) — `BEDS24_WEBHOOK_CAPTURE_MESSAGES=1` 일 때만, 메시지가 실린 배달만.
  // 실제 배달 모양을 확인하면 끈다. 표는 같은 beds24_webhook_events(모드 `messages_capture`). 첨부는 길이만, 크기 상한.
  // 실패 배치는 원문(재처리용)을 남기되 거절 배달과 같은 20,000자 상한(2026-11-26).
  const captureMessages = shouldCaptureWebhookMessages(body);
  const keepRaw = anyFailed || captureMessages;
  after(() =>
    recordBeds24WebhookEvent({
      supabase,
      durationMs,
      httpStatus: anyFailed ? 207 : 200,
      results,
      rawBody: anyFailed
        ? capRejectedBody(body, rawText)
        : captureMessages
          ? prepareCapturedMessagesPayload(body)
          : undefined,
      contentType: keepRaw ? contentType : undefined,
      extraModes: captureMessages ? ["messages_capture"] : undefined,
    }),
  );

  // 손님 메시지 받기(docs/product/47 §4) — 예약 처리가 끝난 뒤, 응답 뒤에. Beds24 를 새로 부르지 않는다(크레딧 0).
  // 안에서 모든 오류를 삼킨다 — 예약 처리 결과 · 웹훅 응답에 영향이 없다. 바깥 try 는 혹시 모를 동기 예외까지 막는다.
  after(async () => {
    try {
      const ingest = await ingestBeds24WebhookMessages({
        supabase,
        body,
        bookingPayloads,
        results,
        organizationIdDefault,
      });
      // 방금 들어온 메시지의 Airbnb 사진만 Foldy 저장소로 복사(47 §5-8) — 밀린 것은 건드리지 않는다(따라잡기 라우트 몫).
      // 조직마다 6개 · 20초, 던지지 않음. Beds24 호출 없음.
      for (const [organizationId, messageIds] of Object.entries(ingest.mediaMessageIds)) {
        await copyPendingGuestMessageMedia(supabase, organizationId, { messageIds, limit: 6, budgetMs: 20_000 });
      }
    } catch (error) {
      console.error("[beds24/webhook] guest message ingest failed", error instanceof Error ? error.message : "unknown");
    }
  });

  // 손님 메시지 자동 안내(docs/product/47 §5-6) — 들어온 예약만 다시 계획한다(날짜 바뀜 · 취소 · 확정 직후). 큐 넣기 · Beds24 호출 없음.
  // 안에서 모든 오류를 삼킨다.
  after(() =>
    planAutoMessagesAfterWebhook(
      supabase,
      results.filter((result) => result.mode !== "skipped_stale" && !noAutoMessages.has(result)),
    ),
  );

  // 부분 실패한 배치를 Beds24 가 전달 실패로 보고 재시도 폭주를 하지 않도록
  // 항상 2xx 로 ACK 한다. 실패한 행은 위에서(응답 뒤) 기록되고
  // 정합 작업이 복구한다.
  return NextResponse.json(
    {
      ok: !anyFailed,
      processed: results.length,
      succeeded,
      failed,
      stale,
      verified,
      verifyUnavailableApplied,
      results,
    },
    { status: 200 },
  );
}
