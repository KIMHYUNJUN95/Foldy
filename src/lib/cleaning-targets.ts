import {
  buildRoomKey,
  buildSessionRoomLabel,
  getCanonicalPropertyName,
  getCanonicalRoomLabel,
  getDisplayRoomLabel,
  isExcludedOperationalProperty,
  isExcludedOperationalRoom,
} from "@/lib/room-label-normalization";
import { getCleaningOperatingDateKey } from "@/lib/cleaning";
import { getReservationGuests } from "@/lib/reservation-guests";
import { GUEST_PAYLOAD_KEYS, slimPayloadOf, slimPayloadSelect } from "@/lib/reservation-payload-slim";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

function getPax(rawPayload: unknown): number | null {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return null;
  const r = rawPayload as Record<string, unknown>;
  for (const key of [
    "numAdult", "num_adult", "num_adults", "adults",
    "guestCount", "guest_count", "pax", "persons", "guests",
  ]) {
    const v = r[key];
    if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.round(v));
    if (typeof v === "string") {
      const n = Number(v.trim());
      if (Number.isFinite(n)) return Math.max(0, Math.round(n));
    }
  }
  return null;
}

function addCalendarDays(dateStr: string, days: number) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const BASE_COLUMNS = "id, check_in_date, check_out_date, guest_name, property_name, room_label";
// 도착 예약은 인원(`getPax` · `getReservationGuests`)만 원본에서 읽는다 — 키만 받는다(2026-10-19 속도, 30일 429행 약 890KB 였다).
// 떠나는 예약은 원본을 읽지 않는다.
const ARRIVAL_SELECT = `${BASE_COLUMNS}, ${slimPayloadSelect(GUEST_PAYLOAD_KEYS)}`;

type ResRow = {
  id: string;
  check_in_date: string;
  check_out_date: string;
  guest_name: string;
  property_name: string;
  room_label: string;
  raw_payload: unknown;
};

export type CleaningTarget = {
  roomKey: string;
  sessionRoomLabel: string;
  canonicalPropertyName: string;
  canonicalRoomLabel: string;
  checkOutDate: string;
  departingGuestName: string;
  hasTurnover: boolean;
  // populated when hasTurnover === true
  arrivingGuestName: string | null;
  arrivingPax: number | null;
  /** 성인 + 어린이 합계(Slack 청소 명단 — 저쪽은 `numAdult + numChild`). `arrivingPax` 는 화면 호환용으로 성인만. */
  arrivingGuestsTotal: number | null;
  // populated when hasTurnover === false and next check-in exists within 30 days
  nextCheckInDate: string | null;
  nextCheckInGuestName: string | null;
  nextCheckInPax: number | null;
  nextCheckInGuestsTotal: number | null;
};

export type SettingTarget = {
  roomKey: string;
  sessionRoomLabel: string;
  canonicalPropertyName: string;
  canonicalRoomLabel: string;
  checkInDate: string;
  arrivingGuestName: string;
  arrivingPax: number | null;
  arrivingGuestsTotal: number | null;
};

export type CleaningTargetsResult = {
  cleaningList: CleaningTarget[];
  settingList: SettingTarget[];
  targetDate: string;
};

/**
 * 청소·셋팅 대상은 **예약에서 파생**된다(그날 체크아웃 → 청소, 그날 체크인 → 셋팅). 그래서 날짜만
 * 바꾸면 과거·미래도 그대로 계산된다 — 2026-08-04 에 `date` 파라미터를 열었다.
 *
 * **과거 조회의 한계:** 대상은 *지금* 예약 데이터로 다시 계산한 값이다. 그 뒤에 취소·변경된 예약은
 * 사라지거나 달라지므로 **그날 실제로 화면에 보였던 목록과 다를 수 있다.** 정확히 하려면 매일
 * 대상을 스냅샷으로 남겨야 하는데, 그 비용 대신 화면에서 한계를 안내하는 쪽을 택했다.
 *
 * **미래 조회의 한계:** 먼 미래일수록 예약이 덜 차 있어 건수가 실제보다 적게 보인다. 한가한 것이
 * 아니라 아직 안 찬 것이다 — 화면이 이를 구분해 안내해야 한다.
 */
