/**
 * Beds24 **가격 변경 웹훅**.
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md
 * 원본: STAY ARI Manager `functions/index.js` → `exports.priceWebhook`
 *
 * ## 왜 필요한가
 *
 * 요금은 백필로 한 번 채우면 끝이 아니다. Beds24 화면에서 가격을 바꾸면 그 순간부터 우리 표가
 * 틀린 값을 들고 있게 되고, 판매 캘린더는 **없는 가격을 보여주는 화면**이 된다.
 * 저쪽도 같은 이유로 예약이 아니라 **가격 전용 웹훅**을 따로 받는다.
 *
 * ## 배달 형태
 *
 * 예약 웹훅과 **같은 엔드포인트**로 오지만 예약이 들어 있지 않다. 실린 것은 `roomId` 와
 * `action` 뿐이다.
 *
 * ```
 * V1(GET)  ?roomId=440617&action=PRICE_CHANGE&propId=176430
 * V2(POST) {"roomId":440617,"action":"PRICE_CHANGE","propId":176430}
 * ```
 *
 * `action` 이 비어 오는 경우도 있어 저쪽은 `!action` 도 받아들인다. 우리는 **`roomId` 가 있고
 * 예약이 없으면** 가격 배달로 본다 — 예약 배달은 이 함수에 오기 전에 걸러진다.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { syncBeds24RoomRates } from "@/lib/beds24/room-rates-sync";
import { syncBeds24RoomBlocks } from "@/lib/beds24/room-blocks-sync";
import { markPropertyFullRead, markPropertyWebhook } from "@/lib/beds24/property-rates-state";
import { hasPendingPriceJobs } from "@/lib/beds24/price-job-queue";
import { acquireBeds24Lock, getBeds24Cooldown, releaseBeds24Lock } from "@/lib/beds24/sync-locks";
import type { Database } from "@/types/database";

type JsonRecord = Record<string, unknown>;

/**
 * 같은 건물에 대한 재동기화를 이 시간 안에는 **바로** 다시 하지 않는다.
 *
 * 가격을 일괄로 바꾸면 웹훅이 **객실 수만큼** 쏟아진다(저쪽도 `PRICE_WEBHOOK_INVALIDATION_
 * DEBOUNCE_MS` 로 합친다). 한 번의 동기화가 그 건물의 전 객실 · 12개월을 가져오므로 몰려온
 * 배달은 하나로 합친다.
 *
 * ## 버리지 않고 「창이 끝날 때 한 번 더」 (2026-09-29)
 *
 * 예전(60초)에는 창 안의 배달을 **버렸다.** 그러면 창 안에 들어온 **마지막 변경**은 다음 주기
 * 동기화(실측 약 6시간 뒤)까지 반영되지 않았다 — 실시간이 깨진다. 이제 창 안의 첫 배달이
 * 「창이 끝나면 한 번 더 읽기」를 예약하고(건물별 락으로 하나만), 나머지는 그 예약에 얹힌다.
 * 창을 20초로 줄인 이유: 몰려오는 배달은 몇 초 안에 끝나고, 응답 뒤에 기다리는 시간이 웹훅 함수의
 * 최대 실행 시간(60초) 안에 들어와야 한다.
 */
export const PRICE_WEBHOOK_DEBOUNCE_MS = 20_000;
const TRAILING_LOCK_TTL_MS = 55_000;

/** 건물당 「지금 읽기」는 하나만 — 웹훅과 틱(`/api/beds24/tick`)이 같은 락을 쓴다. */
export function priceWebhookRunLockName(externalPropertyId: string) {
  return `price-webhook-run:${externalPropertyId}`;
}

/**
 * 한 건물을 다시 읽는다 — 요금(12개월: 가격 · 재고 · 최소숙박 · 차단)과 현장 예약 캘린더의 차단
 * 막대(`room_blocks`, 3개월). 재고 웹훅은 이 둘을 다 바꾸는 신호라 같이 맞춘다.
 *
 * 다른 요금 경로(`rates-refresh.ts` · 주기 동기화)와 같은 규칙으로 **물러난다** — 쿨다운 중이면
 * 크레딧이 안 풀리고, 쓰기 작업이 돌고 있으면 그 되받이 웹훅일 가능성이 높다. 그래도 옛 값이 새
 * 값을 덮지 못하는 것은 `upsert_room_daily_rates_if_newer` 가 보장한다.
 *
 * ## 물러나면 적어 둔다 (2026-09-30)
 *
 * 예전에는 물러난 변경을 버렸다 — 다음 주기 동기화(실측 몇 시간 뒤)까지 화면이 Beds24 와 달랐다.
 * 이제 `beds24_deferred_refreshes` 에 「이 건물은 다시 읽어야 한다」를 남기고, 틱
 * (`/api/beds24/tick`)이 쿨다운·작업이 풀리면 이 함수를 다시 불러 읽는다. 읽기가 성공하면 지운다 —
 * 단, 읽기를 **시작한 뒤에** 새로 적힌 요청은 남긴다 — 그 변경을 이 읽기가 못 봤을 수 있다.
 *
 * `source` — 웹훅에서 온 요청은 새 변경이므로 틱의 재시도 횟수를 0 으로 돌린다. 틱이 부를 때는
 * 횟수를 틱이 센다.
 */
