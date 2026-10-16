import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractBeds24BookingCandidates } from "@/lib/beds24/booking-payload";
import {
  cancelReservationRowsByOriginalBookingId,
  finalizeCancelledBookingConsistency,
  findReservationRowsByOriginalBookingId,
} from "@/lib/beds24/reservation-lookup";
import {
  chooseStoredReservationId,
  filterRowsOfSameBeds24Booking,
  isSameBeds24Booking,
  readBeds24MasterId,
  readBeds24OwnBookingId,
  toOriginalReservationId,
  toStoredReservationId,
} from "@/lib/beds24/reservation-id";
import type { Database } from "@/types/database";

/**
 * Booking.com 다객실(그룹) 예약 — 2026-10-01 실제 사고 픽스처.
 * 채널 번호(apiReference) 5277809875 하나에 Beds24 예약이 방마다 따로 있다.
 */
const MASTER = {
  id: 93328947,
  masterId: null,
  apiReference: "5277809875",
  roomId: 708660,
  arrival: "2026-10-29",
  departure: "2026-11-01",
  status: "confirmed",
  referer: "Booking.com",
};
const CHILD = { ...MASTER, id: 93328948, masterId: 93328947, roomId: 708656 };
const BASE = "5277809875";

describe("Beds24 own booking id vs channel reference", () => {
  it("reads the Beds24 id, never the channel reference", () => {
    expect(readBeds24OwnBookingId(MASTER)).toBe("93328947");
    expect(readBeds24OwnBookingId(CHILD)).toBe("93328948");
    expect(readBeds24OwnBookingId({ bookId: 99001, apiReference: "BDC-99001" })).toBe("99001");
    expect(readBeds24OwnBookingId({ apiReference: "X" })).toBeNull();
  });

  it("reads masterId only for group children", () => {
    expect(readBeds24MasterId(MASTER)).toBeNull();
    expect(readBeds24MasterId(CHILD)).toBe("93328947");
    expect(readBeds24MasterId({ id: 5, masterId: 5 })).toBeNull();
    expect(readBeds24MasterId({ id: 5, masterId: 0 })).toBeNull();
  });

  it("keeps both group bookings when extracting candidates from one response", () => {
    const rows = extractBeds24BookingCandidates({ data: [MASTER, CHILD] });
    expect(rows.map((row) => row.id)).toEqual([93328947, 93328948]);
  });
});

describe("room move vs group sibling", () => {
  it("same Beds24 id = same booking (room move)", () => {
    expect(isSameBeds24Booking("93328947", "93328947")).toBe(true);
  });

  it("different Beds24 id with the same channel reference = different booking", () => {
    expect(isSameBeds24Booking("93328947", "93328948")).toBe(false);
  });

  it("unknown id on either side falls back to the old 'same booking' behavior", () => {
    expect(isSameBeds24Booking(null, "93328948")).toBe(true);
    expect(isSameBeds24Booking("93328947", null)).toBe(true);
  });

  it("filters sibling rows out of a channel-reference lookup", () => {
    const rows = [
      { id: "a", bookingId: "93328947" },
      { id: "b", bookingId: "93328948" },
      { id: "legacy", bookingId: null },
    ];
    expect(filterRowsOfSameBeds24Booking(rows, "93328948").map((r) => r.id)).toEqual(["b", "legacy"]);
    expect(filterRowsOfSameBeds24Booking(rows, null)).toHaveLength(3);
  });
});

