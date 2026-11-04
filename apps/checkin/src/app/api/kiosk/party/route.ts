import { z } from "zod";

import { authenticateDevice } from "@/lib/device/auth";
import { json, readJson, serverError } from "@/lib/guest/request";
import { clampPartySize } from "@/lib/kiosk/find";
import { kioskStayOf, openProvenKioskStay, provenFailure } from "@/lib/kiosk/store";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// POST /api/kiosk/party — 시안 T2 의 인원 ±(44 FR-K05: 예약과 달라도 막지 않고 직원 화면에 표시).
// 이 기기가 잡은 세션으로만. 저장한 사람 수 아래로는 못 내린다(1~20).
export const dynamic = "force-dynamic";

const bodySchema = z.object({ sessionId: z.uuid(), partySize: z.number().int() });

export async function POST(request: Request) {
  try {
    const db = createCheckinServiceClient();
    const auth = await authenticateDevice(db, request);
    if ("error" in auth) return json({ ok: false, error: auth.error }, 401);
    const { device } = auth;

    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) return json({ ok: false, error: "invalid" }, 400);
    const now = new Date();

    const opened = await openProvenKioskStay(db, parsed.data.sessionId, device, now);
    if ("error" in opened) return provenFailure(opened.error);
    const { stay } = opened;
    if (!stay.editable) return json({ ok: false, error: "locked" }, 409);

    const partySize = clampPartySize(parsed.data.partySize, stay.guests.length);
    if (partySize === null) return json({ ok: false, error: "invalid" }, 400);
    // 「미리 체크인 끝」이었는데 빈 자리가 생기면 다시 「진행 전」으로(사전 등록 웹의 refreshPreRegStatus 와 같은 규칙).
    const reopen = stay.status === "pre_registered" && partySize > stay.guests.length;
    const { error } = await db
      .from("stays")
      .update({ party_size: partySize, updated_at: now.toISOString(), ...(reopen ? { status: "pending" } : {}) })
      .eq("id", stay.id);
    if (error) throw new Error(error.message);

    return json({ ok: true, stay: kioskStayOf({ ...stay, partySize }) });
  } catch (error) {
    return serverError("kiosk-party", error);
  }
}