export async function refreshBeds24Property(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  externalPropertyId: string,
  source: "webhook" | "tick",
): Promise<
  | { yielded: "cooldown" | "price_job" }
  | { yielded: null; rows: number; skipped: string[] }
> {
  const startedAt = Date.now();
  const cooldown = await getBeds24Cooldown(supabase);
  const yielded = cooldown.active
    ? "cooldown"
    : (await hasPendingPriceJobs(supabase))
      ? "price_job"
      : null;
  if (yielded) {
    await recordDeferredRefresh(supabase, {
      externalPropertyId,
      organizationId,
      reason: yielded,
      resetAttempts: source === "webhook",
    });
    return { yielded };
  }

  const readStartedAt = Date.now();
  const rates = await syncBeds24RoomRates(organizationId, supabase, undefined, {
    externalPropertyIds: [externalPropertyId],
  });
  // 차단 막대는 실패해도 요금 갱신을 되돌리지 않는다 — 6시간 정합성 크론이 안전망이다.
  await syncBeds24RoomBlocks(supabase, {
    externalPropertyIds: [externalPropertyId],
    organizationId,
  }).catch((error) => {
    console.error("[beds24/price-webhook] room block refresh failed", error);
  });

  if (rates.skipped.length === 0) {
    await clearDeferredRefresh(supabase, externalPropertyId, startedAt);
    // 안전망은 가장 오래 안 읽힌 건물부터 돈다 — 방금 읽은 이 건물은 뒤로 밀린다.
    await markPropertyFullRead(supabase, organizationId, externalPropertyId, source, readStartedAt);
  } else if (source === "webhook") {
    // 읽다 실패했다(429 등). 버리지 않고 틱에게 넘긴다.
    await recordDeferredRefresh(supabase, {
      externalPropertyId,
      lastError: rates.skipped.join(","),
      organizationId,
      reason: "failed",
      resetAttempts: true,
    });
  }
  return { rows: rates.rows, skipped: rates.skipped, yielded: null };
}

/** 건물 한 줄을 남긴다(있으면 갱신). 실패해도 던지지 않는다 — 다음 주기 동기화가 안전망이다. */
async function recordDeferredRefresh(
  supabase: SupabaseClient<Database>,
  args: {
    externalPropertyId: string;
    organizationId: string;
    reason: "cooldown" | "price_job" | "failed";
    resetAttempts: boolean;
    lastError?: string;
  },
): Promise<void> {
  const nowIso = new Date().toISOString();
  const result = await supabase.from("beds24_deferred_refreshes").upsert(
    {
      external_property_id: args.externalPropertyId,
      organization_id: args.organizationId,
      reason: args.reason,
      requested_at: nowIso,
      updated_at: nowIso,
      ...(args.resetAttempts ? { attempts: 0 } : {}),
      ...(args.lastError !== undefined ? { last_error: args.lastError } : {}),
    },
    { onConflict: "external_property_id" },
  );
  if (result.error) {
    console.error("[beds24/price-webhook] deferred refresh record failed", {
      code: result.error.code,
      externalPropertyId: args.externalPropertyId,
    });
  }
}

async function clearDeferredRefresh(
  supabase: SupabaseClient<Database>,
  externalPropertyId: string,
  refreshStartedAt: number,
): Promise<void> {
  const result = await supabase
    .from("beds24_deferred_refreshes")
    .delete()
    .eq("external_property_id", externalPropertyId)
    .lte("requested_at", new Date(refreshStartedAt).toISOString());
  if (result.error) {
    console.error("[beds24/price-webhook] deferred refresh clear failed", {
      code: result.error.code,
      externalPropertyId,
    });
  }
}

function describeRefresh(refreshed: Awaited<ReturnType<typeof refreshBeds24Property>>) {
  return refreshed.yielded
    ? { yielded: refreshed.yielded }
    : { rows: refreshed.rows, skipped: refreshed.skipped };
}

function readString(record: JsonRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}


export type PriceWebhookSignal = {
  action: string | null;
  externalPropertyId: string | null;
  externalRoomId: string;
};

/**
 * 배달에서 가격 신호를 읽는다. 가격 배달이 아니면 `null`.
 *
 * **순수 함수다** — 모양 판정은 테스트로 고정한다
 * (`src/lib/__tests__/beds24-price-webhook.test.ts`).
 */
