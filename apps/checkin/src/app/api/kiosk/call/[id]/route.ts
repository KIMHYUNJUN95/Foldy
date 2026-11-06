import { authenticateDevice } from "@/lib/device/auth";
import { json, serverError } from "@/lib/guest/request";
import { readStaffCallState } from "@/lib/kiosk/staff-call-store";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// GET /api/kiosk/call/[id] — 통화 상태(46 §5). `token` · `url` 은 `accepted` 일 때만. 다른 기기 · 다른 조직은 404.
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const db = createCheckinServiceClient();
    const auth = await authenticateDevice(db, request);
    if ("error" in auth) return json({ ok: false, error: auth.error }, 401);

    const state = await readStaffCallState(db, auth.device, (await params).id, new Date());
    if (!state) return json({ ok: false, error: "not_found" }, 404);
    return json({ ok: true, ...state });
  } catch (error) {
    return serverError("kiosk-call-read", error);
  }
}
