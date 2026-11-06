import { authenticateDevice } from "@/lib/device/auth";
import { json, readJson, serverError } from "@/lib/guest/request";
import { callRequestSchema, sessionIdOf } from "@/lib/kiosk/staff-call";
import { openStaffCall } from "@/lib/kiosk/staff-call-store";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// POST /api/kiosk/call — 직원 호출(46 §5). `disabled` · `unconfigured` 는 오류가 아니라 정상 응답(200)이다 — 태블릿은 연락처 화면을 보여 준다.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const db = createCheckinServiceClient();
    const auth = await authenticateDevice(db, request);
    if ("error" in auth) return json({ ok: false, error: auth.error }, 401);

    const body = await readJson(request);
    const parsed = callRequestSchema.safeParse(body);
    if (!parsed.success) return json({ ok: false, error: "invalid" }, 400);

    return json(await openStaffCall(db, auth.device, { ...parsed.data, sessionId: sessionIdOf(body) }, new Date()));
  } catch (error) {
    return serverError("kiosk-call", error);
  }
}
