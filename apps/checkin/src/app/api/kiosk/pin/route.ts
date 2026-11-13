import { createHmac } from "node:crypto";

import { z } from "zod";

import { readDeviceSettings } from "@/lib/contract/read-settings";
import { authenticateDevice } from "@/lib/device/auth";
import { verifyPin } from "@/lib/device/pin";
import { discardAttempts, markSucceeded, priorAttempts, recordPending } from "@/lib/guest/attempts";
import { lockState } from "@/lib/guest/limits";
import { json, readJson, serverError } from "@/lib/guest/request";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// POST /api/kiosk/pin — 직원 해제 PIN 을 서버가 대조한다(FR-K18 · K24, 2026-11-13). 태블릿은 온라인이면 이 라우트를 먼저 쓰고,
// 연결이 없을 때만 계약의 기기별 값으로 대조한다. 틀림은 기기마다 10분 안 5번 → 마지막 실패 + 10분 잠금(키 `kiosk-pin|기기`).
// 기록에 PIN 원문은 없다. 시도는 먼저 실패로 적고 판정한다(동시 요청이 서로를 세게).
export const dynamic = "force-dynamic";

const bodySchema = z.object({ pin: z.string().regex(/^[0-9]{4,8}$/) });

export async function POST(request: Request) {
  const secret = process.env.CHECKIN_HASH_SECRET;
  if (!secret) return serverError("kiosk-pin", new Error("CHECKIN_HASH_SECRET 가 없습니다."));

  try {
    const db = createCheckinServiceClient();
    const auth = await authenticateDevice(db, request);
    if ("error" in auth) return json({ ok: false, error: auth.error }, 401);
    const { device } = auth;

    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) return json({ ok: false, error: "invalid" }, 400);
    const now = new Date();

    const hmac = (value: string) => createHmac("sha256", secret).update(value).digest("hex");
    const keyHash = hmac(`kiosk-pin|${device.id}`);
    const own = await recordPending(db, [{ key_hash: keyHash, ip_hash: hmac(`device|${device.id}`) }]);
    const recent = await priorAttempts(db, keyHash, 10 * 60_000, 10, now, own.ids);
    const before = lockState(recent, now);
    if (before.lockedUntil) {
      await discardAttempts(db, own.ids);
      return json({ ok: false, error: "locked", locked_until: before.lockedUntil }, 429);
    }

    const settings = await readDeviceSettings(db, device, "staff_pin_hash");
    const stored = (settings?.staff_pin_hash as string | null | undefined) ?? null;
    if (!stored) {
      await discardAttempts(db, own.ids);
      return json({ ok: false, error: "unset" }, 409);
    }

    if (verifyPin(parsed.data.pin, stored)) {
      await markSucceeded(db, own.ids);
      return json({ ok: true });
    }

    const after = lockState([{ succeeded: false, attempted_at: now.toISOString() }, ...recent], now);
    if (after.lockedUntil) return json({ ok: false, error: "locked", locked_until: after.lockedUntil }, 429);
    return json({ ok: false, error: "wrong", remaining: after.remaining }, 403);
  } catch (error) {
    return serverError("kiosk-pin", error);
  }
}
