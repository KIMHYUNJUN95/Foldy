import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import type { Database } from "@/types/database";
import { recordBeds24AccountCredit } from "@/lib/beds24/account-credit";
import { readBeds24Credits } from "@/lib/beds24/credits";
import {
  BEDS24_DEFAULT_CREDENTIAL_KEY,
  type Beds24CreditActor,
  type Beds24CreditCallContext,
  type Beds24CreditFeature,
} from "@/lib/beds24/credit-usage-types";

/**
 * Beds24 크레딧 사용 기록 — **모든 Beds24 호출이 지나는 한 곳** (2026-11-18).
 *
 * 도메인 계약: docs/engineering/01-beds24-integration.md → 「크레딧 사용 기록」.
 *
 * - `beds24Fetch` 가 응답(실패 · 429 · 네트워크 오류 포함)마다 `beds24_credit_usage` 에 한 줄을 남기고,
 *   헤더가 있으면 계정 마지막 값(`beds24_sync_locks` 'account_credit')도 갱신한다.
 * - 「누가」는 호출 지점이 아니라 **바깥에서** 정한다: 사람이 누른 서버 액션 · 요금 작업 워커가
 *   `withBeds24CreditScope` 로 감싸면 그 안의 모든 호출(토큰 갱신 · 되읽기 포함)이 그 사람 몫이 된다.
 *   감싸지 않은 호출(크론 · 웹훅 · 백필)은 `{ kind: "auto", job }` — job 은 호출 지점이 준 이름.
 * - **기록은 절대 던지지 않는다.** 기록이 실패해도 Beds24 호출 결과는 그대로 돌려준다.
 * - 호출마다 두 쓰기를 **바로 시작**하고, 각자 중단 시한(`BEDS24_CREDIT_WRITE_TIMEOUT_MS`)을 건다. 요청 사이에
 *   공유되는 상태는 없다 — 순서는 DB 함수(`beds24_record_account_credit`)가 지킨다.
 *   · 계정 마지막 값 — **늦으면 안 된다.** 응답은 그 쓰기를 최대 `BEDS24_ACCOUNT_CREDIT_WAIT_MS` 만 기다린다.
 *   · 사용 줄 — **늦어도 되지만 사라지면 안 된다.** 기다리지 않는다.
 *   두 쓰기 모두 그 호출이 속한 요청의 `after()` 에 걸어, 서버리스가 끝까지(시한 안) 지켜보게 한다.
 * - 토큰 · 헤더 원문 · 요청 본문은 남기지 않는다 — 숫자 헤더 3개와 상태 코드만.
 *
 * `server-only` 를 직접 import 하지 않는다 — Beds24 호출 모듈을 읽는 기존 테스트가 많다. 서비스 클라이언트는
 * 기록할 때 동적으로 불러오고, 못 불러오면(테스트 · 환경 변수 없음) 조용히 건너뛴다.
 */

export type Beds24CreditScope = {
  actor?: Beds24CreditActor;
  organizationId?: string | null;
  feature?: Beds24CreditFeature;
};

/** 호출 지점이 아는 것. 사람(`actor`)은 여기서 정하지 않는다. */
export type Beds24CreditHint = {
  feature?: Beds24CreditFeature;
  action?: string;
  itemCount?: number | null;
  organizationId?: string | null;
  /** 바깥에 사람이 없을 때 「자동 — 무슨 작업」. */
  job?: string;
  credentialKey?: string;
};

type Client = SupabaseClient<Database>;

const scopeStorage = new AsyncLocalStorage<Beds24CreditScope>();

function definedOnly(scope: Beds24CreditScope): Beds24CreditScope {
  const out: Beds24CreditScope = {};
  if (scope.actor !== undefined) out.actor = scope.actor;
  if (scope.organizationId !== undefined) out.organizationId = scope.organizationId;
  if (scope.feature !== undefined) out.feature = scope.feature;
  return out;
}

/** 안쪽 값이 바깥 값을 덮는다. */
export function withBeds24CreditScope<T>(scope: Beds24CreditScope, fn: () => Promise<T>): Promise<T> {
  return scopeStorage.run({ ...scopeStorage.getStore(), ...definedOnly(scope) }, fn);
}

/** 감싼 뒤에야 알게 된 것(요금 작업 워커가 작업을 집은 뒤의 요청자)을 지금 범위에 채운다. 범위 밖이면 아무것도 안 한다. */
export function updateBeds24CreditScope(patch: Beds24CreditScope): void {
  const store = scopeStorage.getStore();
  if (store) Object.assign(store, definedOnly(patch));
}

export function currentBeds24CreditScope(): Beds24CreditScope | undefined {
  return scopeStorage.getStore();
}

export function userCreditActor(user: { id: string; name?: string | null }): Beds24CreditActor {
  return { kind: "user", userId: user.id, name: user.name?.trim() || "" };
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split("?")[0] ?? "";
  }
}

