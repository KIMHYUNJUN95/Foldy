import { describe, expect, it } from "vitest";
import {
  buildOpsSalesSummary,
  combineSalesSummary,
  defaultSalesExcluded,
  isLegacyConfirmedStatus,
  isSalesCountedReservation,
  legacyChannelKey,
  legacyMoney,
  legacyPlatform,
  legacyReservationAmount,
  type SalesRawPayload,
  type SalesSummaryBlock,
  type SalesSummaryReservation,
  type SalesSummaryRoom,
} from "@/lib/ops-sales-summary";

/*
 * ── 저쪽 코드 이식 (대조용) ──────────────────────────────────────────────
 *
 * STAY ARI Manager `src/components/BuildingCalendar.jsx` 의 함수를 **식 그대로** 옮겼다. dayjs 대신 UTC
 * 날짜 숫자를 쓰는 것만 다르다(날짜 문자열만 다루므로 결과가 같다). 저쪽 예약 객체 모양(`room`,
 * `status: "confirmed"`, `totalPrice`, `commission`, `referer` …)을 그대로 받는다.
 */
type LegacyReservation = {
  room: string;
  building: string;
  status: string;
  arrival: string;
  departure: string;
  totalPrice?: number | string;
  price?: number | string;
  netRevenue?: number | string;
  commission?: number | string;
  referer?: string;
  referrer?: string;
  channel?: string;
  platform?: string;
  source?: string;
  apiSource?: string;
};

const DAY = 86_400_000;
const d = (s: string) => Math.floor(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY);

/** `calculateBuildingMetricsForRange` (:2837) — 오늘 재실 계산만 뺐다. */
function legacyMetricsForRange(targetReservations: LegacyReservation[], targetRooms: { name: string }[], rangeStartStr: string, rangeEndStr: string) {
  const uniqueRoomNames = [...new Set(targetRooms.map((r) => r.name))];
  const rangeStart = d(rangeStartStr);
  const rangeEnd = d(rangeEndStr);
  const rangeEndExclusive = rangeEnd + 1;
  const rangeDays = rangeEnd - rangeStart + 1;
  const occupiedSetByRoom: Record<string, Set<number>> = {};
  uniqueRoomNames.forEach((name) => {
    occupiedSetByRoom[name] = new Set();
  });
  const uniqueRoomNameSet = new Set(uniqueRoomNames);
  let totalRevenue = 0;
  targetReservations.forEach((r) => {
    if (r.status !== "confirmed" || !r.arrival || !r.departure) return;
    const inRoomCatalog = uniqueRoomNameSet.has(r.room);
    const arrivalDate = d(r.arrival);
    const departureDate = d(r.departure);
    const effectiveStart = arrivalDate > rangeStart ? arrivalDate : rangeStart;
    const effectiveEnd = departureDate < rangeEndExclusive ? departureDate : rangeEndExclusive;
    if (!(effectiveEnd > effectiveStart)) return;
    if (inRoomCatalog) {
      const roomSet = occupiedSetByRoom[r.room];
      for (let x = effectiveStart; x < effectiveEnd; x += 1) roomSet.add(x);
    }
    const visibleNights = effectiveEnd - effectiveStart;
    const totalReservationNights = Math.max(1, departureDate - arrivalDate);
    const val = parseFloat(String(r.totalPrice)) || parseFloat(String(r.price)) || parseFloat(String(r.netRevenue)) || 0;
    if (val > 0 && totalReservationNights > 0) totalRevenue += (val / totalReservationNights) * visibleNights;
  });
  let occupiedSlot = 0;
  uniqueRoomNames.forEach((name) => {
    occupiedSlot += occupiedSetByRoom[name].size;
  });
  const totalSlot = uniqueRoomNames.length * rangeDays;
  return {
    availableDays: totalSlot,
    avgPrice: occupiedSlot > 0 ? totalRevenue / occupiedSlot : 0,
    occupancyRate: totalSlot > 0 ? (occupiedSlot / totalSlot) * 100 : 0,
    occupiedDays: occupiedSlot,
    totalRevenue,
    vacantNights: Math.max(0, totalSlot - occupiedSlot),
  };
}

function legacyChannel(reservation: LegacyReservation) {
  const source = [reservation.referer, reservation.referrer, reservation.channel, reservation.platform, reservation.source, reservation.apiSource]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (source.includes("airbnb")) return "airbnb";
  if (source.includes("booking")) return "booking";
  if (source.includes("direct") || source.includes("manual")) return "direct";
  return "other";
}

