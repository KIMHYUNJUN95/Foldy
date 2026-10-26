import { after, NextResponse, type NextRequest } from "next/server";
import { extractBeds24WebhookBookingCandidates } from "@/lib/beds24/booking-payload";
import { processBeds24WebhookBooking } from "@/lib/beds24/process-webhook-booking";
import { processBeds24PriceWebhook } from "@/lib/beds24/price-webhook";
import { isBeds24SyncPaused } from "@/lib/beds24/sync-control";
import {
  recordBeds24WebhookEvent,
  recordBeds24WebhookRejection,
} from "@/lib/beds24/webhook-events";
import { forwardBeds24Delivery, parseForwardTargets } from "@/lib/beds24/webhook-forward";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requestMatchesSecret } from "@/lib/api-secret";

/**
 * 가격 웹훅이 건물 다시 읽기(「창이 끝나면 한 번 더」면 최대 20초 대기 + 건물 하나 동기화)를 응답
 * 뒤에 돌린다. 그 시간이 이 안에 들어와야 한다.
 */
export const maxDuration = 60;

/**
 * 받은 배달을 다른 수신처로 넘긴다 — **기본 꺼짐**.
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

/** 거절 · 미분류 배달 원문 저장 상한(글자). 넘으면 앞부분 표본과 길이만 남긴다(2026-10-26). */
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
 * Parse an inbound webhook body defensively. Beds24 deliveries have shipped as
 * JSON *and* as `application/x-www-form-urlencoded` (sometimes with a field whose
 * value is itself a JSON string) depending on account/config. We read the raw
 * text once and try both so the ingestion path never rejects a delivery merely
 * because of its transport encoding.
 */
function parseWebhookBody(raw: string): { body: unknown; parsed: boolean } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { body: null, parsed: false };

  // 1) JSON (Beds24 API v2 webhooks).
  try {
    return { body: JSON.parse(trimmed), parsed: true };
  } catch {
    // fall through
  }

  // 2) Form-encoded. Each field value may itself be JSON.
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
    // fall through
  }

  return { body: trimmed, parsed: false };
}

function isAuthorized(request: NextRequest): boolean {
  const requiredSecret = process.env.BEDS24_WEBHOOK_SECRET?.trim();
  // TODO(2026-10-26, 운영 환경변수 미확인): 시크릿이 설정되지 않으면 통과(fail-open)한다 — 설정 전 배포를 견디려는
  // 기존 동작이라 바꾸지 않았다. 운영에 BEDS24_WEBHOOK_SECRET 이 확실히 있음을 확인한 뒤 닫을 것.
  if (!requiredSecret) return true;
  // 상수 시간 비교 · 헤더 / Bearer / 쿼리 중 하나라도 맞으면 통과(api-secret). 쿼리 시크릿은 기존 배달 호환으로 유지.
  return requestMatchesSecret(request, [requiredSecret], {
    headers: ["x-beds24-webhook-secret"],
    query: true,
  });
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
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // 질의 파라미터가 곧 페이로드다. 우리 시크릿은 배달 내용이 아니므로 뺀다.
  const body: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams) {
    if (key.toLowerCase() === "secret") continue;
    body[key] = value;
  }

  scheduleForward({ request, method: "GET" });

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
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const contentType = request.headers.get("content-type");
  const rawText = await request.text();
  const { body } = parseWebhookBody(rawText);

  scheduleForward({ request, method: "POST", rawBody: rawText, contentType });

  const supabase = getSupabaseServiceClient();
  const bookingPayloads = extractBeds24WebhookBookingCandidates(body);

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

  // No booking could be extracted (unparseable body or unrecognized envelope).
  // NEVER drop this silently: persist the raw body so the shape is debuggable and
  // the delivery is replayable, then ACK so Beds24 does not retry-storm. The daily
  // reconciliation heals the missed reservation from the Beds24 API in the meantime.
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

  const results: Awaited<ReturnType<typeof processBeds24WebhookBooking>>[] = [];
  for (const payload of bookingPayloads) {
    const result = await processBeds24WebhookBooking({
      payload,
      organizationIdDefault,
      supabase,
    });
    results.push(result);
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

  // Observability: persist the batch result so a dropped/failed booking is traceable
  // (see public.beds24_webhook_events). Written after the response (`after()`) so it
  // never adds a DB round-trip to the webhook latency.
  // When some bookings failed to process, keep their raw body for replay/debug.
  const anyFailed = failed > 0;
  const durationMs = Math.round(performance.now() - startedAt);
  after(() =>
    recordBeds24WebhookEvent({
      supabase,
      durationMs,
      httpStatus: anyFailed ? 207 : 200,
      results,
      rawBody: anyFailed ? body : undefined,
      contentType: anyFailed ? contentType : undefined,
    }),
  );

  // Always ACK with 2xx, so Beds24 does not treat a partially-failed batch as a
  // delivery failure and retry-storm; the failed rows are recorded above (after the
  // response) and healed by reconciliation.
  return NextResponse.json(
    {
      ok: !anyFailed,
      processed: results.length,
      succeeded,
      failed,
      results,
    },
    { status: 200 },
  );
}