/** URL · 메서드로 짐작한 「어디에」. 호출 지점 · 범위가 정해 주면 그쪽이 이긴다. */
export function inferBeds24CreditFeature(url: string, method: string): Beds24CreditFeature {
  const path = pathOf(url).toLowerCase();
  const post = method.toUpperCase() !== "GET";
  if (path.includes("/authentication/")) return "auth";
  if (path.includes("/bookings/messages")) return "guest_messages";
  if (path.includes("/reviews")) return "reviews_sync";
  if (path.includes("/inventory/")) return post ? "rates_write" : "rates_read";
  if (path.endsWith("/bookings")) return post ? "booking_write" : "bookings_sync";
  if (path.includes("/properties")) return "rooms_sync";
  return "other";
}

/** `calendar.get` · `bookings.post` 처럼 마지막 경로 조각 + 메서드. */
export function inferBeds24CreditAction(url: string, method: string): string {
  const segments = pathOf(url).split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "unknown";
  return `${last}.${method.toLowerCase()}`;
}

export function resolveBeds24CreditContext(
  url: string,
  method: string,
  hint: Beds24CreditHint = {},
  scope: Beds24CreditScope | undefined = scopeStorage.getStore(),
): Beds24CreditCallContext {
  // 범위의 job(크론 · 워커 입구)이 호출 지점 job 보다 이긴다 — 요금 작업 크론이 「calendar」로 남지 않게.
  const actor: Beds24CreditActor =
    scope?.actor?.kind === "user"
      ? scope.actor
      : { kind: "auto", job: (scope?.actor?.kind === "auto" ? scope.actor.job : undefined) ?? hint.job ?? "unknown" };
  return {
    organizationId: hint.organizationId ?? scope?.organizationId ?? null,
    feature: hint.feature ?? scope?.feature ?? inferBeds24CreditFeature(url, method),
    actor,
    action: hint.action ?? inferBeds24CreditAction(url, method),
    itemCount: hint.itemCount ?? null,
    credentialKey: hint.credentialKey ?? BEDS24_DEFAULT_CREDENTIAL_KEY,
  };
}

export type Beds24CreditUsageInsert = Database["public"]["Tables"]["beds24_credit_usage"]["Insert"];

/** 응답 헤더(없으면 null = 네트워크 오류) → 기록 한 줄. **순수 함수.** */
export function buildBeds24CreditUsageRow(
  ctx: Beds24CreditCallContext,
  response: { status: number; headers: Headers } | null,
  nowMs: number,
): Beds24CreditUsageInsert {
  const credit = response ? readBeds24Credits(response.headers) : null;
  const intOrNull = (value: number | null | undefined) =>
    typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
  return {
    called_at: new Date(nowMs).toISOString(),
    organization_id: ctx.organizationId,
    credential_key: ctx.credentialKey ?? BEDS24_DEFAULT_CREDENTIAL_KEY,
    feature: ctx.feature,
    action: ctx.action.slice(0, 80),
    item_count: intOrNull(ctx.itemCount),
    actor_kind: ctx.actor.kind,
    actor_user_id: ctx.actor.kind === "user" ? ctx.actor.userId : null,
    actor_name: ctx.actor.kind === "user" ? ctx.actor.name || null : null,
    actor_job: ctx.actor.kind === "auto" ? ctx.actor.job.slice(0, 80) : null,
    cost: intOrNull(credit?.requestCost),
    remaining: intOrNull(credit?.remaining),
    resets_at:
      credit && credit.resetsIn !== null ? new Date(nowMs + credit.resetsIn * 1000).toISOString() : null,
    http_status: response ? response.status : null,
  };
}

async function loadServiceClient(): Promise<Client | null> {
  try {
    const { getSupabaseServiceClient } = await import("@/lib/supabase/service");
    return getSupabaseServiceClient();
  } catch {
    return null;
  }
}

/**
 * 계정 값 쓰기를 기다리는 상한. 부른 쪽 시간 제한 중 가장 짧은 것(웹훅 전달 10초 · 예약 되읽기 10초 ·
 * 예약 쓰기 20초)의 10분의 1 — 평소 RPC 한 번(수십 ms)은 넉넉히 들어오고, DB 가 막혀도 호출당 1초 넘게 먹지 않는다.
 */
export const BEDS24_ACCOUNT_CREDIT_WAIT_MS = 1_000;
/** 기록 쓰기 하나의 중단 시한. 이 안에 못 쓰면 버린다(로그) — `after()` 가 maxDuration 까지 붙잡히지 않게. */
export const BEDS24_CREDIT_WRITE_TIMEOUT_MS = 4_000;

type ResponseSnapshot = { status: number; headers: Headers };

