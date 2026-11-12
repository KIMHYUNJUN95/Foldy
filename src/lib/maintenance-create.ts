import "server-only";

/**
 * 수리 · 점검 신고 만들기 — 한 곳의 검사 · 저장(2026-11-13). docs/product/08-maintenance-workflow.md
 *
 * 모바일 신고 폼(`/mobile/maintenance/new` 의 `createMaintenanceReport`)과 손님 메시지 「업무 만들기」(47 §6-4)가 같이 쓴다.
 * 예전에는 검사가 폼 액션 안에 있었고 실패마다 바로 `redirect` 했다 — 여기서는 결과 코드만 돌려주고, 부르는 쪽이 자기 길로 바꾼다.
 * 검사 순서 · 내용은 그대로: 방 라벨 길이 → 제목 → 요청 id → 사진 5장 → 건물 → 활성 방 카탈로그 대조(못 읽으면 저장 안 함) →
 * 사진 경로(`{org}/maintenance-reports/{id}/`) → 청소 세션(이 사람 · 이 조직) → 예약(이 조직, 건물 · 방이 같아야).
 * 저장은 **그 사람의 RLS 클라이언트**로(서비스 키 아님) — 신고자 = 로그인한 사람.
 */

import {
  getCanonicalPropertyName,
  getCanonicalRoomLabel,
  getDisplayRoomLabel,
} from "@/lib/room-label-normalization";
import {
  isMaintenanceCategory,
  isMaintenancePriority,
  type MaintenanceCategory,
  type MaintenancePriority,
} from "@/lib/maintenance-constants";
import { isOwnResentRequest } from "@/lib/request-resend";
import { getActiveRoomCatalogServer } from "@/lib/rooms";
import type { AppSession } from "@/lib/session";
import { isOwnStoragePublicUrl } from "@/lib/storage-url-guard";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

const REQUEST_IMAGE_BUCKET = "request-images";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MaintenanceCreateInput = {
  /** 화면이 만든 요청 id(사진 경로와 같은 값, 다시 보내도 한 건). 비우면 서버가 만든다. */
  id?: string | null;
  propertyName: string | null;
  roomLabel: string;
  isBuildingOnly: boolean;
  issueTitle: string;
  description: string;
  category: string;
  priority: string;
  imageUrls: string[];
  cleaningSessionId?: string | null;
  reservationId?: string | null;
};

export type MaintenanceCreateError =
  | "invalid_room"
  | "missing_issue_title"
  | "missing_building"
  | "invalid_session"
  | "save_failed";

export type MaintenanceCreateResult = { ok: true; id: string } | { ok: false; error: MaintenanceCreateError };

export async function createMaintenanceRecord(
  session: AppSession,
  input: MaintenanceCreateInput,
): Promise<MaintenanceCreateResult> {
  const fail = (error: MaintenanceCreateError): MaintenanceCreateResult => ({ ok: false, error });
  const propertyName = input.propertyName?.trim() || null;
  const issueTitle = input.issueTitle.trim();
  const description = input.description.trim();
  const imageUrls = input.imageUrls.map((url) => url.trim()).filter(Boolean);
  const requestedId = input.id?.trim() || "";
  // 알 수 없는 분류 · 우선순위는 거절하지 않고 기본값(오래된 클라이언트가 현장 신고를 잃지 않게, 2026-07-14).
  const category: MaintenanceCategory = isMaintenanceCategory(input.category) ? input.category : "other";
  const priority: MaintenancePriority = isMaintenancePriority(input.priority) ? input.priority : "normal";
  // 「건물 전체」는 방 자리에 고정값 "-"(2026-10-26) — 화면은 is_building_only 를 보고 보는 사람 언어로 그린다.
  const roomLabel = input.isBuildingOnly ? "-" : input.roomLabel.trim();

  if (roomLabel.length === 0 || roomLabel.length > 100) return fail("invalid_room");
  if (!issueTitle) return fail("missing_issue_title");
  if (requestedId && !UUID.test(requestedId)) return fail("save_failed");
  if (imageUrls.length > 5) return fail("save_failed");
  if (!propertyName) return fail("missing_building");

  // 건물 · 방을 활성 방 카탈로그와 대조한다(2026-11-10). 「건물 전체」는 건물이 카탈로그에 있을 때만. 못 읽으면 저장하지 않는다.
  const catalog = await getActiveRoomCatalogServer(session.organization.id).catch(() => null);
  if (!catalog || catalog.length === 0) return fail("save_failed");
  const placeKnown = input.isBuildingOnly
    ? catalog.some((item) => item.propertyName === propertyName)
    : catalog.some((item) => item.propertyName === propertyName && item.displayRoomLabel === roomLabel);
  if (!placeKnown) return fail("invalid_room");

  const requestId = requestedId || crypto.randomUUID();
  const imagePrefix = `${session.organization.id}/maintenance-reports/${requestId}/`;
  if (!imageUrls.every((url) => isOwnStoragePublicUrl(url, REQUEST_IMAGE_BUCKET, imagePrefix))) return fail("save_failed");

  const supabase = await getSupabaseServerClient();

  // 청소 세션 연결: 이 사용자 · 조직의 것이어야 한다(상태는 무관).
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

  let reservationId: string | null = null;
  let guestName: string | null = null;
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
    // 합쳐서 표시하는 라벨과 비교한다 — 폼은 "201" 을 보내지만 예약은 "201_2" 일 수 있다.
    const linkedRoomLabel = getDisplayRoomLabel(linkedPropertyName, linkedCanonical);
    if (linkedPropertyName !== propertyName || linkedRoomLabel !== roomLabel) return fail("save_failed");
    reservationId = linked.id;
    guestName = linked.guest_name;
  }

  const insert: Database["public"]["Tables"]["maintenance_reports"]["Insert"] = {
    id: requestId,
    organization_id: session.organization.id,
    reported_by_user_id: session.user.id,
    guest_name: guestName,
    property_name: propertyName,
    reservation_id: reservationId,
    room_label: roomLabel,
    is_building_only: input.isBuildingOnly,
    issue_title: issueTitle,
    description: description || null,
    category,
    priority,
    image_urls: imageUrls,
    cleaning_session_id: cleaningSessionId,
  };

  const { data: created, error } = await supabase.from("maintenance_reports").insert(insert).select("id").single();
  let createdId = (created as { id: string } | null)?.id ?? null;
  // 같은 id 로 다시 보냄(첫 번째가 이미 저장됨) — 내 행이면 성공으로 넘긴다.
  if (
    !createdId &&
    (await isOwnResentRequest(supabase, "maintenance_reports", {
      error,
      id: requestId,
      organizationId: session.organization.id,
      userId: session.user.id,
    }))
  ) {
    createdId = requestId;
  }
  // 올라간 사진은 지우지 않는다(2026-10-26) — 사진의 주인은 클라이언트(`usePhotoUpload`)다.
  return createdId ? { ok: true, id: createdId } : fail("save_failed");
}
