import "server-only";

import type { CheckinServiceClient as SupabaseClient } from "../supabase/service";

import { PASSPORT_BUCKET } from "../guest/store";
import { NAME_DAY_MS } from "../guest/limits";
import { todayTokyo } from "../tokyo-date";

// jobs/retention(43 §8-14 · 16 §3): retain_until 이 지난 stay 를 파일 → 줄 순으로 지운다.
// SQL 로는 storage.objects 를 지울 수 없어 Storage API 로 먼저 지우고, 하나라도 실패하면 그 stay 줄은 남겨 다음 실행이 다시 한다.
// 결과는 건수만 — 예약 번호 · 이름을 돌려주지 않는다.

const BATCH = 50;
const MAX_STAYS = 500;
const BUDGET_MS = 40_000;
const REMOVE_CHUNK = 100;
const LIST_PAGE = 1000;
// stay 정리가 시간을 다 써도 claim_attempts 정리가 굶지 않게 끝 5초는 남겨 둔다.
const CLAIM_RESERVE_MS = 5_000;
const CLAIM_BATCH = 500;
// 예약 찾기 잠금의 가장 긴 창(같은 이름 하루 15번)이 24시간 — 여유 24시간을 더 둔다.
export const CLAIM_ATTEMPT_KEEP_MS = NAME_DAY_MS * 2;

export type RetentionResult = {
  staysDeleted: number;
  staysFailed: number;
  filesDeleted: number;
  claimAttemptsDeleted: number;
  done: boolean;
};

type Options = { now?: Date; batchSize?: number; maxStays?: number; budgetMs?: number; listPageSize?: number };

type ExpiredStay = { id: string; organization_id: string; reservation_group_key: string; status: string };

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function listAll(db: SupabaseClient, prefix: string, pageSize: number) {
  const entries: { name: string; id: string | null }[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.storage.from(PASSPORT_BUCKET).list(prefix, { limit: pageSize, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`파일 목록 실패: ${error.message}`);
    entries.push(...(data ?? []));
    if (!data || data.length < pageSize) return entries;
  }
}

// 경로는 `org/stay/guest/파일`(passport · face 라우트). 줄이 없는 파일(동행자를 뺀 뒤 파일 지우기 실패 등)까지 잡으려고 폴더를 직접 본다.
async function listStayFiles(db: SupabaseClient, prefix: string, pageSize: number): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await listAll(db, prefix, pageSize)) {
    if (entry.id) {
      files.push(`${prefix}/${entry.name}`);
      continue;
    }
    for (const file of await listAll(db, `${prefix}/${entry.name}`, pageSize)) {
      if (file.id) files.push(`${prefix}/${entry.name}/${file.name}`);
    }
  }
  return files;
}

async function deleteStay(
  db: SupabaseClient,
  stay: ExpiredStay,
  today: string,
  pageSize: number,
): Promise<{ deleted: boolean; files: number }> {
  // 고른 뒤 sync-stays 가 취소를 되살려 기간을 늘렸을 수 있다 — 파일을 건드리기 전에 다시 본다.
  const { data: current, error: currentError } = await db
    .from("stays")
    .select("retain_until")
    .eq("id", stay.id)
    .eq("organization_id", stay.organization_id)
    .maybeSingle();
  if (currentError) throw new Error(`stays 다시 읽기 실패: ${currentError.message}`);
  const retainUntil = current?.retain_until as string | null | undefined;
  if (!retainUntil || retainUntil >= today) return { deleted: false, files: 0 };

  const { data: guests, error: guestError } = await db
    .from("guests")
    .select("id")
    .eq("organization_id", stay.organization_id)
    .eq("stay_id", stay.id);
  if (guestError) throw new Error(`guests 읽기 실패: ${guestError.message}`);
  const guestIds = (guests ?? []).map((row) => row.id as string);

  const documentPaths: string[] = [];
  for (const part of chunks(guestIds, BATCH)) {
    const { data, error } = await db
      .from("guest_documents")
      .select("storage_path")
      .eq("organization_id", stay.organization_id)
      .in("guest_id", part);
    if (error) throw new Error(`guest_documents 읽기 실패: ${error.message}`);
    documentPaths.push(...(data ?? []).map((row) => row.storage_path as string));
  }

  const prefix = `${stay.organization_id}/${stay.id}`;
  const paths = [...new Set([...documentPaths, ...(await listStayFiles(db, prefix, pageSize))])];
  for (const part of chunks(paths, REMOVE_CHUNK)) {
    const { error } = await db.storage.from(PASSPORT_BUCKET).remove(part);
    if (error) throw new Error(`파일 지우기 실패: ${error.message}`);
  }
  // remove 는 못 지운 경로도 오류 없이 넘길 수 있다 — 폴더가 비었을 때만 줄로 넘어간다.
  if ((await listStayFiles(db, prefix, pageSize)).length > 0) throw new Error("파일이 남아 있음");

  // audit_log 은 stay 로 외래 키가 없어 따로, stay 보다 먼저 지운다 — 여기서 실패하면 stay 가 남아 다음 실행이 다시 한다(43 「3년 보관 뒤 명부와 함께 삭제」).
  const { data: audits, error: auditError } = await db
    .from("audit_log")
    .delete()
    .eq("organization_id", stay.organization_id)
    .eq("stay_id", stay.id)
    .select("id");
  if (auditError) throw new Error(`audit_log 지우기 실패: ${auditError.message}`);

  // 한 번 더 조건을 걸고 지운다 — 다시 읽은 뒤 짧은 틈에 기간이 늘었으면 남긴다.
  // 지우면 stay_rooms · guests · guest_documents · consents · sessions · stay_tokens 가 같이 지워진다(on delete cascade).
  const { data: removed, error: stayError } = await db
    .from("stays")
    .delete()
    .eq("id", stay.id)
    .eq("organization_id", stay.organization_id)
    .lt("retain_until", today)
    .select("id");
  if (stayError) throw new Error(`stays 지우기 실패: ${stayError.message}`);
  if (!removed?.length) return { deleted: false, files: paths.length };

  const { error: logError } = await db.from("deletions").insert({
    organization_id: stay.organization_id,
    stay_key: stay.reservation_group_key,
    counts: {
      guests: guestIds.length,
      documents: documentPaths.length,
      files: paths.length,
      audit_log: audits?.length ?? 0,
      status: stay.status,
    },
  });
  if (logError) console.error("[retention] deletions 쓰기 실패", logError.message);

  return { deleted: true, files: paths.length };
}

