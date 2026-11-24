/**
 * 손님 메시지 직원용 출입 번호 — 규칙 한 곳(순수 함수). docs/product/47-guest-messaging.md §6-3 · Q9
 *
 * - `sameRoom`: 대화 방 라벨(「201」 또는 「아라키초A 201」) ↔ 출입 코드 방 라벨. 마지막 띄어쓰기 뒤 토막(없으면 전체)을 t, 코드 라벨을 c 라 할 때
 *   대소문자 무시하고 ① t == c ② 끝 `#` 와 그 앞 `_숫자` 묶음을 뗀 t == c(`201_2` · `401_2_2` · `202#`)
 *   ③ ②의 t 가 영문 한 글자 + 숫자, c 가 그 숫자(`K202` ↔ `202` — `Ab402` ↔ `402` 는 아님)
 *   ④ ②의 t 가 숫자, c 가 숫자 + f(`2` ↔ `2f`, 거꾸로도). 이 밖의 느슨한 맞추기는 하지 않는다.
 *   정확히 같은 라벨(①)이 있으면 그것만 · 손님에게 가는 값(`pickSingleRoomAccess`)은 후보가 하나일 때만 쓴다(둘 이상이면 못 찾음). 답장 칸 넣기 목록 · 자동 안내 변수 · 예약 패널 「출입 번호」가 같이 쓴다.
 * - `canSeeStaffCodes`: 번호를 볼 사람 — `guest_messages.manage` 또는 `property_info.edit`(Q9 확정).
 *   대화 방 라벨이 비었거나 공백뿐이면(코드 방 라벨도 다듬어 비면) 맞지 않는다. AI 답장 도우미 손님용 번호도 같은 규칙.
 * - `conversationAccessCodes`: 이 대화에 보일 번호 — 공용 번호(빈 값 빼고) + 이 방 번호(빈 값 · 다른 방 빼고). 라벨은 부르는 쪽이 정한다.
 *
 * 번호 값은 서버 안에서만 다룬다 — 화면에는 권한을 다시 본 서버 액션(`getConversationAccessCodes`)으로만 간다.
 */

import type { Dictionary } from "@/lib/i18n";
import type { PropertyAccessInfo, PropertyRoomCode } from "@/lib/property-map-links";

export type ConversationAccessCode = { kind: "shared" | "room"; label: string; code: string };

function roomTail(conversationRoom: string): string {
  return conversationRoom.includes(" ") ? conversationRoom.slice(conversationRoom.lastIndexOf(" ") + 1) : conversationRoom;
}

/** 규칙 1 — 다듬은 전체 라벨 또는 마지막 토막이 코드 라벨과 같다(대소문자 무시). */
function exactRoom(conversationRoom: string | null, codeRoom: string): boolean {
  if (!conversationRoom?.trim()) return false;
  const code = codeRoom.trim().toLowerCase();
  if (!code) return false;
  const room = conversationRoom.trim().toLowerCase();
  return room === code || roomTail(room) === code;
}

/** 규칙 2~4 — 표기만 다른 같은 방(`_숫자` · `#` · 영문 한 글자 · `f`). */
function looseRoom(conversationRoom: string | null, codeRoom: string): boolean {
  if (!conversationRoom?.trim()) return false;
  const code = codeRoom.trim().toLowerCase();
  if (!code) return false;
  const tail = roomTail(conversationRoom.trim().toLowerCase());
  const base = tail.replace(/#$/, "").replace(/(?:_\d+)+$/, "");
  if (!base) return false;
  if (base === code) return true;
  const letterThenDigits = /^[a-z](\d+)$/.exec(base);
  if (letterThenDigits && letterThenDigits[1] === code) return true;
  if (/^\d+$/.test(base) && code === `${base}f`) return true;
  return /^\d+f$/.test(base) && code === base.slice(0, -1);
}

/** 대화의 방 라벨 ↔ 출입 코드 방 라벨. */
export function sameRoom(conversationRoom: string | null, codeRoom: string): boolean {
  return exactRoom(conversationRoom, codeRoom) || looseRoom(conversationRoom, codeRoom);
}

/** 이 대화의 방 항목 — 정확히 같은 라벨이 있으면 그것들만, 없을 때만 느슨한 규칙으로 찾는다. */
export function pickRoomAccess<T extends { roomLabel: string }>(conversationRoom: string | null, roomAccess: readonly T[]): T[] {
  const exact = roomAccess.filter((room) => exactRoom(conversationRoom, room.roomLabel));
  return exact.length ? exact : roomAccess.filter((room) => looseRoom(conversationRoom, room.roomLabel));
}

/** 손님에게 나가는 값용 — 후보가 정확히 하나일 때만, 아니면 null(못 찾음). */
export function pickSingleRoomAccess<T extends { roomLabel: string }>(conversationRoom: string | null, roomAccess: readonly T[]): T | null {
  const picked = pickRoomAccess(conversationRoom, roomAccess);
  return picked.length === 1 ? picked[0] : null;
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
    ...pickRoomAccess(conversationRoom, building.roomAccess.filter((room) => room.code.trim()))
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
