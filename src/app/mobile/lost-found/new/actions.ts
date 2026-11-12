"use server";

import { redirect } from "next/navigation";
import { createLostItemRecord } from "@/lib/lost-item-create";
import { getCurrentAppSession } from "@/lib/session";

function cleanText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

/**
 * 모바일 분실물 등록 폼. 검사 · 저장은 공용 `createLostItemRecord`(손님 메시지 「업무 만들기」와 같은 함수, 2026-11-13) —
 * 여기서는 폼 값을 읽고 결과를 예전과 같은 주소로 보낸다.
 */
export async function createLostItem(formData: FormData) {
  const rawCleaningSessionId = cleanText(formData.get("cleaningSessionId"));
  const rawReservationId = cleanText(formData.get("reservationId"));

  const session = await getCurrentAppSession();
  if (!session) {
    const basePath = "/mobile/lost-found/new";
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

  const result = await createLostItemRecord(session, {
    id: cleanText(formData.get("id")),
    propertyName: cleanText(formData.get("propertyName")),
    roomLabel: cleanText(formData.get("roomLabel")),
    itemName: cleanText(formData.get("itemName")),
    category: cleanText(formData.get("category")),
    memo: cleanText(formData.get("memo")),
    imageUrls: formData
      .getAll("imageUrls")
      .map((v) => cleanText(v))
      .filter(Boolean),
    cleaningSessionId: rawCleaningSessionId || null,
    reservationId: rawReservationId || null,
  });

  if (!result.ok) {
    if (result.error === "invalid_session") {
      redirect(`/mobile/lost-found/new?error=invalid_session&sessionId=${encodeURIComponent(rawCleaningSessionId)}`);
    }
    redirect(`/mobile/lost-found/new?error=${result.error}${sessionParam}`);
  }
  redirect(`/mobile/requests/lost-found/${result.id}?created=1`);
}
