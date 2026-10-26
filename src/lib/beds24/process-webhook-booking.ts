import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import {
  beds24LastNightToCheckout,
  isLikelyNumericRoomLabel,
  readBeds24ExternalRoomId,
  readBeds24String,
  toBeds24IsoDate,
  type Beds24JsonRecord,
} from "@/lib/beds24/booking-payload";
import { syncBeds24InventoryMinimumStayThrottled } from "@/lib/beds24/inventory-sync";
import {
  cancelReservationRowsByOriginalBookingId,
  finalizeCancelledBookingConsistency,
  findReservationRowsByOriginalBookingId,
} from "@/lib/beds24/reservation-lookup";
import {
  chooseStoredReservationId,
  isSameBeds24Booking,
  readBeds24OwnBookingId,
  toOriginalReservationId,
} from "@/lib/beds24/reservation-id";
import { recoverReservationRoomLabelById } from "@/lib/beds24/reservations-backfill";
import { resolveReservationStatusFromBeds24Record } from "@/lib/beds24/reservation-status";
import { extractBeds24RoomSyncFields, syncBeds24PropertyAndRoom } from "@/lib/beds24/room-sync";
import { normalizeReservationSource } from "@/lib/beds24/source-normalization";
import type { Database } from "@/types/database";
import { signalBeds24Change } from "@/lib/beds24/live-signal";
import { pickWebhookOrganizationId, readMappedOrganizationIds } from "@/lib/beds24/webhook-organization";

export type ProcessWebhookBookingResult =
  | {
      ok: true;
      mode:
        | "upserted"
        | "cancelled_existing_rows"
        | "cancelled_fallback_upsert"
        | "cancelled_no_local_row";
      sourceReservationId: string;
      originalReservationId: string;
      mappedStatus: Database["public"]["Enums"]["reservation_status"];
      reservationId?: string;
      updatedRows?: number;
      cleanedRows?: number;
      roomLabelResolvedFrom?: "payload" | "room_master" | "recovery" | "unknown_fallback";
      roomSync?: {
        propertyId: string | null;
        roomId: string | null;
        roomStatus: string | null;
        skipped: string[];
      };
    }
  | {
      ok: false;
      mode: "missing_required_fields" | "upsert_failed";
      sourceReservationId: string | null;
      missing?: string[];
      error?: string;
    };

/**
 * 응답 뒤로 미룬다(`after()`). 요청 밖(스크립트 · 테스트)에서 불리면 `after()` 가 던지므로 그때는 바로 기다린다.
 */
async function runAfterResponse(label: string, task: () => Promise<unknown>) {
  const guarded = async () => {
    try {
      await task();
    } catch (error) {
      console.error(`[beds24/webhook] deferred ${label} failed`, error);
    }
  };
  try {
    after(guarded);
  } catch {
    await guarded();
  }
}

function sanitizeRawPayload(value: unknown) {
  try {
    return JSON.parse(JSON.stringify(value)) as Database["public"]["Tables"]["reservations"]["Insert"]["raw_payload"];
  } catch {
    return {};
  }
}

async function resolveRoomLabel(params: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  payload: Beds24JsonRecord;
  syncFields: ReturnType<typeof extractBeds24RoomSyncFields>;
}) {
  const payloadRoomLabelRaw = readBeds24String(params.payload, [
    "unitName",
    "unit_name",
    "unitLabel",
    "unit_label",
    "roomName",
    "room_name",
    "roomLabel",
    "room",
  ]);
  const payloadRoomLabel =
    payloadRoomLabelRaw && !isLikelyNumericRoomLabel(payloadRoomLabelRaw) ? payloadRoomLabelRaw : null;

  const externalRoomId = readBeds24ExternalRoomId(params.payload) ?? params.syncFields.externalRoomId;
  let resolvedRoomLabel = payloadRoomLabel ?? params.syncFields.roomLabel;
  let resolvedFromValue: "payload" | "room_master" | "unknown_fallback" = payloadRoomLabel
    ? "payload"
    : "unknown_fallback";

  if (externalRoomId) {
    const existingRoomResult = await params.supabase
      .from("rooms")
      .select("room_label")
      .eq("organization_id", params.organizationId)
      .eq("external_room_id", externalRoomId)
      .limit(1)
      .maybeSingle();

    const existingRoom = existingRoomResult.data as { room_label: string } | null;
    if (existingRoom?.room_label) {
      resolvedRoomLabel = existingRoom.room_label;
      params.syncFields.roomLabel = existingRoom.room_label;
      params.syncFields.externalRoomId = externalRoomId;
      resolvedFromValue = "room_master";
    }
  }

  return {
    payloadRoomLabel,
    externalRoomId,
    resolvedRoomLabel,
    resolvedFromValue,
  };
}

