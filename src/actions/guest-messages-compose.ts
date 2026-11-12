"use server";

/**
 * 답장 칸 「정해 둔 문구」 · 「건물 정보 넣기」 목록 — PC 팝오버 · 모바일 시트 공용(문서 CLAUDE.md `src/actions`).
 * docs/product/47-guest-messaging.md §6-3
 *
 * - 권한: 메시지 보기 **와** 답장(`guest_messages.view` + `guest_messages.reply`) — 답장 칸을 쓰는 사람만. 아니면 `forbidden`.
 * - 언어마다(ko · ja · en) 넣을 글을 서버가 다 만들어 돌려준다(손님 언어 사전 · 건물 이름 · 날짜 꼴). 화면은 지금 보낼 언어
 *   (`insertLanguageFor`)로 고르기만 한다 — 번역 대상을 바꿔도 다시 부르지 않는다.
 * - 출입 코드는 손님용 목록과 **따로**(`staffCodes`) — 화면이 자물쇠 · 「직원용」으로 보인다.
 *   **임시 결정(2026-11-13, 47 §6-3 · Q9)**: 출입 코드는 `guest_messages.manage` 또는 `property_info.edit` 가 있는 사람에게만 준다
 *   (답장 권한만 개인으로 받은 알바 · 야간 직원에게는 빈 목록).
 * - 조직 id 는 세션에서. 대화도 이 조직 것만 읽는다.
 */

import { loadConversationRow } from "@/lib/guest-messages/inbox-server";
import { UUID_RE } from "@/lib/guest-messages/inbox-model";
import { buildReplyContext, guestDictionaries } from "@/lib/guest-messages/reply-context-server";
import { buildGuestInserts, GUEST_LANGS, type GuestInsertItem, type GuestLang } from "@/lib/guest-messages/guest-info-model";
import { loadBuildingGuestInfo } from "@/lib/guest-messages/guest-info-server";
import { savedReplyText, type ReplyContext, type SavedReplyVariable } from "@/lib/guest-messages/saved-reply-model";
import { loadSavedReplies } from "@/lib/guest-messages/saved-replies-server";
import { getDictionary } from "@/lib/i18n";
import type { PropertyAccessInfo } from "@/lib/property-map-links";
import { localizeRoomPlaceLabel } from "@/lib/room-label-normalization";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export type ComposerInserts = {
  building: {
    canonicalName: string;
    inserts: Record<GuestLang, GuestInsertItem[]>;
    /** 직원용 — 공용 출입 코드 · 이 방 출입 코드(라벨은 보는 사람 언어). */
    staffCodes: Array<{ label: string; code: string }>;
  } | null;
  replies: Array<{
    id: string;
    title: string;
    byLang: Record<GuestLang, { text: string; lang: GuestLang; missing: SavedReplyVariable[] } | null>;
  }>;
  canEditBuilding: boolean;
};

export type ComposerInsertsResult = { ok: true; data: ComposerInserts } | { ok: false; errorKey: "forbidden" | "invalid" | "not_found" | "failed" };

function accessLabel(access: PropertyAccessInfo, t: ReturnType<typeof getDictionary>["mobile"]): string {
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

/** 대화의 방 라벨(「201」 또는 「아라키초A 201」) ↔ 출입 코드 방 라벨. */
function sameRoom(conversationRoom: string | null, codeRoom: string): boolean {
  if (!conversationRoom) return false;
  const room = conversationRoom.trim();
  const tail = room.includes(" ") ? room.slice(room.lastIndexOf(" ") + 1) : room;
  return room === codeRoom || tail === codeRoom;
}

/** 출입 코드를 넣기 목록에 보일 사람 — 임시(47 §6-3 · Q9). */
function canSeeStaffCodes(capabilities: readonly string[]): boolean {
  return capabilities.includes("guest_messages.manage") || capabilities.includes("property_info.edit");
}

export async function getComposerInserts(conversationId: string): Promise<ComposerInsertsResult> {
  const session = await getCurrentAppSession().catch(() => null);
  if (!session || !hasOrganizationContext(session)) return { ok: false, errorKey: "forbidden" };
  if (!session.capabilities.includes("guest_messages.view") || !session.capabilities.includes("guest_messages.reply")) {
    return { ok: false, errorKey: "forbidden" };
  }
  if (typeof conversationId !== "string" || !UUID_RE.test(conversationId)) return { ok: false, errorKey: "invalid" };
  const organizationId = session.organization.id;
  const db = getSupabaseServiceClient();
  try {
    const conversation = await loadConversationRow(db, organizationId, conversationId);
    if (!conversation) return { ok: false, errorKey: "not_found" };
    const [building, replies] = await Promise.all([
      loadBuildingGuestInfo(db, organizationId, conversation.property_name),
      loadSavedReplies(db, organizationId),
    ]);

    const dictionaries = guestDictionaries();
    const context: ReplyContext = buildReplyContext(conversation, dictionaries);

    const staffDict = getDictionary(session.user.preferredLanguage);
    const staffT = staffDict.mobile;
    const staffCopy = staffDict.guestMessages;
    const canSeeCodes = canSeeStaffCodes(session.capabilities);
    return {
      ok: true,
      data: {
        building: building
          ? {
              canonicalName: building.canonicalName,
              inserts: Object.fromEntries(
                GUEST_LANGS.map((lang) => [
                  lang,
                  buildGuestInserts(building.guestInfo, lang, {
                    wifi: dictionaries[lang].guestMessages.insertWifiFormat,
                    wifiNameOnly: dictionaries[lang].guestMessages.insertWifiNameOnly,
                    wifiPasswordOnly: dictionaries[lang].guestMessages.insertWifiPasswordOnly,
                  }),
                ]),
              ) as Record<GuestLang, GuestInsertItem[]>,
              staffCodes: canSeeCodes
                ? [
                ...building.sharedAccess.filter((a) => a.code.trim()).map((a) => ({ label: accessLabel(a, staffT), code: a.code })),
                ...building.roomAccess
                  .filter((room) => room.code.trim() && sameRoom(conversation.room_label, room.roomLabel))
                  .map((room) => ({
                    label: staffCopy.insertRoomCode.replace("{room}", localizeRoomPlaceLabel(room.roomLabel, staffDict.cleaning.buildingLabels)),
                    code: room.code,
                  })),
                ]
                : [],
            }
          : null,
        replies: replies.map((reply) => ({
          id: reply.id,
          title: reply.title,
          byLang: Object.fromEntries(GUEST_LANGS.map((lang) => [lang, savedReplyText(reply.bodies, lang, context)])) as ComposerInserts["replies"][number]["byLang"],
        })),
        canEditBuilding: session.capabilities.includes("property_info.edit"),
      },
    };
  } catch (error) {
    console.error("[guest-messages] composer inserts failed", error instanceof Error ? error.message : "unknown");
    return { ok: false, errorKey: "failed" };
  }
}