/** `calculateCommissionSummary` (:2962). */
function legacyCommission(targetReservations: LegacyReservation[], firstDate: string, lastDate: string) {
  const rangeStart = d(firstDate);
  const rangeEnd = d(lastDate) + 1;
  const summary = { airbnb: 0, booking: 0 };
  targetReservations.forEach((reservation) => {
    if (reservation.status !== "confirmed" || !reservation.arrival || !reservation.departure) return;
    const channelKey = legacyChannel(reservation);
    if (channelKey !== "airbnb" && channelKey !== "booking") return;
    const commission = legacyMoney(reservation.commission);
    if (commission <= 0) return;
    const arrivalDate = d(reservation.arrival);
    const departureDate = d(reservation.departure);
    const totalReservationNights = Math.max(1, departureDate - arrivalDate);
    const effectiveStart = arrivalDate > rangeStart ? arrivalDate : rangeStart;
    const effectiveEnd = departureDate < rangeEnd ? departureDate : rangeEnd;
    const visibleNights = effectiveEnd - effectiveStart;
    if (visibleNights <= 0) return;
    summary[channelKey] += (commission / totalReservationNights) * visibleNights;
  });
  return { ...summary, total: summary.airbnb + summary.booking };
}

/** `calculateArrivalCountSummary` (:2998). */
function legacyArrivals(targetReservations: LegacyReservation[], firstDate: string, lastDate: string) {
  const rangeStart = d(firstDate);
  const rangeEnd = d(lastDate) + 1;
  const summary = { airbnb: 0, booking: 0, direct: 0 };
  targetReservations.forEach((reservation) => {
    if (reservation.status !== "confirmed" || !reservation.arrival) return;
    const arrivalDate = d(reservation.arrival);
    if (arrivalDate < rangeStart || !(arrivalDate < rangeEnd)) return;
    const channelKey = legacyChannel(reservation);
    if (channelKey !== "airbnb" && channelKey !== "booking" && channelKey !== "direct") return;
    summary[channelKey] += 1;
  });
  return summary;
}

/** `futureVacancySummary` (:6600). 차단은 저쪽에서 `status: "blackout"` 예약으로 들어온다. */
function legacyFutureVacancy(reservations: LegacyReservation[], rooms: string[], visibleDates: string[], todayStr: string) {
  const futureDays = visibleDates.filter((date) => date >= todayStr);
  let vacantRoomNights = 0;
  futureDays.forEach((dateStr) => {
    rooms.forEach((room) => {
      const isUnavailable = reservations.some(
        (reservation) =>
          reservation.room === room &&
          reservation.status !== "cancelled" &&
          reservation.status !== "inquiry" &&
          dateStr >= reservation.arrival &&
          dateStr < reservation.departure,
      );
      if (!isUnavailable) vacantRoomNights += 1;
    });
  });
  return { totalRoomNights: futureDays.length * rooms.length, vacantRoomNights };
}

// ── 고정 데이터 ─────────────────────────────────────────────────────────

function room(key: string, propertyName = "A", inCatalog = true): SalesSummaryRoom {
  return { inCatalog, key, propertyName };
}

function booking(
  id: string,
  roomKey: string,
  checkIn: string,
  checkOut: string,
  raw: SalesRawPayload,
  extra: Partial<SalesSummaryReservation> = {},
): SalesSummaryReservation {
  return { checkIn, checkOut, id, propertyName: roomKey.split("::")[0], raw, roomKey, status: "confirmed", ...extra };
}

const AIRBNB = { channel: "airbnb", referer: "Airbnb", status: "new" };
const BOOKING = { channel: "booking", referer: "Booking.com", status: "new" };
const DIRECT = { channel: "direct", referer: "Isuhyun123", status: "confirmed" };