/**
 * 같은 Beds24 예약의 **옛 방** 행을 지운다 (방 이동·`(unknown)` 정리).
 *
 * 「같은 예약」은 Beds24 자기 예약번호로만 판단한다 (2026-10-01). 채널 번호(`apiReference`)만
 * 같은 행은 그룹 예약의 다른 방이라 절대 지우지 않는다 — 예전엔 그걸 지워서 다객실 예약이 마지막
 * 웹훅의 방 하나로 쪼그라들었다.
 */
async function deleteStaleRowsForSameBooking(params: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  originalId: string;
  beds24BookingId: string | null;
  keepReservationId: string;
}) {
  const keptRow = await params.supabase
    .from("reservations")
    .select("source_reservation_id")
    .eq("id", params.keepReservationId)
    .maybeSingle();
  const keepStoredReservationId =
    (keptRow.data as { source_reservation_id: string } | null)?.source_reservation_id ?? null;

  const relatedRows = await findReservationRowsByOriginalBookingId(
    params.supabase,
    params.organizationId,
    params.originalId,
    { beds24BookingId: params.beds24BookingId },
  );

  for (const staleRow of relatedRows) {
    if (staleRow.id === params.keepReservationId) continue;
    if (keepStoredReservationId && staleRow.source_reservation_id === keepStoredReservationId) continue;
    if (!isSameBeds24Booking(staleRow.bookingId, params.beds24BookingId)) continue;

    const isUnknownRow =
      staleRow.room_label === "(unknown)" || staleRow.source_reservation_id.includes("::room::(unknown)");
    const isActiveDuplicate =
      staleRow.status === "confirmed" ||
      staleRow.status === "checked_in" ||
      staleRow.status === "checked_out";

    if (!isUnknownRow && !isActiveDuplicate) continue;

    console.warn("[beds24/webhook] dedup: deleting stale row for same booking", {
      staleId: staleRow.id,
      keptId: params.keepReservationId,
      originalId: params.originalId,
      staleSourceReservationId: staleRow.source_reservation_id,
      staleStatus: staleRow.status,
    });
    await params.supabase.from("reservations").delete().eq("id", staleRow.id);
  }
}

async function processCancelledWebhookBooking(params: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  sourceReservationId: string;
  originalReservationId: string;
  beds24BookingId: string | null;
  source: string;
  sanitizedPayload: Database["public"]["Tables"]["reservations"]["Insert"]["raw_payload"];
  payload: Beds24JsonRecord;
  storedRoomLabel: string;
  propertyName: string | null;
  guestName: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  roomSync: {
    propertyId: string | null;
    roomId: string | null;
    roomStatus: string | null;
    skipped: string[];
  };
}): Promise<ProcessWebhookBookingResult> {
  const cancelledExisting = await cancelReservationRowsByOriginalBookingId({
    organizationId: params.organizationId,
    sourceReservationId: params.sourceReservationId,
    beds24BookingId: params.beds24BookingId,
    supabase: params.supabase,
    rawPayload: params.sanitizedPayload,
  });

  const finalized = await finalizeCancelledBookingConsistency({
    organizationId: params.organizationId,
    sourceReservationId: params.sourceReservationId,
    beds24BookingId: params.beds24BookingId,
    supabase: params.supabase,
    rawPayload: params.sanitizedPayload,
  });

  const hadLocalImpact =
    cancelledExisting.updatedRows > 0 ||
    finalized.activeCleaned > 0 ||
    finalized.staleRemoved > 0;

  if (hadLocalImpact) {
    return {
      ok: true,
      mode: "cancelled_existing_rows",
      sourceReservationId: params.sourceReservationId,
      originalReservationId: params.originalReservationId,
      mappedStatus: "cancelled",
      updatedRows: cancelledExisting.updatedRows + finalized.activeCleaned,
      cleanedRows: finalized.activeCleaned + finalized.staleRemoved,
      roomSync: params.roomSync,
    };
  }

  if (!params.checkInDate || !params.checkOutDate || !params.guestName || !params.propertyName) {
    console.warn("[beds24/webhook] cancel: sparse payload with no local rows", {
      sourceReservationId: params.originalReservationId,
      hasCheckIn: !!params.checkInDate,
      hasCheckOut: !!params.checkOutDate,
      hasGuest: !!params.guestName,
      hasProperty: !!params.propertyName,
    });
    return {
      ok: true,
      mode: "cancelled_no_local_row",
      sourceReservationId: params.sourceReservationId,
      originalReservationId: params.originalReservationId,
      mappedStatus: "cancelled",
      updatedRows: 0,
      cleanedRows: 0,
      roomSync: params.roomSync,
    };
  }

  const upsertResult = await upsertReservationByBookingIdentity({
    supabase: params.supabase,
    organizationId: params.organizationId,
    source: params.source,
    sourceReservationId: params.sourceReservationId,
    beds24BookingId: params.beds24BookingId,
    storedRoomLabel: params.storedRoomLabel,
    propertyName: params.propertyName,
    guestName: params.guestName,
    checkInDate: params.checkInDate,
    checkOutDate: params.checkOutDate,
    status: "cancelled",
    rawPayload: params.sanitizedPayload,
  });

  const saved = upsertResult.saved;
  if (upsertResult.error || !saved?.id) {
    console.error("[beds24/webhook] cancelled fallback upsert failed", upsertResult.error);
    return {
      ok: false,
      mode: "upsert_failed",
      sourceReservationId: params.sourceReservationId,
      error: upsertResult.error?.message ?? "upsert_failed",
    };
  }

  const postFinalized = await finalizeCancelledBookingConsistency({
    organizationId: params.organizationId,
    sourceReservationId: params.sourceReservationId,
    beds24BookingId: params.beds24BookingId,
    supabase: params.supabase,
    rawPayload: params.sanitizedPayload,
    keepReservationId: saved.id,
  });

  return {
    ok: true,
    mode: "cancelled_fallback_upsert",
    sourceReservationId: params.sourceReservationId,
    originalReservationId: params.originalReservationId,
    mappedStatus: "cancelled",
    reservationId: saved.id,
    updatedRows: 1,
    cleanedRows: postFinalized.activeCleaned + postFinalized.staleRemoved,
    roomSync: params.roomSync,
  };
}

