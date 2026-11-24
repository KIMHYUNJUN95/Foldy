/**
 * 손님 메시지 직원용 출입 번호 — 규칙 한 곳(순수 함수). docs/product/47-guest-messaging.md §6-3 · Q9
 *
 * - `sameRoom`: 대화 방 라벨(「201」 또는 「아라키초A 201」) ↔ 출입 코드 방 라벨. 다듬은 라벨 그대로 같거나, 마지막 띄어쓰기 뒤
 *   토막이 같으면 같은 방(`Ab402` ↔ `Ab402` 맞음 · `402` 아님). 답장 칸 넣기 목록 · 자동 안내 변수 · 예약 패널 「출입 번호」가 같이 쓴다.
 * - `canSeeStaffCodes`: 번호를 볼 사람 — `guest_messages.manage` 또는 `property_info.edit`(Q9 확정).
 *   대화 방 라벨이 비었거나 공백뿐이면(코드 방 라벨도 다듬어 비면) 맞지 않는다. AI 답장 도우미 손님용 번호도 같은 규칙.
 * - `conversationAccessCodes`: 이 대화에 보일 번호 — 공용 번호(빈 값 빼고) + 이 방 번호(빈 값 · 다른 방 빼고). 라벨은 부르는 쪽이 정한다.
 *
 * 번호 값은 서버 안에서만 다룬다 — 화면에는 권한을 다시 본 서버 액션(`getConversationAccessCodes`)으로만 간다.
 */

import type { Dictionary } from "@/lib/i18n";
import type { PropertyAccessInfo, PropertyRoomCode } from "@/lib/property-map-links";

export type ConversationAccessCode = { kind: "shared" | "room"; label: string; code: string };

/** 대화의 방 라벨 ↔ 출입 코드 방 라벨. */
export function sameRoom(conversationRoom: string | null, codeRoom: string): boolean {
  if (!conversationRoom?.trim()) return false;
  const room = conversationRoom.trim();
  const code = codeRoom.trim();
  if (!code) return false;
  const tail = room.includes(" ") ? room.slice(room.lastIndexOf(" ") + 1) : room;
  return room === code || tail === code;
}

/** 직원용 출입 번호를 볼 사람(47 §6-3 · Q9). */
export function canSeeStaffCodes(capabilities: readonly string[]): boolean {
  return capabilities.includes("guest_messages.manage") || capabilities.includes("property_info.edit");
}

/** 공용 출입 번호 라벨(「1층 · 창고 비밀번호」 꼴) — 그 언어 사전의 `mobile` 묶음으로. */
export function accessLabel(access: PropertyAccessInfo, t: Dictionary["mobile"]): string {
  const labels: Record<PropertyAccessInfo["labelKey"], string> = {
    doorPassword: t.calendarMapAccessKindDoorPassword,
    keyBox: t.calendarMapAccessKindKeyBox,
    keyBoxPassword: t.calendarMapAccessKindKeyBoxPassword,
    linenStorageEntrancePassword: t.calendarMapAccessKindLinenStorageEntrancePassword,
    roomPassword: t.calendarMapAccessKindRoomPassword,
    storage: t.calendarMapAccessKindStorage,
    storagePassword: t.calendarMapAccessKindStoragePassword,
  };
  const prefix = access.prefixKey === "floor1" ? t.calendarMapAccessFloor1 : null;
  return prefix ? `${prefix} · ${labels[access.labelKey]}` : labels[access.labelKey];
}

/** 이 대화에 보일 번호 — 공용 먼저, 이 방은 뒤. 건물을 모르면 빈 목록. */
export function conversationAccessCodes(
  building: { sharedAccess: readonly PropertyAccessInfo[]; roomAccess: readonly PropertyRoomCode[] } | null,
  conversationRoom: string | null,
  labels: { shared: (access: PropertyAccessInfo) => string; room: (roomLabel: string) => string },
): ConversationAccessCode[] {
  if (!building) return [];
  return [
    ...building.sharedAccess
      .filter((access) => access.code.trim())
      .map((access): ConversationAccessCode => ({ kind: "shared", label: labels.shared(access), code: access.code })),
    ...building.roomAccess
      .filter((room) => room.code.trim() && sameRoom(conversationRoom, room.roomLabel))
      .map((room): ConversationAccessCode => ({ kind: "room", label: labels.room(room.roomLabel), code: room.code })),
  ];
}

/** 서버 액션 `getConversationAccessCodes` 결과(타입만 여기 — 화면 상태 규칙이 같이 쓴다). */
export type ConversationAccessCodesResult =
  | { ok: true; codes: ConversationAccessCode[] }
  | { ok: false; errorKey: "forbidden" | "invalid" | "not_found" | "failed" };

/**
 * 예약 패널 「출입 번호」 화면 상태. `request` 는 「번호 보기」를 누를 때마다 올라가고, 숨기기도 올린다 —
 * 답이 올 때 지금 번호와 다르면(숨겼거나 다시 눌렀으면) 버려서, 숨긴 뒤 번호가 다시 펴지지 않는다.
 */
export type AccessCodesView =
  | { status: "hidden"; request: number }
  | { status: "loading"; request: number }
  | { status: "failed"; request: number }
  | { status: "forbidden"; request: number }
  | { status: "shown"; request: number; codes: ConversationAccessCode[] };

export type AccessCodesAction =
  | { type: "start" }
  | { type: "hide" }
  | { type: "settle"; request: number; result: ConversationAccessCodesResult | null };

export function accessCodesReducer(view: AccessCodesView, action: AccessCodesAction): AccessCodesView {
  switch (action.type) {
    case "start":
      return { status: "loading", request: view.request + 1 };
    case "hide":
      return { status: "hidden", request: view.request + 1 };
    case "settle": {
      if (view.status !== "loading" || action.request !== view.request) return view;
      const result = action.result;
      if (result?.ok) return { status: "shown", request: view.request, codes: result.codes };
      if (result && result.errorKey === "forbidden") return { status: "forbidden", request: view.request };
      return { status: "failed", request: view.request };
    }
  }
}
