import { createHmac } from "node:crypto";

import { z } from "zod";

import { authenticateDevice } from "@/lib/device/auth";
import { clientIp, json, readJson, serverError } from "@/lib/guest/request";
import { loadStayById } from "@/lib/guest/store";
import { todayTokyo } from "@/lib/tokyo-date";
import {
  kioskGate,
  kioskLockState,
  kioskRequireMrz,
  matchByName,
  matchByPassportStays,
  passportNumberConflict,
  passportSearchDates,
  pickByCode,
} from "@/lib/kiosk/find";
import { parseMrzStrip } from "@/lib/kiosk/mrz";
import { discardAttempts, markSucceeded, priorAttempts, recordPending } from "@/lib/guest/attempts";
import { holdSession, kioskStayOf, readNameCandidates, readStayLanguage, readStaysByCode, type KioskStayRow } from "@/lib/kiosk/store";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// POST /api/kiosk/find — 태블릿 예약 찾기(44 FR-K02 · K03 · K04 · K17, 시안 T1 · T1k · T1x · T1b · T1c).
// 6자리 코드, 또는 여권 띠(`mrz_raw` — 서버가 검사 숫자를 확인하고 띠의 성 · 이름으로 찾으며, 명부에 같은 이름의 여권 번호가 있으면 대조), 또는 이름 + 체크인 날짜(이름은 stay 를 돌려주지 않고 proof_needed — 여권 확인 뒤 /api/kiosk/prove)(이 기기의 건물만). 못 찾으면 어느 칸이 틀렸는지 말하지 않는다.
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
    mrz_raw: z.string().max(200).optional(),
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
    // 성 · 이름만으로는 방 번호까지 열리므로 띠가 기본 필수(2026-11-13). 틀림으로 세지 않는다 — 추측이 아니라 앱 쪽 문제다.
    if (input.mode === "passport" && !input.mrz_raw && kioskRequireMrz(process.env.CHECKIN_KIOSK_REQUIRE_MRZ)) {
      return json({ ok: false, error: "mrz_required" }, 400);
    }

    // 시도 기록은 사전 등록 웹과 같은 표 — 키는 기기(IP 가 아니라).
    const hmac = (value: string) => createHmac("sha256", secret).update(value).digest("hex");
    const keyHash = hmac(`kiosk-find|${device.id}`);
    // 먼저 실패로 적고 자기 줄을 뺀 앞 기록으로 판정한다(동시 요청이 서로를 세게, lib/guest/attempts.ts).
    const own = await recordPending(db, [{ key_hash: keyHash, ip_hash: hmac(`ip|${clientIp(request)}`) }]);
    const recent = await priorAttempts(db, keyHash, 10 * 60_000, 20, now, own.ids);
    const before = kioskLockState(recent, now);
    if (before.lockedUntil) {
      await discardAttempts(db, own.ids);
      return json({ ok: false, error: "locked", locked_until: before.lockedUntil }, 429);
    }

    let found: KioskStayRow | null = null;
    let loaded: Awaited<ReturnType<typeof loadStayById>> | undefined;
    // 여권 띠의 번호가 명부와 어긋나면 열지 않고 직원 확인(`staff_needed`)으로 — 틀림으로 센다(기기 토큰으로 번호를 마구 맞춰 보지 못하게).
    let numberConflict = false;
    if (input.mode === "code") {
      // 코드는 회사 전체에서 찾지만, 다른 건물 것은 「없는 코드」와 똑같이 답하고 틀림으로 센다(그런 코드가 있다는 것도 알려 주지 않는다).
      const byCode = pickByCode(await readStaysByCode(db, device.organization_id, input.code));
      found = byCode?.property_key === device.property_key ? byCode : null;
    } else if (input.mode === "passport") {
      // 띠가 오면 띠에서 읽은 이름만 쓴다. 검사 숫자가 틀린 띠는 「못 찾음」(틀림으로 셈).
      const strip = input.mrz_raw === undefined ? null : parseMrzStrip(input.mrz_raw);
      if (input.mrz_raw === undefined || strip) {
        const surname = strip?.surname ?? input.lastName;
        const givenNames = strip?.givenNames ?? input.firstName;
        const { stays, candidates } = await readNameCandidates(db, device.organization_id, device.property_key, passportSearchDates(now), todayTokyo(now));
        const stayId = matchByPassportStays(candidates, stays, surname, givenNames, todayTokyo(now));
        found = stays.find((stay) => stay.id === stayId) ?? null;
        if (found && strip) {
          loaded = await loadStayById(db, found.id);
          numberConflict = !!loaded && passportNumberConflict(loaded.guests, strip);
        }
      }
    } else {
      const { stays, candidates } = await readNameCandidates(db, device.organization_id, device.property_key, input.checkInDate);
      const stayId = matchByName(candidates, input.lastName, input.firstName);
      found = stays.find((stay) => stay.id === stayId) ?? null;
    }

    // 실패 줄은 그대로 둔다(번호 어긋남 포함). 찾았을 때만 성공으로.
    if (numberConflict) return json({ ok: false, error: "staff_needed" }, 403);
    if (!found) {
      const after = kioskLockState([{ succeeded: false, attempted_at: now.toISOString() }, ...recent], now);
      if (after.lockedUntil) return json({ ok: false, error: "locked", locked_until: after.lockedUntil }, 429);
      return json({ ok: false, error: "not_found", remaining: after.remaining }, 404);
    }
    await markSucceeded(db, own.ids);

    const gate = kioskGate(found, now);
    if (gate.kind === "blocked") {
      return json(
        { ok: false, error: "blocked", reason: gate.reason, ...(gate.reason === "too_early" ? { check_in_date: gate.checkInDate } : {}) },
        409,
      );
    }

    const stay = loaded ?? (await loadStayById(db, found.id));
    if (!stay) return json({ ok: false, error: "blocked", reason: "expired" }, 409);
    const sessionId = await holdSession(db, stay, device.id, now, input.mode);
    if (!sessionId) return json({ ok: false, error: "blocked", reason: "busy" }, 409);

    // 이름만으로는 예약 정보(방 · 날짜 · 연락처)를 보여 주지 않는다 — 여권으로 본인 확인(`prove`)이 먼저다.
    if (input.mode === "name") {
      return json({ ok: true, result: "proof_needed", session_id: sessionId, language: await readStayLanguage(db, stay.id) });
    }

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
