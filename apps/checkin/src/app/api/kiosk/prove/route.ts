import { createHmac } from "node:crypto";

import { z } from "zod";

import { authenticateDevice } from "@/lib/device/auth";
import { proveOutcome } from "@/lib/kiosk/complete";
import { kioskLockState, type KioskAttempt } from "@/lib/kiosk/find";
import { json, readJson, serverError } from "@/lib/guest/request";
import { kioskStayOf, markPassportProof, openKioskStayWithProof, takeSessionLock, readReservationNames, readStayLanguage } from "@/lib/kiosk/store";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// POST /api/kiosk/prove — 이름으로 찾은 뒤 여권 띠로 본인 확인. 서버가 띠(mrz_raw)를 직접 읽어(검사 숫자 + 줄1 이름)
// 이 세션 예약의 이름과 맞으면 증명을 건다. 맞는 값을 알아내려는 반복을 막으려고 틀린 이름은 find 와 같은 방식으로 센다
// (이 기기에서 연달아 5번 틀릴 때마다 1분 잠금, 키는 `kiosk-prove|기기`). 읽지 못한 띠는 정보를 주지 않으므로 세지 않는다.
export const dynamic = "force-dynamic";

const bodySchema = z.object({ session_id: z.uuid(), mrz_raw: z.string().max(200).optional() });

export async function POST(request: Request) {
  const secret = process.env.CHECKIN_HASH_SECRET;
  if (!secret) return serverError("kiosk-prove", new Error("CHECKIN_HASH_SECRET 가 없습니다."));

  try {
    const db = createCheckinServiceClient();
    const auth = await authenticateDevice(db, request);
    if ("error" in auth) return json({ ok: false, error: auth.error }, 401);
    const { device } = auth;

    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) return json({ ok: false, error: "invalid" }, 400);
    const now = new Date();

    const hmac = (value: string) => createHmac("sha256", secret).update(value).digest("hex");
    const keyHash = hmac(`kiosk-prove|${device.id}`);
    const { data: recent, error: recentError } = await db
      .from("claim_attempts")
      .select("succeeded, attempted_at")
      .eq("key_hash", keyHash)
      .gte("attempted_at", new Date(now.getTime() - 10 * 60_000).toISOString())
      .order("attempted_at", { ascending: false })
      .limit(20);
    if (recentError) throw new Error(recentError.message);
    const before = kioskLockState((recent ?? []) as KioskAttempt[], now);
    if (before.lockedUntil) return json({ ok: false, error: "locked", locked_until: before.lockedUntil }, 429);

    const opened = await openKioskStayWithProof(db, parsed.data.session_id, device, now);
    if (!opened) return json({ ok: false, error: "session_gone" }, 409);
    const { stay, payload } = opened;

    const names = await readReservationNames(db, stay.organizationId, stay.id);
    const outcome = proveOutcome(payload, parsed.data.mrz_raw, names);
    if (outcome === "unreadable") return json({ ok: false, error: "unreadable" }, 400);

    if (outcome === "name_mismatch") {
      const { error: logError } = await db
        .from("claim_attempts")
        .insert({ key_hash: keyHash, ip_hash: hmac(`device|${device.id}`), succeeded: false });
      if (logError) throw new Error(logError.message);
      const { error: auditError } = await db.from("audit_log").insert({
        organization_id: stay.organizationId,
        device_id: device.id,
        stay_id: stay.id,
        action: "kiosk_proof_failed",
        meta: {},
      });
      if (auditError) console.error("[kiosk-prove] audit_log 쓰기 실패:", auditError.message);
      const after = kioskLockState([{ succeeded: false, attempted_at: now.toISOString() }, ...((recent ?? []) as KioskAttempt[])], now);
      if (after.lockedUntil) return json({ ok: false, error: "locked", locked_until: after.lockedUntil }, 429);
      return json({ ok: false, error: "name_mismatch", remaining: after.remaining }, 403);
    }

    if (outcome === "proven") {
      // 증명한 뒤에야 예약을 잠근다 — 다른 기기가 진짜로 잡고 있으면 증명도 걸지 않고 busy.
      if (!(await takeSessionLock(db, stay, parsed.data.session_id, device.id, now))) return json({ ok: false, error: "blocked", reason: "busy" }, 409);
      // 성공 기록(실패 횟수 지움)은 잠금까지 얻은 뒤에만.
      const { error: logError } = await db
        .from("claim_attempts")
        .insert({ key_hash: keyHash, ip_hash: hmac(`device|${device.id}`), succeeded: true });
      if (logError) throw new Error(logError.message);
      await markPassportProof(db, parsed.data.session_id, stay.organizationId, payload);
    }

    return json({
      ok: true,
      result: stay.status === "checked_in" ? "checked_in" : "found",
      session_id: parsed.data.session_id,
      language: await readStayLanguage(db, stay.id),
      checked_in_at: stay.checkedInAt,
      stay: kioskStayOf(stay),
    });
  } catch (error) {
    return serverError("kiosk-prove", error);
  }
}
