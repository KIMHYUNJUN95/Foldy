import { createHmac } from "node:crypto";

import { z } from "zod";

import { authenticateDevice } from "@/lib/device/auth";
import { clientIp, json, readJson, serverError } from "@/lib/guest/request";
import { loadStayById } from "@/lib/guest/store";
import { todayTokyo } from "@/lib/tokyo-date";
import { kioskGate, kioskLockState, matchByName, matchByPassportStays, passportSearchDates, pickByCode, type KioskAttempt } from "@/lib/kiosk/find";
import { holdSession, kioskStayOf, readNameCandidates, readStayLanguage, readStaysByCode, type KioskStayRow } from "@/lib/kiosk/store";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// POST /api/kiosk/find — 태블릿 예약 찾기(44 FR-K02 · K03 · K04 · K17, 시안 T1 · T1k · T1x · T1b · T1c).
// 6자리 코드, 또는 이름 + 체크인 날짜(이 기기의 건물만). 못 찾으면 어느 칸이 틀렸는지 말하지 않는다.
// 이 기기에서 연달아 5번 틀릴 때마다 1분 잠금. 찾으면 이 기기의 세션을 잡는다(다른 기기가 진행 중이면 막음).
export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("code"), code: z.string().regex(/^[0-9]{6}$/) }),
  z.object({
    mode: z.literal("name"),
    lastName: z.string().trim().min(1).max(60),
    firstName: z.string().trim().min(1).max(60),
    checkInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({
    mode: z.literal("passport"),
    lastName: z.string().trim().min(1).max(60),
    firstName: z.string().trim().max(60),
  }),
]);

export async function POST(request: Request) {
  const secret = process.env.CHECKIN_HASH_SECRET;
  if (!secret) return serverError("kiosk-find", new Error("CHECKIN_HASH_SECRET 가 없습니다."));

  try {
    const db = createCheckinServiceClient();
    const auth = await authenticateDevice(db, request);
    if ("error" in auth) return json({ ok: false, error: auth.error }, 401);
    const { device } = auth;

    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) return json({ ok: false, error: "invalid" }, 400);
    const input = parsed.data;
    const now = new Date();

    // 시도 기록은 사전 등록 웹과 같은 표 — 키는 기기(IP 가 아니라).
    const hmac = (value: string) => createHmac("sha256", secret).update(value).digest("hex");
    const keyHash = hmac(`kiosk-find|${device.id}`);
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

    let found: KioskStayRow | null = null;
    if (input.mode === "code") {
      found = pickByCode(await readStaysByCode(db, device.organization_id, input.code));
    } else if (input.mode === "passport") {
      const { stays, candidates } = await readNameCandidates(db, device.organization_id, device.property_key, passportSearchDates(now));
      const stayId = matchByPassportStays(candidates, stays, input.lastName, input.firstName, todayTokyo(now));
      found = stays.find((stay) => stay.id === stayId) ?? null;
    } else {
      const { stays, candidates } = await readNameCandidates(db, device.organization_id, device.property_key, input.checkInDate);
      const stayId = matchByName(candidates, input.lastName, input.firstName);
      found = stays.find((stay) => stay.id === stayId) ?? null;
    }

    const { error: logError } = await db
      .from("claim_attempts")
      .insert({ key_hash: keyHash, ip_hash: hmac(`ip|${clientIp(request)}`), succeeded: !!found });
    if (logError) throw new Error(logError.message);

    if (!found) {
      const after = kioskLockState([{ succeeded: false, attempted_at: now.toISOString() }, ...((recent ?? []) as KioskAttempt[])], now);
      if (after.lockedUntil) return json({ ok: false, error: "locked", locked_until: after.lockedUntil }, 429);
      return json({ ok: false, error: "not_found", remaining: after.remaining }, 404);
    }

    if (found.property_key !== device.property_key) return json({ ok: false, error: "blocked", reason: "other_building" }, 409);
    const gate = kioskGate(found, now);
    if (gate.kind === "blocked") {
      return json(
        { ok: false, error: "blocked", reason: gate.reason, ...(gate.reason === "too_early" ? { check_in_date: gate.checkInDate } : {}) },
        409,
      );
    }

    const stay = await loadStayById(db, found.id);
    if (!stay) return json({ ok: false, error: "blocked", reason: "expired" }, 409);
    const sessionId = await holdSession(db, stay, device.id, now);
    if (!sessionId) return json({ ok: false, error: "blocked", reason: "busy" }, 409);

    return json({
      ok: true,
      result: gate.kind === "checked_in" ? "checked_in" : "found",
      session_id: sessionId,
      language: await readStayLanguage(db, stay.id),
      checked_in_at: stay.checkedInAt,
      stay: kioskStayOf(stay),
    });
  } catch (error) {
    return serverError("kiosk-find", error);
  }
}
