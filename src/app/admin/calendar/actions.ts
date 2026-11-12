"use server";

import { revalidatePath } from "next/cache";
import { canEditPropertyOperationInfo } from "@/lib/admin-calendar-dashboard";
import { getAdminSessionForApi } from "@/lib/admin-session";
import type { PropertyMapMeta } from "@/lib/property-map-links";
import { savePropertyOperationInfo } from "@/lib/property-operation-info";
import { saveReservationInternalNote } from "@/lib/reservation-internal-notes";
import {
  type ReservationNoteErrorCode,
  type ReservationNoteSnapshot,
  validateExpectedUpdatedAt,
} from "@/lib/reservation-note-sync";

// 관리자 캘린더만 부르는 액션(모바일 캘린더 메모 · 건물 정보는 읽기만) — 그래서 `src/actions` 가 아니라 여기.
// 가드는 redirect 대신 `forbidden` 결과(2026-11-12) — 화면이 번역된 문구로 보여 준다. DB 원문 메시지는 돌려주지 않는다.

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export type SaveReservationNoteActionResult =
  | { ok: true; snapshot: ReservationNoteSnapshot }
  | { ok: false; error: "conflict"; current: ReservationNoteSnapshot }
  | { ok: false; error: Exclude<ReservationNoteErrorCode, "conflict"> };

/**
 * 내부 메모 저장 — 쓸 수 있는 사람 = 관리자 웹 권한(`admin_web.access`, 2026-11-12 결정). DB 규칙도 같은 키(202611120001).
 * `expectedUpdatedAt` = 화면이 마지막으로 본 버전(없던 메모면 `null`). 그사이 바뀌었으면 `conflict` + 최신 값.
 */
export async function saveReservationInternalNoteAction(input: {
  expectedUpdatedAt: string | null;
  note: string;
  reservationId: string;
}): Promise<SaveReservationNoteActionResult> {
  const auth = await getAdminSessionForApi();
  if (!auth.ok) return { error: "forbidden", ok: false };

  if (!isValidUuid(input?.reservationId)) return { error: "invalid_reservation_id", ok: false };
  if (typeof input.note !== "string") return { error: "invalid_note", ok: false };
  const expectedUpdatedAt = validateExpectedUpdatedAt(input.expectedUpdatedAt);
  if (expectedUpdatedAt === undefined) return { error: "invalid_note", ok: false };

  try {
    const result = await saveReservationInternalNote({
      expectedUpdatedAt,
      note: input.note,
      reservationId: input.reservationId,
      session: auth.session,
    });
    if (result.ok) {
      revalidatePath("/admin/calendar");
      revalidatePath("/mobile/calendar");
    }
    return result;
  } catch (error) {
    console.error("[reservation-note] action failed", { name: error instanceof Error ? error.name : "unknown" });
    return { error: "save_failed", ok: false };
  }
}

export type SavePropertyInfoActionResult =
  | { ok: true; info: PropertyMapMeta }
  | { ok: false; error: "conflict"; current: PropertyMapMeta }
  | { ok: false; error: "forbidden" | "invalid_input" | "invalid_property" | "save_failed" | "too_long" };

export async function savePropertyOperationInfoAction(input: {
  canonicalName: string;
  data: Pick<PropertyMapMeta, "address" | "note" | "roomAccess" | "sharedAccess">;
  expectedUpdatedAt: string | null;
}): Promise<SavePropertyInfoActionResult> {
  const auth = await getAdminSessionForApi();
  if (!auth.ok || !canEditPropertyOperationInfo(auth.session)) {
    return { error: "forbidden", ok: false };
  }
  if (typeof input?.canonicalName !== "string" || input.canonicalName.length > 100) {
    return { error: "invalid_property", ok: false };
  }
  const expectedUpdatedAt = validateExpectedUpdatedAt(input.expectedUpdatedAt);
  if (expectedUpdatedAt === undefined) return { error: "invalid_input", ok: false };

  try {
    const result = await savePropertyOperationInfo({
      canonicalName: input.canonicalName,
      data: input.data,
      expectedUpdatedAt,
      session: auth.session,
    });
    if (result.ok) {
      revalidatePath("/admin/calendar");
      revalidatePath("/mobile/calendar");
    }
    return result;
  } catch (error) {
    console.error("[property-operation-info] action failed", { name: error instanceof Error ? error.name : "unknown" });
    return { error: "save_failed", ok: false };
  }
}
