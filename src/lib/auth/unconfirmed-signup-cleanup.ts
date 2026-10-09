import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isStaleUnconfirmedSignup, type UnconfirmedCandidate } from "@/lib/auth/unconfirmed-signup-rule";

/** 한 번에 지우는 최대 개수(크론 한 번이 오래 걸리지 않게). */
const MAX_DELETES_PER_RUN = 200;

/**
 * 확인 안 된 오래된 가입 정리(2026-10-09 사용자 승인 — 「가입」을 누르면 Supabase 가 확인 전 계정을 먼저 만들어,
 * 메일 확인을 안 했거나 주소를 잘못 친 계정이 계속 쌓였다).
 *
 * 메일 확인 전에는 로그인이 안 되므로 이 계정들에는 프로필 · 업무 기록이 있을 수 없다. 그래도 **프로필 행이 있으면
 * 건너뛴다**(이중 안전장치). 지우는 것은 Supabase Auth 의 사용자 행뿐이고, 같은 주소로 다시 가입하면 새로 만들어진다.
 */
export async function cleanupUnconfirmedSignups(service: SupabaseClient<Database>, now = new Date()) {
  const stale: string[] = [];
  for (let page = 1; page <= 50 && stale.length < MAX_DELETES_PER_RUN; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const user of data.users) {
      if (isStaleUnconfirmedSignup(user as UnconfirmedCandidate, now)) stale.push(user.id);
      if (stale.length >= MAX_DELETES_PER_RUN) break;
    }
    if (data.users.length < 1000) break;
  }
  if (stale.length === 0) return { checked: true, deleted: 0, skipped: 0 };

  const { data: withProfile, error: profileError } = await service.from("profiles").select("id").in("id", stale);
  if (profileError) throw profileError;
  const keep = new Set((withProfile ?? []).map((p) => p.id));

  let deleted = 0;
  for (const id of stale) {
    if (keep.has(id)) continue;
    const { error } = await service.auth.admin.deleteUser(id);
    if (error) {
      console.error("[auth/unconfirmed-cleanup] delete failed", id, error.message);
      continue;
    }
    deleted += 1;
  }
  return { checked: true, deleted, skipped: keep.size };
}