describe("legacy helpers", () => {
  it("reads money like cleanPrice/parseMoneyAmount", () => {
    expect(legacyMoney(12000)).toBe(12000);
    expect(legacyMoney("¥12,000")).toBe(12000);
    expect(legacyMoney(null)).toBe(0);
    expect(legacyMoney("abc")).toBe(0);
    expect(legacyMoney(Number.NaN)).toBe(0);
  });

  it("only 1/2/new/confirmed are confirmed (determineStatus)", () => {
    for (const value of ["new", "confirmed", "NEW", 1, 2, "1"]) expect(isLegacyConfirmedStatus(value)).toBe(true);
    for (const value of ["request", "inquiry", "enquiry", "black", "cancelled", 0, "0", undefined]) {
      expect(isLegacyConfirmedStatus(value)).toBe(false);
    }
  });

  it("counts no-show (legacy ignores subStatus) but never a cancelled row", () => {
    expect(isSalesCountedReservation({ raw: { status: "new" }, status: "no_show" })).toBe(true);
    expect(isSalesCountedReservation({ raw: { status: "confirmed" }, status: "cancelled" })).toBe(false);
    expect(isSalesCountedReservation({ raw: { status: "request" }, status: "confirmed" })).toBe(false);
    // 가격 개입 전환이 이 필터를 같이 씀(2026-10-28) — 운영에 raw inquiry 인데 status confirmed 인 줄이 실제로 있다.
    expect(isSalesCountedReservation({ raw: { status: "inquiry" }, status: "confirmed" })).toBe(false);
    expect(isSalesCountedReservation({ raw: { status: "black" }, status: "confirmed" })).toBe(false);
    expect(isSalesCountedReservation({ raw: {}, status: "confirmed" })).toBe(true);
  });

  it("amount = invoiceItems sum → price → amount", () => {
    expect(legacyReservationAmount({ invoiceItems: [{ amount: 1000 }, { amount: "2,000" }], price: 9 })).toBe(3000);
    expect(legacyReservationAmount({ price: 31404 })).toBe(31404);
    expect(legacyReservationAmount({ amount: 500, price: 0 })).toBe(500);
    expect(legacyReservationAmount({})).toBe(0);
  });

  it("classifies channels like getReservationChannelKey (+ stored platform)", () => {
    expect(legacyChannelKey(AIRBNB)).toBe("airbnb");
    expect(legacyChannelKey(BOOKING)).toBe("booking");
    expect(legacyChannelKey(DIRECT)).toBe("direct");
    expect(legacyChannelKey({ apiSource: "Manual", referer: "HARU-WEB" })).toBe("direct");
    // 저쪽 `platform` 기본값이 Airbnb 라, 아무 단서도 없는 예약은 Airbnb 로 분류된다(그대로 재현).
    expect(legacyChannelKey({ referer: "Expedia" })).toBe("other");
    expect(legacyChannelKey({})).toBe("airbnb");
  });
});

