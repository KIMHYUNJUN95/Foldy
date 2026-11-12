import "server-only";

/**
 * 정해 둔 문구 변수 값 — 대화 한 줄에서(언어마다 건물 이름 · 방 라벨). 답장 칸 넣기 목록(`getComposerInserts`)과
 * 「해결됐어요」 초안(6단계)이 같이 쓴다. docs/product/47-guest-messaging.md §5-5 · §5-7
 */

import { GUEST_LANGS, type GuestLang, type Localized } from "@/lib/guest-messages/guest-info-model";
import { nightsBetween } from "@/lib/guest-messages/inbox-model";
import type { ReplyContext } from "@/lib/guest-messages/saved-reply-model";
import { getDictionary } from "@/lib/i18n";
import { localizeBuildingName, localizeRoomPlaceLabel } from "@/lib/room-label-normalization";

export type ReplyContextSource = {
  property_name: string | null;
  room_label: string | null;
  guest_name: string | null;
  check_in_date: string | null;
  check_out_date: string | null;
};

export function guestDictionaries(): Record<GuestLang, ReturnType<typeof getDictionary>> {
  return Object.fromEntries(GUEST_LANGS.map((lang) => [lang, getDictionary(lang)])) as Record<GuestLang, ReturnType<typeof getDictionary>>;
}

export function buildReplyContext(
  conversation: ReplyContextSource,
  dictionaries: Record<GuestLang, ReturnType<typeof getDictionary>> = guestDictionaries(),
): ReplyContext {
  const buildingNames = conversation.property_name
    ? (Object.fromEntries(
        GUEST_LANGS.map((lang) => [lang, localizeBuildingName(conversation.property_name as string, dictionaries[lang].cleaning.buildingLabels)]),
      ) as Localized)
    : null;
  // 방 라벨도 언어마다 — 한 채 건물은 방 라벨이 건물 이름(「아라키초A」)이라 그대로 두면 일본어 · 영어 답장에 한국어가 나간다.
  const roomLabels = conversation.room_label?.trim()
    ? (Object.fromEntries(
        GUEST_LANGS.map((lang) => [lang, localizeRoomPlaceLabel(conversation.room_label as string, dictionaries[lang].cleaning.buildingLabels)]),
      ) as Localized)
    : null;
  return {
    guestName: conversation.guest_name,
    checkInDate: conversation.check_in_date,
    checkOutDate: conversation.check_out_date,
    nights: nightsBetween(conversation.check_in_date, conversation.check_out_date),
    building: buildingNames,
    room: roomLabels,
  };
}
