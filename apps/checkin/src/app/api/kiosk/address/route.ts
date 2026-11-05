import { authenticateDevice } from "@/lib/device/auth";
import { applyAddressPlan, planAddresses } from "@/lib/guest/address-plan";
import { json, readJson, serverError } from "@/lib/guest/request";
import { addressBodySchema } from "@/lib/kiosk/guests";
import { kioskStayOf, openProvenKioskStay, provenFailure, reloadKioskStay } from "@/lib/kiosk/store";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// POST /api/kiosk/address — 전원 집 주소 전체(2026-11-04, 44 FR-K06). 대표자 글 하나 + 「다른 사람」만 따로.
// 대표자 글은 대표자의 일본 거주 여부로, others 는 그 사람 자신의 여부로 검사하고(외국인은 영문만), 나머지는 대표자 글을 그대로 받는다.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const db = createCheckinServiceClient();
    const auth = await authenticateDevice(db, request);
    if ("error" in auth) return json({ ok: false, error: auth.error }, 401);
    const { device } = auth;

    const parsed = addressBodySchema.safeParse(await readJson(request));
    if (!parsed.success) return json({ ok: false, error: "invalid", fields: ["address"] }, 400);
    const { sessionId, representativeAddress, others } = parsed.data;
    const now = new Date();

    const opened = await openProvenKioskStay(db, sessionId, device, now);
    if ("error" in opened) return provenFailure(opened.error);
    const { stay } = opened;
    if (!stay.editable) return json({ ok: false, error: "locked" }, 409);

    const plan = planAddresses(stay.guests, representativeAddress, others);
    if (!plan.ok) return json({ ok: false, error: "invalid", fields: plan.fields }, 400);
    await applyAddressPlan(db, stay.id, plan.groups, now.toISOString());

    const refreshed = await reloadKioskStay(db, stay.id);
    if (!refreshed) return json({ ok: false, error: "session_gone" }, 409);
    return json({ ok: true, stay: kioskStayOf(refreshed) });
  } catch (error) {
    return serverError("kiosk-address", error);
  }
}