describe("buildOpsSalesSummary", () => {
  const W = { endExclusive: "2026-10-01", start: "2026-09-01", today: "2026-09-15" };

  it("allocates revenue per night and clips to the window", () => {
    const summary = buildOpsSalesSummary({
      ...W,
      blocks: [],
      reservations: [
        // 8/30 ~ 9/3 = 4박 중 9/1·9/2 두 밤이 창 안 → 40,000 × 2/4
        booking("r1", "A::101", "2026-08-30", "2026-09-03", { ...AIRBNB, commission: 6000, price: 40000 }),
        // 9/29 ~ 10/2 = 3박 중 2밤 → 30,000 × 2/3
        booking("r2", "A::102", "2026-09-29", "2026-10-02", { ...BOOKING, commission: 4500, price: 30000 }),
      ],
      rooms: [room("A::101"), room("A::102")],
    });
    expect(summary.totals.revenue).toBeCloseTo(20000 + 20000, 6);
    expect(summary.totals.commission).toBeCloseTo(3000 + 3000, 6);
    expect(summary.totals.net).toBeCloseTo(34000, 6);
    expect(summary.totals.occupiedNights).toBe(4);
    expect(summary.totals.availableNights).toBe(60);
    expect(summary.totals.vacantNights).toBe(56);
    expect(summary.totals.occupancyPct).toBeCloseTo((4 / 60) * 100, 9);
    expect(summary.totals.adr).toBeCloseTo(10000, 6);
    expect(summary.totals.revpar).toBeCloseTo(40000 / 60, 6);
    // 체크인이 창 안인 것만 — r1 은 8/30 체크인이라 안 센다.
    expect(summary.byChannel.find((row) => row.channel === "airbnb")?.arrivals).toBe(0);
    expect(summary.byChannel.find((row) => row.channel === "booking")?.arrivals).toBe(1);
  });

  it("negative amounts — skipped by default (calendar card), subtracted with include (revenue screen, 2026-10-07)", () => {
    const input = {
      ...W,
      blocks: [],
      reservations: [
        booking("r1", "A::101", "2026-09-01", "2026-09-03", { ...AIRBNB, price: 40000 }),
        // 직원이 넣은 조정 예약 −9,996 엔(2025-07 아라키초B 실례) — 2박
        booking("r2", "A::102", "2026-09-05", "2026-09-07", { ...DIRECT, price: -9996 }),
      ],
      rooms: [room("A::101"), room("A::102")],
    };
    const skip = buildOpsSalesSummary(input);
    expect(skip.totals.revenue).toBeCloseTo(40000, 6);
    expect(skip.zeroPriceCount).toBe(1);
    const include = buildOpsSalesSummary({ ...input, negativeAmounts: "include" });
    expect(include.totals.revenue).toBeCloseTo(40000 - 9996, 6);
    expect(include.zeroPriceCount).toBe(0);
    // 점유는 두 쪽 다 같다 — 확정 예약이면 판 밤이다.
    expect(include.totals.occupiedNights).toBe(4);
    expect(skip.totals.occupiedNights).toBe(4);
  });

  it("excludes cancelled / request, keeps no-show and 0-yen as occupied (legacy)", () => {
    const summary = buildOpsSalesSummary({
      ...W,
      blocks: [],
      reservations: [
        booking("c", "A::101", "2026-09-05", "2026-09-07", { ...AIRBNB, price: 50000, status: "cancelled" }, { status: "cancelled" }),
        booking("q", "A::101", "2026-09-10", "2026-09-12", { ...AIRBNB, price: 50000, status: "request" }),
        booking("ns", "A::101", "2026-09-20", "2026-09-22", { ...AIRBNB, price: 20000 }, { status: "no_show" }),
        booking("z", "A::101", "2026-09-25", "2026-09-26", { ...DIRECT, price: 0 }),
      ],
      rooms: [room("A::101")],
    });
    expect(summary.totals.revenue).toBe(20000);
    expect(summary.totals.occupiedNights).toBe(3);
    expect(summary.totals.adr).toBeCloseTo(20000 / 3, 6);
    expect(summary.zeroPriceCount).toBe(1);
    expect(summary.reservationCount).toBe(2);
  });

  it("commission only for Airbnb / Booking.com", () => {
    const summary = buildOpsSalesSummary({
      ...W,
      blocks: [],
      reservations: [booking("d", "A::101", "2026-09-05", "2026-09-07", { ...DIRECT, commission: 999, price: 10000 })],
      rooms: [room("A::101")],
    });
    expect(summary.totals.commission).toBe(0);
    expect(summary.byChannel.find((row) => row.channel === "direct")?.revenue).toBe(10000);
  });

  it("overlapping bookings in one room count as one night; off-catalog rooms add revenue only", () => {
    const summary = buildOpsSalesSummary({
      ...W,
      blocks: [],
      reservations: [
        booking("a", "A::101", "2026-09-05", "2026-09-08", { ...AIRBNB, price: 30000 }),
        booking("b", "A::101", "2026-09-06", "2026-09-07", { ...BOOKING, price: 10000 }),
        booking("x", "A::999", "2026-09-06", "2026-09-07", { ...BOOKING, price: 5000 }),
      ],
      rooms: [room("A::101"), room("A::999", "A", false)],
    });
    expect(summary.totals.occupiedNights).toBe(3);
    expect(summary.totals.roomCount).toBe(1);
    expect(summary.totals.revenue).toBe(45000);
  });

  it("blocked nights stay in the denominator and count as vacant; future vacancy excludes them", () => {
    const blocks: SalesSummaryBlock[] = [{ endDate: "2026-09-20", roomKey: "A::101", startDate: "2026-09-16" }];
    const summary = buildOpsSalesSummary({
      ...W,
      blocks,
      reservations: [booking("a", "A::101", "2026-09-14", "2026-09-16", { ...AIRBNB, price: 20000 })],
      rooms: [room("A::101")],
    });
    expect(summary.totals.availableNights).toBe(30);
    expect(summary.totals.vacantNights).toBe(28);
    // 오늘(9/15)~9/30 = 16일. 9/15 예약 · 9/16~20 차단(5) → 16 − 6 = 10.
    expect(summary.futureVacancy).toEqual({ days: 16, totalNights: 16, vacantNights: 10 });
  });

  it("splits by property in the given order and keeps totals weighted", () => {
    const summary = buildOpsSalesSummary({
      ...W,
      blocks: [],
      properties: ["B", "A"],
      reservations: [
        booking("a", "A::101", "2026-09-05", "2026-09-06", { ...AIRBNB, price: 10000 }),
        booking("b1", "B::1", "2026-09-05", "2026-09-06", { ...AIRBNB, price: 30000 }),
        booking("b2", "B::1", "2026-09-06", "2026-09-07", { ...AIRBNB, price: 30000 }),
      ],
      rooms: [room("A::101"), room("B::1", "B")],
    });
    expect(summary.byProperty.map((row) => row.propertyName)).toEqual(["B", "A"]);
    expect(summary.byProperty[0].adr).toBe(30000);
    expect(summary.byProperty[1].adr).toBe(10000);
    expect(summary.totals.adr).toBeCloseTo(70000 / 3, 6);
    // 저쪽 포트폴리오 Grand Total 은 건물 ADR 의 단순 평균.
    expect(summary.legacyPortfolioMeanAdr).toBe(20000);
  });

  it("rejects malformed windows", () => {
    expect(() => buildOpsSalesSummary({ ...W, blocks: [], reservations: [], rooms: [], start: "2026/09/01" })).toThrow();
  });
});

