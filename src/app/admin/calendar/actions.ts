"use server";

import { revalidatePath } from "next/cache";
import { canEditPropertyOperationInfo } from "@/lib/admin-calendar-dashboard";
import { requireAdminSession } from "@/lib/admin-session";
import type { PropertyMapMeta } from "@/lib/property-map-links";
import { savePropertyOperationInfo } from "@/lib/property-operation-info";
import { saveReservationInternalNote } from "@/lib/reservation-internal-notes";

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function saveReservationInternalNoteAction(
  reservationId: string,
  note: string,
): Promise<{ note: string; ok: true } | { error: string; ok: false }> {
  const session = await requireAdminSession();

  if (!isValidUuid(reservationId)) {
    return { error: "invalid_reservation_id", ok: false };
  }

  try {
    const savedNote = await saveReservationInternalNote({
      note,
      reservationId,
      session,
    });
    revalidatePath("/admin/calendar");
    return { note: savedNote, ok: true };
  } catch (error) {
    return {
      error: error instanceof Error && error.message ? error.message : "save_failed",
      ok: false,
    };
  }
}

export async function savePropertyOperationInfoAction(input: {
  canonicalName: string;
  data: Pick<PropertyMapMeta, "address" | "note" | "roomAccess" | "sharedAccess">;
}): Promise<{ ok: true } | { error: string; ok: false }> {
  const session = await requireAdminSession();
  if (!canEditPropertyOperationInfo(session)) {
    return { error: "forbidden", ok: false };
  }

  try {
    await savePropertyOperationInfo({
      canonicalName: input.canonicalName,
      data: input.data,
      session,
    });
    revalidatePath("/admin/calendar");
    revalidatePath("/mobile/calendar");
    return { ok: true };
  } catch (error) {
    return {
      error: error instanceof Error && error.message ? error.message : "save_failed",
      ok: false,
    };
  }
}
