import { createHmac } from "node:crypto";

import { z } from "zod";

import { authenticateDevice } from "@/lib/device/auth";
import { proveOutcome } from "@/lib/kiosk/complete";
import { kioskLockState } from "@/lib/kiosk/find";
import { discardAttempts, markSucceeded, priorAttempts, recordPending } from "@/lib/guest/attempts";
import { json, readJson, serverError } from "@/lib/guest/request";
import { kioskStayOf, markPassportProof, openKioskStayWithProof, takeSessionLock, readReservationNames, readStayLanguage } from "@/lib/kiosk/store";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// POST /api/kiosk/prove — 이름으로 찾은 뒤 여권 띠로 본인 확인. 서버가 띠(mrz_raw)를 직접 읽어(검사 숫자 + 줄1 이름)
// 이 세션 예약의 이름과 맞으면 증명을 건다. 맞는 값을 알아내려는 반복을 막으려고 틀린 이름은 find 와 같은 방식으로 센다
// (이 기기에서 연달아 5번 틀릴 때마다 1분 잠금, 키는 `kiosk-prove|기기`). 읽지 못한 띠는 정보를 주지 않으므로 세지 않는다.
// 명부의 같은 이름 여권 번호와 띠의 번호가 다르면 `staff_needed`(틀림으로 셈).
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
    // 먼저 실패로 적고 자기 줄을 뺀 앞 기록으로 판정한다(동시 요청이 서로를 세게). 세지 않는 결과(읽지 못함 · 이미 증명 · 세션 없음 · 사용 중)는 지운다.
    const own = await recordPending(db, [{ key_hash: keyHash, ip_hash: hmac(`device|${device.id}`) }]);
    const recent = await priorAttempts(db, keyHash, 10 * 60_000, 20, now, own.ids);
    const before = kioskLockState(recent, now);
    if (before.lockedUntil) {
      await discardAttempts(db, own.ids);
      return json({ ok: false, error: "locked", locked_until: before.lockedUntil }, 429);
    }

    const opened = await openKioskStayWithProof(db, parsed.data.session_id, device, now);
    if (!opened) {
      await discardAttempts(db, own.ids);
      return json({ ok: false, error: "session_gone" }, 409);
    }
    const { stay, payload } = opened;

    const names = await readReservationNames(db, stay.organizationId, stay.id);
    const outcome = proveOutcome(payload, parsed.data.mrz_raw, names, stay.guests);
    if (outcome === "unreadable") {
      await discardAttempts(db, own.ids);
      return json({ ok: false, error: "unreadable" }, 400);
    }

    if (outcome === "name_mismatch" || outcome === "staff_needed") {
      // 실패 줄은 그대로 둔다. 번호가 어긋난 여권은 다시 찍어도 같으니 직원 확인으로.
      const { error: auditError } = await db.from("audit_log").insert({
        organization_id: stay.organizationId,
        device_id: device.id,
        stay_id: stay.id,
        action: "kiosk_proof_failed",
        meta: {},
      });
      if (auditError) console.error("[kiosk-prove] audit_log 쓰기 실패:", auditError.message);
      if (outcome === "staff_needed") return json({ ok: false, error: "staff_needed" }, 403);
      const after = kioskLockState([{ succeeded: false, attempted_at: now.toISOString() }, ...recent], now);
      if (after.lockedUntil) return json({ ok: false, error: "locked", locked_until: after.lockedUntil }, 429);
      return json({ ok: false, error: "name_mismatch", remaining: after.remaining }, 403);
    }

    if (outcome === "proven") {
      // 증명한 뒤에야 예약을 잠근다 — 다른 기기가 진짜로 잡고 있으면 증명도 걸지 않고 busy(이 시도는 세지 않음).
      if (!(await takeSessionLock(db, stay, parsed.data.session_id, device.id, now))) {
        await discardAttempts(db, own.ids);
        return json({ ok: false, error: "blocked", reason: "busy" }, 409);
      }
      // 성공 표시(실패 횟수 지움)는 잠금까지 얻은 뒤에만.
      await markSucceeded(db, own.ids);
      await markPassportProof(db, parsed.data.session_id, stay.organizationId, payload);
    } else {
      await discardAttempts(db, own.ids);
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