// ── 무작위 대조 ─────────────────────────────────────────────────────────

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function addDays(date: string, n: number) {
  return new Date((d(date) + n) * DAY).toISOString().slice(0, 10);
}

describe("cross-check against the legacy functions (random fixtures)", () => {
  for (const seed of [1, 7, 42, 2026, 9999]) {
    it(`seed ${seed}`, () => {
      const random = rng(seed);
      const start = "2026-10-01";
      const endExclusive = random() < 0.5 ? "2026-10-31" : "2026-11-01";
      const lastDate = addDays(endExclusive, -1);
      const today = addDays(start, Math.floor(random() * 40) - 5);
      const roomNames = ["101", "102", "201", "202", "301"];
      const catalogNames = roomNames.slice(0, 4); // 301 은 목록 밖
      const statuses = ["new", "confirmed", "cancelled", "request", "black"];
      const channelRaws = [AIRBNB, BOOKING, DIRECT, { referer: "Expedia" }, { apiSource: "Manual", referer: "x" }];

      const ours: SalesSummaryReservation[] = [];
      const legacy: LegacyReservation[] = [];
      for (let index = 0; index < 60; index += 1) {
        const name = roomNames[Math.floor(random() * roomNames.length)];
        const checkIn = addDays(start, Math.floor(random() * 50) - 15);
        const nights = 1 + Math.floor(random() * 7);
        const checkOut = addDays(checkIn, nights);
        const rawStatus = statuses[Math.floor(random() * statuses.length)];
        const channelRaw = channelRaws[Math.floor(random() * channelRaws.length)];
        const price = random() < 0.1 ? 0 : Math.round(8000 + random() * 90000);
        const commission = Math.round(price * (0.1 + random() * 0.1));
        const raw = { ...channelRaw, commission, price, status: rawStatus };
        ours.push(booking(`r${index}`, `A::${name}`, checkIn, checkOut, raw, {
          status: rawStatus === "cancelled" ? "cancelled" : "confirmed",
        }));
        const legacyStatus = isLegacyConfirmedStatus(rawStatus)
          ? "confirmed"
          : rawStatus === "request"
            ? "inquiry"
            : rawStatus === "black"
              ? "blackout"
              : "cancelled";
        legacy.push({
          ...channelRaw,
          arrival: checkIn,
          building: "A",
          commission,
          departure: checkOut,
          platform: legacyPlatform(channelRaw),
          price,
          room: name,
          status: legacyStatus,
          totalPrice: price,
        });
      }
      // 차단 — 저쪽에서는 `blackout` 상태의 예약 문서다.
      const blocks: SalesSummaryBlock[] = [];
      for (let index = 0; index < 4; index += 1) {
        const name = catalogNames[Math.floor(random() * catalogNames.length)];
        const startDate = addDays(start, Math.floor(random() * 30));
        const endDate = addDays(startDate, Math.floor(random() * 4));
        blocks.push({ endDate, roomKey: `A::${name}`, startDate });
        legacy.push({ arrival: startDate, building: "A", departure: addDays(endDate, 1), room: name, status: "blackout" });
      }

      const summary = buildOpsSalesSummary({
        blocks,
        endExclusive,
        reservations: ours,
        rooms: roomNames.map((name) => room(`A::${name}`, "A", catalogNames.includes(name))),
        start,
        today,
      });
      const expected = legacyMetricsForRange(legacy, catalogNames.map((name) => ({ name })), start, lastDate);
      expect(summary.totals.revenue).toBeCloseTo(expected.totalRevenue, 6);
      expect(summary.totals.occupiedNights).toBe(expected.occupiedDays);
      expect(summary.totals.availableNights).toBe(expected.availableDays);
      expect(summary.totals.vacantNights).toBe(expected.vacantNights);
      expect(summary.totals.occupancyPct).toBeCloseTo(expected.occupancyRate, 9);
      expect(summary.totals.adr).toBeCloseTo(expected.avgPrice, 6);

      const commission = legacyCommission(legacy, start, lastDate);
      expect(summary.byChannel.find((row) => row.channel === "airbnb")!.commission).toBeCloseTo(commission.airbnb, 6);
      expect(summary.byChannel.find((row) => row.channel === "booking")!.commission).toBeCloseTo(commission.booking, 6);
      expect(summary.totals.commission).toBeCloseTo(commission.total, 6);

      const arrivals = legacyArrivals(legacy, start, lastDate);
      for (const channel of ["airbnb", "booking", "direct"] as const) {
        expect(summary.byChannel.find((row) => row.channel === channel)!.arrivals).toBe(arrivals[channel]);
      }

      const visibleDates: string[] = [];
      for (let date = start; date < endExclusive; date = addDays(date, 1)) visibleDates.push(date);
      const future = legacyFutureVacancy(legacy, catalogNames, visibleDates, today);
      expect(summary.futureVacancy.vacantNights).toBe(future.vacantRoomNights);
      expect(summary.futureVacancy.totalNights).toBe(future.totalRoomNights);
    });
  }
});

