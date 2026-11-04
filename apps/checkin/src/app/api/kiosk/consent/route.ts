import { z } from "zod";

import { authenticateDevice } from "@/lib/device/auth";
import { json, readJson, serverError } from "@/lib/guest/request";
import { isLocale } from "@/lib/i18n";
import { kioskStayOf, openProvenKioskStay, provenFailure, reloadKioskStay } from "@/lib/kiosk/store";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// POST /api/kiosk/consent — 태블릿 약관 · 개인정보 두 칸 동의(시안 G3b, 44 FR-K09). 대표자 이름으로 한 줄 + 기기.
// 웹과 달리 명부가 덜 됐어도 막지 않는다 — 「직원 확인 필요」로 넘긴 분이 있을 수 있고, 다 됐는지는 완료(complete)가 본다.
// 이미 동의한 예약은 줄을 더 만들지 않는다(웹에서 미리 동의했거나 다시 누름).
export const dynamic = "force-dynamic";

const kioskConsentSchema = z.object({
  sessionId: z.uuid(),
  terms: z.literal(true),
  locale: z.string().refine(isLocale),
});

export async function POST(request: Request) {
  try {
    const db = createCheckinServiceClient();
    const auth = await authenticateDevice(db, request);
    if ("error" in auth) return json({ ok: false, error: auth.error }, 401);
    const { device } = auth;

    const parsed = kioskConsentSchema.safeParse(await readJson(request));
    if (!parsed.success) return json({ ok: false, error: "invalid" }, 400);

    const opened = await openProvenKioskStay(db, parsed.data.sessionId, device, new Date());
    if ("error" in opened) return provenFailure(opened.error);
    const { stay } = opened;
    if (!stay.editable) return json({ ok: false, error: "locked" }, 409);

    if (!stay.consented) {
      const { data: settings, error: settingsError } = await db
        .from("property_settings")
        .select("terms_version")
        .eq("organization_id", stay.organizationId)
        .eq("property_key", stay.propertyKey)
        .maybeSingle();
      if (settingsError) throw new Error(settingsError.message);
      const representative = stay.guests.find((guest) => guest.is_representative);
      const { error } = await db.from("consents").insert({
        organization_id: stay.organizationId,
        stay_id: stay.id,
        guest_id: representative?.id ?? null,
        terms_version: (settings?.terms_version as number | undefined) ?? 1,
        locale: parsed.data.locale,
        device_id: device.id,
      });
      if (error) throw new Error(error.message);
    }

    const refreshed = await reloadKioskStay(db, stay.id);
    if (!refreshed) return json({ ok: false, error: "session_gone" }, 409);
    return json({ ok: true, stay: kioskStayOf(refreshed) });
  } catch (error) {
    return serverError("kiosk-consent", error);
  }
}
