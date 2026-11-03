import { createHash, randomUUID } from "node:crypto";

import { authenticateDevice } from "@/lib/device/auth";
import { EXTENSION, MAX_PASSPORT_BYTES, sniffImageType } from "@/lib/guest/image";
import { json, serverError } from "@/lib/guest/request";
import { PASSPORT_BUCKET } from "@/lib/guest/store";
import { kioskStayOf, openKioskStay, reloadKioskStay } from "@/lib/kiosk/store";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// POST /api/kiosk/passport — 태블릿 카메라 여권 사진 한 장(multipart: session_id · guest_id · file, 44 FR-K07).
// 사전 등록 웹 POST /api/guest/[token]/passport 와 같은 규칙: 앞 바이트로 형식 확인 · 10MB · 사람당 1장(다시 찍으면 대체 · 앞 파일 지움).
export const dynamic = "force-dynamic";

const UPLOADS_PER_HOUR = 40;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const db = createCheckinServiceClient();
    const auth = await authenticateDevice(db, request);
    if ("error" in auth) return json({ ok: false, error: auth.error }, 401);
    const { device } = auth;

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ ok: false, error: "invalid" }, 400);
    }
    const sessionId = form.get("session_id");
    const guestId = form.get("guest_id");
    const file = form.get("file");
    if (typeof sessionId !== "string" || !UUID.test(sessionId) || typeof guestId !== "string" || !(file instanceof Blob)) {
      return json({ ok: false, error: "invalid" }, 400);
    }
    if (file.size === 0 || file.size > MAX_PASSPORT_BYTES) return json({ ok: false, error: "too_large" }, 413);
    const now = new Date();

    const stay = await openKioskStay(db, sessionId, device, now);
    if (!stay) return json({ ok: false, error: "session_gone" }, 409);
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
      .gte("captured_at", new Date(now.getTime() - 3_600_000).toISOString());
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
        captured_on: "kiosk",
        device_id: device.id,
        retain_until: stay.retainUntil,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      })
      .select("id")
      .single();
    if (insertError) {
      await db.storage.from(PASSPORT_BUCKET).remove([path]);
      throw new Error(insertError.message);
    }

    if (previous?.length) {
      const { error: replaceError } = await db
        .from("guest_documents")
        .update({ replaced_by: doc.id })
        .in("id", previous.map((row) => row.id));
      if (replaceError) {
        await db.from("guest_documents").delete().eq("id", doc.id);
        await db.storage.from(PASSPORT_BUCKET).remove([path]);
        throw new Error(replaceError.message);
      }
      await db.storage.from(PASSPORT_BUCKET).remove(previous.map((row) => row.storage_path as string));
    }

    const refreshed = await reloadKioskStay(db, stay.id);
    if (!refreshed) return json({ ok: false, error: "session_gone" }, 409);
    return json({ ok: true, stay: kioskStayOf(refreshed) });
  } catch (error) {
    return serverError("kiosk-passport", error);
  }
}
