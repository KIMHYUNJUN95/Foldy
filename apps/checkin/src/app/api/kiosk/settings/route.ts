import { buildContract, settingsVersionOf, type PropertySettingsRow } from "@/lib/contract/build";
import { readDeviceSettings } from "@/lib/contract/read-settings";
import { authenticateDevice } from "@/lib/device/auth";
import { json, serverError } from "@/lib/guest/request";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// GET /api/kiosk/settings — 태블릿이 그리는 계약 JSON(칸 · 규칙 · 문구 · 약관 · 초 · 연락처 · 기기별 PIN 값, 16 §4).
// PIN 은 원 해시가 아니라 이 기기 id 로 다시 만든 값만 나간다(오프라인 대조용). 온라인 대조는 `POST /api/kiosk/pin`.
// 건물 설정이 아직 없으면 기본값. settingsVersion 은 ping 과 같은 값(바뀌었는지 비교용).
export const dynamic = "force-dynamic";

const COLUMNS =
  "languages, welcome_text, terms_text, terms_version, required_fields, video_seconds_per_guest, support_contacts, idle_seconds_input, idle_seconds_done, verification_method, staff_pin_hash, mrz_autofill, updated_at";

export async function GET(request: Request) {
  const secret = process.env.CHECKIN_HASH_SECRET;
  if (!secret) return serverError("kiosk-settings", new Error("CHECKIN_HASH_SECRET 가 없습니다."));
  try {
    const db = createCheckinServiceClient();
    const auth = await authenticateDevice(db, request);
    if ("error" in auth) return json({ ok: false, error: auth.error }, 401);
    const { device } = auth;

    const data = await readDeviceSettings(db, device, COLUMNS);

    return json({
      ok: true,
      device: { id: device.id, propertyKey: device.property_key, name: device.name },
      settingsVersion: settingsVersionOf(data as { updated_at?: string | null; staff_call_enabled: boolean } | null),
      contract: buildContract(data as unknown as PropertySettingsRow | null, { id: device.id, secret }),
    });
  } catch (error) {
    return serverError("kiosk-settings", error);
  }
}
