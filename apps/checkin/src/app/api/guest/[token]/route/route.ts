import { z } from "zod";

import { ROUTE_TEXT_MAX } from "@/lib/guest/route";
import { json, readJson, serverError } from "@/lib/guest/request";
import { loadStayByToken, refreshPreRegStatus } from "@/lib/guest/store";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// PUT /api/guest/[token]/route — 대표자의 전 숙박지 · 다음 행선지 저장(시안 W3s).
// 대표자 값을 따라오던 동행자(값이 비었거나 옛 대표자 값과 같은 사람)도 같이 바꾼다 — guests 저장과 같은 규칙.
export const dynamic = "force-dynamic";

// 값은 lib/guest/route.ts 가 만든 짧은 일본어이고, 서버 검사 상한(120)보다 짧은 60자까지.
const bodySchema = z.object({
  prevStay: z.string().trim().min(1).max(ROUTE_TEXT_MAX),
  nextDest: z.string().trim().min(1).max(ROUTE_TEXT_MAX),
});

export async function PUT(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ ok: false, error: "invalid" }, 400);
  const input = { prev_stay: parsed.data.prevStay, next_dest: parsed.data.nextDest };

  try {
    const db = createCheckinServiceClient();
    const stay = await loadStayByToken(db, token);
    if (!stay) return json({ ok: false, error: "not_found" }, 404);
    if (!stay.editable) return json({ ok: false, error: "locked" }, 409);
    const representative = stay.guests.find((guest) => guest.is_representative);
    if (!representative) return json({ ok: false, error: "not_found" }, 404);

    const now = new Date().toISOString();
    const { error } = await db.from("guests").update({ ...input, updated_at: now }).eq("id", representative.id).eq("stay_id", stay.id);
    if (error) throw new Error(error.message);

    for (const field of ["prev_stay", "next_dest"] as const) {
      const before = representative[field];
      if (before === input[field]) continue;
      const companions = stay.guests.filter((guest) => !guest.is_representative && (guest[field] === null || guest[field] === before));
      if (companions.length === 0) continue;
      const { error: shareError } = await db
        .from("guests")
        .update({ [field]: input[field], updated_at: now })
        .in("id", companions.map((guest) => guest.id));
      if (shareError) throw new Error(shareError.message);
    }

    await refreshPreRegStatus(db, token);
    return json({ ok: true });
  } catch (error) {
    return serverError("guest-route", error);
  }
}