async function upsertReservationByBookingIdentity(params: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  source: string;
  sourceReservationId: string;
  beds24BookingId: string | null;
  storedRoomLabel: string;
  propertyName: string;
  guestName: string;
  checkInDate: string;
  checkOutDate: string;
  status: Database["public"]["Enums"]["reservation_status"];
  rawPayload: Database["public"]["Tables"]["reservations"]["Insert"]["raw_payload"];
}) {
  // 같은 채널 번호의 행을 모두 보고 키를 고른다 — 같은 방을 **다른 Beds24 예약**(그룹 형제)이
  // 이미 쓰고 있으면 덮어쓰지 않고 `::bid::` 꼬리표 키로 따로 저장한다(`chooseStoredReservationId`).
  const siblingRows = await findReservationRowsByOriginalBookingId(
    params.supabase,
    params.organizationId,
    params.sourceReservationId,
  );
  const storedReservationId = chooseStoredReservationId({
    sourceReservationId: params.sourceReservationId,
    roomLabel: params.storedRoomLabel,
    bookingId: params.beds24BookingId,
    existingRows: siblingRows,
  });

  const existing =
    siblingRows.find(
      (row) =>
        row.source_reservation_id === storedReservationId &&
        isSameBeds24Booking(row.bookingId, params.beds24BookingId),
    ) ?? null;
  const reservationFields = {
    property_name: params.propertyName,
    room_label: params.storedRoomLabel,
    guest_name: params.guestName,
    check_in_date: params.checkInDate,
    check_out_date: params.checkOutDate,
    status: params.status,
    raw_payload: params.rawPayload,
  };

  if (existing?.id) {
    const updateResult = await params.supabase
      .from("reservations")
      .update(reservationFields)
      .eq("id", existing.id)
      .select("id")
      .single();

    return {
      saved: updateResult.data as { id: string } | null,
      error: updateResult.error,
      mode: "updated_existing" as const,
      preservedSource: existing.source,
    };
  }

  const upsertResult = await params.supabase
    .from("reservations")
    .upsert(
      {
        organization_id: params.organizationId,
        source: params.source,
        source_reservation_id: storedReservationId,
        ...reservationFields,
      },
      { onConflict: "organization_id,source,source_reservation_id" },
    )
    .select("id")
    .single();

  return {
    saved: upsertResult.data as { id: string } | null,
    error: upsertResult.error,
    mode: "inserted" as const,
    preservedSource: params.source,
  };
}

