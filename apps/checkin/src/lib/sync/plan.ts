import { buildingKeyOf } from "../building-key";
import { guestCountOf } from "../guest-count";
import { addDays, addYears } from "../tokyo-date";

// sync-stays 의 판단만 모은 곳(DB 없음 — 테스트로 덮는다). 읽기 · 쓰기는 run.ts.
// 한 stay = 채널 예약 번호(original_reservation_id) 하나. 방 여러 개 예약은 stay 1개 + stay_rooms 여러 개(16 §3).

export type ReservationRow = {
  id: string;
  organization_id: string;
  original_reservation_id: string | null;
  property_name: string;
  room_label: string;
  check_in_date: string;
  check_out_date: string;
  status: string;
  raw_payload: unknown;
};

export type StayStatus = "pending" | "pre_registered" | "in_progress" | "checked_in" | "expired" | "cancelled";

export type StayRow = {
  id: string;
  organization_id: string;
  reservation_group_key: string;
  property_key: string;
  check_in_date: string;
  check_out_date: string;
  guest_count_expected: number;
  status: StayStatus;
  retain_until: string | null;
};

export type StayRoomRow = {
  id: string;
  stay_id: string;
  reservation_id: string;
};

export type StayFields = {
  property_key: string;
  check_in_date: string;
  check_out_date: string;
  guest_count_expected: number;
  retain_until: string;
};

export type NewStay = StayFields & {
  organization_id: string;
  reservation_group_key: string;
  rooms: { reservation_id: string; room_label: string }[];
};

export type StayUpdate = {
  id: string;
  patch: Partial<StayFields> & { status?: StayStatus };
  /** 취소됐던 예약이 다시 살아나면 코드를 새로 준다(옛 코드는 그사이 다른 stay 가 썼을 수 있다). */
  needsCode: boolean;
};

export type SyncPlan = {
  inserts: NewStay[];
  updates: StayUpdate[];
  roomInserts: { organization_id: string; stay_id: string; reservation_id: string; room_label: string }[];
  roomDeletes: string[];
  /** 체크인 뒤 예약이 바뀐 건 — 바꾸지 않고 건수만 센다(16 §3 「체크인 뒤 변경은 기록만」). */
  changedAfterCheckin: number;
  /** 건물 키를 모르는 예약 묶음 — 새 건물이면 building-key.ts 에 넣는다. */
  unknownProperty: number;
  /** 태블릿을 두지 않는 건물(EXCLUDED_PROPERTY_KEYS)이라 건너뛴 예약 묶음. */
  excludedProperty: number;
};

// 대행 운영 등 태블릿 체크인을 쓰지 않는 건물 — stay 도 체크인 코드도 만들지 않는다. 건물 키 판별(building-key.ts)은 그대로 둔다.
export const EXCLUDED_PROPERTY_KEYS: ReadonlySet<string> = new Set(["sano"]);

// Beds24 상태 중 숙박이 없는 것. 43 「막는 경우」 표: 취소 · no_show 는 「취소된 예약」으로 안내.
const INACTIVE = new Set(["cancelled", "no_show"]);
// 아직 체크인하지 않은 stay — 예약을 따라 바뀐다.
const OPEN: ReadonlySet<StayStatus> = new Set(["pending", "pre_registered", "in_progress"]);

const MAX_GUESTS = 99;
const CANCEL_RETAIN_DAYS = 30;
const RETAIN_YEARS = 3;

function groupKey(organizationId: string, reservationGroupKey: string) {
  return `${organizationId}|${reservationGroupKey}`;
}

function fieldsOf(rows: ReservationRow[], propertyKey: string): StayFields {
  const checkIn = rows.reduce((min, row) => (row.check_in_date < min ? row.check_in_date : min), rows[0].check_in_date);
  const checkOut = rows.reduce((max, row) => (row.check_out_date > max ? row.check_out_date : max), rows[0].check_out_date);
  const guests = rows.reduce((sum, row) => sum + Math.max(1, guestCountOf(row.raw_payload) ?? 1), 0);
  return {
    property_key: propertyKey,
    check_in_date: checkIn,
    check_out_date: checkOut,
    guest_count_expected: Math.min(MAX_GUESTS, guests),
    retain_until: addYears(checkOut, RETAIN_YEARS),
  };
}