export function extractPriceWebhookSignal(body: unknown): PriceWebhookSignal | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as JsonRecord;

  const externalRoomId = readString(record, ["roomId", "roomid", "room_id"]);
  if (!externalRoomId) return null;

  const action = readString(record, ["action"]);
  // 저쪽과 같은 집합. `action` 이 없는 배달도 받아들인다 — Beds24 V1 이 그렇게 보낸다.
  if (action && !["PRICE_CHANGE", "SYNC_ROOM"].includes(action.toUpperCase())) return null;

  return {
    action,
    externalPropertyId: readString(record, ["propId", "propertyId", "propid", "property_id"]),
    externalRoomId,
  };
}

export type PriceWebhookResult =
  | { handled: false; reason: "not_a_price_delivery" | "unknown_room" }
  | {
      handled: true;
      skipped: true;
      /** `debounced_trailing` = 창이 끝날 때 한 번 더 읽는 일을 **이 배달이** 예약했다. */
      reason: "debounced" | "debounced_trailing";
      externalPropertyId: string;
      /** 응답 뒤에 돌릴 일(라우트가 `after()` 로 부른다). 없으면 이미 누가 예약했다. */
      deferred?: () => Promise<void>;
    }
  | {
      handled: true;
      skipped: false;
      externalPropertyId: string;
      organizationId: string;
      /**
       * 건물 다시 읽기 — **응답 뒤에** 돈다(라우트가 `after()` 로 부른다). 12개월 읽기를 기다렸다
       * 응답하면 Beds24 가 늦은 응답을 실패로 보고 재배달한다.
       */
      deferred: () => Promise<void>;
    };

/**
 * 가격 배달을 처리한다 — 그 **건물**의 요금을 다시 가져온다.
 *
 * 객실 하나만 가져오지 않는 이유: Beds24 의 `/inventory/rooms/calendar` 는 **건물 단위**로
 * 응답한다. 한 객실을 위해 요청해도 그 건물이 통째로 오므로, 어차피 전부 저장하는 편이 낫다.
 *
 * ## 되받아치기 방지
 *
 * 우리가 Beds24 에 가격을 쓰면 Beds24 가 그 변경을 웹훅으로 되돌려 보낸다. 판매 캘린더의
 * 쓰기 기능이 살아 있으므로(2026-09-24) 이건 **실제로 일어나는 일**이다.
 *
 * 지금은 **디바운스가 그 역할을 겸한다.** 가격 작업 워커는 Beds24 에 쓴 뒤 `room_daily_rates`
 * 를 직접 갱신하므로 그 건물의 `synced_at` 이 방금 값이 되고, 뒤따라 오는 되받이 웹훅은
 * `PRICE_WEBHOOK_DEBOUNCE_MS` 안에 들어와 버려진다 — 우리가 쓴 값을 다시 읽어오는 왕복이
 * 생기지 않는다.
 *
 * 디바운스보다 늦게 오는 되받이는 통과하지만, 그때는 그냥 **같은 값을 다시 읽는 것**이라
 * 해롭지 않다. 「우리가 만든 변경인가」 판정이 필요해지는 건 디바운스를 줄일 때다.
 */