export async function processBeds24WebhookBooking(params: {
  payload: Beds24JsonRecord;
  organizationIdDefault: string | null;
  supabase: SupabaseClient<Database>;
}): Promise<ProcessWebhookBookingResult> {
  const { payload, supabase } = params;
  const sanitizedPayload = sanitizeRawPayload(payload);

  const syncFields = extractBeds24RoomSyncFields(payload);
  // 조직은 **우리 DB 매핑**이 정한다. 페이로드의 조직 id 는 믿지 않는다(`webhook-organization.ts`).
  const organizationId = pickWebhookOrganizationId({
    fallbackOrganizationId: params.organizationIdDefault,
    mappedOrganizationIds: await readMappedOrganizationIds(supabase, {
      externalPropertyId: syncFields.externalPropertyId,
      externalRoomId: readBeds24ExternalRoomId(payload) ?? syncFields.externalRoomId,
    }),
  });

  const sourceReservationId = readBeds24String(payload, [
    "bookId",
    "book_id",
    "apiReference",
    "api_reference",
    "reservationId",
    "reservation_id",
    "bookingId",
    "booking_id",
    "id",
  ]);

  const checkInDate = toBeds24IsoDate(
    readBeds24String(payload, [
      "firstNight",
      "first_night",
      "checkIn",
      "check_in",
      "arrival",
      "arrivalDate",
      "startDate",
    ]),
  );

  const checkOutDate =
    beds24LastNightToCheckout(readBeds24String(payload, ["lastNight", "last_night"])) ??
    toBeds24IsoDate(
      readBeds24String(payload, ["checkOut", "check_out", "departure", "departureDate", "endDate"]),
    );

  const guestFirstName = readBeds24String(payload, ["guestFirstName", "guest_first_name", "firstName", "first_name"]);
  const guestLastName = readBeds24String(payload, ["guestLastName", "guest_last_name", "lastName", "last_name"]);
  const guestFullName = [guestFirstName, guestLastName].filter(Boolean).join(" ").trim();
  const guestName =
    (guestFullName.length > 0 ? guestFullName : null) ??
    readBeds24String(payload, ["guestName", "guest_name", "customerName", "customer_name", "name"]);

  // 페이로드에서 사람이 읽는 프로퍼티 이름만 읽는다. 원본 property id
  // (propId)는 여기서 일부러 대체값으로 쓰지 않는다 — 예약의
  // property_name 으로 쓰면 한 건물이 원본 id 건물("176431")로 중복 분리됐다.
  // 표준 이름은 아래 방 동기화 뒤에 프로퍼티 마스터에서 해석한다.
  const payloadPropertyName = readBeds24String(payload, [
    "propName",
    "prop_name",
    "propertyName",
    "property_name",
  ]);

  const source = normalizeReservationSource(
    readBeds24String(payload, ["referer", "source", "channel", "bookingSource", "booking_source"]) ?? "beds24",
  );
  const status = resolveReservationStatusFromBeds24Record(payload);
  const originalReservationId = sourceReservationId ? toOriginalReservationId(sourceReservationId) : null;
  // 「같은 예약인가」의 기준. `sourceReservationId` 는 채널 번호라 그룹 예약의 방들이 공유한다.
  const beds24BookingId = readBeds24OwnBookingId(payload);

  if (!organizationId || !sourceReservationId || !originalReservationId) {
    const missing = [
      !organizationId && "organizationId",
      !sourceReservationId && "sourceReservationId",
    ].filter(Boolean) as string[];

    console.warn("[beds24/webhook] skip:missing_required_fields", {
      sourceReservationId,
      missing,
      payloadKeys: Object.keys(payload),
    });

    return {
      ok: false,
      mode: "missing_required_fields",
      sourceReservationId,
      missing,
    };
  }

  const roomResolution = await resolveRoomLabel({
    supabase,
    organizationId,
    payload,
    syncFields,
  });

  syncFields.roomLabel =
    syncFields.roomLabel && !isLikelyNumericRoomLabel(syncFields.roomLabel) ? syncFields.roomLabel : null;

  const roomSync = await syncBeds24PropertyAndRoom(organizationId, syncFields, supabase);
  if (roomSync.skipped.length > 0) {
    console.log("[beds24/webhook] room sync skipped", roomSync.skipped);
  }

  // 최소숙박은 예약과 무관하다 — 응답 뒤에, 건물마다 10분에 한 번만 돈다(`inventory-sync.ts`).
  const externalPropertyIdForInventory = syncFields.externalPropertyId;
  await runAfterResponse("inventory sync", () =>
    syncBeds24InventoryMinimumStayThrottled(organizationId, externalPropertyIdForInventory, supabase),
  );

  // 예약의 property_name 을 운영자가 관리하는 프로퍼티
  // 마스터(방금 동기화한 property id 기준)에서 해석하며, 페이로드 propName 보다 우선한다.
  // 원본 외부 property id 로는 절대 대체하지 않는다 — 마스터가 건물 이름의 유일한
  // 단일 진실 공급원이다. decision-log 2026-07-22 참고.
  let propertyName = payloadPropertyName;
  if (roomSync.propertyId) {
    const masterProperty = await supabase
      .from("properties")
      .select("name")
      .eq("id", roomSync.propertyId)
      .maybeSingle();
    const masterName = (masterProperty.data as { name: string } | null)?.name ?? null;
    if (masterName) propertyName = masterName;
  }

  let storedRoomLabel = roomResolution.resolvedRoomLabel ?? "(unknown)";
  let roomLabelResolvedFrom: "payload" | "room_master" | "recovery" | "unknown_fallback" = roomResolution.resolvedFromValue;

  if (!roomResolution.resolvedRoomLabel) {
    console.warn("[beds24/webhook] warn:room_label_unresolved — storing as (unknown)", {
      sourceReservationId: originalReservationId,
      propertyName,
      guestName,
      payloadRoomLabel: roomResolution.payloadRoomLabel,
      externalRoomId: roomResolution.externalRoomId,
      checkInDate,
      checkOutDate,
    });
  }

  const roomSyncSummary = {
    propertyId: roomSync.propertyId,
    roomId: roomSync.roomId,
    roomStatus: roomSync.roomStatus,
    skipped: roomSync.skipped,
  };

  if (status === "cancelled") {
    return processCancelledWebhookBooking({
      supabase,
      organizationId,
      sourceReservationId,
      originalReservationId,
      beds24BookingId,
      source,
      sanitizedPayload,
      payload,
      storedRoomLabel,
      propertyName,
      guestName,
      checkInDate,
      checkOutDate,
      roomSync: roomSyncSummary,
    });
  }

  if (!checkInDate || !checkOutDate || !guestName || !propertyName) {
    const missing = [
      !checkInDate && "checkInDate",
      !checkOutDate && "checkOutDate",
      !guestName && "guestName",
      !propertyName && "propertyName",
    ].filter(Boolean) as string[];

    console.warn("[beds24/webhook] skip:missing_required_fields", {
      sourceReservationId,
      propertyName,
      guestName,
      checkInDate,
      checkOutDate,
      missing,
      payloadKeys: Object.keys(payload),
    });

    return {
      ok: false,
      mode: "missing_required_fields",
      sourceReservationId,
      missing,
    };
  }

  const upsertResult = await upsertReservationByBookingIdentity({
    supabase,
    organizationId,
    source,
    sourceReservationId,
    beds24BookingId,
    storedRoomLabel,
    propertyName,
    guestName,
    checkInDate,
    checkOutDate,
    status,
    rawPayload: sanitizedPayload,
  });

  const saved = upsertResult.saved;
  if (upsertResult.error || !saved?.id) {
    console.error("[beds24/webhook] reservation upsert failed", upsertResult.error);
    return {
      ok: false,
      mode: "upsert_failed",
      sourceReservationId,
      error: upsertResult.error?.message ?? "upsert_failed",
    };
  }

  if (storedRoomLabel === "(unknown)") {
    const recovery = await recoverReservationRoomLabelById(supabase, saved.id, organizationId);
    if (recovery.recovered && recovery.roomLabel) {
      storedRoomLabel = recovery.roomLabel;
      roomLabelResolvedFrom = "recovery";
    }
  }

  await deleteStaleRowsForSameBooking({
    supabase,
    organizationId,
    originalId: originalReservationId,
    beds24BookingId,
    keepReservationId: saved.id,
  });

  // 열려 있는 캘린더·홈·청소 화면이 새로고침 없이 다시 읽는다(`src/lib/beds24-live.ts`). 예약은 이미 저장됐으니
  // 신호는 응답 뒤에 보내도 순서가 같다(저장 → 신호).
  await runAfterResponse("live signal", () => signalBeds24Change(organizationId, "reservations"));

  return {
    ok: true,
    mode: "upserted",
    sourceReservationId,
    originalReservationId,
    mappedStatus: status,
    reservationId: saved.id,
    roomLabelResolvedFrom,
    roomSync: {
      propertyId: roomSync.propertyId,
      roomId: roomSync.roomId,
      roomStatus: roomSync.roomStatus,
      skipped: roomSync.skipped,
    },
  };
}