export function planSync(
  reservations: ReservationRow[],
  stays: StayRow[],
  stayRooms: StayRoomRow[],
  today: string,
): SyncPlan {
  const plan: SyncPlan = {
    inserts: [],
    updates: [],
    roomInserts: [],
    roomDeletes: [],
    changedAfterCheckin: 0,
    unknownProperty: 0,
    excludedProperty: 0,
  };

  const groups = new Map<string, ReservationRow[]>();
  for (const row of reservations) {
    const key = row.original_reservation_id?.trim();
    if (!key) continue;
    const id = groupKey(row.organization_id, key);
    const list = groups.get(id);
    if (list) list.push(row);
    else groups.set(id, [row]);
  }

  const stayByGroup = new Map(stays.map((stay) => [groupKey(stay.organization_id, stay.reservation_group_key), stay]));
  const roomsByStay = new Map<string, StayRoomRow[]>();
  for (const room of stayRooms) {
    const list = roomsByStay.get(room.stay_id);
    if (list) list.push(room);
    else roomsByStay.set(room.stay_id, [room]);
  }

  for (const [id, rows] of groups) {
    const stay = stayByGroup.get(id);
    const active = rows
      .filter((row) => !INACTIVE.has(row.status))
      .sort((a, b) => a.room_label.localeCompare(b.room_label) || a.id.localeCompare(b.id));

    if (active.length === 0) {
      // 전부 취소 — 열린 stay 만 닫는다. 없던 stay 는 만들지 않는다.
      if (stay && OPEN.has(stay.status)) {
        plan.updates.push({
          id: stay.id,
          patch: { status: "cancelled", retain_until: addDays(today, CANCEL_RETAIN_DAYS) },
          needsCode: false,
        });
      }
      continue;
    }

    // 한 묶음이 두 건물에 걸치는 일은 없다고 보고 첫 방의 건물을 쓴다.
    const propertyKey = buildingKeyOf(active[0].property_name);
    if (!propertyKey) {
      plan.unknownProperty += 1;
      continue;
    }
    if (EXCLUDED_PROPERTY_KEYS.has(propertyKey)) {
      plan.excludedProperty += 1;
      continue;
    }
    const fields = fieldsOf(active, propertyKey);

    if (!stay) {
      plan.inserts.push({
        ...fields,
        organization_id: active[0].organization_id,
        reservation_group_key: active[0].original_reservation_id!.trim(),
        rooms: active.map((row) => ({ reservation_id: row.id, room_label: row.room_label })),
      });
      continue;
    }

    if (stay.status === "checked_in" || stay.status === "expired") {
      const changed =
        stay.check_in_date !== fields.check_in_date ||
        stay.check_out_date !== fields.check_out_date ||
        stay.guest_count_expected !== fields.guest_count_expected;
      if (changed) plan.changedAfterCheckin += 1;
      continue;
    }

    const patch: StayUpdate["patch"] = {};
    for (const field of Object.keys(fields) as (keyof StayFields)[]) {
      if (stay[field] !== fields[field]) Object.assign(patch, { [field]: fields[field] });
    }
    const revived = stay.status === "cancelled";
    if (revived) patch.status = "pending";
    if (Object.keys(patch).length > 0) plan.updates.push({ id: stay.id, patch, needsCode: revived });

    const existing = roomsByStay.get(stay.id) ?? [];
    const activeIds = new Set(active.map((row) => row.id));
    const existingIds = new Set(existing.map((room) => room.reservation_id));
    for (const row of active) {
      if (!existingIds.has(row.id)) {
        plan.roomInserts.push({
          organization_id: stay.organization_id,
          stay_id: stay.id,
          reservation_id: row.id,
          room_label: row.room_label,
        });
      }
    }
    for (const room of existing) {
      if (!activeIds.has(room.reservation_id)) plan.roomDeletes.push(room.id);
    }
  }

  return plan;
}
