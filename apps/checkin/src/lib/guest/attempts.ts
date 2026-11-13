import "server-only";

import type { CheckinServiceClient } from "../supabase/service";
import type { AttemptRow } from "./limits";

// 시도 기록(`checkin.claim_attempts`)을 「먼저 실패로 적고 → 자기 줄을 뺀 앞 기록으로 판정 → 끝나면 고치기」 순서로 쓴다(2026-11-13).
// 동시에 들어온 요청끼리 서로의 줄을 보게 하려는 것 — 세기 → 판정 → 기록 순서면 한꺼번에 보낸 요청이 모두 상한 아래로 보인다.
// 두 요청 중 적어도 하나는 다른 쪽 줄을 본다(각자 적은 뒤에 읽으므로). 그래서 판정까지 가는 요청은 상한 수를 넘지 않는다.

export type PendingRow = { key_hash: string; ip_hash: string };

export type Pending = {
  /** 이번 요청이 적은 줄 전부. */
  ids: number[];
  /** 키 → 줄 id. 돌려받는 순서를 믿지 않고 key_hash 로 짝을 맞춘다(한 요청 안에서 키는 겹치지 않는다). */
  idOf: (key: string) => number;
};

/** 실패로 먼저 적는다. 적지 못하면 판정하지 않는다(조용히 상한이 풀리지 않게). */
export async function recordPending(db: CheckinServiceClient, rows: PendingRow[]): Promise<Pending> {
  const { data, error } = await db
    .from("claim_attempts")
    .insert(rows.map((row) => ({ ...row, succeeded: false })))
    .select("id, key_hash");
  if (error) throw new Error(`claim_attempts 쓰기 실패: ${error.message}`);
  const byKey = new Map((data ?? []).map((row) => [row.key_hash as string, row.id as number]));
  if (byKey.size !== rows.length) throw new Error("claim_attempts 쓰기 결과가 맞지 않습니다.");
  return {
    ids: [...byKey.values()],
    idOf: (key) => {
      const id = byKey.get(key);
      if (id === undefined) throw new Error("claim_attempts 줄을 찾지 못했습니다.");
      return id;
    },
  };
}

/** 그 키의 창 안 기록(새것 먼저) — 자기 줄은 뺀다. 다른 요청이 지금 적은 줄은 실패로 보인다. */
export async function priorAttempts(
  db: CheckinServiceClient,
  key: string,
  windowMs: number,
  limit: number,
  now: Date,
  own: number[],
): Promise<AttemptRow[]> {
  const { data, error } = await db
    .from("claim_attempts")
    .select("id, succeeded, attempted_at")
    .eq("key_hash", key)
    .gte("attempted_at", new Date(now.getTime() - windowMs).toISOString())
    .order("attempted_at", { ascending: false })
    .limit(limit + own.length);
  if (error) throw new Error(`claim_attempts 읽기 실패: ${error.message}`);
  return (data ?? []).filter((row) => !own.includes(row.id as number)) as AttemptRow[];
}

/** 한 칸 값으로 창 안 줄 수 — 자기 줄은 뺀다. */
export async function priorCount(
  db: CheckinServiceClient,
  column: "key_hash" | "ip_hash",
  value: string,
  windowMs: number,
  now: Date,
  ownCount: number,
): Promise<number> {
  const { count, error } = await db
    .from("claim_attempts")
    .select("id", { count: "exact", head: true })
    .eq(column, value)
    .gte("attempted_at", new Date(now.getTime() - windowMs).toISOString());
  if (error) throw new Error(`claim_attempts 읽기 실패: ${error.message}`);
  return Math.max(0, (count ?? 0) - ownCount);
}

/** 판정 없이 거절했을 때 — 자기 줄을 지운다(잠금 중 되풀이가 잠금을 늘리지 않게). */
export async function discardAttempts(db: CheckinServiceClient, ids: number[]) {
  if (ids.length === 0) return;
  const { error } = await db.from("claim_attempts").delete().in("id", ids);
  if (error) throw new Error(`claim_attempts 지우기 실패: ${error.message}`);
}

/** 맞았을 때 — 자기 줄을 성공으로(그 앞 실패를 지운 셈). */
export async function markSucceeded(db: CheckinServiceClient, ids: number[]) {
  if (ids.length === 0) return;
  const { error } = await db.from("claim_attempts").update({ succeeded: true }).in("id", ids);
  if (error) throw new Error(`claim_attempts 고치기 실패: ${error.message}`);
}
