import { describe, expect, it } from "vitest";
import type { OpsCalendarBar, OpsCalendarDay, OpsCalendarRate, OpsCalendarRoom } from "@/lib/ops-calendar";
import {
  buildGridRowData,
  buildRowRateLookup,
  dayFlagAt,
  decodeRowRate,
  encodeDayFlags,
  encodeRowRates,
  hashString,
  reuseStableRows,
  rowGapCellKeys,
  sameOpsDays,
  rowStays,
} from "@/lib/ops-calendar-rows";
import type { OpsRoomStay } from "@/lib/ops-calendar-occupancy";

const dates = ["2026-10-01", "2026-10-02", "2026-10-03"];

function rate(partial: Partial<OpsCalendarRate>): OpsCalendarRate {
  return {
    altPrice: null,
    bookingPrice: null,
    maxStay: null,
    minStay: null,
    minStayByUnit: null,
    minStayMax: null,
    numAvail: null,
    overrideKind: null,
    price: null,
    ...partial,
  };
}

const room: OpsCalendarRoom = {
  displayRoomLabel: "402",
  key: "아라키초A::402",
  propertyName: "아라키초A",
  roomIds: ["00000000-0000-0000-0000-000000000001"],
};

const bar: OpsCalendarBar = {
  channel: "airbnb",
  checkIn: "2026-10-02",
  checkOut: "2026-10-04",
  guestName: "Guest",
  id: "r1",
  isCancelled: false,
  kind: "confirmed",
  roomKey: room.key,
};

function makeRow(overrides: { price?: number; bars?: OpsCalendarBar[]; history?: string[]; stays?: OpsRoomStay[] } = {}) {
  const rates = new Map<string, OpsCalendarRate>([
    ["2026-10-01", rate({ bookingPrice: 14800, minStay: 2, price: overrides.price ?? 10000 })],
    // 칸은 있는데 가격이 없다 — 「칸 없음」과 달라야 한다.
    ["2026-10-02", rate({ minStay: 1, minStayByUnit: [{ label: "802#", minStay: 1 }, { label: "K802", minStay: 2 }] })],
  ]);
  const history = new Set(overrides.history ?? ["2026-10-01"]);
  return buildGridRowData({
    bars: overrides.bars ?? [bar],
    blocks: [],
    dates,
    hasHistory: (date) => history.has(date),
    isGap: (date) => date === "2026-10-03",
    rateAt: (date) => rates.get(date),
    room,
    stays: overrides.stays ?? [],
  });
}

describe("ops-calendar-rows encoding", () => {
  it("round-trips rates by day index and keeps 'no cell' distinct from 'null price'", () => {
    const encoded = encodeRowRates(dates, (date) =>
      date === "2026-10-01" ? rate({ bookingPrice: 14800, minStay: 2, price: 10000 }) : date === "2026-10-02" ? rate({}) : undefined,
    );
    expect(encoded.has).toBe("110");
    expect(decodeRowRate(encoded, 0)).toEqual({ bookingPrice: 14800, minStay: 2, minStayByUnit: null, price: 10000 });
    expect(decodeRowRate(encoded, 1)).toEqual({ bookingPrice: null, minStay: null, minStayByUnit: null, price: null });
    expect(decodeRowRate(encoded, 2)).toBeUndefined();
    expect(decodeRowRate(encoded, -1)).toBeUndefined();
  });

  it("keeps per-unit min stay only for mixed cells", () => {
    const row = makeRow();
    expect(row.rates.mixed).toEqual([[1, [{ label: "802#", minStay: 1 }, { label: "K802", minStay: 2 }]]]);
    expect(decodeRowRate(row.rates, 1)?.minStayByUnit).toHaveLength(2);
    expect(decodeRowRate(row.rates, 0)?.minStayByUnit).toBeNull();
  });

  it("encodes day flags as one char per day", () => {
    const flags = encodeDayFlags(dates, (date) => date !== "2026-10-02");
    expect(flags).toBe("101");
    expect(dayFlagAt(flags, 0)).toBe(true);
    expect(dayFlagAt(flags, 1)).toBe(false);
    expect(dayFlagAt(flags, 5)).toBe(false);
  });

  it("builds a lookup and gap keys matching the old `roomKey|date` shape", () => {
    const row = makeRow();
    const lookup = buildRowRateLookup([row], dates);
    expect(lookup(room.key, "2026-10-01")?.price).toBe(10000);
    expect(lookup(room.key, "2026-10-03")).toBeUndefined();
    expect(lookup("other::1", "2026-10-01")).toBeUndefined();
    expect(lookup(room.key, "2026-11-01")).toBeUndefined();
    expect([...rowGapCellKeys([row], dates)]).toEqual([`${room.key}|2026-10-03`]);
  });
});

