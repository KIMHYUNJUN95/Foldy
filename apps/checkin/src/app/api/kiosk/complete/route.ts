import { z } from "zod";

import { canonicalNameOf } from "@/lib/building-key";
import { authenticateDevice } from "@/lib/device/auth";
import { json, readJson, serverError } from "@/lib/guest/request";
import {
  addressOf,
  completionBlock,
  currentRoomLabels,
  matchRoomCodes,
  identityProven,
  raceOutcome,
  sharedCodesOf,
  staffCheckCount,
} from "@/lib/kiosk/complete";
import { notifyStaff } from "@/lib/kiosk/staff-notify";
import { openKioskStayForComplete } from "@/lib/kiosk/store";
import { createCheckinServiceClient } from "@/lib/supabase/service";

// POST /api/kiosk/complete — 태블릿 체크인 완료(44 FR-K04 · K13, 16 §5-4). 응답에 출입 번호가 있어 캐시하지 않는다(json 이 no-store).
// 막는 것은 약관 동의 · 명부(인원 · 이름) 뿐. 얼굴 영상이 없거나 직원 확인이 필요한 분은 끝내고 인원 수만 센다.
// 이미 체크인된 예약은 아무것도 바꾸지 않고 같은 정보를 다시 준다(already: true) — 그때마다 「번호 봄」 기록 한 줄.
// 순서: 읽기(번호 · 방) 전부 → 상태 바꾸기 → 부가 쓰기(세션 · 기록)는 실패해도 성공으로 답한다(체크인은 이미 끝났다).
export const dynamic = "force-dynamic";

const bodySchema = z.object({ session_id: z.uuid() });
const OPEN_STATUSES = ["pending", "pre_registered", "in_progress"];

