"use server";

import { revalidatePath } from "next/cache";
import { canEditPropertyOperationInfo } from "@/lib/admin-calendar-dashboard";
import { getAdminSessionForApi } from "@/lib/admin-session";
import type { PropertyMapMeta } from "@/lib/property-map-links";
import { loadBuildingGuestInfo, saveBuildingGuestInfo, toGuestInfoView, type BuildingGuestInfoView } from "@/lib/guest-messages/guest-info-server";
import { savePropertyOperationInfo } from "@/lib/property-operation-info";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
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

export type SaveBuildingGuestInfoActionResult =
  | { ok: true; building: BuildingGuestInfoView }
  | { ok: false; error: "conflict"; current: BuildingGuestInfoView }
  | { ok: false; error: "forbidden" | "invalid_input" | "invalid_property" | "save_failed" | "too_long" };

/**
 * 건물 정보 **손님용 칸**(와이파이 · 체크인 · 짐 보관 …, 언어별) 저장 — 예약 캘린더 건물 정보 · 손님 메시지 PC 가 같이 부른다
 * (둘 다 관리자 웹이라 여기). 권한은 출입 코드와 같은 `property_info.edit`. 직원용 칸은 건드리지 않는다.
 * docs/product/47-guest-messaging.md §6-3 · 15 「건물 정보」.
 */
export async function saveBuildingGuestInfoAction(input: {
  canonicalName: string;
  guestInfo: unknown;
  expectedUpdatedAt: string | null;
}): Promise<SaveBuildingGuestInfoActionResult> {
  const auth = await getAdminSessionForApi();
  if (!auth.ok || !canEditPropertyOperationInfo(auth.session)) return { error: "forbidden", ok: false };
  if (typeof input?.canonicalName !== "string" || input.canonicalName.length > 100) return { error: "invalid_property", ok: false };
  const expectedUpdatedAt = validateExpectedUpdatedAt(input.expectedUpdatedAt);
  if (expectedUpdatedAt === undefined) return { error: "invalid_input", ok: false };
  try {
    const result = await saveBuildingGuestInfo(getSupabaseServiceClient(), auth.session.organization.id, {
      canonicalName: input.canonicalName,
      guestInfo: input.guestInfo,
      expectedUpdatedAt,
    });
    if (result.ok) {
      revalidatePath("/admin/calendar");
      revalidatePath("/admin/messages");
      return { ok: true, building: toGuestInfoView(result.building) };
    }
    // 출입 코드 값은 브라우저로 보내지 않는다(개수만).
    if (result.error === "conflict") return { ok: false, error: "conflict", current: toGuestInfoView(result.current) };
    return result;
  } catch (error) {
    console.error("[guest-info] action failed", { name: error instanceof Error ? error.name : "unknown" });
    return { error: "save_failed", ok: false };
  }
}

export type LoadBuildingGuestInfoActionResult =
  | { ok: true; building: BuildingGuestInfoView; canEdit: boolean }
  | { ok: false; error: "forbidden" | "invalid_property" | "load_failed" };

/**
 * 손님용 칸 고치기 패널을 열 때 읽기(관리자 웹). 읽기 권한은 건물 정보와 같다(조직 멤버) — 고치기 여부는 `canEdit`.
 * 출입 코드는 **개수만** 돌려준다(값은 안 보냄, 2026-11-13 리뷰).
 */
export async function loadBuildingGuestInfoAction(canonicalName: string): Promise<LoadBuildingGuestInfoActionResult> {
  const auth = await getAdminSessionForApi();
  if (!auth.ok) return { error: "forbidden", ok: false };
  if (typeof canonicalName !== "string" || canonicalName.length > 100) return { error: "invalid_property", ok: false };
  try {
    const building = await loadBuildingGuestInfo(getSupabaseServiceClient(), auth.session.organization.id, canonicalName);
    if (!building) return { error: "invalid_property", ok: false };
    return { ok: true, building: toGuestInfoView(building), canEdit: canEditPropertyOperationInfo(auth.session) };
  } catch (error) {
    console.error("[guest-info] load failed", { name: error instanceof Error ? error.name : "unknown" });
    return { error: "load_failed", ok: false };
  }
}