describe("stored reservation key", () => {
  it("builds the plain key and keeps the channel reference as the original id", () => {
    expect(toStoredReservationId(BASE, "O309")).toBe("5277809875::room::O309");
    const suffixed = toStoredReservationId(BASE, "O309", "93328948");
    expect(suffixed).toBe("5277809875::room::O309::bid::93328948");
    expect(toOriginalReservationId(suffixed)).toBe(BASE);
  });

  it("group bookings in different rooms each get their own plain key", () => {
    const existing = [{ source_reservation_id: `${BASE}::room::O309`, bookingId: "93328947" }];
    expect(
      chooseStoredReservationId({ sourceReservationId: BASE, roomLabel: "O305", bookingId: "93328948", existingRows: existing }),
    ).toBe(`${BASE}::room::O305`);
    expect(
      chooseStoredReservationId({ sourceReservationId: BASE, roomLabel: "O309", bookingId: "93328947", existingRows: existing }),
    ).toBe(`${BASE}::room::O309`);
  });

  it("a genuine room move of one booking reuses the plain key of the new room", () => {
    const existing = [{ source_reservation_id: `${BASE}::room::O309`, bookingId: "93328947" }];
    expect(
      chooseStoredReservationId({ sourceReservationId: BASE, roomLabel: "O305", bookingId: "93328947", existingRows: existing }),
    ).toBe(`${BASE}::room::O305`);
  });

  it("two group bookings in the same room label: the second one gets the ::bid:: key", () => {
    const existing = [{ source_reservation_id: `${BASE}::room::(unknown)`, bookingId: "93328947" }];
    expect(
      chooseStoredReservationId({
        sourceReservationId: BASE,
        roomLabel: "(unknown)",
        bookingId: "93328948",
        existingRows: existing,
      }),
    ).toBe(`${BASE}::room::(unknown)::bid::93328948`);
  });

  it("keeps an existing ::bid:: row even after the plain key is freed", () => {
    const existing = [{ source_reservation_id: `${BASE}::room::101::bid::93328948`, bookingId: "93328948" }];
    expect(
      chooseStoredReservationId({ sourceReservationId: BASE, roomLabel: "101", bookingId: "93328948", existingRows: existing }),
    ).toBe(`${BASE}::room::101::bid::93328948`);
  });

  it("without a Beds24 id it keeps the old plain key behavior", () => {
    const existing = [{ source_reservation_id: `${BASE}::room::O309`, bookingId: "93328947" }];
    expect(
      chooseStoredReservationId({ sourceReservationId: BASE, roomLabel: "O309", bookingId: null, existingRows: existing }),
    ).toBe(`${BASE}::room::O309`);
  });
});

// ── 취소 경로: 최소한의 인메모리 supabase ─────────────────────────────────────────

type Row = {
  id: string;
  organization_id: string;
  source: string;
  source_reservation_id: string;
  status: Database["public"]["Enums"]["reservation_status"];
  room_label: string;
  raw_payload: Record<string, unknown> | null;
};

function fakeSupabase(rows: Row[]) {
  function project(row: Row, columns: string) {
    const out: Record<string, unknown> = {};
    for (const part of columns.split(",").map((c) => c.trim())) {
      const alias = part.match(/^(\w+):raw_payload->>(\w+)$/);
      if (alias) {
        const value = row.raw_payload?.[alias[2]];
        out[alias[1]] = value === undefined || value === null ? null : String(value);
      } else {
        out[part] = (row as Record<string, unknown>)[part];
      }
    }
    return out;
  }

  function builder() {
    const filters: Array<(row: Row) => boolean> = [];
    let mode: "select" | "update" | "delete" = "select";
    let columns = "*";
    let patch: Partial<Row> = {};
    const run = () => {
      const matched = rows.filter((row) => filters.every((f) => f(row)));
      if (mode === "update") matched.forEach((row) => Object.assign(row, patch));
      if (mode === "delete") matched.forEach((row) => rows.splice(rows.indexOf(row), 1));
      return { data: matched.map((row) => project(row, columns === "*" ? "id" : columns)), error: null };
    };
    const api = {
      select(cols: string) {
        columns = cols;
        return api;
      },
      update(value: Partial<Row>) {
        mode = "update";
        patch = value;
        return api;
      },
      delete() {
        mode = "delete";
        return api;
      },
      eq(column: keyof Row | "original_reservation_id", value: unknown) {
        // `original_reservation_id` 는 DB 생성 열(`::room::` 앞부분)이라 여기서 계산한다.
        filters.push((row) =>
          column === "original_reservation_id"
            ? row.source_reservation_id.split("::room::")[0] === value
            : row[column] === value,
        );
        return api;
      },
      in(column: keyof Row, values: unknown[]) {
        filters.push((row) => values.includes(row[column]));
        return api;
      },
      like(column: keyof Row, pattern: string) {
        const prefix = pattern.replace(/%$/, "");
        filters.push((row) => String(row[column]).startsWith(prefix));
        return api;
      },
      then(resolve: (value: ReturnType<typeof run>) => unknown) {
        return Promise.resolve(run()).then(resolve);
      },
    };
    return api;
  }

  return { from: () => builder() } as unknown as SupabaseClient<Database>;
}

