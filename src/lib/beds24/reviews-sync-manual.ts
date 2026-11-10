import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * 외부 리뷰 **「지금 가져오기」** — 상태 기록 (2026-10-02, 사용자 요청).
 *
 * 도메인 계약: `docs/product/25-complaint-workflow.md` → 「지금 가져오기 (수동 수집)」
 *
 * 리뷰는 웹훅이 없어 하루 한 번(08:05 도쿄, GitHub Actions — 실제로는 몇 시간 늦게도 돈다) 가져온다.
 * 보고 싶을 때 누른 시점 기준으로 가져오는 버튼을 위해 두 가지를 `beds24_sync_locks` 에 둔다
 * (새 표를 만들지 않는다 — `api_cooldown` 처럼 이름으로 구분하는 시각 기록이다):
 *
 * - `reviews_sync_run:<조직>` — **도는 중** 잠금. 두 사람이 동시에 눌러도 한 번만 돈다. 한 바퀴는
 *   조각(약 12곳 · 30초)을 화면이 이어 부르는 방식이라 잠금이 여러 호출에 걸친다 — 만료는 넉넉히.
 * - `reviews_sync_done:<조직>` — **마지막으로 끝난 시각**(`locked_at`)과 **다시 누를 수 있는 시각**
 *   (`expires_at` = 끝난 뒤 10분). 아침 정기 수집도 여기에 남긴다 — 그래야 「마지막 수집」이 정확하고,
 *   방금 정기 수집이 끝났는데 또 70곳을 부르는 일이 없다.
 */

type Client = SupabaseClient<Database>;

/** 한 번 끝난 뒤 다시 누를 수 있기까지. 한 바퀴가 Beds24 크레딧을 ~70번 쓴다. */
export const REVIEW_SYNC_COOLDOWN_MS = 10 * 60 * 1000;
/** 도는 중 잠금의 수명. 한 바퀴 실측 1~2분 — 화면이 중간에 닫혀도 이 뒤엔 다시 누를 수 있다. */
export const REVIEW_SYNC_RUN_TTL_MS = 5 * 60 * 1000;

export const reviewSyncRunLockName = (organizationId: string) => `reviews_sync_run:${organizationId}`;
const doneName = (organizationId: string) => `reviews_sync_done:${organizationId}`;

export type ReviewSyncStatus = {
  /** 마지막으로 끝난 시각(ISO). 기록이 없으면 `null`. */
  lastSyncedAt: string | null;
  /** 이 시각 전까지는 다시 누를 수 없다(ISO). 지금 누를 수 있으면 `null`. */
  availableAt: string | null;
  /** 누가 지금 돌리고 있다. */
  running: boolean;
};

export async function getReviewSyncStatus(supabase: Client, organizationId: string): Promise<ReviewSyncStatus> {
  const result = await supabase
    .from("beds24_sync_locks")
    .select("name, locked_at, expires_at")
    .in("name", [doneName(organizationId), reviewSyncRunLockName(organizationId)]);
  const now = Date.now();
  let lastSyncedAt: string | null = null;
  let availableAt: string | null = null;
  let running = false;
  for (const row of (result.data ?? []) as Array<{ name: string; locked_at: string; expires_at: string }>) {
    const active = new Date(row.expires_at).getTime() > now;
    if (row.name === doneName(organizationId)) {
      lastSyncedAt = row.locked_at;
      if (active) availableAt = row.expires_at;
    } else if (active) {
      running = true;
    }
  }
  return { availableAt, lastSyncedAt, running };
}

/** 한 조직의 수집이 끝났다 — 수동이든 정기든 같은 기록을 남긴다. 실패해도 수집 자체는 끝났으므로 던지지 않는다. */
export async function recordReviewSyncDone(
  supabase: Client,
  args: { organizationId: string; by: "manual" | "schedule"; upserted: number },
): Promise<void> {
  const now = new Date();
  const { error } = await supabase.from("beds24_sync_locks").upsert(
    {
      expires_at: new Date(now.getTime() + REVIEW_SYNC_COOLDOWN_MS).toISOString(),
      locked_at: now.toISOString(),
      locked_by: args.by,
      metadata: { upserted: args.upserted },
      name: doneName(args.organizationId),
      reason: null,
      updated_at: now.toISOString(),
    },
    { onConflict: "name" },
  );
  if (error) console.error("[beds24/reviews-sync] done record failed", { error, organizationId: args.organizationId });
}

