import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readBeds24BookingId } from "@/lib/beds24/reservation-status";
import { getReservationGuests } from "@/lib/reservation-guests";
import {
  BOOKING_ID_PAYLOAD_KEYS,
  CALENDAR_PAYLOAD_KEYS,
  GUEST_PAYLOAD_KEYS,
  PHONE_PAYLOAD_KEYS,
  ROOM_MATCH_PAYLOAD_KEYS,
  slimPayloadOf,
  slimPayloadSelect,
} from "@/lib/reservation-payload-slim";
import { getRawPayloadString } from "@/lib/rooms";

/** PostgREST `rp_<key>:raw_payload-><key>` 가 돌려주는 행 — 객체가 아니거나 키가 없으면 `null`. */
function postgrestRow(payload: unknown, keys: readonly string[]): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  for (const key of keys) row[`rp_${key}`] = record[key] ?? null;
  return row;
}

const slim = (payload: unknown, keys: readonly string[] = CALENDAR_PAYLOAD_KEYS) =>
  slimPayloadOf(postgrestRow(payload, keys), keys);

const asRecord = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, string | number | boolean | null>)
    : {};

const samples: unknown[] = [
  null,
  [],
  "text",
  {},
  {
    bookId: 81234567,
    note: "x".repeat(5000),
    numAdult: 2,
    numChild: 1,
    numInfant: 1,
    phone: " 090-1234-5678 ",
    roomId: 501,
    unitName: "501_2",
  },
  { adults: "3", apiReference: "HMABC", children: "0", mobile: "+81-90", room_label: "203" },
  { booking_id: "B-1", guestCount: 4, guestPhone: "", roomName: "Room 3", unit_id: "77" },
  { guest_phone: 819012345678, id: 5, pax: "2", room_id: "88", unitLabel: "A" },
  { child: 2, infant: 1, persons: null, reservation_id: " r-9 ", unit_label: "B" },
  { guests: [1, 2], num_adults: 1, num_children: 2, roomLabel: "C", unitId: 9 },
];

describe("예약 원본 슬림 읽기", () => {
  it("select 열은 키마다 `rp_<key>:raw_payload-><key>`", () => {
    expect(slimPayloadSelect(["roomId", "id"])).toBe("rp_roomId:raw_payload->roomId, rp_id:raw_payload->id");
  });

  it("인원 · 전화 · 예약 번호 · 객실 매칭 값이 원본과 같다", () => {
    for (const payload of samples) {
      const small = slim(payload);
      expect(getReservationGuests(small)).toEqual(getReservationGuests(payload));
      for (const keys of [ROOM_MATCH_PAYLOAD_KEYS, PHONE_PAYLOAD_KEYS, BOOKING_ID_PAYLOAD_KEYS]) {
        expect(getRawPayloadString(small as never, [...keys])).toBe(getRawPayloadString(payload as never, [...keys]));
      }
      expect(readBeds24BookingId(asRecord(small))).toBe(readBeds24BookingId(asRecord(payload)));
    }
  });

  it("청소 대상(인원 키만)도 원본과 같다", () => {
    for (const payload of samples) {
      expect(getReservationGuests(slim(payload, GUEST_PAYLOAD_KEYS))).toEqual(getReservationGuests(payload));
    }
  });

  it("인원 키 목록이 reservation-guests.ts 의 키를 모두 담는다", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/reservation-guests.ts"), "utf8");
    const declared = [...source.matchAll(/const [A-Z_]+_KEYS = \[([^\]]*)\]/g)].flatMap((match) =>
      [...match[1].matchAll(/"([^"]+)"/g)].map((key) => key[1]),
    );
    expect(declared.length).toBeGreaterThan(10);
    for (const key of declared) expect(GUEST_PAYLOAD_KEYS as readonly string[]).toContain(key);
  });

  it("예약 번호 키 목록이 readBeds24BookingId 의 키를 모두 담는다", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/beds24/reservation-status.ts"), "utf8");
    const body = source.slice(source.indexOf("export function readBeds24BookingId"));
    const list = body.slice(body.indexOf("["), body.indexOf("]"));
    const keys = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(keys.length).toBeGreaterThan(5);
    for (const key of keys) expect(BOOKING_ID_PAYLOAD_KEYS as readonly string[]).toContain(key);
  });
});