export async function getCleaningTargets(
  organizationId: string,
  date?: string,
  /** 세션이 없는 곳(자동화 틱)은 service-role 클라이언트를 넘긴다. 없으면 로그인 사용자 클라이언트. */
  client?: SupabaseClient<Database>,
): Promise<CleaningTargetsResult> {
  const targetDate = date ?? getCleaningOperatingDateKey();
  const windowEnd = addCalendarDays(targetDate, 30);

  const supabase = client ?? (await getSupabaseServerClient());

  const [depResult, arrResult] = await Promise.all([
    supabase
      .from("reservations")
      .select(BASE_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("status", "confirmed")
      .eq("check_out_date", targetDate),
    supabase
      .from("reservations")
      .select(ARRIVAL_SELECT)
      .eq("organization_id", organizationId)
      .eq("status", "confirmed")
      .gte("check_in_date", targetDate)
      .lt("check_in_date", windowEnd)
      .order("check_in_date", { ascending: true }),
  ]);

  if (depResult.error) throw new Error(depResult.error.message);
  if (arrResult.error) throw new Error(arrResult.error.message);

  function excluded(row: ResRow) {
    return (
      isExcludedOperationalProperty(row.property_name) ||
      isExcludedOperationalRoom(row.property_name, row.room_label)
    );
  }

  function canonicalize(row: ResRow) {
    const cp = getCanonicalPropertyName(row.property_name);
    const cr = getCanonicalRoomLabel(cp, row.room_label);
    // Physical-room key: collapses Arakicho _N sub-listings (501 / 501_2 → 501). The same
    // physical room carries two Beds24 listings (one per channel), so a same-day checkout and
    // check-in of that one room can land under different room_labels. Turnover/setting detection
    // must match on the physical room, not the per-listing key, or the arrival is misclassified
    // as a setting target. Non-Arakicho keys are unchanged. Mirrors the admin console, which
    // already keys these off the display-collapsed room. See docs/product/07-cleaning-workflow.md.
    const physicalKey = buildRoomKey(cp, getDisplayRoomLabel(cp, cr));
    return { cp, cr, key: buildRoomKey(cp, cr), physicalKey };
  }

  const departures = ((depResult.data ?? []) as unknown as Omit<ResRow, "raw_payload">[])
    .map((r): ResRow => ({ ...r, raw_payload: null }))
    .filter((r) => !excluded(r));
  const arrivals = ((arrResult.data ?? []) as unknown as Record<string, unknown>[])
    .map((r): ResRow => ({
      check_in_date: r.check_in_date as string,
      check_out_date: r.check_out_date as string,
      guest_name: r.guest_name as string,
      id: r.id as string,
      property_name: r.property_name as string,
      raw_payload: slimPayloadOf(r, GUEST_PAYLOAD_KEYS),
      room_label: r.room_label as string,
    }))
    .filter((r) => !excluded(r));

  // Map: physicalKey → first departure row (edge-case: multiple checkouts same physical room)
  const departureMap = new Map<string, { row: ResRow; cp: string; cr: string }>();
  for (const row of departures) {
    const { cp, cr, physicalKey } = canonicalize(row);
    if (!departureMap.has(physicalKey)) departureMap.set(physicalKey, { row, cp, cr });
  }

  // Map: physicalKey → arrivals sorted ascending by check_in_date (already ordered from DB)
  const arrivalsByKey = new Map<string, ResRow[]>();
  for (const row of arrivals) {
    const { physicalKey } = canonicalize(row);
    const list = arrivalsByKey.get(physicalKey) ?? [];
    list.push(row);
    arrivalsByKey.set(physicalKey, list);
  }

  // Build cleaning list
  const cleaningList: CleaningTarget[] = [];
  for (const [physicalKey, { row: dep, cp, cr }] of departureMap) {
    const roomArrivals = arrivalsByKey.get(physicalKey) ?? [];
    const todayArrival = roomArrivals.find((a) => a.check_in_date === targetDate) ?? null;
    const hasTurnover = todayArrival !== null;
    const nextArrival = hasTurnover
      ? null
      : (roomArrivals.find((a) => a.check_in_date > targetDate) ?? null);

    cleaningList.push({
      roomKey: buildRoomKey(cp, cr),
      sessionRoomLabel: buildSessionRoomLabel(cp, cr),
      canonicalPropertyName: cp,
      canonicalRoomLabel: cr,
      checkOutDate: dep.check_out_date,
      departingGuestName: dep.guest_name || "Guest",
      hasTurnover,
      arrivingGuestName: todayArrival ? (todayArrival.guest_name || null) : null,
      arrivingPax: todayArrival ? getPax(todayArrival.raw_payload) : null,
      arrivingGuestsTotal: todayArrival ? getReservationGuests(todayArrival.raw_payload).total : null,
      nextCheckInDate: nextArrival ? nextArrival.check_in_date : null,
      nextCheckInGuestName: nextArrival ? (nextArrival.guest_name || null) : null,
      nextCheckInPax: nextArrival ? getPax(nextArrival.raw_payload) : null,
      nextCheckInGuestsTotal: nextArrival ? getReservationGuests(nextArrival.raw_payload).total : null,
    });
  }

  // Build setting list: today's arrivals whose physical room is NOT in the departure set.
  // Keyed by physicalKey so a same-day turnover split across two Beds24 listings of the same
  // physical room (checkout under 501_2, check-in under 501) is excluded here and surfaces as a
  // turnover in the cleaning list instead.
  const settingList: SettingTarget[] = [];
  const settingKeysSeen = new Set<string>();
  for (const row of arrivals) {
    if (row.check_in_date !== targetDate) continue;
    const { cp, cr, key, physicalKey } = canonicalize(row);
    if (departureMap.has(physicalKey) || settingKeysSeen.has(physicalKey)) continue;
    settingKeysSeen.add(physicalKey);
    settingList.push({
      roomKey: key,
      sessionRoomLabel: buildSessionRoomLabel(cp, cr),
      canonicalPropertyName: cp,
      canonicalRoomLabel: cr,
      checkInDate: row.check_in_date,
      arrivingGuestName: row.guest_name || "Guest",
      arrivingPax: getPax(row.raw_payload),
      arrivingGuestsTotal: getReservationGuests(row.raw_payload).total,
    });
  }

  return { cleaningList, settingList, targetDate };
}
