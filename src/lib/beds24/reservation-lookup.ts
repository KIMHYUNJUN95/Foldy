import type { SupabaseClient } from "@supabase/supabase-js";
import { filterRowsOfSameBeds24Booking, toOriginalReservationId } from "@/lib/beds24/reservation-id";
import type { Database } from "@/types/database";

export type ReservationLookupRow = {
  id: string;
  source: string;
  source_reservation_id: string;
  status: Database["public"]["Enums"]["reservation_status"];
  room_label: string;
  /** `raw_payload` 의 Beds24 자기 예약번호(`bookId` → `id`). 옛 행이면 `null`. */
  bookingId: string | null;
};

type ReservationLookupDbRow = Omit<ReservationLookupRow, "bookingId"> & {
  raw_book_id: string | null;
  raw_id: string | null;
};

const LOOKUP_SELECT =
  "id, source, source_reservation_id, status, room_label, raw_book_id:raw_payload->>bookId, raw_id:raw_payload->>id";

const ACTIVE_STATUSES = new Set<Database["public"]["Enums"]["reservation_status"]>([
  "confirmed",
  "checked_in",
  "checked_out",
]);

function isActiveReservationStatus(status: Database["public"]["Enums"]["reservation_status"]) {
  return ACTIVE_STATUSES.has(status);
}

/**
 * Finds reservation rows sharing the same original (channel) id, regardless of channel source.
 * Matches exact original id and `originalId::room::*` suffix variants.
 *
 * **`beds24BookingId` 를 넘기면 그 Beds24 예약의 행만 돌려준다** (2026-10-01). 채널 번호
 * (`apiReference`)가 같아도 Beds24 id 가 다르면 그룹(다객실) 예약의 **다른 방**이다 — 그 행을
 * 「같은 예약의 옛 방」으로 보고 지우거나 취소하면 형제 예약이 통째로 사라진다
 * (Booking.com 5277809875: O309·O305 두 방 중 O305 가 없어졌다).
 */
export async function findReservationRowsByOriginalBookingId(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  sourceReservationId: string,
  options?: { activeOnly?: boolean; beds24BookingId?: string | null },
): Promise<ReservationLookupRow[]> {
  const originalId = toOriginalReservationId(sourceReservationId).trim();
  if (!originalId) return [];

  // `original_reservation_id` = `::room::` 앞부분(생성 열 · 202610160002). 정확한 번호 행과
  // `<번호>::room::*` 행을 한 번의 `=` 로 찾는다 — 예전 `LIKE '<번호>::room::%'` 는 PostgREST 의
  // 매개변수 계획에서 인덱스를 못 써 예약 전체를 훑었다(웹훅마다 0.3~5초).
  const { data, error } = await supabase
    .from("reservations")
    .select(LOOKUP_SELECT)
    .eq("organization_id", organizationId)
    .eq("original_reservation_id", originalId);

  if (error) {
    throw new Error(`reservation lookup failed: ${error.message}`);
  }

  const byId = new Map<string, ReservationLookupRow>();
  for (const row of (data ?? []) as unknown as ReservationLookupDbRow[]) {
    const { raw_book_id, raw_id, ...rest } = row;
    byId.set(row.id, { ...rest, bookingId: raw_book_id?.trim() || raw_id?.trim() || null });
  }

  const rows = filterRowsOfSameBeds24Booking([...byId.values()], options?.beds24BookingId);
  if (options?.activeOnly) {
    return rows.filter((row) => isActiveReservationStatus(row.status));
  }
  return rows;
}

export async function cancelReservationRowsByOriginalBookingId(params: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  sourceReservationId: string;
  /** 취소된 Beds24 예약 자기 번호. 그룹 형제(같은 채널 번호, 다른 방)를 같이 취소하지 않게 한다. */
  beds24BookingId: string | null;
  rawPayload: Database["public"]["Tables"]["reservations"]["Insert"]["raw_payload"];
}) {
  const originalId = toOriginalReservationId(params.sourceReservationId).trim();
  const matchedRows = await findReservationRowsByOriginalBookingId(
    params.supabase,
    params.organizationId,
    params.sourceReservationId,
    { beds24BookingId: params.beds24BookingId },
  );

  if (matchedRows.length === 0) {
    return {
      originalReservationId: originalId,
      matchedRows: 0,
      updatedRows: 0,
      reservationIds: [] as string[],
    };
  }

  const reservationIds = matchedRows.map((row) => row.id);
  const updateResult = await params.supabase
    .from("reservations")
    .update(
      {
        status: "cancelled",
        raw_payload: params.rawPayload,
      },
    )
    .in("id", reservationIds)
    .select("id");

  if (updateResult.error) {
    console.error("[beds24/reservation-lookup] cancel update failed", {
      originalReservationId: originalId,
      reservationIds,
      error: updateResult.error.message,
    });
    return {
      originalReservationId: originalId,
      matchedRows: matchedRows.length,
      updatedRows: 0,
      reservationIds,
    };
  }

  return {
    originalReservationId: originalId,
    matchedRows: matchedRows.length,
    updatedRows: updateResult.data?.length ?? 0,
    reservationIds,
  };
}

/**
 * Ensures no active rows remain for a cancelled Beds24 booking (source-agnostic).
 */
