import { authenticateDevice } from "@/lib/device/auth";
import { json, serverError } from "@/lib/guest/request";
import { hangUpStaffCall } from "@/lib/kiosk/staff-call-store";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// POST /api/kiosk/call/[id]/end — 통화 끝내기(46 §5). 울리는 중이면 canceled, 통화 중이면 ended, 끝났으면 그대로. 다른 기기 · 다른 조직은 404.
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const db = createCheckinServiceClient();
    const auth = await authenticateDevice(db, request);
    if ("error" in auth) return json({ ok: false, error: auth.error }, 401);

    const status = await hangUpStaffCall(db, auth.device, (await params).id, new Date());
    if (!status) return json({ ok: false, error: "not_found" }, 404);
    return json({ ok: true, status });
  } catch (error) {
    return serverError("kiosk-call-end", error);
  }
}