export async function processBeds24PriceWebhook(args: {
  body: unknown;
  supabase: SupabaseClient<Database>;
  /** 배달에 조직 정보가 없으므로 방으로 거슬러 찾는다. */
  fallbackOrganizationId?: string | null;
}): Promise<PriceWebhookResult> {
  const signal = extractPriceWebhookSignal(args.body);
  if (!signal) return { handled: false, reason: "not_a_price_delivery" };

  // roomId → 우리 방 → 건물. 모르는 방이면 **Beds24 를 부르지 않고 끝낸다**(저쪽과 같다) —
  // 남의 계정 웹훅이나 폐기된 방으로 API 크레딧을 쓰지 않기 위해서다.
  const roomResult = await args.supabase
    .from("rooms")
    .select("organization_id, properties(external_property_id)")
    .eq("external_provider", "beds24")
    .eq("external_room_id", signal.externalRoomId)
    .maybeSingle();

  if (roomResult.error) {
    console.error("[beds24/price-webhook] room lookup failed", roomResult.error);
    return { handled: false, reason: "unknown_room" };
  }

  const row = roomResult.data as {
    organization_id: string;
    properties: { external_property_id: string | null } | { external_property_id: string | null }[] | null;
  } | null;
  if (!row) {
    console.warn("[beds24/price-webhook] unknown roomId; ignored without Beds24 call", {
      externalRoomId: signal.externalRoomId,
    });
    return { handled: false, reason: "unknown_room" };
  }

  const propertyRow = Array.isArray(row.properties) ? row.properties[0] : row.properties;
  const externalPropertyId = propertyRow?.external_property_id ?? signal.externalPropertyId;
  if (!externalPropertyId) {
    return { handled: false, reason: "unknown_room" };
  }

  // 디바운스 — **DB 의 `synced_at` 으로 본다.** 서버리스에서는 인스턴스가 매번 새로 뜨므로
  // 메모리 플래그가 남지 않는다.
  //
  // **건물별로 본다.** 조직 전체로 보면 아라키초A 를 방금 동기화한 탓에 가부키초 웹훅이
  // 통째로 버려진다 — 가격을 여러 건물에 걸쳐 바꾸면 실제로 그렇게 된다.
  const roomIdsResult = await args.supabase
    .from("rooms")
    .select("id, properties!inner(external_property_id)")
    .eq("organization_id", row.organization_id)
    .eq("properties.external_property_id", externalPropertyId);
  const propertyRoomIds = ((roomIdsResult.data ?? []) as Array<{ id: string }>).map((r) => r.id);

  const freshResult = propertyRoomIds.length
    ? await args.supabase
        .from("room_daily_rates")
        .select("synced_at")
        .eq("organization_id", row.organization_id)
        .in("room_id", propertyRoomIds)
        .order("synced_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };
  const lastSyncedAt = (freshResult.data as { synced_at: string } | null)?.synced_at ?? null;
  const organizationId = row.organization_id;
  const supabase = args.supabase;

  // 배달이 왔다는 사실은 디바운스와 상관없이 남긴다 — 안전망이 「웹훅이 놓쳤나」를 가릴 때 쓴다.
  await markPropertyWebhook(supabase, organizationId, externalPropertyId);

  /**
   * 창이 끝나면 한 번 더 읽도록 예약한다(건물별로 하나만). 이미 누가 예약했으면 그걸로 충분하다.
   * `baseMs` 는 창이 시작된 시각 — 마지막 동기화 시각, 또는 남이 지금 읽고 있으면 지금.
   */
  const scheduleTrailing = async (baseMs: number): Promise<PriceWebhookResult> => {
    const lockName = `price-webhook-trailing:${externalPropertyId}`;
    const lock = await acquireBeds24Lock(supabase, lockName, "price-webhook", TRAILING_LOCK_TTL_MS);
    if (!lock.acquired) {
      return { handled: true, skipped: true, reason: "debounced", externalPropertyId };
    }
    const waitMs = Math.max(0, baseMs + PRICE_WEBHOOK_DEBOUNCE_MS - Date.now() + 1_000);
    return {
      externalPropertyId,
      handled: true,
      reason: "debounced_trailing",
      skipped: true,
      deferred: async () => {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        // **읽기 전에 락을 푼다.** 읽는 동안 들어온 배달이 또 한 번을 예약할 수 있어야 한다 —
        // 쥔 채로 읽으면 그 배달은 「이미 예약됨」으로 버려지고, 읽기가 그 변경을 놓칠 수 있다.
        await releaseBeds24Lock(supabase, lockName, lock.lockId);
        const refreshed = await refreshBeds24Property(supabase, organizationId, externalPropertyId, "webhook");
        console.log("[beds24/price-webhook] trailing refresh", {
          externalPropertyId,
          ...describeRefresh(refreshed),
        });
      },
    };
  };

  if (lastSyncedAt && Date.now() - new Date(lastSyncedAt).getTime() < PRICE_WEBHOOK_DEBOUNCE_MS) {
    // 창 안이다. **버리지 않는다** — 창이 끝나면 한 번 더 읽는다.
    return scheduleTrailing(new Date(lastSyncedAt).getTime());
  }

  /*
   * 지금 읽는다 — 단, **건물당 하나만.** Beds24 는 한 번의 변경에 배달을 여러 건 같은 초에
   * 보낸다(2026-09-29 실측: 343112 에 5건, 176430 에 2건이 같은 초). 그때는 전부 `synced_at` 이
   * 오래됐다고 보고 각자 12개월을 다시 읽었다. 이제 하나만 읽고, 나머지는 「창이 끝나면 한 번 더」
   * 로 돌린다 — 읽는 도중에 들어온 변경을 그 읽기가 못 봤을 수 있기 때문이다.
   */
  const runLockName = priceWebhookRunLockName(externalPropertyId);
  const runLock = await acquireBeds24Lock(supabase, runLockName, "price-webhook", TRAILING_LOCK_TTL_MS);
  if (!runLock.acquired) return scheduleTrailing(Date.now());

  return {
    handled: true,
    skipped: false,
    externalPropertyId,
    organizationId,
    deferred: async () => {
      try {
        const refreshed = await refreshBeds24Property(supabase, organizationId, externalPropertyId, "webhook");
        console.log("[beds24/price-webhook] refresh", {
          externalPropertyId,
          ...describeRefresh(refreshed),
        });
      } finally {
        await releaseBeds24Lock(supabase, runLockName, runLock.lockId);
      }
    },
  };
}
