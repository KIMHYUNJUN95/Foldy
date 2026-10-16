import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Beds24HttpError,
  fetchBeds24Calendar,
  LOW_CREDIT_THRESHOLD,
  postBeds24Calendar,
  type CalendarRoomData,
} from "@/lib/beds24/calendar-client";
import { buildCalendarSegments, type CalendarDateValues } from "@/lib/beds24/calendar-write-payload";
import {
  isWithinCoalesceWindow,
  mergePriceJobRoomUpdates,
  type MergeableJob,
  type PriceJobRoomUpdate,
} from "@/lib/beds24/price-job-merge";
import {
  diffCalendarReadback,
  mismatchFailure,
  toLinkedUnitExpectation,
  type CalendarReadSegment,
  type ExpectedDateValues,
  type PriceJobFailure,
} from "@/lib/beds24/price-write-verification";
import {
  acquireBeds24Lock,
  activateBeds24Cooldown,
  getBeds24Cooldown,
  PRICE_JOB_LOCK,
  PRICE_JOB_LOCK_TTL_MS,
  releaseBeds24Lock,
  shouldCooldownForCredit,
} from "@/lib/beds24/sync-locks";
import { encodePriceJobWait, type PriceJobWaitReason } from "@/lib/beds24/price-job-wait";
import type { Database } from "@/types/database";
import { signalBeds24Change } from "@/lib/beds24/live-signal";

/**
 * 가격·최소숙박 작업 워커.
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md 「작업 큐」·「쓰기 안전장치」
 * 원본: STAY ARI Manager `functions/index.js` — `processPriceJob`, `scheduledPriceJobWorker`
 *
 * ## 한 번에 하나만 돈다
 *
 * Beds24 V2 는 **계정 단위 5분 크레딧**을 예약·가격·캘린더가 함께 쓴다. 여러 작업이 동시에
 * POST 하면 주기 동기화·웹훅과 크레딧을 다투고 429 가 난다. 그래서 락 하나로 직렬화한다.
 *
 * ## 쓰고 나서 **반드시 다시 읽는다**
 *
 * Beds24 는 값을 반영하지 않고도 `success: true` 를 돌려준다. 되읽어 대조하지 않으면
 * 반영 실패가 「성공」으로 기록되고, 화면에는 바뀐 값이 뜨는데 채널에 나가는 가격은 옛것이다.
 */

const JOB_LOCK_OWNER = "price-job-worker";
/** 한 번에 Beds24 로 묶어 보낼 객실 수. 저쪽과 같다. */
const WRITE_BATCH_SIZE = 50;
/** 되읽기 한 번에 물어볼 객실 수. */
const VERIFY_BATCH_SIZE = 20;
/** 링크 전파에 시간이 걸린다 — 바로 안 맞으면 조금 쉬고 다시 읽는다. */
const VERIFY_ATTEMPTS = 3;
/** 15분 넘게 `processing` 이면 죽은 것으로 보고 되돌린다. */
const STUCK_JOB_MS = 15 * 60 * 1000;

type Client = SupabaseClient<Database>;

type JobRow = Database["public"]["Tables"]["beds24_price_jobs"]["Row"];

export type PriceJobOutcome =
  | { ran: false; reason: "cooldown" | "lock_busy" | "lock_error" | "empty" }
  | {
      ran: true;
      jobId: string;
      /** `requeued` — 쿨다운에 걸려 못 보낸 객실이 남아 **다시 대기**로 돌렸다(`planPriceJobResume`). */
      status: "completed" | "partial_failed" | "failed" | "requeued";
      coalescedJobIds: string[];
      succeeded: number;
      failed: number;
    };

function asRoomUpdates(value: unknown): PriceJobRoomUpdate[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is PriceJobRoomUpdate => {
    const record = entry as PriceJobRoomUpdate | null;
    return !!record && typeof record.externalRoomId === "string" && !!record.dates;
  });
}

/**
 * 객실 하나의 처리 결과 — `beds24_price_jobs.results[]`.
 *
 * `error` 는 **코드**다(`PriceJobFailureCode`) — 이력 패널이 보는 사람 언어로 바꾼다. 2026-09-30 전
 * 행에는 한국어 문장이 들어 있고, 패널은 모르는 값을 그대로 보여준다.
 */
export type PriceJobRoomResult = {
  externalRoomId: string;
  success: boolean;
  error: string | null;
  params?: Record<string, string | number>;
};

function asRoomResults(value: unknown): PriceJobRoomResult[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is PriceJobRoomResult => {
    const record = entry as PriceJobRoomResult | null;
    return !!record && typeof record.externalRoomId === "string" && typeof record.success === "boolean";
  });
}

const failedResult = (externalRoomId: string, failure: PriceJobFailure): PriceJobRoomResult => ({
  externalRoomId,
  success: false,
  ...failure,
});

/**
 * 쿨다운으로 멈췄다 **다시 도는** 작업에서 이미 끝낸 객실을 가려낸다 — 순수 함수.
 *
 * 쿨다운에 걸리면 못 보낸 객실을 실패로 만들지 않고 작업을 `queued` 로 되돌린다. 그때까지의 결과는
 * `results` 에 남긴다(흡수한 형제 작업에도 같은 것을). 다음 차례에는 결과가 있는 객실을 건너뛰고
 * 결과를 그대로 이어 붙인다 — 같은 값을 또 보내 크레딧을 쓰지 않게.
 *
 * **다만 새로 흡수된 작업(결과가 빈)이 건드리는 객실은 다시 보낸다.** 그 사이 누가 같은 객실을
 * 새 값으로 고쳤으면 합친 값이 달라졌다.
 */