/** 도는 중 잠금이 아직 이 실행(`runId`)의 것인가 — 만료됐거나 남이 잡았으면 이어 부르지 않는다. */
export async function ownsReviewSyncRun(supabase: Client, organizationId: string, runId: string): Promise<boolean> {
  const result = await supabase
    .from("beds24_sync_locks")
    .select("expires_at, metadata")
    .eq("name", reviewSyncRunLockName(organizationId))
    .maybeSingle();
  const row = result.data as { expires_at: string; metadata: { lockId?: string } | null } | null;
  if (!row) return false;
  return row.metadata?.lockId === runId && new Date(row.expires_at).getTime() > Date.now();
}

type RunMetadata = { lockId?: string; offset?: number; done?: boolean } | null;

/**
 * 「지금 가져오기」 다음 조각을 **서버에서** 정한다(2026-11-10).
 *
 * 예전엔 화면이 `offset` 을 들고 와서, `offset: 0` 을 계속 보내면 잠금이 살아 있는 5분 동안 같은 조각을 몇 번이고
 * 다시 돌려 10분 잠금을 비켜 가며 Beds24 크레딧을 태울 수 있었다. 이제 이어 부를 위치는 «도는 중» 잠금 줄의
 * `metadata.offset` 에만 있다. 한 번에 한 조각만 가져가도록 «읽은 위치일 때만 앞으로 옮기기»(조건부 갱신)로 잡는다 —
 * 같은 runId 로 두 번 눌려도 같은 조각을 두 번 돌리지 않는다.
 */
