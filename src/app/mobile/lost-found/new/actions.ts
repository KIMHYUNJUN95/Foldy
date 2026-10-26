"use server";

import { redirect } from "next/navigation";
import {
  getCanonicalPropertyName,
  getCanonicalRoomLabel,
  getDisplayRoomLabel,
} from "@/lib/room-label-normalization";
import { isLostItemCategory, type LostItemCategory } from "@/lib/lost-found-constants";
import { getActiveRoomCatalogServer } from "@/lib/rooms";
import { getCurrentAppSession } from "@/lib/session";
import { isOwnStoragePublicUrl } from "@/lib/storage-url-guard";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

const REQUEST_IMAGE_BUCKET = "request-images";

function cleanText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function createLostItem(formData: FormData) {
  const rawCleaningSessionId = cleanText(formData.get("cleaningSessionId"));
  const rawReservationId = cleanText(formData.get("reservationId"));
  const requestedId = cleanText(formData.get("id"));

  const session = await getCurrentAppSession();
  if (!session) {
    const basePath = "/mobile/lost-found/new";
    const targetParams = new URLSearchParams();
    if (rawCleaningSessionId) {
      targetParams.set("sessionId", rawCleaningSessionId);
    }
    if (rawReservationId) {
      targetParams.set("reservationId", rawReservationId);
    }
    const targetPath =
      targetParams.size > 0 ? `${basePath}?${targetParams.toString()}` : basePath;
    redirect(`/auth/login?next=${encodeURIComponent(targetPath)}`);
  }

  const propertyName = cleanText(formData.get("propertyName"));
  const roomLabel = cleanText(formData.get("roomLabel"));
  const itemName = cleanText(formData.get("itemName"));
  const rawCategory = cleanText(formData.get("category"));
  const category: LostItemCategory = isLostItemCategory(rawCategory) ? rawCategory : "other";
  const memo = cleanText(formData.get("memo"));
  const imageUrls = formData
    .getAll("imageUrls")
    .map((v) => cleanText(v))
    .filter(Boolean);

  const sessionParams = new URLSearchParams();
  if (rawCleaningSessionId) sessionParams.set("sessionId", rawCleaningSessionId);
  if (rawReservationId) sessionParams.set("reservationId", rawReservationId);
  const sessionParam = sessionParams.size > 0 ? `&${sessionParams.toString()}` : "";

  if (!propertyName) {
    redirect(`/mobile/lost-found/new?error=missing_building${sessionParam}`);
  }
  if (roomLabel.length === 0 || roomLabel.length > 100) {
    redirect(`/mobile/lost-found/new?error=invalid_room${sessionParam}`);
  }

  // Fetch active room catalog to double-check validation on server
  const catalog = await getActiveRoomCatalogServer(session.organization.id);
  if (!catalog) {
    redirect(`/mobile/lost-found/new?error=save_failed${sessionParam}`);
  }

  // The form submits the collapsed displayRoomLabel ("201", not "201_2"), so validate against
  // displayRoomLabel — otherwise a room whose only active Beds24 account is a "_2" sub-unit would fail.
  const isValidCombination = catalog.some(
    (item) => item.propertyName === propertyName && item.displayRoomLabel === roomLabel
  );
  if (!isValidCombination) {
    redirect(`/mobile/lost-found/new?error=invalid_room${sessionParam}`);
  }

  if (!itemName) {
    redirect(`/mobile/lost-found/new?error=missing_item_name${sessionParam}`);
  }
  if (requestedId && !isValidUuid(requestedId)) {
    redirect(`/mobile/lost-found/new?error=save_failed${sessionParam}`);
  }
  if (imageUrls.length > 5) {
    redirect(`/mobile/lost-found/new?error=save_failed${sessionParam}`);
  }

  const requestId = requestedId || crypto.randomUUID();
  const imagePrefix = `${session.organization.id}/lost-items/${requestId}/`;
  if (!imageUrls.every((url) => isOwnStoragePublicUrl(url, REQUEST_IMAGE_BUCKET, imagePrefix))) {
    redirect(`/mobile/lost-found/new?error=save_failed${sessionParam}`);
  }

  const supabase = await getSupabaseServerClient();

  // Validate the cleaning session link: must belong to this user/org (any status).
  let cleaningSessionId: string | null = null;
  if (rawCleaningSessionId) {
    const { data } = await supabase
      .from("cleaning_sessions")
      .select("id")
      .eq("id", rawCleaningSessionId)
      .eq("organization_id", session.organization.id)
      .eq("staff_user_id", session.user.id)
      .maybeSingle();
    cleaningSessionId = (data as { id: string } | null)?.id ?? null;
    if (!cleaningSessionId) {
      redirect(
        `/mobile/lost-found/new?error=invalid_session&sessionId=${encodeURIComponent(rawCleaningSessionId)}`,
      );
    }
  }

  let guestName: string | null = null;
  let reservationId: string | null = null;
  if (rawReservationId) {
    const { data } = await supabase
      .from("reservations")
      .select("id, guest_name, property_name, room_label")
      .eq("id", rawReservationId)
      .eq("organization_id", session.organization.id)
      .maybeSingle();

    const linkedReservation = data as {
      guest_name: string;
      id: string;
      property_name: string;
      room_label: string;
    } | null;

    if (!linkedReservation) {
      redirect(`/mobile/lost-found/new?error=save_failed${sessionParam}`);
    }

    const linkedPropertyName = getCanonicalPropertyName(linkedReservation.property_name);
    const linkedCanonical =
      getCanonicalRoomLabel(linkedPropertyName, linkedReservation.room_label) ??
      linkedReservation.room_label.trim();
    // Compare against the collapsed display label — the form sends "201", the reservation may be "201_2".
    const linkedRoomLabel = getDisplayRoomLabel(linkedPropertyName, linkedCanonical);

    if (linkedPropertyName !== propertyName || linkedRoomLabel !== roomLabel) {
      redirect(`/mobile/lost-found/new?error=save_failed${sessionParam}`);
    }

    guestName = linkedReservation.guest_name;
    reservationId = linkedReservation.id;
  }

  // Store the room_label in combined format "{propertyName} {canonicalRoom}" so that
  // resolveRequestLocation() can recover the building via its combinedMatch path.
  // When propertyName === roomLabel (Okubo pattern) just use roomLabel as-is.
  const combinedRoomLabel =
    propertyName && propertyName !== roomLabel
      ? `${propertyName} ${roomLabel}`
      : roomLabel;

  const insert: Database["public"]["Tables"]["lost_items"]["Insert"] = {
    id: requestId,
    organization_id: session.organization.id,
    reported_by_user_id: session.user.id,
    guest_name: guestName,
    property_name: propertyName,
    reservation_id: reservationId,
    room_label: combinedRoomLabel,
    item_name: itemName,
    category,
    memo: memo || null,
    image_urls: imageUrls,
    cleaning_session_id: cleaningSessionId,
  };

  const { data: created, error } = await supabase
    .from("lost_items")
    .insert(insert)
    .select("id")
    .single();
  const createdId = (created as { id: string } | null)?.id ?? null;

  if (error || !createdId) {
    // 올라간 사진은 지우지 않는다(2026-10-26) — 사진의 주인은 클라이언트(`usePhotoUpload`)다. 폼은 같은 요청 id 와
    // 같은 주소로 다시 보내므로 여기서 지우면 다시 보낸 등록이 지워진 사진을 가리켰다. 그만두면 클라이언트가 지운다.
    redirect(`/mobile/lost-found/new?error=save_failed${sessionParam}`);
  }
  redirect(`/mobile/requests/lost-found/${createdId}?created=1`);
}
