import "server-only";

/**
 * 분실물 등록 — 한 곳의 검사 · 저장(2026-11-13). docs/product/09-lost-found-workflow.md
 *
 * 모바일 등록 폼(`/mobile/lost-found/new` 의 `createLostItem`)과 손님 메시지 「업무 만들기」(47 §6-4)가 같이 쓴다. 결과 코드만 돌려주고
 * 길(redirect)은 부르는 쪽이 정한다. 검사 순서 · 내용은 예전 폼 액션 그대로: 건물 → 방 라벨 길이 → 활성 방 카탈로그 대조 → 물건 이름 →
 * 요청 id → 사진 5장 → 사진 경로(`{org}/lost-items/{id}/`) → 청소 세션 → 예약(건물 · 방이 같아야). 저장은 그 사람의 RLS 클라이언트로.
 */

import {
  getCanonicalPropertyName,
  getCanonicalRoomLabel,
  getDisplayRoomLabel,
} from "@/lib/room-label-normalization";
import { isLostItemCategory, type LostItemCategory } from "@/lib/lost-found-constants";
import { getActiveRoomCatalogServer } from "@/lib/rooms";
import { isOwnResentRequest } from "@/lib/request-resend";
import type { AppSession } from "@/lib/session";
import { isOwnStoragePublicUrl } from "@/lib/storage-url-guard";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

const REQUEST_IMAGE_BUCKET = "request-images";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LostItemCreateInput = {
  id?: string | null;
  propertyName: string;
  roomLabel: string;
  itemName: string;
  category: string;
  memo: string;
  imageUrls: string[];
  cleaningSessionId?: string | null;
  reservationId?: string | null;
};

export type LostItemCreateError =
  | "missing_building"
  | "invalid_room"
  | "missing_item_name"
  | "invalid_session"
  | "save_failed";

export type LostItemCreateResult = { ok: true; id: string } | { ok: false; error: LostItemCreateError };

export async function createLostItemRecord(session: AppSession, input: LostItemCreateInput): Promise<LostItemCreateResult> {
  const fail = (error: LostItemCreateError): LostItemCreateResult => ({ ok: false, error });
  const propertyName = input.propertyName.trim();
  const roomLabel = input.roomLabel.trim();
  const itemName = input.itemName.trim();
  const category: LostItemCategory = isLostItemCategory(input.category) ? input.category : "other";
  const memo = input.memo.trim();
  const imageUrls = input.imageUrls.map((url) => url.trim()).filter(Boolean);
  const requestedId = input.id?.trim() || "";

  if (!propertyName) return fail("missing_building");
  if (roomLabel.length === 0 || roomLabel.length > 100) return fail("invalid_room");

  // 못 읽으면(던짐) 저장하지 않고 save_failed — 수리 · 점검과 같게(예전엔 던져서 오류 화면).
  const catalog = await getActiveRoomCatalogServer(session.organization.id).catch(() => null);
  if (!catalog) return fail("save_failed");
  // 폼은 합쳐진 displayRoomLabel("201_2" 가 아닌 "201")을 보낸다 — displayRoomLabel 로 대조한다.
  const isValidCombination = catalog.some((item) => item.propertyName === propertyName && item.displayRoomLabel === roomLabel);
  if (!isValidCombination) return fail("invalid_room");

  if (!itemName) return fail("missing_item_name");
  if (requestedId && !UUID.test(requestedId)) return fail("save_failed");
  if (imageUrls.length > 5) return fail("save_failed");

  const requestId = requestedId || crypto.randomUUID();
  const imagePrefix = `${session.organization.id}/lost-items/${requestId}/`;
  if (!imageUrls.every((url) => isOwnStoragePublicUrl(url, REQUEST_IMAGE_BUCKET, imagePrefix))) return fail("save_failed");

  const supabase = await getSupabaseServerClient();

  let cleaningSessionId: string | null = null;
  const rawSessionId = input.cleaningSessionId?.trim() || "";
  if (rawSessionId) {
    const { data } = await supabase
      .from("cleaning_sessions")
      .select("id")
      .eq("id", rawSessionId)
      .eq("organization_id", session.organization.id)
      .eq("staff_user_id", session.user.id)
      .maybeSingle();
    cleaningSessionId = (data as { id: string } | null)?.id ?? null;
    if (!cleaningSessionId) return fail("invalid_session");
  }

  let guestName: string | null = null;
  let reservationId: string | null = null;
  const rawReservationId = input.reservationId?.trim() || "";
  if (rawReservationId) {
    const { data } = await supabase
      .from("reservations")
      .select("id, guest_name, property_name, room_label")
      .eq("id", rawReservationId)
      .eq("organization_id", session.organization.id)
      .maybeSingle();
    const linked = data as { guest_name: string; id: string; property_name: string; room_label: string } | null;
    if (!linked) return fail("save_failed");
    const linkedPropertyName = getCanonicalPropertyName(linked.property_name);
    const linkedCanonical = getCanonicalRoomLabel(linkedPropertyName, linked.room_label) ?? linked.room_label.trim();
    const linkedRoomLabel = getDisplayRoomLabel(linkedPropertyName, linkedCanonical);
    if (linkedPropertyName !== propertyName || linkedRoomLabel !== roomLabel) return fail("save_failed");
    guestName = linked.guest_name;
    reservationId = linked.id;
  }

  // room_label 은 "{propertyName} {canonicalRoom}" 결합 형식(resolveRequestLocation() 의 combinedMatch). 한 채 건물(건물 = 방)은 그대로.
  const combinedRoomLabel = propertyName && propertyName !== roomLabel ? `${propertyName} ${roomLabel}` : roomLabel;

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

  const { data: created, error } = await supabase.from("lost_items").insert(insert).select("id").single();
  let createdId = (created as { id: string } | null)?.id ?? null;
  if (
    !createdId &&
    (await isOwnResentRequest(supabase, "lost_items", {
      error,
      id: requestId,
      organizationId: session.organization.id,
      userId: session.user.id,
    }))
  ) {
    createdId = requestId;
  }
  return createdId ? { ok: true, id: createdId } : fail("save_failed");
}
