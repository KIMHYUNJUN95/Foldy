import {
  buildRoomKey,
  buildSessionRoomLabel,
  getCanonicalPropertyName,
  getCanonicalRoomLabel,
  getDisplayRoomLabel,
} from "@/lib/room-label-normalization";

/**
 * 예약 · 객실 라벨 → 배정 방 키(물리 방, 아라키초 `_2` 계정 접음). 순수 모듈.
 *
 * 수기 추가 방(`cleaning_list_extra_rooms.room_key`)은 객실 카탈로그(`getActiveRoomCatalog` → `loadCleaningRoomOptions`)가
 * 같은 식 — 정규 건물 + 표시 라벨(`getDisplayRoomLabel(정규 건물, 정규 라벨)`) — 으로 만든다. 예약에서 만든 키와 모양이 같아야
 * 「오늘 내 방」 청소 종류(`todayTaskKey`)가 맞는다(회귀 테스트: `src/lib/__tests__/cleaning-assign-task-kind.test.ts`).
 */
export function physicalKeyOf(propertyName: string, roomLabel: string): { roomKey: string; propertyName: string; roomLabel: string; sessionRoomLabel: string } {
  const cp = getCanonicalPropertyName(propertyName);
  const cr = getCanonicalRoomLabel(cp, roomLabel);
  const display = getDisplayRoomLabel(cp, cr);
  return { roomKey: buildRoomKey(cp, display), propertyName: cp, roomLabel: display === cp ? cp : display, sessionRoomLabel: buildSessionRoomLabel(cp, cr) };
}