export async function POST(request: Request) {
  try {
    const db = createCheckinServiceClient();
    const auth = await authenticateDevice(db, request);
    if ("error" in auth) return json({ ok: false, error: auth.error }, 401);
    const { device } = auth;

    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) return json({ ok: false, error: "invalid" }, 400);

    const now = new Date();
    const opened = await openKioskStayForComplete(db, parsed.data.session_id, device, now);
    if (!opened) return json({ ok: false, error: "session_gone" }, 409);
    const { stay, proof } = opened;

    let already = stay.status === "checked_in";
    if (!already) {
      const block = completionBlock({
        consented: stay.consented,
        partySize: stay.partySize,
        guests: stay.guests.map((guest) => ({ name: guest.name_roman, missing: guest.missing })),
      });
      if (block) return json({ ok: false, error: "incomplete", reason: block }, 409);
    }

    // ── 읽기 전부 먼저 — 실패하면 아무것도 바뀌지 않는다 ──
    const { data: mrzRows, error: mrzError } = await db
      .from("guests")
      .select("id, mrz_valid")
      .eq("organization_id", stay.organizationId)
      .eq("stay_id", stay.id);
    if (mrzError) throw new Error(`guests 읽기 실패: ${mrzError.message}`);
    const mrzValidById = new Map((mrzRows ?? []).map((row) => [row.id as string, (row.mrz_valid as boolean | null) ?? null]));
    const staffChecks = staffCheckCount(
      stay.guests.map((guest) => ({
        hasFaceVideo: guest.hasFaceVideo,
        noPassportReason: guest.no_passport_reason,
        mrzValid: mrzValidById.get(guest.id) ?? null,
        missing: guest.missing,
      })),
    );

    // 본인 확인 — 이 찾기의 증명(세션 step_payload)만 본다. 체크인 전 · 후, 재시도, 경쟁 분기 모두 같은 검사를 이 앞에서 지난다.
    // 명부에 남은 MRZ · 사진은 증거로 보지 않는다.
    if (!identityProven(proof)) {
      const { error: refusedError } = await db.from("audit_log").insert({
        organization_id: stay.organizationId,
        device_id: device.id,
        stay_id: stay.id,
        action: "kiosk_codes_refused",
        meta: {},
      });
      if (refusedError) console.error("[kiosk-complete] audit_log 쓰기 실패:", refusedError.message);
      return json({ ok: false, error: "verify_required" }, 403);
    }

    // 지금 예약의 방 — 체크인 뒤에 방이 바뀌거나 취소됐을 수 있다. stay_rooms 줄은 건드리지 않는다.
    const { data: stayRooms, error: roomsError } = await db
      .from("stay_rooms")
      .select("reservation_id, room_label")
      .eq("organization_id", stay.organizationId)
      .eq("stay_id", stay.id);
    if (roomsError) throw new Error(`stay_rooms 읽기 실패: ${roomsError.message}`);
    const reservationIds = (stayRooms ?? []).map((room) => room.reservation_id as string);
    const { data: reservations, error: reservationsError } = reservationIds.length
      ? await db
          .schema("public")
          .from("reservations")
          .select("id, status, room_label")
          .eq("organization_id", stay.organizationId)
          .in("id", reservationIds)
      : { data: [], error: null };
    if (reservationsError) throw new Error(`reservations 읽기 실패: ${reservationsError.message}`);
    const roomLabels = currentRoomLabels(
      (stayRooms ?? []).map((room) => ({ reservation_id: room.reservation_id as string, room_label: room.room_label as string })),
      (reservations ?? []).map((row) => ({ id: row.id as string, status: row.status as string, room_label: (row.room_label as string | null) ?? null })),
    );
    if (roomLabels === null) return json({ ok: false, error: "blocked", reason: "cancelled" }, 409);

    const canonicalName = canonicalNameOf(stay.propertyKey);
    let info: { address_ko: unknown; address_ja: unknown; address_en: unknown; shared_access: unknown; room_access: unknown } | null = null;
    if (canonicalName) {
      const { data, error } = await db
        .schema("public")
        .from("property_operation_infos")
        .select("address_ko, address_ja, address_en, shared_access, room_access")
        .eq("organization_id", stay.organizationId)
        .eq("canonical_name", canonicalName)
        .maybeSingle();
      if (error) throw new Error(`property_operation_infos 읽기 실패: ${error.message}`);
      info = data;
    }

    // ── 상태 바꾸기 — 조건부 갱신이라 동시에 두 번 불려도 한 쪽만 쓴다 ──
    if (!already) {
      const { data: changed, error: updateError } = await db
        .from("stays")
        .update({ status: "checked_in", checked_in_at: now.toISOString(), updated_at: now.toISOString() })
        .eq("id", stay.id)
        .eq("organization_id", stay.organizationId)
        .in("status", OPEN_STATUSES)
        .select("id");
      if (updateError) throw new Error(`stays 갱신 실패: ${updateError.message}`);
      if (!changed?.length) {
        const { data: now_, error: rereadError } = await db
          .from("stays")
          .select("status")
          .eq("id", stay.id)
          .eq("organization_id", stay.organizationId)
          .maybeSingle();
        if (rereadError) throw new Error(`stays 읽기 실패: ${rereadError.message}`);
        const outcome = raceOutcome((now_?.status as string | undefined) ?? null);
        if ("blocked" in outcome) return json({ ok: false, error: "blocked", reason: outcome.blocked }, 409);
        already = true;
      } else {
        // 여기부터는 체크인이 끝난 뒤 — 실패해도 손님을 번호 화면 앞에서 막지 않는다. 로그에는 손님 정보를 넣지 않는다.
        const { error: sessionError } = await db
          .from("sessions")
          .update({ finished_at: now.toISOString(), last_step: "done" })
          .eq("id", parsed.data.session_id)
          .eq("organization_id", stay.organizationId)
          .is("finished_at", null);
        if (sessionError) console.error("[kiosk-complete] sessions 갱신 실패:", sessionError.message);
        const { error: auditError } = await db.from("audit_log").insert({
          organization_id: stay.organizationId,
          device_id: device.id,
          stay_id: stay.id,
          action: "kiosk_check_in_completed",
          meta: { staff_check_count: staffChecks },
        });
        if (auditError) console.error("[kiosk-complete] audit_log 쓰기 실패:", auditError.message);
        if (staffChecks > 0) {
          await notifyStaff(db, {
            organizationId: stay.organizationId,
            capability: "checkin.view",
            type: "checkin_staff_check",
            sourceId: stay.id,
            payload: { stayId: stay.id, propertyKey: stay.propertyKey },
          });
        }
      }
    }

    if (already) {
      const { error: viewedError } = await db.from("audit_log").insert({
        organization_id: stay.organizationId,
        device_id: device.id,
        stay_id: stay.id,
        action: "kiosk_codes_viewed",
        meta: {},
      });
      if (viewedError) console.error("[kiosk-complete] audit_log 쓰기 실패:", viewedError.message);
    }

    return json({
      ok: true,
      already,
      rooms: matchRoomCodes(stay.propertyKey, roomLabels, info?.room_access),
      shared: sharedCodesOf(info?.shared_access, stay.propertyKey),
      address: addressOf(info),
      check_in_date: stay.checkInDate,
      check_out_date: stay.checkOutDate,
      guest_count: stay.guests.length,
      lead_name: stay.guests.find((guest) => guest.is_representative)?.name_roman ?? null,
      staff_check_count: staffChecks,
    });
  } catch (error) {
    return serverError("kiosk-complete", error);
  }
}
