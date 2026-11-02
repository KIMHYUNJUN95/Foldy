import { z } from "zod";

import { isLocale } from "@/lib/i18n";
import { json, readJson, serverError } from "@/lib/guest/request";
import { loadStayByToken, refreshPreRegStatus } from "@/lib/guest/store";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// POST /api/guest/[token]/consent — 약관 · 개인정보 두 칸 동의(시안 W3b). 대표자 이름으로 한 줄, 미성년자는 보호자가 대신(FR-K23).
export const dynamic = "force-dynamic";

const bodySchema = z.object({ terms: z.literal(true), privacy: z.literal(true), locale: z.string() });

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success || !isLocale(parsed.data.locale)) return json({ ok: false, error: "invalid" }, 400);

  try {
    const db = createCheckinServiceClient();
    const stay = await loadStayByToken(db, token);
    if (!stay) return json({ ok: false, error: "not_found" }, 404);
    if (!stay.editable) return json({ ok: false, error: "locked" }, 409);
    if (stay.guests.some((guest) => guest.missing.length > 0)) return json({ ok: false, error: "incomplete" }, 409);

    if (!stay.consented) {
      const { data: settings } = await db
        .from("property_settings")
        .select("terms_version")
        .eq("organization_id", stay.organizationId)
        .eq("property_key", stay.propertyKey)
        .maybeSingle();
      const representative = stay.guests.find((guest) => guest.is_representative);
      const { error } = await db.from("consents").insert({
        organization_id: stay.organizationId,
        stay_id: stay.id,
        guest_id: representative?.id ?? null,
        terms_version: (settings?.terms_version as number | undefined) ?? 1,
        locale: parsed.data.locale,
      });
      if (error) throw new Error(error.message);
    }

    const refreshed = await refreshPreRegStatus(db, token);
    return json({ ok: true, status: refreshed?.status ?? stay.status });
  } catch (error) {
    return serverError("guest-consent", error);
  }
}