function groupRows(): Row[] {
  return [
    {
      id: "row-master",
      organization_id: "org",
      source: "Booking.com",
      source_reservation_id: `${BASE}::room::O309`,
      status: "confirmed",
      room_label: "O309",
      raw_payload: MASTER,
    },
    {
      id: "row-child",
      organization_id: "org",
      source: "Booking.com",
      source_reservation_id: `${BASE}::room::O305`,
      status: "confirmed",
      room_label: "O305",
      raw_payload: CHILD,
    },
  ];
}

describe("cancelling one booking of a group", () => {
  it("lookup by channel reference + Beds24 id returns only that booking's rows", async () => {
    const supabase = fakeSupabase(groupRows());
    const all = await findReservationRowsByOriginalBookingId(supabase, "org", BASE);
    expect(all.map((r) => r.id).sort()).toEqual(["row-child", "row-master"]);
    const child = await findReservationRowsByOriginalBookingId(supabase, "org", BASE, { beds24BookingId: "93328948" });
    expect(child.map((r) => r.id)).toEqual(["row-child"]);
    expect(child[0].bookingId).toBe("93328948");
  });

  it("a cancelled child webhook cancels the child and leaves the master untouched", async () => {
    const rows = groupRows();
    const supabase = fakeSupabase(rows);
    const cancelledPayload = { ...CHILD, status: "cancelled" };

    const cancelled = await cancelReservationRowsByOriginalBookingId({
      supabase,
      organizationId: "org",
      sourceReservationId: BASE,
      beds24BookingId: "93328948",
      rawPayload: cancelledPayload,
    });
    const finalized = await finalizeCancelledBookingConsistency({
      supabase,
      organizationId: "org",
      sourceReservationId: BASE,
      beds24BookingId: "93328948",
      rawPayload: cancelledPayload,
    });

    expect(cancelled.updatedRows).toBe(1);
    expect(finalized.staleRemoved).toBe(0);
    const master = rows.find((r) => r.id === "row-master");
    const child = rows.find((r) => r.id === "row-child");
    expect(master?.status).toBe("confirmed");
    expect(master?.raw_payload).toBe(MASTER);
    expect(child?.status).toBe("cancelled");
  });

  it("cancelling the master leaves the child row alive", async () => {
    const rows = groupRows();
    const supabase = fakeSupabase(rows);
    await cancelReservationRowsByOriginalBookingId({
      supabase,
      organizationId: "org",
      sourceReservationId: BASE,
      beds24BookingId: "93328947",
      rawPayload: { ...MASTER, status: "cancelled" },
    });
    await finalizeCancelledBookingConsistency({
      supabase,
      organizationId: "org",
      sourceReservationId: BASE,
      beds24BookingId: "93328947",
      rawPayload: { ...MASTER, status: "cancelled" },
    });
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      ["row-master", "cancelled"],
      ["row-child", "confirmed"],
    ]);
  });

  it("a cancelled room-moved booking still removes its own stale active row", async () => {
    const rows: Row[] = [
      ...groupRows(),
      {
        id: "row-child-old-room",
        organization_id: "org",
        source: "Booking.com",
        source_reservation_id: `${BASE}::room::O301`,
        status: "confirmed",
        room_label: "O301",
        raw_payload: { ...CHILD, roomId: 708650 },
      },
    ];
    const supabase = fakeSupabase(rows);
    await cancelReservationRowsByOriginalBookingId({
      supabase,
      organizationId: "org",
      sourceReservationId: BASE,
      beds24BookingId: "93328948",
      rawPayload: { ...CHILD, status: "cancelled" },
    });
    const result = await finalizeCancelledBookingConsistency({
      supabase,
      organizationId: "org",
      sourceReservationId: BASE,
      beds24BookingId: "93328948",
      rawPayload: { ...CHILD, status: "cancelled" },
    });
    expect(result.activeRemaining).toBe(0);
    expect(rows.find((r) => r.id === "row-master")?.status).toBe("confirmed");
    expect(rows.filter((r) => r.id !== "row-master").every((r) => r.status === "cancelled")).toBe(true);
  });
});
