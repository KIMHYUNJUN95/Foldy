"use server";

import { redirect } from "next/navigation";
import { createMaintenanceRecord } from "@/lib/maintenance-create";
import { getCurrentAppSession } from "@/lib/session";

function cleanText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

/**
 * 모바일 수리 · 점검 신고 폼. 검사 · 저장은 공용 `createMaintenanceRecord`(손님 메시지 「업무 만들기」와 같은 함수, 2026-11-13) —
 * 여기서는 폼 값을 읽고 결과를 예전과 같은 주소로 보낸다.
 */
export async function createMaintenanceReport(formData: FormData) {
  const rawCleaningSessionId = cleanText(formData.get("cleaningSessionId"));
  const rawReservationId = cleanText(formData.get("reservationId"));

  const session = await getCurrentAppSession();
  if (!session) {
    const basePath = "/mobile/maintenance/new";
    const targetParams = new URLSearchParams();
    if (rawCleaningSessionId) targetParams.set("sessionId", rawCleaningSessionId);
    if (rawReservationId) targetParams.set("reservationId", rawReservationId);
    const targetPath = targetParams.size > 0 ? `${basePath}?${targetParams.toString()}` : basePath;
    redirect(`/auth/login?next=${encodeURIComponent(targetPath)}`);
  }

  const sessionParams = new URLSearchParams();
  if (rawCleaningSessionId) sessionParams.set("sessionId", rawCleaningSessionId);
  if (rawReservationId) sessionParams.set("reservationId", rawReservationId);
  const sessionParam = sessionParams.size > 0 ? `&${sessionParams.toString()}` : "";

  const result = await createMaintenanceRecord(session, {
    id: cleanText(formData.get("id")),
    propertyName: cleanText(formData.get("propertyName")) || null,
    roomLabel: cleanText(formData.get("roomLabel")),
    // 「건물 전체」는 폼이 명시적 플래그를 보낸다(현지화 라벨 문자열 매칭을 쓰지 않는다).
    isBuildingOnly: cleanText(formData.get("isBuildingOnly")) === "1",
    issueTitle: cleanText(formData.get("issueTitle")),
    description: cleanText(formData.get("description")),
    category: cleanText(formData.get("category")),
    priority: cleanText(formData.get("priority")),
    imageUrls: formData
      .getAll("imageUrls")
      .map((v) => cleanText(v))
      .filter(Boolean),
    cleaningSessionId: rawCleaningSessionId || null,
    reservationId: rawReservationId || null,
  });

  if (!result.ok) {
    if (result.error === "invalid_session") {
      redirect(`/mobile/maintenance/new?error=invalid_session&sessionId=${encodeURIComponent(rawCleaningSessionId)}`);
    }
    redirect(`/mobile/maintenance/new?error=${result.error}${sessionParam}`);
  }
  redirect(`/mobile/requests/maintenance/${result.id}?created=1`);
}