export async function claimReviewSyncSlice(
  supabase: Client,
  organizationId: string,
  runId: string,
  slice: number,
): Promise<{ ok: true; offset: number } | { ok: false; reason: "lost" | "busy" }> {
  const name = reviewSyncRunLockName(organizationId);
  const { data } = await supabase.from("beds24_sync_locks").select("expires_at, metadata").eq("name", name).maybeSingle();
  const row = data as { expires_at: string; metadata: RunMetadata } | null;
  if (!row || row.metadata?.lockId !== runId || new Date(row.expires_at).getTime() <= Date.now() || row.metadata?.done) {
    return { ok: false, reason: "lost" };
  }
  const offset = Number.isInteger(row.metadata?.offset) && (row.metadata?.offset ?? 0) > 0 ? (row.metadata?.offset as number) : 0;
  let claim = supabase
    .from("beds24_sync_locks")
    // 조각을 가져갈 때마다 잠금 시간도 늘린다 — 한 바퀴가 5분을 넘겨도 중간에 잠금이 풀려 남이 끼어들지 않게.
    .update({
      metadata: { lockId: runId, offset: offset + slice },
      expires_at: new Date(Date.now() + REVIEW_SYNC_RUN_TTL_MS).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("name", name)
    .eq("metadata->>lockId", runId);
  // 처음 조각은 offset 칸이 아직 없다(잠금 RPC 가 lockId 만 넣는다).
  claim = row.metadata?.offset === undefined ? claim.is("metadata->>offset", null) : claim.eq("metadata->>offset", String(offset));
  const { data: claimed, error } = await claim.select("name");
  if (error || !Array.isArray(claimed) || claimed.length === 0) return { ok: false, reason: "busy" };
  return { ok: true, offset };
}

/**
 * 정기 수집이 앞 조각에서 잡아 둔 잠금을 이어 쓸 때 시간을 늘린다(2026-11-10). 조직 하나가 여러 호출에 걸쳐 돌면
 * 5분이 지나 잠금이 풀리고, 그 사이 사람이 누른 수집이 끼어들 수 있었다. 내 lockId 일 때만 늘린다 — 못 늘리면 false.
 */
export async function extendReviewSyncRun(
  supabase: Client,
  organizationId: string,
  lockId: string,
  ttlMs: number = REVIEW_SYNC_RUN_TTL_MS,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("beds24_sync_locks")
    .update({ expires_at: new Date(Date.now() + ttlMs).toISOString(), updated_at: new Date().toISOString() })
    .eq("name", reviewSyncRunLockName(organizationId))
    .eq("metadata->>lockId", lockId)
    .select("name");
  return !error && Array.isArray(data) && data.length > 0;
}

/** 한 바퀴가 끝났다 — 같은 runId 로 다시 돌지 못하게 표시한다(잠금을 놓기 전에). */
export async function markReviewSyncRunDone(supabase: Client, organizationId: string, runId: string): Promise<void> {
  await supabase
    .from("beds24_sync_locks")
    .update({ metadata: { lockId: runId, done: true }, updated_at: new Date().toISOString() })
    .eq("name", reviewSyncRunLockName(organizationId))
    .eq("metadata->>lockId", runId);
}

/** 정기 수집이 잠금을 잡을 때 쓰는 이름(`locked_by`). 사람이 누른 수집은 사용자 id 가 들어간다. */
export const REVIEW_SYNC_SCHEDULE_LOCKER = "schedule";

export type ReviewSyncRunState = { active: boolean; lockedBy: string | null; lockId: string | null };

export async function getReviewSyncRun(supabase: Client, organizationId: string): Promise<ReviewSyncRunState> {
  const { data } = await supabase
    .from("beds24_sync_locks")
    .select("locked_by, expires_at, metadata")
    .eq("name", reviewSyncRunLockName(organizationId))
    .maybeSingle();
  const row = data as { locked_by: string | null; expires_at: string; metadata: RunMetadata } | null;
  if (!row) return { active: false, lockedBy: null, lockId: null };
  return {
    active: new Date(row.expires_at).getTime() > Date.now(),
    lockedBy: row.locked_by,
    lockId: row.metadata?.lockId ?? null,
  };
}

/**
 * 정기 수집(크론)이 이 조직을 돌기 전에 할 일(2026-11-10). 수동 · 정기가 같은 «도는 중» 잠금을 나눠 쓴다:
 * - 사람이 「지금 가져오기」로 돌리는 중 → 이 조직은 건너뛴다(같은 함수 · 같은 창이라 결과가 같다 — 두 번 돌면 크레딧만 쓴다).
 * - 정기 수집이 앞 조각에서 잡아 둔 잠금 → 이어 쓴다.
 * - 아무도 안 잡았다 → 새로 잡는다(못 잡으면 건너뛴다).
 * 반대로 정기 수집이 잡고 있는 동안 사람이 누르면 `acquireBeds24Lock` 이 실패해 `busy` 가 된다.
 */
export function scheduleRunLockPlan(
  run: ReviewSyncRunState,
): { kind: "skip" } | { kind: "reuse"; lockId: string } | { kind: "acquire" } {
  if (!run.active) return { kind: "acquire" };
  if (run.lockedBy === REVIEW_SYNC_SCHEDULE_LOCKER && run.lockId) return { kind: "reuse", lockId: run.lockId };
  return { kind: "skip" };
}

/** 정기 수집과 같은 창 — Booking.com 최근 30일(Airbnb 는 기간 없이 객실당 최대 50건). */
export const REVIEW_SYNC_ROUTINE_SINCE_DAYS = 30;
/**
 * 한 호출이 처리하는 대상 수. 대상 하나가 1.5~2초라 12곳이면 30초 안팎 — Vercel Hobby 60초 상한의 절반.
 * 한 바퀴(약 70곳)는 화면이 이어 부른다(`syncReviewsNowStep`).
 */
export const REVIEW_SYNC_SLICE = 12;