export async function cleanupActiveRowsForCancelledBooking(params: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  sourceReservationId: string;
  beds24BookingId: string | null;
  rawPayload: Database["public"]["Tables"]["reservations"]["Insert"]["raw_payload"];
}) {
  const activeRows = await findReservationRowsByOriginalBookingId(
    params.supabase,
    params.organizationId,
    params.sourceReservationId,
    { activeOnly: true, beds24BookingId: params.beds24BookingId },
  );

  if (activeRows.length === 0) {
    return { cleanedRows: 0 };
  }

  const reservationIds = activeRows.map((row) => row.id);
  const updateResult = await params.supabase
    .from("reservations")
    .update(
      {
        status: "cancelled",
        raw_payload: params.rawPayload,
      },
    )
    .in("id", reservationIds)
    .select("id");

  if (updateResult.error) {
    console.error("[beds24/reservation-lookup] cleanup active rows failed", {
      sourceReservationId: toOriginalReservationId(params.sourceReservationId),
      reservationIds,
      error: updateResult.error.message,
    });
    return { cleanedRows: 0 };
  }

  return { cleanedRows: updateResult.data?.length ?? 0 };
}

function isUnknownRoomRow(row: ReservationLookupRow) {
  return row.room_label === "(unknown)" || row.source_reservation_id.includes("::room::(unknown)");
}

function pickPreferredCancelledRow(rows: ReservationLookupRow[], keepReservationId?: string) {
  if (keepReservationId) {
    const kept = rows.find((row) => row.id === keepReservationId);
    if (kept) return kept;
  }
  const resolved = rows.find((row) => !isUnknownRoomRow(row));
  return resolved ?? rows[0] ?? null;
}

/**
 * Post-cancel consistency pass: cancel any remaining active rows and remove stale
 * duplicate rows for the same Beds24 booking (unknown/room suffix variants).
 * Group siblings (same channel id, different Beds24 id) are never touched.
 */
export async function finalizeCancelledBookingConsistency(params: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  sourceReservationId: string;
  beds24BookingId: string | null;
  rawPayload: Database["public"]["Tables"]["reservations"]["Insert"]["raw_payload"];
  keepReservationId?: string;
}) {
  const originalId = toOriginalReservationId(params.sourceReservationId).trim();
  const lookupOptions = { beds24BookingId: params.beds24BookingId };

  const activeCleanup = await cleanupActiveRowsForCancelledBooking({
    supabase: params.supabase,
    organizationId: params.organizationId,
    sourceReservationId: params.sourceReservationId,
    beds24BookingId: params.beds24BookingId,
    rawPayload: params.rawPayload,
  });

  let allRows = await findReservationRowsByOriginalBookingId(
    params.supabase,
    params.organizationId,
    params.sourceReservationId,
    lookupOptions,
  );

  let activeRows = allRows.filter((row) => isActiveReservationStatus(row.status));
  let additionallyCancelled = 0;

  if (activeRows.length > 0) {
    const updateResult = await params.supabase
      .from("reservations")
      .update(
        {
          status: "cancelled",
          raw_payload: params.rawPayload,
        },
      )
      .in(
        "id",
        activeRows.map((row) => row.id),
      )
      .select("id");

    if (!updateResult.error) {
      additionallyCancelled = updateResult.data?.length ?? 0;
    }
    allRows = await findReservationRowsByOriginalBookingId(
      params.supabase,
      params.organizationId,
      params.sourceReservationId,
      lookupOptions,
    );
    activeRows = allRows.filter((row) => isActiveReservationStatus(row.status));
  }

  const cancelledRows = allRows.filter((row) => row.status === "cancelled");
  const preferred = pickPreferredCancelledRow(cancelledRows, params.keepReservationId);
  let staleRemoved = 0;

  if (preferred) {
    for (const row of allRows) {
      if (row.id === preferred.id) continue;

      const shouldRemoveStaleUnknown =
        isUnknownRoomRow(row) && cancelledRows.some((candidate) => candidate.id === preferred.id);
      const shouldRemoveStaleActiveDuplicate = isActiveReservationStatus(row.status);

      if (!shouldRemoveStaleUnknown && !shouldRemoveStaleActiveDuplicate) {
        continue;
      }

      console.warn("[beds24/reservation-lookup] removing stale duplicate row after cancel", {
        originalReservationId: originalId,
        staleId: row.id,
        keptId: preferred.id,
        staleSourceReservationId: row.source_reservation_id,
        staleStatus: row.status,
      });

      const deleteResult = await params.supabase.from("reservations").delete().eq("id", row.id);
      if (!deleteResult.error) {
        staleRemoved += 1;
      }
    }
  } else if (activeRows.length > 0) {
    for (const row of activeRows) {
      console.warn("[beds24/reservation-lookup] removing remaining active row after cancel", {
        originalReservationId: originalId,
        staleId: row.id,
        staleSourceReservationId: row.source_reservation_id,
      });
      const deleteResult = await params.supabase.from("reservations").delete().eq("id", row.id);
      if (!deleteResult.error) {
        staleRemoved += 1;
      }
    }
  }

  const remainingActive = (
    await findReservationRowsByOriginalBookingId(
      params.supabase,
      params.organizationId,
      params.sourceReservationId,
      { ...lookupOptions, activeOnly: true },
    )
  ).length;

  return {
    originalReservationId: originalId,
    activeCleaned: activeCleanup.cleanedRows + additionallyCancelled,
    staleRemoved,
    activeRemaining: remainingActive,
  };
}