describe("per-room / per-building consistency", () => {
  const summary = buildOpsSalesSummary({
    blocks: [{ endDate: "2026-09-12", roomKey: "B::201", startDate: "2026-09-10" }],
    endExclusive: "2026-10-01",
    properties: ["A", "B"],
    reservations: [
      booking("a1", "A::101", "2026-08-30", "2026-09-04", { ...AIRBNB, commission: 7000, price: 50000 }),
      booking("a2", "A::102", "2026-09-10", "2026-09-13", { ...BOOKING, commission: 5400, price: 36000 }),
      booking("a3", "A::102", "2026-09-12", "2026-09-14", { ...DIRECT, price: 20000 }),
      booking("b1", "B::201", "2026-09-20", "2026-10-03", { ...AIRBNB, commission: 26000, price: 130000 }),
      booking("b2", "B::202", "2026-09-01", "2026-09-02", { ...BOOKING, price: 0 }),
      // 목록 밖 방 — 매출만.
      booking("x", "B::999", "2026-09-05", "2026-09-06", { ...AIRBNB, price: 9000 }),
    ],
    rooms: [
      { inCatalog: true, key: "A::101", label: "101", propertyName: "A" },
      { inCatalog: true, key: "A::102", label: "102", propertyName: "A" },
      { inCatalog: true, key: "B::201", label: "201", propertyName: "B" },
      { inCatalog: true, key: "B::202", label: "202", propertyName: "B" },
      { inCatalog: false, key: "B::999", label: "999", propertyName: "B" },
    ],
    start: "2026-09-01",
    today: "2026-09-15",
  });

  it("every building with catalog rooms has non-zero rooms and room-nights", () => {
    for (const row of summary.byProperty) {
      expect(row.roomCount).toBeGreaterThan(0);
      expect(row.availableNights).toBe(row.roomCount * summary.days);
      expect(row.occupancyPct).toBeGreaterThan(0);
    }
  });

  it("building = sum of its rooms, total = sum of buildings", () => {
    const keys = ["roomCount", "revenue", "commission", "occupiedNights", "availableNights", "vacantNights"] as const;
    for (const row of summary.byProperty) {
      for (const key of keys) {
        expect(row.rooms.reduce((sum, room) => sum + room[key], 0)).toBeCloseTo(row[key], 6);
      }
    }
    for (const key of keys) {
      expect(summary.byProperty.reduce((sum, row) => sum + row[key], 0)).toBeCloseTo(summary.totals[key], 6);
    }
    const totalOcc =
      (summary.byProperty.reduce((sum, row) => sum + row.occupiedNights, 0) /
        summary.byProperty.reduce((sum, row) => sum + row.availableNights, 0)) *
      100;
    expect(summary.totals.occupancyPct).toBeCloseTo(totalOcc, 9);
  });

  it("rooms keep the calendar row order and labels; off-catalog rooms carry revenue only", () => {
    expect(summary.byProperty.map((row) => row.propertyName)).toEqual(["A", "B"]);
    expect(summary.byProperty[1].rooms.map((room) => room.label)).toEqual(["201", "202", "999"]);
    const offCatalog = summary.byProperty[1].rooms[2];
    expect(offCatalog).toMatchObject({ availableNights: 0, inCatalog: false, occupiedNights: 0, revenue: 9000, roomCount: 0 });
    // 102: a2 가 10·11·12일 밤, a3 가 12·13일 밤 — 12일은 겹쳐 한 번만 → 4밤.
    expect(summary.byProperty[0].rooms[1].occupiedNights).toBe(4);
  });

  it("combining every building reproduces the totals; one building = that building", () => {
    const all = combineSalesSummary(summary, () => true);
    expect(all.reservationCount).toBe(summary.reservationCount);
    expect(all.zeroPriceCount).toBe(summary.zeroPriceCount);
    expect(all.futureVacancy).toEqual(summary.futureVacancy);
    for (const key of ["revenue", "commission", "occupiedNights", "availableNights", "occupancyPct", "adr", "revpar"] as const) {
      expect(all.totals[key]).toBeCloseTo(summary.totals[key], 6);
    }
    for (const [index, row] of all.byChannel.entries()) {
      const legacy = summary.byChannel[index];
      expect(row.channel).toBe(legacy.channel);
      for (const key of ["revenue", "commission", "net", "nights", "arrivals"] as const) {
        expect(row[key]).toBeCloseTo(legacy[key], 6);
      }
    }
    const onlyA = combineSalesSummary(summary, (name) => name === "A");
    const a = summary.byProperty[0];
    expect(onlyA.totals.revenue).toBeCloseTo(a.revenue, 6);
    expect(onlyA.totals.occupancyPct).toBeCloseTo(a.occupancyPct, 9);
    expect(onlyA.reservationCount).toBe(3);
    expect(onlyA.byChannel.reduce((sum, row) => sum + row.revenue, 0)).toBeCloseTo(a.revenue, 6);
  });

  it("room channel revenue adds up to the room revenue and the building channel rows", () => {
    for (const row of summary.byProperty) {
      for (const room of row.rooms) {
        const sum = Object.values(room.channelRevenue).reduce((acc, value) => acc + value, 0);
        expect(sum).toBeCloseTo(room.revenue, 6);
      }
      for (const channel of row.channels) {
        expect(row.rooms.reduce((acc, room) => acc + room.channelRevenue[channel.channel], 0)).toBeCloseTo(channel.revenue, 6);
      }
    }
    // 102: Booking 36,000 + 직접 20,000.
    expect(summary.byProperty[0].rooms[1].channelRevenue).toMatchObject({ booking: 36000, direct: 20000 });
  });

  it("totals match the legacy numbers for the same fixture", () => {
    // 101: 50,000 × 3/5 = 30,000 · 102: 36,000 + 20,000 · 201: 130,000 × 11/13 · 999: 9,000
    expect(summary.totals.revenue).toBeCloseTo(30000 + 56000 + (130000 * 11) / 13 + 9000, 6);
    expect(summary.totals.commission).toBeCloseTo(7000 * (3 / 5) + 5400 + (26000 * 11) / 13, 6);
    expect(summary.totals.roomCount).toBe(4);
  });
});

describe("defaultSalesExcluded", () => {
  it("drops 오쿠보A · 사노 from totals only when other buildings are in view", () => {
    expect(defaultSalesExcluded(["아라키초A", "오쿠보A", "Sano", "오쿠보B"])).toEqual(["오쿠보A", "Sano"]);
    expect(defaultSalesExcluded(["오쿠보A"])).toEqual([]);
    expect(defaultSalesExcluded(["아라키초A"])).toEqual([]);
  });
});
