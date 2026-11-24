"use server";

/**
 * 예약 패널 「출입 번호」 — PC 오른쪽 예약 패널 · 모바일 예약 정보 시트 공용(CLAUDE.md `src/actions`). docs/product/47 §5-14 · §6-3 · Q9
 *
 * - 권한: 메시지 보기(`guest_messages.view`) **와** 번호 볼 사람(`guest_messages.manage` 또는 `property_info.edit`). 아니면 `forbidden`
 *   (redirect 하지 않는다 — 폰 사용자를 관리자 화면으로 보내지 않게).
 * - 「번호 보기」를 누를 때만 부른다 — 화면 처음 데이터에는 번호가 없다(볼 수 있는지 참/거짓만).
 * - 조직 id 는 세션에서. 대화는 이 조직 것만 읽고(`loadConversationRow`), 건물 번호도 이 조직 줄만.
 * - 라벨은 보는 사람 언어. 실패 로그 · 결과에 번호 값을 넣지 않는다.
 */

import {
  accessLabel,
  canSeeStaffCodes,
  conversationAccessCodes,
  type ConversationAccessCodesResult,
} from "@/lib/guest-messages/access-codes";
import { loadBuildingGuestInfo } from "@/lib/guest-messages/guest-info-server";
import { UUID_RE } from "@/lib/guest-messages/inbox-model";
import { loadConversationRow } from "@/lib/guest-messages/inbox-server";
import { getDictionary } from "@/lib/i18n";
import { localizeRoomPlaceLabel } from "@/lib/room-label-normalization";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";


export async function getConversationAccessCodes(conversationId: string): Promise<ConversationAccessCodesResult> {
  const session = await getCurrentAppSession().catch(() => null);
  if (!session || !hasOrganizationContext(session)) return { ok: false, errorKey: "forbidden" };
  if (!session.capabilities.includes("guest_messages.view") || !canSeeStaffCodes(session.capabilities)) {
    return { ok: false, errorKey: "forbidden" };
  }
  if (typeof conversationId !== "string" || !UUID_RE.test(conversationId)) return { ok: false, errorKey: "invalid" };
  const organizationId = session.organization.id;
  const db = getSupabaseServiceClient();
  try {
    const conversation = await loadConversationRow(db, organizationId, conversationId);
    if (!conversation) return { ok: false, errorKey: "not_found" };
    const building = await loadBuildingGuestInfo(db, organizationId, conversation.property_name);
    const dict = getDictionary(session.user.preferredLanguage);
    return {
      ok: true,
      codes: conversationAccessCodes(building, conversation.room_label, {
        shared: (access) => accessLabel(access, dict.mobile),
        room: (roomLabel) => dict.guestMessages.insertRoomCode.replace("{room}", localizeRoomPlaceLabel(roomLabel, dict.cleaning.buildingLabels)),
      }),
    };
  } catch (error) {
    // 읽기 오류 글에는 번호가 없다(건물 정보 읽기는 오류 코드만 싣는다) — 그래도 이름 · 글만 남긴다.
    console.error("[guest-messages] access codes failed", error instanceof Error ? error.message : "unknown");
    return { ok: false, errorKey: "failed" };
  }
}
