import { z } from "zod";

import { applyAddressPlan, planAddresses } from "@/lib/guest/address-plan";
import { json, readJson, serverError } from "@/lib/guest/request";
import { loadStayByToken, refreshPreRegStatus } from "@/lib/guest/store";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// PUT /api/guest/[token]/address — 전원 집 주소 전체(2026-11-04, 44 FR-W02). 태블릿 POST /api/kiosk/address 와 같은 분배 규칙
// (lib/guest/address-plan.ts): 대표자 글 하나 + 다른 사람만 따로. 외국인 글은 영문만.
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  representativeAddress: z.string().max(400),
  others: z.array(z.object({ guestId: z.uuid(), address: z.string().max(400) })).max(20),
});

export async function PUT(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ ok: false, error: "invalid", fields: ["address"] }, 400);

  try {
    const db = createCheckinServiceClient();
    const stay = await loadStayByToken(db, token);
    if (!stay) return json({ ok: false, error: "not_found" }, 404);
    if (!stay.editable) return json({ ok: false, error: "locked" }, 409);

    const plan = planAddresses(stay.guests, parsed.data.representativeAddress, parsed.data.others);
    if (!plan.ok) return json({ ok: false, error: "invalid", fields: plan.fields }, 400);
    await applyAddressPlan(db, stay.id, plan.groups, new Date().toISOString());

    await refreshPreRegStatus(db, token);
    return json({ ok: true });
  } catch (error) {
    return serverError("guest-address", error);
  }
}