export function planPriceJobResume(
  jobs: ReadonlyArray<{ roomUpdates: PriceJobRoomUpdate[]; results: unknown }>,
): { carried: PriceJobRoomResult[]; skip: Set<string> } {
  const fresh = new Set<string>();
  const targets = new Set<string>();
  const prior = new Map<string, PriceJobRoomResult>();
  for (const job of jobs) {
    for (const update of job.roomUpdates) targets.add(update.externalRoomId);
    const results = asRoomResults(job.results);
    if (results.length === 0) {
      for (const update of job.roomUpdates) fresh.add(update.externalRoomId);
      continue;
    }
    for (const result of results) {
      if (!prior.has(result.externalRoomId)) prior.set(result.externalRoomId, result);
    }
  }
  const carried = [...prior.values()].filter(
    (result) => targets.has(result.externalRoomId) && !fresh.has(result.externalRoomId),
  );
  return { carried, skip: new Set(carried.map((result) => result.externalRoomId)) };
}

function toReadSegments(room: CalendarRoomData | undefined): CalendarReadSegment[] {
  return (room?.calendar ?? []).map((entry) => ({
    from: String(entry.from ?? ""),
    minStay: (entry.minStay ?? null) as number | string | null,
    price1: (entry.price1 ?? null) as number | string | null,
    to: String(entry.to ?? ""),
  }));
}

/**
 * 멈춘 작업을 되돌린다.
 *
 * 서버리스에서는 **함수가 중간에 사라지는 일이 정상 범주다.** 되돌리지 않으면 그 작업은
 * 영영 `processing` 으로 남고, 사람은 「처리 중」만 보며 기다린다.
 */
async function recoverStuckJobs(supabase: Client): Promise<number> {
  const cutoff = new Date(Date.now() - STUCK_JOB_MS).toISOString();
  const result = await supabase
    .from("beds24_price_jobs")
    .update({ started_at: null, status: "queued" })
    .eq("status", "processing")
    .lt("started_at", cutoff)
    .select("id");
  if (result.error) {
    console.error("[beds24/price-job] stuck recovery failed", result.error);
    return 0;
  }
  const rows = (result.data ?? []) as Array<{ id: string }>;
  if (rows.length > 0) {
    console.warn("[beds24/price-job] 멈춘 작업 회수", { ids: rows.map((row) => row.id) });
  }
  return rows.length;
}

/** 살아 있는 워커는 이보다 자주 `locked_at` 을 갱신한다(`touchWorkerLock`). 이보다 오래 조용하면 죽은 것이다. */
const ORPHAN_LOCK_GRACE_MS = 60_000;

/**
 * 잠금 심장 박동 — `locked_at` 을 지금으로. **내 잠금일 때만**(lockId 비교).
 *
 * 작업을 `completed` 로 적은 뒤에도 연결 유닛 확인·로컬 반영으로 몇 초~수십 초 잠금을 쥔다. 그 사이엔
 * `processing` 작업이 없어서, 박동 없이는 회수기가 살아 있는 워커의 잠금을 깨고 두 번째 워커가
 * 동시에 Beds24 를 부를 수 있었다.
 */
async function touchWorkerLock(supabase: Client, lockId: string): Promise<void> {
  const nowIso = new Date().toISOString();
  const result = await supabase
    .from("beds24_sync_locks")
    .update({ locked_at: nowIso, updated_at: nowIso })
    .eq("name", PRICE_JOB_LOCK)
    .eq("metadata->>lockId", lockId);
  if (result.error) console.error("[beds24/price-job] lock heartbeat failed", result.error);
}

/**
 * 고아 잠금 회수 — 잡은 워커가 죽어 잠금만 남은 경우.
 *
 * 2026-09-29 실측: 개발 서버에서 Supabase 연결이 끊겨(WSL 네트워크) 잠금 해제가 실패했고, 잠금 TTL
 * (15분) 동안 「지금 보내기」와 캘린더 열기가 전부 「남이 돌고 있다」로 조용히 멈췄다. 운영에서도
 * 함수가 중간에 죽으면 똑같다.
 *
 * **마지막 박동(`locked_at`)이 1분이 넘었고 `processing` 인 작업이 하나도 없을 때만** 회수한다 —
 * 살아 있는 워커는 작업을 `processing` 으로 두거나, 작업을 끝낸 뒤 후처리 중이면 박동을 친다.
 * 회수는 **본 그 잠금일 때만**(lockId 비교) — 그 사이 누가 새로 잡았으면 건드리지 않는다.
 */
async function breakOrphanedWorkerLock(supabase: Client): Promise<boolean> {
  const current = await supabase
    .from("beds24_sync_locks")
    .select("locked_at, metadata")
    .eq("name", PRICE_JOB_LOCK)
    .maybeSingle();
  const row = current.data as { locked_at: string | null; metadata: { lockId?: string } | null } | null;
  const lockId = row?.metadata?.lockId;
  if (current.error || !row?.locked_at || !lockId) return false;
  if (Date.now() - new Date(row.locked_at).getTime() < ORPHAN_LOCK_GRACE_MS) return false;

  const processing = await supabase
    .from("beds24_price_jobs")
    .select("id")
    .eq("status", "processing")
    .limit(1)
    .maybeSingle();
  if (processing.error || processing.data) return false;

  // 만료 판정은 DB 시계(`beds24_try_lock`)라 해제도 DB 가 한다 — 앱 시계로 적으면 어긋난 만큼 계속 「점유 중」이다.
  const released = await supabase.rpc("beds24_release_lock", { p_lock_id: lockId, p_name: PRICE_JOB_LOCK });
  const broke = !released.error && released.data === true;
  if (broke) console.warn("[beds24/price-job] 고아 잠금 회수", { lockedAt: row.locked_at });
  return broke;
}

/**
 * 가장 오래된 `queued` 하나를 **원자적으로** 가져온다.
 *
 * 조건부 갱신이라 두 워커가 동시에 시도해도 하나만 가져간다 — 가져간 쪽만 행을 돌려받는다.
 */