/** `task` 가 `ms` 안에 끝나면 "done", 아니면 "timeout". 어느 쪽이든 타이머는 치운다. */
async function raceTimeout(task: Promise<unknown>, ms: number): Promise<"done" | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  try {
    return await Promise.race([task.then(() => "done" as const), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** 중단 신호 + 같은 시한의 race — 드라이버가 신호를 무시해도 이 promise 는 시한 안에 끝난다. */
async function withDeadline(label: string, write: (signal: AbortSignal) => Promise<void>): Promise<void> {
  const controller = new AbortController();
  try {
    const outcome = await raceTimeout(write(controller.signal), BEDS24_CREDIT_WRITE_TIMEOUT_MS);
    if (outcome === "timeout") console.error(`[beds24/credit-ledger] ${label} timed out`);
  } catch (error) {
    console.error(`[beds24/credit-ledger] ${label} failed`, error instanceof Error ? error.message : "unknown");
  } finally {
    controller.abort();
  }
}

/** 이 호출이 속한 요청의 `after()` 에 건다. 요청 밖(스크립트 · 테스트)이면 이미 돌고 있는 promise 그대로 둔다. */
function keepAliveAfterResponse(task: Promise<void>): void {
  try {
    after(() => task);
  } catch {
    // 요청 밖.
  }
}

/** 없는 사람 id(탈퇴 · 삭제 직후)로 FK 가 막히면 id 만 비우고 한 번 더 — 이름 사본은 남는다. */
async function insertUsageRow(supabase: Client, row: Beds24CreditUsageInsert, signal: AbortSignal): Promise<void> {
  const insert = (value: Beds24CreditUsageInsert) =>
    supabase.from("beds24_credit_usage").insert(value).abortSignal(signal);
  let result = await insert(row);
  if (result.error?.code === "23503" && row.actor_user_id) {
    result = await insert({ ...row, actor_user_id: null });
  }
  if (result.error) console.error("[beds24/credit-ledger] insert failed", result.error.message);
}

function accountCreditInput(response: ResponseSnapshot, nowMs: number) {
  const credit = readBeds24Credits(response.headers);
  return {
    remaining: credit.remaining,
    resetsAt: credit.resetsIn !== null ? nowMs + credit.resetsIn * 1000 : null,
    requestCost: credit.requestCost,
    limit: credit.limit ?? null,
  };
}

/** 'account_credit' 은 지금 유일한 토큰(main)의 값이다. 다른 토큰이 생기면 그 토큰 줄을 따로 둔다. */
function writesAccountCredit(ctx: Beds24CreditCallContext, response: ResponseSnapshot | null): response is ResponseSnapshot {
  return Boolean(response) && (ctx.credentialKey ?? BEDS24_DEFAULT_CREDENTIAL_KEY) === BEDS24_DEFAULT_CREDENTIAL_KEY;
}

async function recordCall(ctx: Beds24CreditCallContext, response: Response | null): Promise<void> {
  try {
    const nowMs = Date.now();
    const snapshot: ResponseSnapshot | null = response
      ? { status: response.status, headers: new Headers(response.headers) }
      : null;
    const row = buildBeds24CreditUsageRow(ctx, snapshot, nowMs);
    const clientPromise = loadServiceClient();
    keepAliveAfterResponse(
      withDeadline("insert", async (signal) => {
        const supabase = await clientPromise;
        if (supabase) await insertUsageRow(supabase, row, signal);
      }),
    );
    if (!writesAccountCredit(ctx, snapshot)) return;
    const account = withDeadline("account write", async (signal) => {
      const supabase = await clientPromise;
      if (supabase) {
        await recordBeds24AccountCredit(supabase, accountCreditInput(snapshot, nowMs), `${ctx.feature}:${ctx.action}`, nowMs, { signal });
      }
    });
    keepAliveAfterResponse(account);
    await raceTimeout(account, BEDS24_ACCOUNT_CREDIT_WAIT_MS);
  } catch (error) {
    console.error("[beds24/credit-ledger] record failed", error instanceof Error ? error.message : "unknown");
  }
}

/**
 * Beds24 를 부르는 유일한 fetch. 동작은 `fetch` 그대로다(던지면 그대로 던지고, 응답은 그대로 돌려준다) —
 * 그 사이에 기록만 더한다(계정 값은 최대 `BEDS24_ACCOUNT_CREDIT_WAIT_MS` 기다림, 사용 줄은 기다리지 않음). 응답 본문은 읽지 않는다.
 */
export async function beds24Fetch(
  url: string,
  init: RequestInit = {},
  hint: Beds24CreditHint = {},
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const ctx = resolveBeds24CreditContext(url, init.method ?? "GET", hint);
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    await recordCall(ctx, null);
    throw error;
  }
  await recordCall(ctx, response);
  return response;
}

/**
 * 주입형 fetch 를 쓰는 곳(손님 메시지)에 넘기는 기록용 fetch.
 * **문자열 · URL 입력만** 쓴다 — 주입 자리 모양 때문에 `typeof fetch` 지만, `Request` 를 넘기면 url 만 쓰고
 * 그 안의 method · headers · body 는 버린다(지금 호출부는 모두 문자열 URL + init).
 */
export function createBeds24LedgerFetch(hint: Beds24CreditHint = {}): typeof fetch {
  return (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return beds24Fetch(url, init ?? {}, hint);
  };
}