async function deleteOldClaimAttempts(db: SupabaseClient, now: Date, deadline: number): Promise<{ deleted: number; done: boolean }> {
  const cutoff = new Date(now.getTime() - CLAIM_ATTEMPT_KEEP_MS).toISOString();
  let deleted = 0;
  while (Date.now() < deadline) {
    const { data, error } = await db
      .from("claim_attempts")
      .select("id")
      .lt("attempted_at", cutoff)
      .order("id")
      .limit(CLAIM_BATCH);
    if (error) throw new Error(`claim_attempts 읽기 실패: ${error.message}`);
    const ids = (data ?? []).map((row) => row.id as number);
    if (ids.length === 0) return { deleted, done: true };
    const { error: deleteError } = await db.from("claim_attempts").delete().in("id", ids);
    if (deleteError) throw new Error(`claim_attempts 지우기 실패: ${deleteError.message}`);
    deleted += ids.length;
    if (ids.length < CLAIM_BATCH) return { deleted, done: true };
  }
  return { deleted, done: false };
}

export async function runRetention(db: SupabaseClient, options: Options = {}): Promise<RetentionResult> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? BATCH;
  const maxStays = options.maxStays ?? MAX_STAYS;
  const pageSize = options.listPageSize ?? LIST_PAGE;
  const deadline = Date.now() + (options.budgetMs ?? BUDGET_MS);
  const stayDeadline = deadline - CLAIM_RESERVE_MS;
  const today = todayTokyo(now);
  const result: RetentionResult = { staysDeleted: 0, staysFailed: 0, filesDeleted: 0, claimAttemptsDeleted: 0, done: false };

  // 실패한 stay 는 이번 실행에서 다시 고르지 않도록 id 순으로 넘어간다.
  let cursor = "";
  let seen = 0;
  let staysDone = false;
  while (Date.now() < stayDeadline && seen < maxStays) {
    let query = db
      .from("stays")
      .select("id, organization_id, reservation_group_key, status")
      .lt("retain_until", today);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query.order("id").limit(Math.min(batchSize, maxStays - seen));
    if (error) throw new Error(`stays 읽기 실패: ${error.message}`);
    const stays = (data ?? []) as ExpiredStay[];
    if (stays.length === 0) {
      staysDone = true;
      break;
    }
    for (const stay of stays) {
      if (Date.now() >= stayDeadline) break;
      cursor = stay.id;
      seen += 1;
      try {
        const { deleted, files } = await deleteStay(db, stay, today, pageSize);
        if (deleted) {
          result.staysDeleted += 1;
          result.filesDeleted += files;
        }
      } catch (error) {
        result.staysFailed += 1;
        console.error("[retention] stay 건너뜀", error instanceof Error ? error.message : error);
      }
    }
  }

  const claims = await deleteOldClaimAttempts(db, now, deadline);
  result.claimAttemptsDeleted = claims.deleted;
  result.done = staysDone && claims.done;
  return result;
}