async function claimNextJob(supabase: Client, organizationId?: string): Promise<JobRow | null> {
  let candidateQuery = supabase.from("beds24_price_jobs").select("id").eq("status", "queued");
  if (organizationId) candidateQuery = candidateQuery.eq("organization_id", organizationId);
  const candidate = await candidateQuery
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (candidate.error || !candidate.data) return null;

  const claimed = await supabase
    .from("beds24_price_jobs")
    // 대기 사유(`encodePriceJobWait`)는 다시 집는 순간 지운다 — 이제 기다리는 게 아니다.
    .update({ error: null, started_at: new Date().toISOString(), status: "processing" })
    .eq("id", (candidate.data as { id: string }).id)
    // **여기가 원자성의 핵심** — 아직 queued 일 때만 내 것이 된다.
    .eq("status", "queued")
    .select("*")
    .maybeSingle();
  if (claimed.error || !claimed.data) return null;

  const row = claimed.data as JobRow;
  await supabase
    .from("beds24_price_jobs")
    .update({ attempt_count: row.attempt_count + 1 })
    .eq("id", row.id);
  return row;
}

/** 같은 건물·같은 종류의 `queued` 작업을 2분 창 안에서 흡수한다. */
async function absorbSiblingJobs(
  supabase: Client,
  job: JobRow,
): Promise<{
  roomUpdates: PriceJobRoomUpdate[];
  coalescedJobIds: string[];
  /** 이어 돌기 판단용(`planPriceJobResume`) — 이 작업과 흡수한 작업 각각의 객실·지난 결과. */
  sources: Array<{ roomUpdates: PriceJobRoomUpdate[]; results: unknown }>;
}> {
  const primary: MergeableJob = {
    createdAt: job.created_at,
    id: job.id,
    roomUpdates: asRoomUpdates(job.room_updates),
  };
  const alone = {
    coalescedJobIds: [],
    roomUpdates: primary.roomUpdates,
    sources: [{ results: job.results, roomUpdates: primary.roomUpdates }],
  };
  if (!job.property_id) return alone;

  const siblings = await supabase
    .from("beds24_price_jobs")
    .select("id, created_at, room_updates, results")
    .eq("status", "queued")
    .eq("organization_id", job.organization_id)
    .eq("property_id", job.property_id)
    .eq("job_type", job.job_type)
    .neq("id", job.id);
  if (siblings.error) return alone;

  const inWindow = ((siblings.data ?? []) as Array<{
    id: string;
    created_at: string;
    room_updates: unknown;
    results: unknown;
  }>).filter((row) => isWithinCoalesceWindow(job.created_at, row.created_at));
  if (inWindow.length === 0) return alone;

  // 흡수한다고 표시해 둔다 — 다른 워커가 같은 것을 또 집지 않게.
  const coalescedJobIds: string[] = [];
  for (const row of inWindow) {
    const taken = await supabase
      .from("beds24_price_jobs")
      .update({ error: null, started_at: new Date().toISOString(), status: "processing" })
      .eq("id", row.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();
    if (!taken.error && taken.data) coalescedJobIds.push(row.id);
  }

  const absorbed = inWindow
    .filter((row) => coalescedJobIds.includes(row.id))
    .map((row) => ({
      createdAt: row.created_at,
      id: row.id,
      results: row.results,
      roomUpdates: asRoomUpdates(row.room_updates),
    }));
  const merged = mergePriceJobRoomUpdates([primary, ...absorbed]);
  if (coalescedJobIds.length > 0) {
    console.log("[beds24/price-job] 합치기", { absorbed: coalescedJobIds, primary: job.id });
  }
  return {
    coalescedJobIds,
    roomUpdates: merged,
    sources: [
      ...alone.sources,
      ...absorbed.map((row) => ({ results: row.results, roomUpdates: row.roomUpdates })),
    ],
  };
}

type VerifyOutcome = {
  failures: Map<string, PriceJobFailure>;
  /** 되읽기가 429 를 맞았다 — 부르는 쪽이 쿨다운을 켜고 멈춘다. 이때 `failures` 는 비어 있다. */
  rateLimit: { resetInSec: number | null } | null;
};

/** 되읽기 — 안 맞으면 잠깐 쉬고 다시. 링크 전파에 시간이 걸린다. */
async function verifyWrites(args: {
  expectationByRoomId: Map<string, Record<string, ExpectedDateValues>>;
  includeLinkedPrices: boolean;
}): Promise<VerifyOutcome> {
  const roomIds = [...args.expectationByRoomId.keys()];
  const allDates = roomIds.flatMap((roomId) =>
    Object.keys(args.expectationByRoomId.get(roomId) ?? {}),
  );
  const failures = new Map<string, PriceJobFailure>();
  if (roomIds.length === 0 || allDates.length === 0) return { failures, rateLimit: null };

  const sorted = [...new Set(allDates)].sort();
  const startDate = sorted[0];
  const endDate = sorted[sorted.length - 1];

  for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt += 1) {
    failures.clear();
    const roomsById = new Map<string, CalendarRoomData>();
    let truncated = false;

    for (let index = 0; index < roomIds.length; index += VERIFY_BATCH_SIZE) {
      const chunk = roomIds.slice(index, index + VERIFY_BATCH_SIZE);
      let result;
      try {
        result = await fetchBeds24Calendar({
          endDate,
          externalRoomIds: chunk,
          includeLinkedPrices: args.includeLinkedPrices,
          includeMinStay: true,
          includePrices: true,
          startDate,
        });
      } catch (error) {
        if (error instanceof Beds24HttpError && error.isRateLimit) {
          return { failures: new Map(), rateLimit: { resetInSec: error.resetInSec } };
        }
        const detail = error instanceof Beds24HttpError
          ? `HTTP ${error.status}`
          : error instanceof Error ? error.message : "";
        for (const roomId of chunk) failures.set(roomId, { error: "verify_failed", params: { detail } });
        continue;
      }
      if ("skipped" in result) {
        for (const roomId of chunk) {
          failures.set(roomId, { error: "verify_failed", params: { detail: result.skipped } });
        }
        continue;
      }
      if (result.truncated) truncated = true;
      for (const [roomId, room] of result.roomsById) roomsById.set(roomId, room);
    }

    // **잘린 응답으로는 「일치한다」를 증명할 수 없다.** 검증 실패로 다룬다.
    if (truncated) {
      for (const roomId of roomIds) failures.set(roomId, { error: "verify_truncated" });
      return { failures, rateLimit: null };
    }

    for (const roomId of roomIds) {
      if (failures.has(roomId)) continue;
      const mismatches = diffCalendarReadback({
        expected: args.expectationByRoomId.get(roomId) ?? {},
        segments: toReadSegments(roomsById.get(roomId)),
      });
      if (mismatches.length > 0) failures.set(roomId, mismatchFailure(mismatches));
    }

    if (failures.size === 0) break;
    if (attempt < VERIFY_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  return { failures, rateLimit: null };
}

/**
 * 로컬 반영할 행을 **같은 열 모양끼리** 묶는다 — 순수 함수.
 *
 * 한 번의 upsert 에 열 모양이 다른 행을 섞으면 PostgREST 가 빠진 열을 `null` 로 채워 **안 보낸
 * 값을 지운다**(가격만 바꾼 날의 최소숙박이 사라진다). 그래서 모양마다 한 번씩 보낸다 — 보통 한 번이다.
 * `synced_at` 은 쓰는 시각이다: 요금 동기화는 자기가 시작한 뒤에 쓰인 행을 덮지 않는다.
 */
export function groupLocalRatePatches(args: {
  organizationId: string;
  roomIdByExternal: ReadonlyMap<string, string>;
  updates: ReadonlyArray<{ externalRoomId: string; dates: Record<string, CalendarDateValues> }>;
  syncedAt: string;
}): Array<Array<Record<string, unknown>>> {
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const update of args.updates) {
    const roomId = args.roomIdByExternal.get(update.externalRoomId);
    if (!roomId) continue;
    for (const [stayDate, values] of Object.entries(update.dates)) {
      const patch: Record<string, unknown> = {
        organization_id: args.organizationId,
        room_id: roomId,
        stay_date: stayDate,
        synced_at: args.syncedAt,
      };
      if (values.p1 !== undefined) patch.price1 = values.p1 === "REMOVE" ? null : values.p1;
      if (values.p2 !== undefined) patch.price2 = values.p2 === "REMOVE" ? null : values.p2;
      if (values.p3 !== undefined) patch.price3 = values.p3 === "REMOVE" ? null : values.p3;
      if (values.m !== undefined) patch.min_stay = values.m;
      if (values.mx !== undefined) patch.max_stay = values.mx;
      if (values.na !== undefined) patch.num_avail = values.na;
      if (values.ov !== undefined) patch.override_kind = values.ov || "none";
      const shape = Object.keys(patch).sort().join(",");
      const group = groups.get(shape) ?? [];
      group.push(patch);
      groups.set(shape, group);
    }
  }
  return [...groups.values()];
}

/**
 * 검증까지 끝난 값을 **우리 표에도** 반영한다.
 *
 * 다음 요금 동기화(최대 15분 뒤)를 기다리면 그동안 화면이 옛 값을 보여준다. 사람은
 * 「반영이 안 됐다」며 한 번 더 바꾼다. 검증을 통과한 값만 쓰므로 거짓을 심을 일은 없다.
 */
async function patchLocalRates(args: {
  supabase: Client;
  organizationId: string;
  roomIdByExternal: Map<string, string>;
  updates: Array<{ externalRoomId: string; dates: Record<string, CalendarDateValues> }>;
}): Promise<void> {
  const groups = groupLocalRatePatches({
    organizationId: args.organizationId,
    roomIdByExternal: args.roomIdByExternal,
    syncedAt: new Date().toISOString(),
    updates: args.updates,
  });
  for (const rows of groups) {
    const result = await args.supabase
      .from("room_daily_rates")
      .upsert(rows as never, { onConflict: "room_id,stay_date" });
    if (result.error) {
      console.error("[beds24/price-job] 로컬 반영 실패", {
        error: result.error,
        externalRoomIds: args.updates.map((update) => update.externalRoomId),
        rows: rows.length,
      });
    }
  }
}

/**
 * 큐에서 하나를 집어 끝까지 처리한다.
 *
 * 아무것도 안 했으면 `ran: false` 와 이유를 돌려준다 — 크론이 이유를 로그로 남길 수 있어야
 * 「왜 안 도는가」를 사람이 알 수 있다.
 *
 * ## 쿨다운에 걸리면 멈추고 다시 대기로
 *
 * 429 를 맞았거나 크레딧이 바닥나 쿨다운을 켜면 **다음 배치를 보내지 않는다** — 계속 보내면
 * 또 429 이고, 그 객실들은 영구 실패로 남았다(2026-09-30 전). 못 보낸 객실이 남으면 작업을 `queued`
 * 로 되돌리고 그때까지의 결과를 `results` 에 둔다. 쿨다운이 풀린 뒤 다음 차례가 나머지만 보낸다
 * (`planPriceJobResume`).
 */
export async function runNextPriceJob(
  supabase: Client,
  /** `organizationId` — 「지금 보내기」처럼 사람이 누른 경로는 그 조직 작업만 집는다. 크론·킥은 생략(전역). */
  options: { organizationId?: string } = {},
): Promise<PriceJobOutcome> {
  const cooldown = await getBeds24Cooldown(supabase);
  if (cooldown.active) {
    console.log(`[beds24/price-job] 쿨다운 ${cooldown.remainingSec}초 남음 — 쉰다`);
    return { ran: false, reason: "cooldown" };
  }

  let lock = await acquireBeds24Lock(
    supabase,
    PRICE_JOB_LOCK,
    JOB_LOCK_OWNER,
    PRICE_JOB_LOCK_TTL_MS,
  );
  // 잡은 워커가 **죽었는데** 잠금이 남았으면 회수하고 한 번 더 잡는다(`breakOrphanedWorkerLock`).
  if (!lock.acquired && lock.reason === "busy" && (await breakOrphanedWorkerLock(supabase))) {
    lock = await acquireBeds24Lock(supabase, PRICE_JOB_LOCK, JOB_LOCK_OWNER, PRICE_JOB_LOCK_TTL_MS);
  }
  if (!lock.acquired) {
    // **확인을 못 한 것과 남이 들고 있는 것을 구별한다.** 뭉치면 「왜 안 도는지」를 엉뚱한
    // 곳에서 찾게 된다.
    return { ran: false, reason: lock.reason === "error" ? "lock_error" : "lock_busy" };
  }
  const lockId = lock.lockId;

  try {
    await recoverStuckJobs(supabase);
    const job = await claimNextJob(supabase, options.organizationId);
    if (!job) return { ran: false, reason: "empty" };

    // 우리 방 마스터에 있는 것만 로컬 반영 대상이다. **못 읽었으면 보내지 않는다** — 로컬 반영·
    // 이력이 조용히 빠진 채 「완료」가 된다. 흡수 전이라 이 작업 하나만 되돌리면 된다.
    const roomsResult = await supabase
      .from("rooms")
      .select("id, external_room_id")
      .eq("organization_id", job.organization_id)
      .eq("external_provider", "beds24")
      .not("external_room_id", "is", null);
    if (roomsResult.error) {
      await supabase
        .from("beds24_price_jobs")
        .update({ started_at: null, status: "queued" })
        .eq("id", job.id);
      throw new Error(`[beds24/price-job] rooms lookup failed: ${roomsResult.error.message}`);
    }
    const roomIdByExternal = new Map<string, string>();
    for (const row of (roomsResult.data ?? []) as Array<{ id: string; external_room_id: string }>) {
      roomIdByExternal.set(String(row.external_room_id), row.id);
    }

    const { coalescedJobIds, roomUpdates, sources } = await absorbSiblingJobs(supabase, job);
    const jobIds = [job.id, ...coalescedJobIds];
    const { carried, skip } = planPriceJobResume(sources);
    const results: PriceJobRoomResult[] = [];

    const updateByRoomId = new Map(roomUpdates.map((update) => [update.externalRoomId, update]));
    const targetRoomIds = [...updateByRoomId.keys()];
    const pendingRoomIds = targetRoomIds.filter((externalRoomId) => !skip.has(externalRoomId));
    /** 연결 유닛 전파 확인은 **완료를 기록한 뒤에** 한다(아래 참고). 여기 모아 둔다. */
    const acceptedForLinkCheck: string[] = [];
    /** 쿨다운 때문에 못 보낸(또는 검증 못 한) 객실 — 실패가 아니라 다음 차례 몫이다. */
    const deferred: string[] = [];
    let cooledDown = false;
    /** 마지막으로 켠 쿨다운 — 되돌린 작업에 「왜 · 언제까지」로 적는다(`encodePriceJobWait`). */
    let waitReason: PriceJobWaitReason = "rate_limit";
    let waitUntil: string | null = null;
    const coolDown = async (args: Parameters<typeof activateBeds24Cooldown>[1]) => {
      const seconds = await activateBeds24Cooldown(supabase, args);
      waitReason = args.reason;
      waitUntil = new Date(Date.now() + seconds * 1000).toISOString();
      cooledDown = true;
    };

    /*
     * **쓰기 전에 현재 값을 읽어 둔다.** 이력의 「이전 값」이고, 쓴 뒤에는 영영 알 수 없다.
     *
     * 우리 표가 Beds24 보다 뒤처져 있을 수 있지만 그게 **화면이 보여준 값**이고, 사람이
     * 「얼마에서 바꿨다」고 기억하는 것도 그 값이다.
     */
    const beforeByCell = new Map<string, { price1: number | null; minStay: number | null }>();
    {
      const roomUuids = pendingRoomIds
        .map((externalRoomId) => roomIdByExternal.get(externalRoomId))
        .filter((value): value is string => !!value);
      const stayDates = [
        ...new Set(roomUpdates.flatMap((update) => Object.keys(update.dates ?? {}))),
      ];
      if (roomUuids.length > 0 && stayDates.length > 0) {
        const before = await supabase
          .from("room_daily_rates")
          .select("room_id, stay_date, price1, min_stay")
          .eq("organization_id", job.organization_id)
          .in("room_id", roomUuids)
          .in("stay_date", stayDates);
        for (const rowValue of (before.data ?? []) as Array<{
          room_id: string;
          stay_date: string;
          price1: number | null;
          min_stay: number | null;
        }>) {
          beforeByCell.set(`${rowValue.room_id}|${rowValue.stay_date}`, {
            minStay: rowValue.min_stay,
            price1: rowValue.price1,
          });
        }
      }
    }

    for (let index = 0; index < pendingRoomIds.length; index += WRITE_BATCH_SIZE) {
      const chunk = pendingRoomIds.slice(index, index + WRITE_BATCH_SIZE);
      if (cooledDown) {
        deferred.push(...chunk);
        continue;
      }
      const payload = chunk.map((externalRoomId) => ({
        calendar: buildCalendarSegments(updateByRoomId.get(externalRoomId)?.dates ?? {}),
        roomId: Number.parseInt(externalRoomId, 10),
      }));

      let written;
      try {
        written = await postBeds24Calendar(payload);
      } catch (error) {
        if (error instanceof Beds24HttpError && error.isRateLimit) {
          await coolDown({ reason: "rate_limit", resetInSec: error.resetInSec });
          deferred.push(...chunk);
          continue;
        }
        const failure: PriceJobFailure =
          error instanceof Beds24HttpError
            ? { error: "http_error", params: { status: error.status } }
            : { error: "unknown", params: { detail: error instanceof Error ? error.message : "" } };
        for (const externalRoomId of chunk) results.push(failedResult(externalRoomId, failure));
        continue;
      }
      if ("skipped" in written) {
        for (const externalRoomId of chunk) {
          results.push(
            failedResult(externalRoomId, { error: "beds24_unavailable", params: { detail: written.skipped } }),
          );
        }
        continue;
      }

      // 크레딧이 바닥나기 **전에** 쉰다. 이 배치의 되읽기까지만 하고 다음 배치는 다음 차례가 맡는다.
      if (shouldCooldownForCredit(written.credit, LOW_CREDIT_THRESHOLD)) {
        await coolDown({ fallbackSec: 30, reason: "low_credit", resetInSec: written.credit.resetInSec });
      }

      const accepted = written.items.filter((item) => item.accepted).map((item) => item.externalRoomId);
      for (const item of written.items) {
        if (item.accepted) continue;
        const code = item.errorCode ?? "room_rejected";
        results.push(
          failedResult(item.externalRoomId, {
            error: code,
            params: item.error && item.error !== code ? { detail: item.error } : undefined,
          }),
        );
      }
      if (accepted.length === 0) continue;

      // ── 되읽기 검증 ──────────────────────────────────────────────────
      //
      // 우리가 POST 한 유닛은 **직접 설정값만** 본다(`includeLinkedPrices: false`) —
      // 연결된 Daily Price 쪽에 잘못 쓰인 요청을 성공으로 오인하지 않기 위해서다.
      const expectationByRoomId = new Map<string, Record<string, ExpectedDateValues>>();
      for (const externalRoomId of accepted) {
        expectationByRoomId.set(
          externalRoomId,
          (updateByRoomId.get(externalRoomId)?.dates ?? {}) as Record<string, ExpectedDateValues>,
        );
      }
      const verified = await verifyWrites({ expectationByRoomId, includeLinkedPrices: false });
      if (verified.rateLimit) {
        // 들어갔는지 모른다 — 실패로 적지 않고 다음 차례에 다시 보내 확인한다(같은 값이라 안전하다).
        await coolDown({ reason: "rate_limit", resetInSec: verified.rateLimit.resetInSec });
        deferred.push(...accepted);
        continue;
      }

      const verifiedRoomIds: string[] = [];
      for (const externalRoomId of accepted) {
        const failure = verified.failures.get(externalRoomId);
        if (failure) {
          results.push(failedResult(externalRoomId, failure));
        } else {
          results.push({ error: null, externalRoomId, success: true });
          verifiedRoomIds.push(externalRoomId);
        }
      }

      // **이력이 먼저다.** 로컬 반영이 끝나면 이전 값을 읽을 수 없다. 방끼리는 동시에 —
      // 서로 다른 행이라 순서가 없다(2026-09-28).
      await Promise.all(
        verifiedRoomIds.map((externalRoomId) =>
          writeChangeLogs({
            beforeByCell,
            dates: updateByRoomId.get(externalRoomId)?.dates ?? {},
            externalRoomId,
            job,
            roomIdByExternal,
            roomLabel: updateByRoomId.get(externalRoomId)?.roomLabel ?? null,
            supabase,
          }),
        ),
      );
      await patchLocalRates({
        organizationId: job.organization_id,
        roomIdByExternal,
        supabase,
        updates: verifiedRoomIds.map((externalRoomId) => ({
          dates: updateByRoomId.get(externalRoomId)?.dates ?? {},
          externalRoomId,
        })),
      });
      acceptedForLinkCheck.push(...accepted);
      await touchWorkerLock(supabase, lockId);
    }

    const allResults = [...carried, ...results];
    const failures = allResults.filter((item) => !item.success);
    const anySucceeded = results.some((item) => item.success);

    if (deferred.length > 0) {
      // 흡수한 형제까지 **같이** 되돌린다 — 다음 차례에 다시 합쳐지고, 같은 결과를 보고 끝낸 객실을 건너뛴다.
      await supabase
        .from("beds24_price_jobs")
        .update({
          // 대기 사유와 자동 재전송 예정 시각 — 이력 패널이 「안 나감」 대신 「Beds24 한도 대기」로 보여준다.
          error: encodePriceJobWait(waitReason, waitUntil),
          failed_room_ids: failures.map((item) => item.externalRoomId),
          processed_count: allResults.length,
          results: allResults as never,
          started_at: null,
          status: "queued",
          total_count: targetRoomIds.length,
        })
        .in("id", jobIds);
      console.warn("[beds24/price-job] 쿨다운 — 남은 객실은 다음 차례로", {
        deferred: deferred.length,
        jobId: job.id,
      });
      if (anySucceeded) await signalBeds24Change(job.organization_id, "rates");
      return {
        coalescedJobIds,
        failed: failures.length,
        jobId: job.id,
        ran: true,
        status: "requeued",
        succeeded: allResults.length - failures.length,
      };
    }

    const status = failures.length === 0
      ? "completed"
      : failures.length === allResults.length
        ? "failed"
        : "partial_failed";

    const completion = {
      completed_at: new Date().toISOString(),
      // 진단용 요약 — 코드만(문구 아님). 화면은 `results` 를 보고 객실별로 번역한다.
      error: failures.length > 0
        ? failures.map((item) => `${item.externalRoomId}:${item.error ?? "unknown"}`).join(", ")
        : null,
      failed_room_ids: failures.map((item) => item.externalRoomId),
      processed_count: allResults.length,
      results: allResults as never,
      status,
      total_count: targetRoomIds.length,
    };
    // 흡수한 형제 작업까지 **한 번에** 끝낸다 — 화면은 자기 jobId 의 완료를 기다린다.
    await supabase
      .from("beds24_price_jobs")
      .update(completion)
      .in("id", jobIds);

    /*
     * 연결 유닛까지 퍼졌는지는 **완료를 기록한 뒤에** 본다. 안 퍼졌다고 작업을 실패로 만들지
     * 않는 **경고용**이고(소스 쓰기는 성공했고 Beds24 의 전파가 늦은 것일 수 있다), 되읽기에
     * 재시도까지 있어 몇 초가 든다. 예전에는 이걸 끝내야 완료로 적어서 화면의 「반영 완료」가
     * 그만큼 늦었다(2026-09-28). 그 유닛의 로컬 값은 건드리지 않아 다음 동기화가 채운다.
     *
     * 쿨다운을 켰으면 건너뛴다 — 둘 다 Beds24 를 읽는다. 로컬 값은 다음 요금 동기화가 맞춘다.
     * 이 사이엔 `processing` 작업이 없으므로 **박동을 쳐서** 회수기가 잠금을 깨지 않게 한다.
     */
    if (job.job_type === "price" && acceptedForLinkCheck.length > 0 && !cooledDown) {
      await touchWorkerLock(supabase, lockId);
      let rateLimited = false;
      try {
        rateLimited = await warnUnpropagatedLinks(
          supabase,
          job.organization_id,
          acceptedForLinkCheck,
          updateByRoomId,
        );
      } catch (error) {
        console.error("[beds24/price-job] 링크 전파 확인 실패(작업은 이미 완료)", error);
      }
      await touchWorkerLock(supabase, lockId);
      try {
        if (!rateLimited) await refreshLinkedLocalRates({
          organizationId: job.organization_id,
          roomIdByExternal,
          sourceRoomIds: acceptedForLinkCheck,
          supabase,
          updateByRoomId,
        });
      } catch (error) {
        console.error("[beds24/price-job] 연결 가격 로컬 반영 실패(작업은 이미 완료)", error);
      }
    }

    // 쓴 사람 화면은 작업 추적으로 이미 바뀐다 — 이건 **다른 사람**이 보고 있는 화면용이다.
    if (anySucceeded) {
      await signalBeds24Change(job.organization_id, "rates");
    }

    return {
      coalescedJobIds,
      failed: failures.length,
      jobId: job.id,
      ran: true,
      status,
      succeeded: allResults.length - failures.length,
    };
  } finally {
    await releaseBeds24Lock(supabase, PRICE_JOB_LOCK, lockId);
  }
}

/**
 * 바꾼 칸을 **한 칸씩** 이력에 남긴다.
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md 「이력을 남긴다」
 *
 * **검증을 통과한 것만 적는다.** Beds24 가 안 받아들인 값을 「바꿨다」고 적으면 이력이
 * 거짓말을 하고, 그건 이력이 없는 것보다 나쁘다.
 *
 * 값이 그대로인 칸은 건너뛴다 — 같은 값을 다시 보낸 것까지 남기면 진짜 변경이 묻힌다.
 */
async function writeChangeLogs(args: {
  beforeByCell: Map<string, { price1: number | null; minStay: number | null }>;
  dates: Record<string, CalendarDateValues>;
  externalRoomId: string;
  job: JobRow;
  roomIdByExternal: Map<string, string>;
  roomLabel: string | null;
  supabase: Client;
}): Promise<void> {
  const roomId = args.roomIdByExternal.get(args.externalRoomId) ?? null;
  const rows: Database["public"]["Tables"]["price_change_logs"]["Insert"][] = [];

  for (const [stayDate, values] of Object.entries(args.dates)) {
    const before = roomId ? args.beforeByCell.get(`${roomId}|${stayDate}`) : undefined;
    const shared = {
      adjust_mode: args.job.adjust_mode,
      changed_by: args.job.requested_by,
      changed_by_name: args.job.requested_by_name,
      external_room_id: args.externalRoomId,
      job_id: args.job.id,
      organization_id: args.job.organization_id,
      percent_value: args.job.percent_value,
      room_id: roomId,
      room_label: args.roomLabel,
      stay_date: stayDate,
    };

    if (values.p1 !== undefined) {
      const newValue = values.p1 === "REMOVE" ? null : values.p1;
      const oldValue = before?.price1 ?? null;
      if (oldValue !== newValue) {
        rows.push({ ...shared, field: "price1", new_value: newValue, old_value: oldValue });
      }
    }
    if (values.m !== undefined) {
      const oldValue = before?.minStay ?? null;
      if (oldValue !== values.m) {
        rows.push({ ...shared, field: "min_stay", new_value: values.m, old_value: oldValue });
      }
    }
  }

  if (rows.length === 0) return;
  const result = await args.supabase.from("price_change_logs").insert(rows);
  if (result.error) {
    // 이력을 못 남겼다고 **작업을 실패로 만들지는 않는다** — 값은 이미 Beds24 에 들어갔다.
    console.error("[beds24/price-job] 이력 기록 실패", { error: result.error, job: args.job.id });
  }
}

/** 연결 유닛에 가격이 퍼졌는지 확인하고, 안 퍼졌으면 크게 남긴다. 429 를 맞았으면 쿨다운을 켜고 `true`. */
async function warnUnpropagatedLinks(
  supabase: Client,
  organizationId: string,
  sourceRoomIds: string[],
  updateByRoomId: Map<string, PriceJobRoomUpdate>,
): Promise<boolean> {
  const linked = await supabase
    .from("rooms")
    .select("external_room_id, external_price_source_room_id")
    .eq("organization_id", organizationId)
    .in("external_price_source_room_id", sourceRoomIds);
  const rows = (linked.data ?? []) as Array<{
    external_room_id: string;
    external_price_source_room_id: string;
  }>;
  if (rows.length === 0) return false;

  const expectationByRoomId = new Map<string, Record<string, ExpectedDateValues>>();
  for (const row of rows) {
    const source = updateByRoomId.get(row.external_price_source_room_id);
    if (!source) continue;
    const expectation = toLinkedUnitExpectation(source.dates as Record<string, ExpectedDateValues>);
    if (Object.keys(expectation).length > 0) {
      expectationByRoomId.set(String(row.external_room_id), expectation);
    }
  }
  if (expectationByRoomId.size === 0) return false;

  const verified = await verifyWrites({ expectationByRoomId, includeLinkedPrices: true });
  if (verified.rateLimit) {
    await activateBeds24Cooldown(supabase, { reason: "rate_limit", resetInSec: verified.rateLimit.resetInSec });
    return true;
  }
  for (const [externalRoomId, failure] of verified.failures) {
    console.error("[beds24/price-job] Daily Price 링크 미전파 의심", { externalRoomId, failure });
  }
  return false;
}

/**
 * 가격을 쓴 뒤 **링크로 계산된 가격까지** 우리 표에 바로 맞춘다 (2026-09-29).
 *
 * 우리는 소스의 `p1` 만 쓴다. Booking.com(`p2`)·Agoda·홈페이지(`p3`)와 **실제로 파는 자식 유닛의
 * `p1`** 은 Beds24 링크가 계산한다. 그 값을 우리 표에 넣는 것은 요금 동기화뿐인데, 그게
 * GitHub Actions 라 실측 **약 6시간 간격**으로 돈다(15분 설정). 그동안 화면의 부킹닷컴 가격과
 * 수동 예약 패널의 「부킹닷컴 합계」가 **옛 값**이었다.
 *
 * 그래서 쓴 날짜 구간을 `includeLinkedPrices` 로 한 번 더 읽어(소스 + 그 소스를 가리키는 유닛)
 * `price1~3` 을 그대로 옮긴다. Beds24 가 준 값만 쓰므로 추측이 없다. 실패해도 작업은 이미
 * 끝났다 — 다음 요금 동기화가 맞춘다.
 */
async function refreshLinkedLocalRates(args: {
  supabase: Client;
  organizationId: string;
  sourceRoomIds: string[];
  roomIdByExternal: Map<string, string>;
  updateByRoomId: Map<string, PriceJobRoomUpdate>;
}): Promise<void> {
  const linked = await args.supabase
    .from("rooms")
    .select("external_room_id, external_price_source_room_id")
    .eq("organization_id", args.organizationId)
    .in("external_price_source_room_id", args.sourceRoomIds);
  const sourceOf = new Map<string, string>();
  for (const source of args.sourceRoomIds) sourceOf.set(source, source);
  for (const row of (linked.data ?? []) as Array<{
    external_room_id: string;
    external_price_source_room_id: string;
  }>) {
    sourceOf.set(String(row.external_room_id), String(row.external_price_source_room_id));
  }

  const datesBySource = new Map<string, string[]>();
  for (const source of args.sourceRoomIds) {
    datesBySource.set(source, Object.keys(args.updateByRoomId.get(source)?.dates ?? {}));
  }
  const allDates = [...new Set([...datesBySource.values()].flat())].sort();
  if (allDates.length === 0) return;

  const roomIds = [...sourceOf.keys()];
  for (let index = 0; index < roomIds.length; index += VERIFY_BATCH_SIZE) {
    const chunk = roomIds.slice(index, index + VERIFY_BATCH_SIZE);
    let result;
    try {
      result = await fetchBeds24Calendar({
        endDate: allDates[allDates.length - 1],
        externalRoomIds: chunk,
        includeLinkedPrices: true,
        includePrices: true,
        startDate: allDates[0],
      });
    } catch (error) {
      if (error instanceof Beds24HttpError && error.isRateLimit) {
        await activateBeds24Cooldown(args.supabase, { reason: "rate_limit", resetInSec: error.resetInSec });
        return;
      }
      throw error;
    }
    if ("skipped" in result || result.truncated) return;

    // 연결 유닛 가격은 배수로 계산돼 소수가 온다(49784.24) — 칸은 정수라 그대로 넣으면 22P02 로
    // 통째 실패한다(2026-10-16). 주기 동기화(`room-rates-sync.ts` readInt)와 같게 반올림한다.
    const read = (segment: Record<string, unknown>, key: string) => {
      const value = Number(segment[key]);
      return segment[key] === undefined || segment[key] === null || !Number.isFinite(value) ? null : Math.round(value);
    };
    const rows: Array<Record<string, unknown>> = [];
    for (const externalRoomId of chunk) {
      const roomId = args.roomIdByExternal.get(externalRoomId);
      const source = sourceOf.get(externalRoomId);
      if (!roomId || !source) continue;
      const segments = result.roomsById.get(externalRoomId)?.calendar ?? [];
      // 그 유닛의 소스가 **이번에 쓴 날짜만** — 다른 날은 건드리지 않는다.
      for (const stayDate of datesBySource.get(source) ?? []) {
        const segment = segments.find(
          (entry) => String(entry.from ?? "") <= stayDate && String(entry.to ?? "") >= stayDate,
        );
        if (!segment) continue;
        rows.push({
          organization_id: args.organizationId,
          price1: read(segment, "price1"),
          price2: read(segment, "price2"),
          price3: read(segment, "price3"),
          room_id: roomId,
          stay_date: stayDate,
        });
      }
    }
    if (rows.length === 0) continue;
    // 쓰는 시각 — 요금 동기화는 자기가 시작한 뒤에 쓰인 행을 덮지 않는다.
    const syncedAt = new Date().toISOString();
    const saved = await args.supabase
      .from("room_daily_rates")
      .upsert(rows.map((row) => ({ ...row, synced_at: syncedAt })) as never, {
        onConflict: "room_id,stay_date",
      });
    if (saved.error) {
      console.error("[beds24/price-job] 연결 가격 로컬 반영 실패", {
        error: saved.error,
        externalRoomIds: chunk,
        rows: rows.length,
      });
    }
  }
}
