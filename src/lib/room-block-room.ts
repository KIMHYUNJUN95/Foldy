import {
  getCanonicalPropertyName,
  getCanonicalRoomLabel,
  getDisplayRoomLabel,
} from "@/lib/room-label-normalization";
import { type PropertyRoomLookups, resolveReservationCanonicalRoomLabel } from "@/lib/rooms";

/**
 * Beds24 차단(`room_blocks`) 한 줄 → 캘린더 방 — 모바일 · PC 예약 캘린더 공용 해석기 (2026-11-12).
 *
 * 예전엔 PC 는 예약과 같은 해석기를, 모바일은 이름 정규화(`getCanonicalRoomLabel`)만 써서, 별칭 · 일본어 이름으로 들어온 차단이
 * 모바일에서만 다른 방에 그려지거나 사라졌다. 이제 둘 다 이 함수:
 *   ① `external_room_id`(Beds24 객실 id)가 있으면 그걸로 먼저 → ② 방 이름(정확 → 정규화) → ③ 정규화한 이름 · 원래 이름.
 * 결과 `displayRoomLabel` 은 캘린더 행 이름(402 / 402_2 → 402).
 */
export function resolveRoomBlockRoom(
  block: { external_room_id?: string | null; property_name: string; room_label: string },
  context: {
    globalExternalRoomToCanonical: Map<string, string>;
    isAuthoritative: boolean;
    lookups: PropertyRoomLookups;
  },
): { canonicalRoomLabel: string; displayRoomLabel: string; propertyName: string } {
  const propertyName = getCanonicalPropertyName(block.property_name);
  const externalId = typeof block.external_room_id === "string" ? block.external_room_id.trim() : "";
  const byExternal = externalId
    ? resolveReservationCanonicalRoomLabel(
        { property_name: block.property_name, raw_payload: { roomId: externalId }, room_label: block.room_label },
        context,
      )
    : null;
  const byLabel =
    byExternal ??
    resolveReservationCanonicalRoomLabel(
      { property_name: block.property_name, raw_payload: null, room_label: block.room_label },
      context,
    );
  const canonicalRoomLabel = byLabel ?? (getCanonicalRoomLabel(propertyName, block.room_label) || block.room_label.trim());
  return {
    canonicalRoomLabel,
    displayRoomLabel: getDisplayRoomLabel(propertyName, canonicalRoomLabel) || canonicalRoomLabel,
    propertyName,
  };
}
