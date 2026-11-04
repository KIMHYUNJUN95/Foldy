import { authenticateDevice } from "@/lib/device/auth";
import { json, readJson, serverError } from "@/lib/guest/request";
import { companionsFollowing, routeBodySchema } from "@/lib/kiosk/guests";
import { kioskStayOf, openProvenKioskStay, provenFailure, reloadKioskStay } from "@/lib/kiosk/store";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// POST /api/kiosk/route — 전 숙박지 · 다음 행선지(시안 T3s, 신주쿠구 규칙 10 ⑦ · ⑧). 대표자에 저장하고,
// 비어 있었거나 대표자의 옛 값을 그대로 쓰던 동행자도 따라간다. 값은 글자 그대로 저장(보기 값 · 직접 쓰기는 앱이 정한다).
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const db = createCheckinServiceClient();
    const auth = await authenticateDevice(db, request);
    if ("error" in auth) return json({ ok: false, error: auth.error }, 401);
    const { device } = auth;

    const parsed = routeBodySchema.safeParse(await readJson(request));
    if (!parsed.success) return json({ ok: false, error: "invalid" }, 400);
    const now = new Date();

    const opened = await openProvenKioskStay(db, parsed.data.sessionId, device, now);
    if ("error" in opened) return provenFailure(opened.error);
    const { stay } = opened;
    if (!stay.editable) return json({ ok: false, error: "locked" }, 409);
    const representative = stay.guests.find((guest) => guest.is_representative);
    if (!representative) return json({ ok: false, error: "not_found" }, 404);

    const updatedAt = now.toISOString();
    const values = {
      prev_stay: parsed.data.prevStay,
      next_dest: parsed.data.nextDest,
    };
    const { error } = await db
      .from("guests")
      .update({ ...values, updated_at: updatedAt })
      .eq("id", representative.id)
      .eq("stay_id", stay.id);
    if (error) throw new Error(error.message);

    for (const field of ["prev_stay", "next_dest"] as const) {
      const ids = companionsFollowing(stay.guests, field, representative[field], values[field]);
      if (ids.length === 0) continue;
      const { error: shareError } = await db
        .from("guests")
        .update({ [field]: values[field], updated_at: updatedAt })
        .eq("stay_id", stay.id)
        .in("id", ids);
      if (shareError) throw new Error(shareError.message);
    }

    const refreshed = await reloadKioskStay(db, stay.id);
    if (!refreshed) return json({ ok: false, error: "session_gone" }, 409);
    return json({ ok: true, stay: kioskStayOf(refreshed) });
  } catch (error) {
    return serverError("kiosk-route", error);
  }
}
