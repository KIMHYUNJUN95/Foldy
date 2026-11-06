import { z } from "zod";

import { settingsVersionOf } from "@/lib/contract/build";
import { readDeviceSettings } from "@/lib/contract/read-settings";
import { authenticateDevice } from "@/lib/device/auth";
import { json, readJson, serverError } from "@/lib/guest/request";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// POST /api/device/ping — 태블릿이 5분마다(FR-D03). 마지막 접속 · 배터리 · 버전을 남기고, 설정 버전을 돌려준다.
// 앱은 settingsVersion 이 바뀌었으면 `GET /api/kiosk/settings` 를 다시 받는다. 폐기된 기기는 401 `revoked` → 등록 화면으로.
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  battery: z.number().int().min(0).max(100).optional(),
  appVersion: z.string().trim().max(40).optional(),
  osVersion: z.string().trim().max(40).optional(),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse((await readJson(request)) ?? {});
  if (!parsed.success) return json({ ok: false, error: "invalid" }, 400);

  try {
    const db = createCheckinServiceClient();
    const auth = await authenticateDevice(db, request);
    if ("error" in auth) return json({ ok: false, error: auth.error }, 401);
    const { device } = auth;

    const patch: Record<string, unknown> = { last_seen_at: new Date().toISOString() };
    if (parsed.data.battery !== undefined) patch.battery = parsed.data.battery;
    if (parsed.data.appVersion) patch.app_version = parsed.data.appVersion;
    if (parsed.data.osVersion) patch.os_version = parsed.data.osVersion;

    const [{ error }, settings] = await Promise.all([
      db.from("devices").update(patch).eq("id", device.id),
      readDeviceSettings(db, device, "updated_at"),
    ]);
    if (error) throw new Error(error.message);
    return json({ ok: true, settingsVersion: settingsVersionOf(settings as { updated_at?: string | null; staff_call_enabled: boolean } | null) });
  } catch (error) {
    return serverError("device-ping", error);
  }
}
