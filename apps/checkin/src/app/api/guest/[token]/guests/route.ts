import { z } from "zod";

import { guestInputSchema, nameRomanOf } from "@/lib/guest/fields";
import { partyAfterRemoval } from "@/lib/guest/party";
import { json, readJson, serverError } from "@/lib/guest/request";
import { loadStayByToken, PASSPORT_BUCKET, refreshPreRegStatus } from "@/lib/guest/store";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// PUT /api/guest/[token]/guests — 한 사람 명부 저장(시안 W3). 서버가 다시 검사하고, 체크인 뒤에는 막는다(FR-W03).
// 동행자의 주소 · 전 숙박지 · 다음 행선지는 화면이 대표자 값을 채워 보낸다(사람마다 저장, 44 FR-W02).
// 대표자가 그 값을 바꾸면, 같은 값을 쓰던 동행자도 같이 바꾼다.
export const dynamic = "force-dynamic";

const MAX_GUESTS = 20;
const SHARED = ["address", "prev_stay", "next_dest"] as const;

export async function PUT(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = guestInputSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return json({ ok: false, error: "invalid", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, 400);
  }
  const input = parsed.data;

  try {
    const db = createCheckinServiceClient();
    const stay = await loadStayByToken(db, token);
    if (!stay) return json({ ok: false, error: "not_found" }, 404);
    if (!stay.editable) return json({ ok: false, error: "locked" }, 409);

    const existing = input.id ? stay.guests.find((guest) => guest.id === input.id) : undefined;
    if (input.id && !existing) return json({ ok: false, error: "not_found" }, 404);
    if (!existing && stay.guests.length >= MAX_GUESTS) return json({ ok: false, error: "too_many" }, 409);

    const isChild = input.guestType === "child";
    const row = {
      guest_type: input.guestType,
      name_roman: nameRomanOf(input.lastName, input.firstName),
      has_japan_address: input.hasJapanAddress,
      // 일본에 사는 외국인도 있어 국적을 일본으로 채우지 않는다 — 주소가 있으면 국적 · 여권은 법 요건이 아니다.
      nationality: input.nationality,
      passport_number: isChild && input.noPassport ? null : input.passportNumber,
      no_passport_reason: isChild && input.noPassport ? "child" : null,
      age: input.age,
      gender: input.gender,
      address: input.address,
      // 연락처는 대표자만(동행자는 대표자 것 — 43 §2-1). 동행자가 보낸 값은 버린다.
      contact: existing?.is_representative ? input.contact : null,
      prev_stay: input.prevStay,
      next_dest: input.nextDest,
      source: "guest",
      updated_at: new Date().toISOString(),
    };

    let guestId = existing?.id ?? null;
    if (existing) {
      const { error } = await db.from("guests").update(row).eq("id", existing.id).eq("stay_id", stay.id);
      if (error) throw new Error(error.message);
      if (existing.is_representative) {
        for (const field of SHARED) {
          const before = existing[field];
          if (before === row[field]) continue;
          const companions = stay.guests.filter(
            (guest) => !guest.is_representative && (guest[field] === null || guest[field] === before),
          );
          if (companions.length === 0) continue;
          const { error: shareError } = await db
            .from("guests")
            .update({ [field]: row[field], updated_at: row.updated_at })
            .in("id", companions.map((guest) => guest.id));
          if (shareError) throw new Error(shareError.message);
        }
      }
    } else {
      const { data, error } = await db
        .from("guests")
        .insert({ ...row, organization_id: stay.organizationId, stay_id: stay.id, is_representative: false })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      guestId = data.id as string;
    }

    const refreshed = await refreshPreRegStatus(db, token);
    const saved = refreshed?.guests.find((guest) => guest.id === guestId);
    return json({ ok: true, guest_id: guestId, missing: saved?.missing ?? [] });
  } catch (error) {
    return serverError("guest-save", error);
  }
}

const removeSchema = z.object({ guestId: z.string().uuid().nullable() });

// DELETE /api/guest/[token]/guests — 「이 사람은 안 와요」(43 §8). guestId 가 있으면 저장한 동행자를 지우고(여권 사진 파일까지),
// 없으면 빈 자리 하나를 뺀다. 둘 다 손님이 말한 인원(party_size)을 하나 줄인다. 대표자는 뺄 수 없다.
export async function DELETE(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = removeSchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ ok: false, error: "invalid" }, 400);
  const { guestId } = parsed.data;

  try {
    const db = createCheckinServiceClient();
    const stay = await loadStayByToken(db, token);
    if (!stay) return json({ ok: false, error: "not_found" }, 404);
    if (!stay.editable) return json({ ok: false, error: "locked" }, 409);

    const target = guestId ? stay.guests.find((guest) => guest.id === guestId) : undefined;
    if (guestId && !target) return json({ ok: false, error: "not_found" }, 404);
    if (target?.is_representative) return json({ ok: false, error: "representative" }, 409);

    const next = partyAfterRemoval(stay.guests.length, stay.partySize, !!target);
    if (next === null) return json({ ok: false, error: "last_seat" }, 409);

    if (target) {
      const { data: docs } = await db.from("guest_documents").select("storage_path").eq("guest_id", target.id);
      const { error } = await db.from("guests").delete().eq("id", target.id).eq("stay_id", stay.id);
      if (error) throw new Error(error.message);
      const paths = (docs ?? []).map((doc) => doc.storage_path as string);
      if (paths.length) await db.storage.from(PASSPORT_BUCKET).remove(paths);
    }
    const { error: partyError } = await db
      .from("stays")
      .update({ party_size: next, updated_at: new Date().toISOString() })
      .eq("id", stay.id);
    if (partyError) throw new Error(partyError.message);

    await refreshPreRegStatus(db, token);
    return json({ ok: true, party_size: next });
  } catch (error) {
    return serverError("guest-remove", error);
  }
}