describe("ops-calendar-rows signature", () => {
  it("is stable for the same content and changes when anything in the row changes", () => {
    const base = makeRow().sig;
    expect(makeRow().sig).toBe(base);
    expect(makeRow({ price: 10001 }).sig).not.toBe(base);
    expect(makeRow({ history: [] }).sig).not.toBe(base);
    expect(makeRow({ bars: [{ ...bar, guestName: "Other" }] }).sig).not.toBe(base);
    expect(makeRow({ bars: [] }).sig).not.toBe(base);
    // 확정을 꺼서 막대가 없어도 점유(숙박)가 바뀌면 행이 바뀐 것이다(2026-11-26).
    expect(makeRow({ stays: [bar] }).sig).not.toBe(base);
  });

  it("keeps stays on the row and flattens them across rows", () => {
    const stay: OpsRoomStay = bar;
    const row = makeRow({ bars: [], stays: [stay] });
    expect(row.stays).toEqual([stay]);
    expect(rowStays([row, makeRow({ stays: [] })])).toEqual([stay]);
  });

  it("changes when the window moves even if the arrays look the same", () => {
    const a = buildGridRowData({
      bars: [],
      blocks: [],
      dates: ["2026-10-01"],
      hasHistory: () => false,
      isGap: () => false,
      rateAt: () => undefined,
      room,
      stays: [],
    });
    const b = buildGridRowData({
      bars: [],
      blocks: [],
      dates: ["2026-10-02"],
      hasHistory: () => false,
      isGap: () => false,
      rateAt: () => undefined,
      room,
      stays: [],
    });
    expect(a.sig).not.toBe(b.sig);
  });

  it("hashString is deterministic and short", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
    expect(hashString("x".repeat(10_000)).length).toBeLessThanOrEqual(11);
  });
});

describe("reuseStableRows", () => {
  it("returns the previous array when every row is unchanged", () => {
    const previous = [makeRow()];
    const next = [makeRow()];
    expect(next[0]).not.toBe(previous[0]);
    expect(reuseStableRows(previous, next)).toBe(previous);
  });

  it("reuses unchanged rows by room key and swaps in changed ones", () => {
    const other = { ...makeRow(), room: { ...room, key: "아라키초A::501" } };
    const otherSigged = { ...other, sig: "other" };
    const previous = [makeRow(), otherSigged];
    const changed = makeRow({ price: 20000 });
    const result = reuseStableRows(previous, [changed, { ...otherSigged }]);
    expect(result).not.toBe(previous);
    expect(result[0]).toBe(changed);
    expect(result[1]).toBe(previous[1]);
  });

  it("follows the new order and length", () => {
    const a = makeRow();
    const b = { ...makeRow(), room: { ...room, key: "B" }, sig: "b" };
    const result = reuseStableRows([a, b], [{ ...b }, makeRow()]);
    expect(result[0]).toBe(b);
    expect(result[1]).toBe(a);
    expect(reuseStableRows([a, b], [makeRow()])).toEqual([a]);
  });
});

describe("sameOpsDays", () => {
  const day = (date: string, isToday = false): OpsCalendarDay => ({
    date,
    day: Number(date.slice(8)),
    isToday,
    isWeekend: false,
    startsMonth: false,
    weekday: 1,
  });
  it("compares by content", () => {
    expect(sameOpsDays([day("2026-10-01")], [day("2026-10-01")])).toBe(true);
    expect(sameOpsDays([day("2026-10-01")], [day("2026-10-01", true)])).toBe(false);
    expect(sameOpsDays([day("2026-10-01")], [day("2026-10-02")])).toBe(false);
    expect(sameOpsDays([day("2026-10-01")], [])).toBe(false);
  });
});
