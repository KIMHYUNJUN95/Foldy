import { buildContract, type PropertySettingsRow } from "@/lib/contract/build";
import { authenticateDevice } from "@/lib/device/auth";
import { json, serverError } from "@/lib/guest/request";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// GET /api/kiosk/settings — 태블릿이 그리는 계약 JSON(칸 · 규칙 · 문구 · 약관 · 초 · 연락처 · PIN 해시, 16 §4).
// 건물 설정이 아직 없으면 기본값. settingsVersion 은 ping 과 같은 값(바뀌었는지 비교용).
export const dynamic = "force-dynamic";

const COLUMNS =
  "languages, welcome_text, terms_text, terms_version, required_fields, video_seconds_per_guest, support_contacts, idle_seconds_input, idle_seconds_done, verification_method, staff_pin_hash, mrz_autofill, updated_at";

export async function GET(request: Request) {
  try {
    const db = createCheckinServiceClient();
    const auth = await authenticateDevice(db, request);
    if ("error" in auth) return json({ ok: false, error: auth.error }, 401);
    const { device } = auth;

    const { data, error } = await db
      .from("property_settings")
      .select(COLUMNS)
      .eq("organization_id", device.organization_id)
      .eq("property_key", device.property_key)
      .maybeSingle();
    if (error) throw new Error(error.message);

    return json({
      ok: true,
      device: { id: device.id, propertyKey: device.property_key, name: device.name },
      settingsVersion: (data?.updated_at as string | undefined) ?? "default",
      contract: buildContract((data as PropertySettingsRow | null) ?? null),
    });
  } catch (error) {
    return serverError("kiosk-settings", error);
  }
}
