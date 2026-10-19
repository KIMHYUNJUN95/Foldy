/**
 * 예약 원본(`raw_payload`)에서 **화면이 읽는 키만** 받는다(2026-10-19 속도 — 예약 캘린더 · 청소 대상).
 *
 * 원본을 통째로 받으면 예약 캘린더 두 달 창 954행에 약 2MB, 청소 대상 30일 도착 429행에 약 890KB 였다(실측). 쓰는 것은
 * 객실 매칭 키 · 인원 · 전화 · 예약 번호뿐이라, PostgREST 의 JSON 경로 선택(`raw_payload->key`)으로 그 키만 받고 받은 값으로
 * 작은 `raw_payload` 를 다시 만든다 — 읽는 함수(`resolveReservationCanonicalRoomLabel` · `getReservationGuests` 등)는
 * 그대로 `raw_payload` 를 읽는다. 판매 캘린더의 `SLIM_PAYLOAD_KEYS`(ops-calendar.ts)와 같은 방식이다.
 *
 * **읽는 함수가 새 키를 보게 되면 여기 목록에도 넣어야 한다** — 빠진 키는 조용히 「값 없음」이 된다.
 */

/** 객실 매칭 — `resolveReservationCanonicalRoomLabel`(rooms.ts) · 모바일 캘린더의 같은 판정. */
export const ROOM_MATCH_PAYLOAD_KEYS = [
  "roomId",
  "room_id",
  "unitId",
  "unit_id",
  "unitName",
  "unit_name",
  "roomName",
  "room_name",
  "roomLabel",
  "unitLabel",
  "unit_label",
  "room_label",
] as const;

/** 인원 — `getReservationGuests`(reservation-guests.ts)의 성인 · 어린이 · 유아 · 합계 키, 청소 대상 `getPax` 키 포함. */
export const GUEST_PAYLOAD_KEYS = [
  "numAdult",
  "num_adult",
  "num_adults",
  "adults",
  "adult",
  "numChild",
  "num_child",
  "num_children",
  "children",
  "child",
  "numInfant",
  "num_infant",
  "infants",
  "infant",
  "guestCount",
  "guest_count",
  "pax",
  "persons",
  "guests",
] as const;

/** 전화 — 예약 캘린더(관리자 · 모바일) `getPhone`. */
export const PHONE_PAYLOAD_KEYS = ["phone", "mobile", "guest_phone", "guestPhone"] as const;

/** 예약 번호 — `readBeds24BookingId` · 모바일 캘린더 `getDisplayReservationId`. */
export const BOOKING_ID_PAYLOAD_KEYS = [
  "bookId",
  "book_id",
  "apiReference",
  "api_reference",
  "reservationId",
  "reservation_id",
  "bookingId",
  "booking_id",
  "id",
] as const;

/** 예약 캘린더(관리자 · 모바일)가 읽는 키 전부. */
export const CALENDAR_PAYLOAD_KEYS: readonly string[] = [
  ...new Set<string>([...ROOM_MATCH_PAYLOAD_KEYS, ...GUEST_PAYLOAD_KEYS, ...PHONE_PAYLOAD_KEYS, ...BOOKING_ID_PAYLOAD_KEYS]),
];

const ALIAS_PREFIX = "rp_";

/** select 문에 붙일 JSON 경로 열 — `rp_<key>:raw_payload-><key>`. `->` 라 값의 형(숫자 · 문자)이 그대로 온다. */
export function slimPayloadSelect(keys: readonly string[]): string {
  return keys.map((key) => `${ALIAS_PREFIX}${key}:raw_payload->${key}`).join(", ");
}

/** 받은 행의 `rp_*` 열로 작은 `raw_payload` 를 다시 만든다. 값이 없는(`null`) 키는 넣지 않는다 — 원본에서도 「값 없음」이다. */
export function slimPayloadOf(row: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of keys) {
    const value = row[`${ALIAS_PREFIX}${key}`];
    if (value !== null && value !== undefined) payload[key] = value;
  }
  return payload;
}
