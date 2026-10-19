import { describe, expect, it } from "vitest";
import {
  buildOpsSalesSummary,
  type SalesSummaryReservation,
  type SalesSummaryRoom,
} from "@/lib/ops-sales-summary";

/*
 * 대시보드 홈(2026-10-19 속도): 요약기의 「1일 ~ 오늘」 조각을 따로 읽지 않고 **그 달 전체 읽기**(더 넓은 창)로 계산한다.
 * 창 밖 예약은 그 조각에 밤이 없어 아무것도 더하지 않으므로, 조각에서 나오는 객실 행(요약기가 저장하는 모양)이 같아야 한다.
 * `ops-revenue-server.ts` `createRevenueSummarizer` 의 행 거르기와 같은 규칙으로 비교한다.
 */

const catalog: SalesSummaryRoom[] = [
  { inCatalog: true, key: "A::101", label: "101", propertyName: "A" },
  { inCatalog: true, key: "A::102", label: "102", propertyName: "A" },
  { inCatalog: true, key: "B::201", label: "201", propertyName: "B" },
];

const reservation = (
  id: string,
  roomKey: string,
  checkIn: string,
  checkOut: string,
  price: number,
  extra: Partial<SalesSummaryReservation> = {},
): SalesSummaryReservation => ({
  checkIn,
  checkOut,
  id,
  propertyName: roomKey.split("::")[0],
  raw: { commission: Math.abs(price) / 10, price, referer: "Airbnb" },
  roomKey,
  status: "confirmed",
  ...extra,
});

const all: SalesSummaryReservation[] = [
  reservation("r1", "A::101", "2026-10-02", "2026-10-05", 30000),
  reservation("r2", "A::101", "2026-10-18", "2026-10-22", 41000), // 조각 끝을 넘는 숙박
  reservation("r3", "A::102", "2026-09-29", "2026-10-03", 52000), // 지난달에서 넘어온 숙박
  reservation("r4", "A::102", "2026-10-25", "2026-10-28", 33000), // 조각 밖(달 안)
  reservation("r5", "B::201", "2026-10-10", "2026-10-11", -9995), // 마이너스 금액
  reservation("r6", "X::999", "2026-10-26", "2026-10-29", 27000), // 목록 밖 방 · 조각 밖
  reservation("r7", "X::888", "2026-10-05", "2026-10-07", 15000), // 목록 밖 방 · 조각 안
  reservation("r8", "B::201", "2026-10-28", "2026-10-30", 0), // 0원 · 조각 밖
  reservation("r9", "B::201", "2026-10-12", "2026-10-14", 20000, { status: "cancelled" }),
];

const overlaps = (r: SalesSummaryReservation, start: string, endExclusive: string) =>
  r.checkIn < endExclusive && r.checkOut > start;

/** 읽기 함수(`readOpsSalesInputs`)처럼 — 창에 걸친 살아 있는 예약의 목록 밖 방만 행이 된다. */
function roomsFor(reservations: SalesSummaryReservation[]): SalesSummaryRoom[] {
  const rooms = [...catalog];
  for (const r of reservations) {
    if (rooms.some((room) => room.key === r.roomKey)) continue;
    if (r.status === "cancelled" || r.status === "no_show") continue;
    rooms.push({ inCatalog: false, key: r.roomKey, label: r.roomKey.split("::")[1], propertyName: r.propertyName });
  }
  return rooms;
}

type Row = { key: string } & Record<string, unknown>;

function pieceRows(reservations: SalesSummaryReservation[], start: string, endExclusive: string): Row[] {
  const summary = buildOpsSalesSummary({
    blocks: [],
    endExclusive,
    negativeAmounts: "include",
    properties: ["A", "B"],
    reservations,
    rooms: roomsFor(reservations),
    start,
    today: "2026-10-19",
  });
  const rows: Row[] = [];
  for (const property of summary.byProperty) {
    for (const room of property.rooms) {
      if (!room.inCatalog && room.revenue === 0 && room.occupiedNights === 0) continue;
      rows.push({
        availableNights: room.availableNights,
        channelRevenue: room.channelRevenue,
        commission: room.commission,
        inCatalog: room.inCatalog,
        key: room.key,
        occupiedNights: room.occupiedNights,
        property: property.propertyName,
        revenue: room.revenue,
      });
    }
  }
  return rows.sort((a, b) => a.key.localeCompare(b.key));
}

describe("대시보드 홈 — 달 일부 조각을 그 달 전체 읽기로 계산", () => {
  const monthRead = all.filter((r) => overlaps(r, "2026-10-01", "2026-11-01"));

  for (const [start, endExclusive] of [
    ["2026-10-01", "2026-10-20"],
    ["2026-10-01", "2026-10-02"],
    ["2026-10-01", "2026-11-01"],
  ] as const) {
    it(`${start} ~ ${endExclusive} 조각의 객실 행이 같다`, () => {
      const ownRead = all.filter((r) => overlaps(r, start, endExclusive));
      const rows = pieceRows(monthRead, start, endExclusive);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows).toEqual(pieceRows(ownRead, start, endExclusive));
    });
  }
});
