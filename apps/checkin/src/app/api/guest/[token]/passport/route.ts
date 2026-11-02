import { createHash, randomUUID } from "node:crypto";

import { EXTENSION, MAX_PASSPORT_BYTES, sniffImageType } from "@/lib/guest/image";
import { json, serverError } from "@/lib/guest/request";
import { loadStayByToken, PASSPORT_BUCKET, refreshPreRegStatus } from "@/lib/guest/store";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// POST /api/guest/[token]/passport — 여권 사진 한 장(multipart: guest_id · file). 사람당 1장, 다시 올리면 대체(44 FR-W05).
// 화면이 긴 변 2,400px JPEG 로 줄여 보내서(16 §6) 서버리스 본문 한도(4.5MB) 안에 든다 — 서버 상한은 10MB.
// 웹은 판독(MRZ)하지 않는다. 판독은 태블릿에서(16 §6).
export const dynamic = "force-dynamic";

const UPLOADS_PER_HOUR = 40;

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "invalid" }, 400);
  }
  const guestId = form.get("guest_id");
  const file = form.get("file");
  if (typeof guestId !== "string" || !(file instanceof Blob)) return json({ ok: false, error: "invalid" }, 400);
  if (file.size === 0 || file.size > MAX_PASSPORT_BYTES) return json({ ok: false, error: "too_large" }, 413);

  try {
    const db = createCheckinServiceClient();
    const stay = await loadStayByToken(db, token);
    if (!stay) return json({ ok: false, error: "not_found" }, 404);
    if (!stay.editable) return json({ ok: false, error: "locked" }, 409);
    const guest = stay.guests.find((row) => row.id === guestId);
    if (!guest) return json({ ok: false, error: "not_found" }, 404);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffImageType(bytes);
    if (!type) return json({ ok: false, error: "not_image" }, 415);

    const { count, error: countError } = await db
      .from("guest_documents")
      .select("id", { count: "exact", head: true })
      .in("guest_id", stay.guests.map((row) => row.id))
      .gte("captured_at", new Date(Date.now() - 3_600_000).toISOString());
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) >= UPLOADS_PER_HOUR) return json({ ok: false, error: "rate_limited" }, 429);

    const path = `${stay.organizationId}/${stay.id}/${guest.id}/passport-${randomUUID()}.${EXTENSION[type]}`;
    const { error: uploadError } = await db.storage
      .from(PASSPORT_BUCKET)
      .upload(path, bytes, { contentType: type, upsert: false });
    if (uploadError) throw new Error(uploadError.message);

    const { data: previous } = await db
      .from("guest_documents")
      .select("id, storage_path")
      .eq("guest_id", guest.id)
      .eq("kind", "passport")
      .is("replaced_by", null);

    const { data: doc, error: insertError } = await db
      .from("guest_documents")
      .insert({
        organization_id: stay.organizationId,
        guest_id: guest.id,
        kind: "passport",
        storage_path: path,
        byte_size: bytes.length,
        captured_on: "guest_web",
        retain_until: stay.retainUntil,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      })
      .select("id")
      .single();
    if (insertError) {
      await db.storage.from(PASSPORT_BUCKET).remove([path]);
      throw new Error(insertError.message);
    }

    // 대체된 사진은 파일을 바로 지운다(필요 없는 개인 정보를 들고 있지 않기). 줄은 replaced_by 로 남긴다.
    if (previous?.length) {
      await db
        .from("guest_documents")
        .update({ replaced_by: doc.id })
        .in("id", previous.map((row) => row.id));
      await db.storage.from(PASSPORT_BUCKET).remove(previous.map((row) => row.storage_path as string));
    }

    await refreshPreRegStatus(db, token);
    return json({ ok: true });
  } catch (error) {
    return serverError("guest-passport", error);
  }
}
