import { z } from "zod";

import { attemptKeys } from "@/lib/guest/limits";
import { clientIp, json, readJson, serverError } from "@/lib/guest/request";
import { newGuestToken } from "@/lib/guest/token";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// POST /api/device/enroll — 직원이 관리자 화면에서 만든 8자리 등록 코드(10분 · 1회)로 태블릿을 건물 하나에 등록한다(FR-D01, 16 §4).
// 기기 토큰 원문은 여기서 한 번만 돌려준다. 같은 IP 는 1분에 5번까지(잘못된 코드 마구 넣기 막기).
export const dynamic = "force-dynamic";

const ENROLL_PER_MINUTE = 5;

const bodySchema = z.object({
  code: z.string().regex(/^[0-9]{8}$/),
  deviceModel: z.string().trim().max(80).optional(),
  osVersion: z.string().trim().max(40).optional(),
  appVersion: z.string().trim().max(40).optional(),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ ok: false, error: "invalid" }, 400);
  const input = parsed.data;
  const secret = process.env.CHECKIN_HASH_SECRET;
  if (!secret) return serverError("device-enroll", new Error("CHECKIN_HASH_SECRET 가 없습니다."));

  try {
    const db = createCheckinServiceClient();
    const now = new Date();
    // 시도 기록은 「예약 찾기」와 같은 표 — 키 자리에 건물 대신 "device-enroll".
    const { keyHash, ipHash } = attemptKeys(clientIp(request), "device-enroll", secret);
    const { count, error: countError } = await db
      .from("claim_attempts")
      .select("id", { count: "exact", head: true })
      .eq("key_hash", keyHash)
      .gte("attempted_at", new Date(now.getTime() - 60_000).toISOString());
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) >= ENROLL_PER_MINUTE) return json({ ok: false, error: "rate_limited" }, 429);

    // 코드 쓰기를 한 번의 조건부 update 로 — 두 기기가 같은 코드를 동시에 넣어도 한쪽만 된다.
    const { data: code, error: codeError } = await db
      .from("enrollment_codes")
      .update({ used_at: now.toISOString() })
      .eq("code", input.code)
      .is("used_at", null)
      .gt("expires_at", now.toISOString())
      .select("organization_id, property_key, device_name, created_by")
      .maybeSingle();
    if (codeError) throw new Error(codeError.message);
    await db.from("claim_attempts").insert({ key_hash: keyHash, ip_hash: ipHash, succeeded: !!code });
    // 없는 코드 · 지난 코드 · 쓴 코드를 구별하지 않는다.
    if (!code) return json({ ok: false, error: "invalid_code" }, 404);

    const token = newGuestToken();
    const { data: device, error: deviceError } = await db
      .from("devices")
      .insert({
        organization_id: code.organization_id,
        property_key: code.property_key,
        name: code.device_name,
        token_hash: token.hash,
        registered_by: code.created_by,
        last_seen_at: now.toISOString(),
        device_model: input.deviceModel ?? null,
        os_version: input.osVersion ?? null,
        app_version: input.appVersion ?? null,
      })
      .select("id, property_key, name")
      .single();
    if (deviceError) throw new Error(deviceError.message);

    // 기기는 이미 등록됐다 — 기록 실패로 토큰을 잃으면 코드만 날아가므로 로그만 남기고 성공으로 답한다.
    const { error: auditError } = await db.from("audit_log").insert({
      organization_id: code.organization_id,
      actor_user_id: code.created_by,
      device_id: device.id,
      action: "device_enrolled",
      meta: { property_key: code.property_key },
    });
    if (auditError) console.error("[device-enroll] audit_log 쓰기 실패:", auditError.message);

    return json({ ok: true, token: token.raw, device: { id: device.id, propertyKey: device.property_key, name: device.name } });
  } catch (error) {
    return serverError("device-enroll", error);
  }
}
