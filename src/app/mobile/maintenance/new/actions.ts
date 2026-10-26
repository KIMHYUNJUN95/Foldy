"use server";

import { redirect } from "next/navigation";
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

export async function createMaintenanceReport(formData: FormData) {
  const rawCleaningSessionId = cleanText(formData.get("cleaningSessionId"));
  const rawReservationId = cleanText(formData.get("reservationId"));
  const requestedId = cleanText(formData.get("id"));

  const session = await getCurrentAppSession();
  if (!session) {
    const basePath = "/mobile/maintenance/new";
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

  const rawRoomLabel = cleanText(formData.get("roomLabel"));
  const propertyName = cleanText(formData.get("propertyName")) || null;
  const issueTitle = cleanText(formData.get("issueTitle"));
  const description = cleanText(formData.get("description"));
  const imageUrls = formData
    .getAll("imageUrls")
    .map((v) => cleanText(v))
    .filter(Boolean);

  // 카테고리와 우선순위는 폼에서 보여줬지만 2026-07-14 전까지 여기서 조용히 버려졌다 —
  // 저장할 컬럼이 없었다. 이제 둘 다 저장되며, 알 수 없는 값은 제출을 거부하지 않고 기본값으로
  // 대체한다(오래된 클라이언트가 현장 신고를 잃어서는 안 된다).
  const rawCategory = cleanText(formData.get("category"));
  const category: MaintenanceCategory = isMaintenanceCategory(rawCategory) ? rawCategory : "other";
  const rawPriority = cleanText(formData.get("priority"));
  const priority: MaintenancePriority = isMaintenancePriority(rawPriority) ? rawPriority : "normal";

  // "건물 전체" 신고를 예전에는 신고자의 라벨 문자열 매칭으로 판별했는데,
  // 현지화된 라벨이라 일본어 신고자의 신고가 한국어 독자에게는 방 지정처럼 보였다.
  // 이제 폼이 명시적 플래그를 보내고 DB 에 boolean 으로 저장한다.
  const isBuildingOnly = cleanText(formData.get("isBuildingOnly")) === "1";
  // 「건물 전체」는 방 자리에 번역된 라벨이 아니라 고정값 "-" 를 둔다(2026-10-26). 화면은 is_building_only 를 보고
  // 보는 사람 언어로 「건물 전체」를 그린다.
  const roomLabel = isBuildingOnly ? "-" : rawRoomLabel;

  const sessionParams = new URLSearchParams();
  if (rawCleaningSessionId) sessionParams.set("sessionId", rawCleaningSessionId);
  if (rawReservationId) sessionParams.set("reservationId", rawReservationId);
  const sessionParam = sessionParams.size > 0 ? `&${sessionParams.toString()}` : "";

  if (roomLabel.length === 0 || roomLabel.length > 100) {
    redirect(`/mobile/maintenance/new?error=invalid_room${sessionParam}`);
  }
  if (!issueTitle) {
    redirect(`/mobile/maintenance/new?error=missing_issue_title${sessionParam}`);
  }
  if (requestedId && !isValidUuid(requestedId)) {
    redirect(`/mobile/maintenance/new?error=save_failed${sessionParam}`);
  }
  if (imageUrls.length > 5) {
    redirect(`/mobile/maintenance/new?error=save_failed${sessionParam}`);
  }

  const requestId = requestedId || crypto.randomUUID();
  const imagePrefix = `${session.organization.id}/maintenance-reports/${requestId}/`;
  if (!imageUrls.every((url) => isOwnStoragePublicUrl(url, REQUEST_IMAGE_BUCKET, imagePrefix))) {
    redirect(`/mobile/maintenance/new?error=save_failed${sessionParam}`);
  }

  const supabase = await getSupabaseServerClient();

  // 청소 세션 연결 검증: 이 사용자/조직의 것이어야 한다(상태는 무관).
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
        `/mobile/maintenance/new?error=invalid_session&sessionId=${encodeURIComponent(rawCleaningSessionId)}`,
      );
    }
  }

  let reservationId: string | null = null;
  let guestName: string | null = null;
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
      redirect(`/mobile/maintenance/new?error=save_failed${sessionParam}`);
    }

    const linkedPropertyName = getCanonicalPropertyName(linkedReservation.property_name);
    const linkedCanonical =
      getCanonicalRoomLabel(linkedPropertyName, linkedReservation.room_label) ??
      linkedReservation.room_label.trim();
    // 합쳐서 표시하는 라벨과 비교한다 — 폼은 "201" 을 보내지만 예약은 "201_2" 일 수 있다.
    const linkedRoomLabel = getDisplayRoomLabel(linkedPropertyName, linkedCanonical);

    if (linkedPropertyName !== propertyName || linkedRoomLabel !== roomLabel) {
      redirect(`/mobile/maintenance/new?error=save_failed${sessionParam}`);
    }

    reservationId = linkedReservation.id;
    guestName = linkedReservation.guest_name;
  }

  const insert: Database["public"]["Tables"]["maintenance_reports"]["Insert"] = {
    id: requestId,
    organization_id: session.organization.id,
    reported_by_user_id: session.user.id,
    guest_name: guestName,
    property_name: propertyName,
    reservation_id: reservationId,
    room_label: roomLabel,
    is_building_only: isBuildingOnly,
    issue_title: issueTitle,
    description: description || null,
    category,
    priority,
    image_urls: imageUrls,
    cleaning_session_id: cleaningSessionId,
  };

  const { data: created, error } = await supabase
    .from("maintenance_reports")
    .insert(insert)
    .select("id")
    .single();
  const createdId = (created as { id: string } | null)?.id ?? null;

  if (error || !createdId) {
    // 올라간 사진은 지우지 않는다(2026-10-26) — 사진의 주인은 클라이언트(`usePhotoUpload`)다. 폼은 같은 요청 id 와
    // 같은 주소로 다시 보내므로 여기서 지우면 다시 보낸 신고가 지워진 사진을 가리켰다. 그만두면 클라이언트가 지운다.
    redirect(`/mobile/maintenance/new?error=save_failed${sessionParam}`);
  }
  redirect(`/mobile/requests/maintenance/${createdId}?created=1`);
}
