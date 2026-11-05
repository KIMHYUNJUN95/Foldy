import { authenticateDevice } from "@/lib/device/auth";
import { japanFlagChanged } from "@/lib/guest/address";
import { companionsSharingOldAddress } from "@/lib/guest/address-plan";
import { json, readJson, serverError } from "@/lib/guest/request";
import {
  invalidFieldsOf,
  KIOSK_MAX_GUESTS,
  kioskGuestBodySchema,
  kioskGuestRow,
} from "@/lib/kiosk/guests";
import { kioskStayOf, openProvenKioskStay, provenFailure, reloadKioskStay } from "@/lib/kiosk/store";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// POST /api/kiosk/guests — 태블릿에서 한 사람 명부 저장(44 FR-K06 · K07 · K08 · K16 · K21). 이 기기가 잡은 세션으로만.
// 서버가 다시 검사한다. MRZ 판독값이 오면 source = mrz + 원문 · 체크섬 결과를 남긴다(직원이 손 입력과 비교).
// 새 동행자는 대표자의 전 숙박지 · 다음 행선지를 이어받는다. 주소는 이어받지 않는다 — POST /api/kiosk/address 가 따로 저장(2026-11-04).
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const db = createCheckinServiceClient();
    const auth = await authenticateDevice(db, request);
    if ("error" in auth) return json({ ok: false, error: auth.error }, 401);
    const { device } = auth;

    const parsed = kioskGuestBodySchema.safeParse(await readJson(request));
    if (!parsed.success) return json({ ok: false, error: "invalid", fields: invalidFieldsOf(parsed.error) }, 400);
    const { sessionId, guest: input } = parsed.data;
    const now = new Date();

    const opened = await openProvenKioskStay(db, sessionId, device, now);
    if ("error" in opened) return provenFailure(opened.error);
    const { stay } = opened;
    if (!stay.editable) return json({ ok: false, error: "locked" }, 409);

    const existing = input.id ? stay.guests.find((guest) => guest.id === input.id) : undefined;
    if (input.id && !existing) return json({ ok: false, error: "not_found" }, 404);
    if (!existing && stay.guests.length >= KIOSK_MAX_GUESTS) return json({ ok: false, error: "too_many" }, 409);

    const representative = stay.guests.find((guest) => guest.is_representative) ?? null;
    const row = kioskGuestRow(input, representative, !existing, now.toISOString(), !!existing?.is_representative, existing);

    let guestId: string;
    if (existing) {
      // 대표자의 일본 거주 여부가 바뀌어 주소가 비워질 때, 옛 글을 그대로 쓰던 동행자도 비운다. 대표자 쓰기보다 먼저 —
      // 중간에 끊겨 다시 보내도 대표자의 옛 여부가 그대로라 같은 판정이 다시 돈다.
      if (existing.is_representative && "address" in row && japanFlagChanged(existing.has_japan_address, input.hasJapanAddress)) {
        const stale = companionsSharingOldAddress(stay.guests, existing.address);
        if (stale.length) {
          const { error: staleError } = await db
            .from("guests")
            .update({ address: null, updated_at: row.updated_at })
            .eq("stay_id", stay.id)
            .in("id", stale);
          if (staleError) throw new Error(staleError.message);
        }
      }
      const { error } = await db.from("guests").update(row).eq("id", existing.id).eq("stay_id", stay.id);
      if (error) throw new Error(error.message);
      guestId = existing.id;
    } else {
      const { data, error } = await db
        .from("guests")
        .insert({ ...row, organization_id: stay.organizationId, stay_id: stay.id, is_representative: false })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      guestId = data.id as string;
    }

    const refreshed = await reloadKioskStay(db, stay.id);
    if (!refreshed) return json({ ok: false, error: "session_gone" }, 409);
    return json({ ok: true, guest_id: guestId, stay: kioskStayOf(refreshed) });
  } catch (error) {
    return serverError("kiosk-guests", error);
  }
}
