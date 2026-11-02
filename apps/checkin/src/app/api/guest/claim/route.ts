import { z } from "zod";

import { isBuildingKey } from "@/lib/building-key";
import { attemptKeys, IP_PER_MINUTE, lockState, type AttemptRow } from "@/lib/guest/limits";
import { matchClaim } from "@/lib/guest/match";
import { clientIp, json, readJson, serverError } from "@/lib/guest/request";
import { readClaimCandidates } from "@/lib/guest/store";
import { newGuestToken } from "@/lib/guest/token";
import { createCheckinServiceClient } from "@/lib/supabase/service";
import { addDays, todayTokyo } from "@/lib/tokyo-date";

// POST /api/guest/claim — 건물 고정 링크에서 이름 + 체크인 날짜 + (예약 번호 | 전화 뒤 4자리)로 예약을 찾아 링크 토큰을 준다(16 §4).
// 틀려도 어느 칸이 틀렸는지 말하지 않는다. 10분 안 5번 실패 → 10분 잠금, IP 당 1분 30번.
export const dynamic = "force-dynamic";

// 한 stay 에 살아 있는 개인 링크 수(일행에게 나눠 준 것 + 다시 찾은 것).
const MAX_TOKENS = 10;

const bodySchema = z
  .object({
    building: z.string(),
    lastName: z.string().trim().min(1).max(60),
    firstName: z.string().trim().min(1).max(60),
    checkInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reference: z.string().trim().max(40).optional(),
    phoneLast4: z.string().trim().regex(/^\d{4}$/).optional(),
  })
  .refine((body) => !!body.reference || !!body.phoneLast4);

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success || !isBuildingKey(parsed.data.building)) {
    return json({ ok: false, error: "invalid" }, 400);
  }
  const input = parsed.data;
  const secret = process.env.CHECKIN_HASH_SECRET;
  if (!secret) return serverError("guest-claim", new Error("CHECKIN_HASH_SECRET 가 없습니다."));

  try {
    const db = createCheckinServiceClient();
    const now = new Date();
    const { keyHash, ipHash } = attemptKeys(clientIp(request), input.building, secret);

    const [{ data: recent, error: recentError }, { count: ipCount, error: ipError }] = await Promise.all([
      db
        .from("claim_attempts")
        .select("succeeded, attempted_at")
        .eq("key_hash", keyHash)
        .gte("attempted_at", new Date(now.getTime() - 10 * 60_000).toISOString())
        .order("attempted_at", { ascending: false })
        .limit(10),
      db
        .from("claim_attempts")
        .select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash)
        .gte("attempted_at", new Date(now.getTime() - 60_000).toISOString()),
    ]);
    if (recentError || ipError) throw new Error((recentError ?? ipError)!.message);

    const before = lockState((recent ?? []) as AttemptRow[], now);
    if (before.lockedUntil) return json({ ok: false, error: "locked", locked_until: before.lockedUntil }, 429);
    if ((ipCount ?? 0) >= IP_PER_MINUTE) return json({ ok: false, error: "rate_limited" }, 429);

    // 열 수 있는 기간: 체크인 날짜가 어제(자정 넘어 도착) ~ 30일 뒤. 그보다 먼 예약은 아직 stay 가 없다(sync-stays 범위와 같다).
    const today = todayTokyo(now);
    const inWindow = input.checkInDate >= addDays(today, -1) && input.checkInDate <= addDays(today, 30);
    const match = inWindow
      ? matchClaim(await readClaimCandidates(db, input.building, input.checkInDate), input)
      : ({ kind: "none" } as const);

    const succeeded = match.kind === "one";
    const { error: logError } = await db.from("claim_attempts").insert({ key_hash: keyHash, ip_hash: ipHash, succeeded });
    if (logError) throw new Error(logError.message);

    if (match.kind !== "one") {
      const after = lockState([{ succeeded: false, attempted_at: now.toISOString() }, ...((recent ?? []) as AttemptRow[])], now);
      if (after.lockedUntil) return json({ ok: false, error: "locked", locked_until: after.lockedUntil }, 429);
      return json({ ok: false, error: "not_found", remaining: after.remaining, failures: after.failures }, 404);
    }

    // 찾을 때마다 새 토큰을 하나 더 만든다 — 앞 링크(일행에게 보낸 것)는 그대로 열린다. 원문은 DB 에 없어 다시 줄 수 없다.
    const token = newGuestToken();
    const { data: stay, error: stayError } = await db.from("stays").select("organization_id").eq("id", match.stayId).single();
    if (stayError) throw new Error(stayError.message);
    const { error: tokenError } = await db
      .from("stay_tokens")
      .insert({ token_hash: token.hash, organization_id: stay.organization_id, stay_id: match.stayId });
    if (tokenError) throw new Error(tokenError.message);
    // stay 당 최근 MAX_TOKENS 개만 남긴다.
    const { data: old } = await db
      .from("stay_tokens")
      .select("token_hash")
      .eq("stay_id", match.stayId)
      .order("created_at", { ascending: false })
      .range(MAX_TOKENS, MAX_TOKENS + 50);
    if (old?.length) await db.from("stay_tokens").delete().in("token_hash", old.map((row) => row.token_hash as string));
    return json({ ok: true, token: token.raw });
  } catch (error) {
    return serverError("guest-claim", error);
  }
}
