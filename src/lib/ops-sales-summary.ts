/**
 * 판매 캘린더 「매출 요약」 — 보고 있는 창 × 고른 건물의 매출·수수료·가동률·ADR·빈방. **순수하다.**
 *
 * 도메인 계약: docs/product/34-metrics-and-automation.md 「매출 요약 모달 — 쓰는 식」
 *              docs/product/33-calendar-write-features.md 「매출 요약」
 *
 * ## 저쪽 숫자를 그대로 재현한다 (2026-09-30 사용자 결정 1)
 *
 * 차단일을 분모에 두는 것, 노쇼·0원을 점유로 보는 것까지 **고치지 않는다.** 저쪽 화면마다 식이 다를
 * 때는(결정 2) 이 모달과 쓰임이 가장 가까운 **저쪽 건물 캘린더의 분석 카드**를 따른다 —
 * STAY ARI Manager `src/components/BuildingCalendar.jsx`:
 *
 * | 여기 | 저쪽 |
 * | --- | --- |
 * | 매출 · 가동률 · 빈방(창 전체) · ADR | `calculateBuildingMetricsForRange` (:2837) — 월 뷰의 `calculateBuildingMetrics` (:2751) 와 같은 식을 **임의 창**으로 |
 * | 수수료 | `calculateCommissionSummary` (:2962) |
 * | 채널 분류 | `getReservationChannelKey` (:2946) — 저쪽 저장 필드 `platform` 은 `functions/index.js` `normalize` (:1365) |
 * | 체크인 예약 수 | `calculateArrivalCountSummary` (:2998) |
 * | 오늘 이후 빈방 | `futureVacancySummary` (:6600) |
 * | RevPAR | 화면에는 없다 — `functions/modules/revenueDashboardData.js` (:312) `revenue ÷ totalRoomNights` |
 * | 「확정」 판정 | `functions/index.js` `determineStatus` (:1196) |
 * | 금액 | `functions/index.js` `normalize` (:1392-1404) → 화면 `totalPrice \|\| price \|\| netRevenue` |
 */

import { getCanonicalPropertyName } from "@/lib/room-label-normalization";

export type SalesChannel = "airbnb" | "booking" | "direct" | "other";

export const SALES_CHANNELS: readonly SalesChannel[] = ["airbnb", "booking", "direct", "other"];

/** 이 요약이 읽는 Beds24 원본 필드(`reservations.raw_payload`)만. */
export type SalesRawPayload = {
  status?: unknown;
  price?: unknown;
  amount?: unknown;
  commission?: unknown;
  invoiceItems?: unknown;
  referer?: unknown;
  referrer?: unknown;
  channel?: unknown;
  apiSource?: unknown;
  subSource?: unknown;
  source?: unknown;
};

export type SalesSummaryRoom = {
  key: string;
  propertyName: string;
  /**
   * 객실 목록(카탈로그)에 있는 방인가. **가동률 분모·분자는 목록의 방만** 센다 — 저쪽도 하드코딩된 객실
   * 목록(`BUILDING_ROOMS`)만 세고, 목록 밖 방의 예약은 **매출에만** 넣는다(`inRoomCatalog`, :2873·2894).
   */
  inCatalog: boolean;
  /** 캘린더 행에 보이는 객실 이름(듀얼 유닛은 격자처럼 한 행). 없으면 키에서 뗀다. */
  label?: string;
};

export type SalesSummaryReservation = {
  id: string;
  roomKey: string;
  propertyName: string;
  checkIn: string;
  checkOut: string;
  /** 우리 표의 상태(`confirmed` / `cancelled` / `no_show` …). */
  status: string;
  raw: SalesRawPayload;
};

/** 차단(양끝 포함). 가동률에는 **안 쓴다** — 오늘 이후 빈방에서만 「못 파는 밤」으로 뺀다. */
export type SalesSummaryBlock = { roomKey: string; startDate: string; endDate: string };

export type SalesMetrics = {
  /** 객실 목록의 방 수. */
  roomCount: number;
  /** 총매출(수수료 포함, 엔 — 반올림 전). */
  revenue: number;
  /** 수수료 합(Airbnb · Booking.com 만). */
  commission: number;
  /** 총매출 − 수수료. */
  net: number;
  /** 판매 객실박(방별 날짜 중복 제거). */
  occupiedNights: number;
  /** 전체 객실박 = 방 수 × 창 일수. **차단일도 들어 있다.** */
  availableNights: number;
  /** 빈 객실박 = 전체 − 판매. 차단한 밤도 빈방으로 센다. */
  vacantNights: number;
  /** 0~100. */
  occupancyPct: number;
  /** 매출 ÷ 판매 객실박. */
  adr: number;
  /** 매출 ÷ 전체 객실박. */
  revpar: number;
};

export type SalesChannelRow = {
  channel: SalesChannel;
  revenue: number;
  commission: number;
  net: number;
  /** 창 안 판매 객실박(그 채널 예약이 창에 걸친 밤 수 — 방별 중복 제거 전). */
  nights: number;
  /** 체크인이 창 안인 예약 수. */
  arrivals: number;
};

/** 객실 한 행. `inCatalog` 가 아니면 방 수 0 — 매출만 있고 가동률은 비운다. */
export type SalesRoomRow = SalesMetrics & {
  key: string;
  label: string;
  inCatalog: boolean;
  /** 채널별 매출(1박 분배 후) — 객실 줄의 「채널 비중」 막대(2026-10-05). 합 = `revenue`. */
  channelRevenue: Record<SalesChannel, number>;
};

const emptyChannelRevenue = (): Record<SalesChannel, number> => ({ airbnb: 0, booking: 0, direct: 0, other: 0 });

/** 건물 한 줄 = **그 건물 객실 행의 합**(구성상 항상 맞는다). 객실은 캘린더 행 순서. */
export type SalesPropertyRow = SalesMetrics & {
  propertyName: string;
  rooms: SalesRoomRow[];
  /**
   * 이 건물 몫의 채널 행 · 오늘 이후 빈방 · 예약 수 · 0원 수 — **합계에 넣을 건물을 고르면**(`combineSalesSummary`)
   * 전체 숫자를 고른 건물만으로 다시 더하는 재료다(2026-10-05). 모든 건물을 더하면 `totals` · `byChannel` 과 같다.
   */
  channels: SalesChannelRow[];
  futureVacantNights: number;
  futureTotalNights: number;
  reservationCount: number;
  zeroPriceCount: number;
};

export type OpsSalesSummary = {
  start: string;
  endExclusive: string;
  days: number;
  totals: SalesMetrics;
  byProperty: SalesPropertyRow[];
  byChannel: SalesChannelRow[];
  /** 저쪽 「Future Vacancy (visible range)」 — 오늘 이후 날짜만, 예약·차단 둘 다 없는 객실박. */
  futureVacancy: { vacantNights: number; totalNights: number; days: number };
  /** 매출에 들어간 예약 수(창에 한 밤이라도 걸친 확정 예약). */
  reservationCount: number;
  /** 확정인데 금액이 0 · 없음 — 점유에는 들어가고 매출에는 0원(저쪽과 같다). */
  zeroPriceCount: number;
  /**
   * 저쪽 「전체」 포트폴리오 표의 Grand Total 평균가 — **건물 ADR 의 단순 평균**(0 인 건물 제외, :9155).
   * 가중 평균이 아니라서 `totals.adr` 와 다르다. 화면에는 쓰지 않고 대조용으로만 둔다.
   */
  legacyPortfolioMeanAdr: number;
};

// ── 저쪽 헬퍼 재현 ──────────────────────────────────────────────────────

/** 저쪽 `cleanPrice` / `parseMoneyAmount` — 숫자 아닌 글자를 지우고 읽는다. 못 읽으면 0. */
export function legacyMoney(value: unknown): number {
  if (value === null || value === undefined || value === "" || value === false) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = parseFloat(String(value).replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 저쪽 `determineStatus` 가 `"confirmed"` 를 주는가. `1`·`2`·`new`·`confirmed` 만 확정이다 —
 * `request`/`inquiry` 는 문의, `black` 은 차단, 나머지는 전부 취소로 떨어진다.
 *
 * 우리 표는 `request`·`black` 도 `confirmed` 로 적는다(`reservation-status.ts`) — 그래서 원본 값을 다시 본다.
 */
export function isLegacyConfirmedStatus(rawStatus: unknown): boolean {
  const value = String(rawStatus).toLowerCase();
  return value === "1" || value === "2" || value === "new" || value === "confirmed";
}

/**
 * 이 예약이 저쪽에서 「확정」인가.
 *
 * - 우리 표가 `cancelled` 면 뺀다(웹훅이 원본보다 먼저 상태를 고친 경우까지 — 취소는 취소다).
 * - 원본 `status` 가 있으면 저쪽 규칙 그대로. **노쇼는 들어간다** — 저쪽은 `subStatus` 를 안 본다.
 * - 원본에 `status` 가 없으면(드묾 — 2026-09-30 실측 0건) 우리 상태로 본다.
 */
export function isSalesCountedReservation(reservation: Pick<SalesSummaryReservation, "status" | "raw">): boolean {
  if (reservation.status === "cancelled") return false;
  const raw = reservation.raw.status;
  if (raw === null || raw === undefined || raw === "") return true;
  return isLegacyConfirmedStatus(raw);
}

/**
 * 저쪽 예약 금액. 저장할 때 `invoiceItems` 합 → `price` → `amount`(:1395-1401), 화면이
 * `totalPrice || price || netRevenue`(:2821) — 셋이 같은 값이라 결국 이 순서다.
 */
export function legacyReservationAmount(raw: SalesRawPayload): number {
  if (Array.isArray(raw.invoiceItems) && raw.invoiceItems.length > 0) {
    return raw.invoiceItems.reduce<number>((sum, item) => {
      const amount = item && typeof item === "object" ? (item as Record<string, unknown>).amount : 0;
      return sum + legacyMoney(amount || 0);
    }, 0);
  }
  if (raw.price) return legacyMoney(raw.price);
  if (raw.amount) return legacyMoney(raw.amount);
  return 0;
}

function joinSources(values: unknown[]): string {
  return values
    .filter((value) => value !== null && value !== undefined && value !== "" && value !== false)
    .map((value) => (typeof value === "string" ? value : String(value)))
    .join(" ")
    .toLowerCase();
}

/** 저쪽 저장 필드 `platform` (`normalize` :1368-1378). 아무것도 안 맞으면 **Airbnb** 가 기본값이다. */
export function legacyPlatform(raw: SalesRawPayload): string {
  const all = [raw.referer, raw.referrer, raw.apiSource, raw.subSource, raw.source, raw.channel]
    .map((value) => (value === undefined || value === null ? "" : String(value)))
    .join(" ")
    .toLowerCase();
  if (all.includes("direct") || all.includes("manual") || all.includes("phone") || all.includes("walk")) {
    return "Direct";
  }
  if (all.includes("booking")) return "Booking";
  if (all.includes("expedia")) return "Expedia";
  if (all.includes("agoda")) return "Agoda";
  return "Airbnb";
}

/** 저쪽 캘린더 `getReservationChannelKey` — airbnb → booking → direct/manual → other 순서로 부분 일치. */
export function legacyChannelKey(raw: SalesRawPayload): SalesChannel {
  const source = joinSources([raw.referer, raw.referrer, raw.channel, legacyPlatform(raw), raw.source, raw.apiSource]);
  if (source.includes("airbnb")) return "airbnb";
  if (source.includes("booking")) return "booking";
  if (source.includes("direct") || source.includes("manual")) return "direct";
  return "other";
}

// ── 날짜 ────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// ── 계산 ────────────────────────────────────────────────────────────────

/** 합이 되는 원재료. 비율(가동률 · ADR · RevPAR)은 합친 뒤에 다시 나눈다 — 비율을 평균내지 않는다. */
type Sums = { roomCount: number; revenue: number; commission: number; occupiedNights: number };

function metricsOf(sums: Sums, days: number): SalesMetrics {
  const availableNights = sums.roomCount * days;
  return {
    adr: sums.occupiedNights > 0 ? sums.revenue / sums.occupiedNights : 0,
    availableNights,
    commission: sums.commission,
    net: sums.revenue - sums.commission,
    occupancyPct: availableNights > 0 ? (sums.occupiedNights / availableNights) * 100 : 0,
    occupiedNights: sums.occupiedNights,
    revenue: sums.revenue,
    revpar: availableNights > 0 ? sums.revenue / availableNights : 0,
    roomCount: sums.roomCount,
    vacantNights: Math.max(0, availableNights - sums.occupiedNights),
  };
}

function addSums(target: Sums, row: Sums): void {
  target.roomCount += row.roomCount;
  target.revenue += row.revenue;
  target.commission += row.commission;
  target.occupiedNights += row.occupiedNights;
}

function labelOf(key: string): string {
  const index = key.lastIndexOf("::");
  return index >= 0 ? key.slice(index + 2) : key;
}

export function buildOpsSalesSummary(input: {
  /** 창의 첫날(`YYYY-MM-DD`). */
  start: string;
  /** 창의 다음 날(배타). */
  endExclusive: string;
  /** 도쿄 기준 오늘 — 오늘 이후 빈방에만 쓴다. */
  today: string;
  /** 보이는 객실(캘린더 행 순서). 건물 순서는 `properties` 가 정한다. */
  rooms: readonly SalesSummaryRoom[];
  reservations: readonly SalesSummaryReservation[];
  blocks: readonly SalesSummaryBlock[];
  /** 건물 표의 순서(탭 순서). 여기 없는 건물의 방·예약은 빼지 않고 뒤에 붙인다. */
  properties?: readonly string[];
  /**
   * 금액이 마이너스인 예약(직원이 넣은 −9,995 엔 같은 조정 예약 — 2025-06~08 아라키초B 등 23건)을 어떻게 셀까.
   * 저쪽 화면끼리 다르다(2026-10-07 대조): 캘린더 분석 카드는 `val > 0` 만(`BuildingCalendar.jsx` :2896-2897) — 기본
   * `"skip"`, 매출 화면(`RevenueDashboard.jsx` `processRevenue`)은 그대로 더한다 — `"include"`(매출 화면이 쓴다).
   */
  negativeAmounts?: "skip" | "include";
}): OpsSalesSummary {
  const includeNegative = input.negativeAmounts === "include";
  if (!isDate(input.start) || !isDate(input.endExclusive)) throw new Error("bad_window");
  const startDay = dayNumber(input.start);
  const endDay = dayNumber(input.endExclusive);
  const days = Math.max(0, endDay - startDay);

  // ── 객실 행이 기본 단위다. 건물 = 그 객실들의 합, 전체 = 건물들의 합 ──
  type RoomAcc = {
    room: SalesSummaryRoom;
    revenue: number;
    commission: number;
    occupied: Set<number>;
    channelRevenue: Record<SalesChannel, number>;
  };
  const roomAccs = new Map<string, RoomAcc>();
  for (const room of input.rooms) {
    if (!roomAccs.has(room.key)) {
      roomAccs.set(room.key, { channelRevenue: emptyChannelRevenue(), commission: 0, occupied: new Set(), revenue: 0, room });
    }
  }
  /** 행 목록에 없는 방의 예약(드묾 — 예: 목록 밖 방의 노쇼)은 목록 밖 행으로 붙인다. 매출이 사라지면 안 된다. */
  const roomAcc = (reservation: SalesSummaryReservation) => {
    let acc = roomAccs.get(reservation.roomKey);
    if (!acc) {
      acc = {
        channelRevenue: emptyChannelRevenue(),
        commission: 0,
        occupied: new Set(),
        revenue: 0,
        room: { inCatalog: false, key: reservation.roomKey, propertyName: reservation.propertyName },
      };
      roomAccs.set(reservation.roomKey, acc);
    }
    return acc;
  };

  const channels = new Map<SalesChannel, SalesChannelRow>(
    SALES_CHANNELS.map((channel) => [channel, { arrivals: 0, channel, commission: 0, net: 0, nights: 0, revenue: 0 }]),
  );

  let reservationCount = 0;
  let zeroPriceCount = 0;
  /** 건물별 몫(채널 행 · 예약 수 · 0원 수) — 합계에 넣을 건물을 고를 때 다시 더한다. */
  type PropertyShare = { channels: Map<SalesChannel, SalesChannelRow>; reservations: number; zero: number };
  const shares = new Map<string, PropertyShare>();
  const shareOf = (propertyName: string) => {
    let share = shares.get(propertyName);
    if (!share) {
      share = {
        channels: new Map(
          SALES_CHANNELS.map((channel) => [channel, { arrivals: 0, channel, commission: 0, net: 0, nights: 0, revenue: 0 }]),
        ),
        reservations: 0,
        zero: 0,
      };
      shares.set(propertyName, share);
    }
    return share;
  };
  /** 오늘 이후 빈방 — 방별 「못 파는 밤」. 예약(확정)과 차단을 합친다. */
  const unavailable = new Map<string, Set<number>>();
  const markUnavailable = (roomKey: string, from: number, toExclusive: number) => {
    if (!roomAccs.get(roomKey)?.room.inCatalog) return;
    let set = unavailable.get(roomKey);
    if (!set) {
      set = new Set();
      unavailable.set(roomKey, set);
    }
    for (let day = Math.max(from, startDay); day < Math.min(toExclusive, endDay); day += 1) set.add(day);
  };

  for (const reservation of input.reservations) {
    if (!isDate(reservation.checkIn) || !isDate(reservation.checkOut)) continue;
    // Beds24 `black` 예약은 저쪽에서 `blackout`(차단)이다 — 매출·점유에는 없고 오늘 이후 빈방에서만 뺀다.
    if (reservation.status !== "cancelled" && String(reservation.raw.status).toLowerCase() === "black") {
      markUnavailable(reservation.roomKey, dayNumber(reservation.checkIn), dayNumber(reservation.checkOut));
      continue;
    }
    if (!isSalesCountedReservation(reservation)) continue;
    const arrival = dayNumber(reservation.checkIn);
    const departure = dayNumber(reservation.checkOut);
    const channel = legacyChannelKey(reservation.raw);
    const channelRow = channels.get(channel)!;
    const acc = roomAcc(reservation);
    const share = shareOf(acc.room.propertyName);
    const shareRow = share.channels.get(channel)!;

    // 체크인 예약 수 — 체크인이 창 안이면(:3011).
    if (arrival >= startDay && arrival < endDay) {
      channelRow.arrivals += 1;
      shareRow.arrivals += 1;
    }

    const effectiveStart = Math.max(arrival, startDay);
    const effectiveEnd = Math.min(departure, endDay);
    if (effectiveEnd <= effectiveStart) continue;

    const visibleNights = effectiveEnd - effectiveStart;
    const totalNights = Math.max(1, departure - arrival);
    reservationCount += 1;
    share.reservations += 1;

    // 점유 — 목록의 방만, 방별 날짜 Set(겹친 예약 = 1박).
    if (acc.room.inCatalog) {
      for (let day = effectiveStart; day < effectiveEnd; day += 1) acc.occupied.add(day);
      markUnavailable(reservation.roomKey, effectiveStart, effectiveEnd);
    }
    channelRow.nights += visibleNights;
    shareRow.nights += visibleNights;

    // 매출 — 1박 균등 분배. 목록 밖 방도 넣는다. 0원은 건너뛴다(점유에는 이미 들어갔다).
    const amount = legacyReservationAmount(reservation.raw);
    if (amount > 0 || (includeNegative && amount < 0)) {
      const part = (amount / totalNights) * visibleNights;
      acc.revenue += part;
      acc.channelRevenue[channel] += part;
      channelRow.revenue += part;
      shareRow.revenue += part;
    } else {
      zeroPriceCount += 1;
      share.zero += 1;
    }

    // 수수료 — Airbnb · Booking.com 만(:2974), 같은 1박 분배.
    if (channel === "airbnb" || channel === "booking") {
      const commission = legacyMoney(reservation.raw.commission);
      if (commission > 0) {
        const part = (commission / totalNights) * visibleNights;
        acc.commission += part;
        channelRow.commission += part;
        shareRow.commission += part;
      }
    }
  }

  for (const block of input.blocks) {
    if (!isDate(block.startDate) || !isDate(block.endDate)) continue;
    markUnavailable(block.roomKey, dayNumber(block.startDate), dayNumber(block.endDate) + 1);
  }

  // ── 객실 → 건물 → 전체 ──
  const buildings = new Map<string, { sums: Sums; rooms: SalesRoomRow[]; futureVacant: number; futureTotal: number }>();
  const building = (name: string) => {
    let entry = buildings.get(name);
    if (!entry) {
      entry = { futureTotal: 0, futureVacant: 0, rooms: [], sums: { commission: 0, occupiedNights: 0, revenue: 0, roomCount: 0 } };
      buildings.set(name, entry);
    }
    return entry;
  };
  for (const name of input.properties ?? []) building(name);
  const totalSums: Sums = { commission: 0, occupiedNights: 0, revenue: 0, roomCount: 0 };
  let futureVacant = 0;
  let catalogRooms = 0;
  const todayDay = isDate(input.today) ? dayNumber(input.today) : startDay;
  const futureFrom = Math.max(startDay, todayDay);
  const futureDays = Math.max(0, endDay - futureFrom);

  for (const acc of roomAccs.values()) {
    const { room } = acc;
    // 목록 밖 행은 매출이 있을 때만 보인다(빈 줄은 소음이다).
    if (!room.inCatalog && acc.revenue === 0 && acc.commission === 0) continue;
    const sums: Sums = {
      commission: acc.commission,
      occupiedNights: room.inCatalog ? acc.occupied.size : 0,
      revenue: acc.revenue,
      roomCount: room.inCatalog ? 1 : 0,
    };
    const entry = building(room.propertyName);
    entry.rooms.push({
      ...metricsOf(sums, days),
      channelRevenue: acc.channelRevenue,
      inCatalog: room.inCatalog,
      key: room.key,
      label: room.label ?? labelOf(room.key),
    });
    addSums(entry.sums, sums);
    addSums(totalSums, sums);
    if (room.inCatalog) {
      catalogRooms += 1;
      const set = unavailable.get(room.key);
      let vacant = 0;
      for (let day = futureFrom; day < endDay; day += 1) if (!set?.has(day)) vacant += 1;
      futureVacant += vacant;
      entry.futureVacant += vacant;
      entry.futureTotal += futureDays;
    }
  }
  // 객실 행이 안 남은 건물(목록 밖 방의 0원 예약뿐)도 채널 몫이 있으면 줄을 만든다 — 다시 더할 때 빠지지 않게.
  for (const [name, share] of shares) {
    if (share.reservations > 0 || [...share.channels.values()].some((row) => row.arrivals > 0)) building(name);
  }

  const propertyRows: SalesPropertyRow[] = [...buildings].map(([propertyName, entry]) => {
    const share = shares.get(propertyName);
    return {
      channels: SALES_CHANNELS.map((channel) => {
        const row = share?.channels.get(channel) ?? { arrivals: 0, channel, commission: 0, net: 0, nights: 0, revenue: 0 };
        return { ...row, net: row.revenue - row.commission };
      }),
      futureTotalNights: entry.futureTotal,
      futureVacantNights: entry.futureVacant,
      propertyName,
      reservationCount: share?.reservations ?? 0,
      rooms: entry.rooms,
      zeroPriceCount: share?.zero ?? 0,
      ...metricsOf(entry.sums, days),
    };
  });
  const withAdr = propertyRows.filter((row) => row.adr > 0);

  return {
    byChannel: SALES_CHANNELS.map((channel) => {
      const row = channels.get(channel)!;
      return { ...row, net: row.revenue - row.commission };
    }),
    byProperty: propertyRows,
    days,
    endExclusive: input.endExclusive,
    futureVacancy: { days: futureDays, totalNights: futureDays * catalogRooms, vacantNights: futureVacant },
    legacyPortfolioMeanAdr: withAdr.length > 0 ? withAdr.reduce((sum, row) => sum + row.adr, 0) / withAdr.length : 0,
    reservationCount,
    start: input.start,
    totals: metricsOf(totalSums, days),
    zeroPriceCount,
  };
}


// ── 합계에 넣을 건물 고르기 (2026-10-05) ────────────────────────────────

/**
 * 매출 요약의 **합계에서 기본으로 빼는 건물** — 오쿠보B · 사노(2026-10-05 사용자 결정). 두 건물은 따로 보이고
 * 총매출 · 가동률 · 채널 합계에 섞지 않는다. 사용자가 요약 안에서 다시 넣을 수 있다. 이 건물들**만** 보고 있으면
 * 빼지 않는다(볼 게 그것뿐이다).
 */
export const SALES_SUMMARY_DEFAULT_EXCLUDED: ReadonlySet<string> = new Set(
  ["오쿠보B", "Sano"].map((name) => getCanonicalPropertyName(name)),
);

export function defaultSalesExcluded(propertyNames: readonly string[]): string[] {
  const excluded = propertyNames.filter((name) => SALES_SUMMARY_DEFAULT_EXCLUDED.has(getCanonicalPropertyName(name)));
  return excluded.length === propertyNames.length ? [] : excluded;
}

export type CombinedSalesSummary = Pick<
  OpsSalesSummary,
  "totals" | "byChannel" | "futureVacancy" | "reservationCount" | "zeroPriceCount"
>;

/**
 * 고른 건물만으로 합계를 다시 낸다 — 비율(가동률 · ADR · RevPAR)은 합을 다시 나눠 구한다(평균내지 않는다).
 * 모든 건물을 넣으면 `buildOpsSalesSummary` 의 합계와 같다(테스트로 고정).
 */
export function combineSalesSummary(summary: OpsSalesSummary, included: (propertyName: string) => boolean): CombinedSalesSummary {
  const sums: Sums = { commission: 0, occupiedNights: 0, revenue: 0, roomCount: 0 };
  const channels = new Map<SalesChannel, SalesChannelRow>(
    SALES_CHANNELS.map((channel) => [channel, { arrivals: 0, channel, commission: 0, net: 0, nights: 0, revenue: 0 }]),
  );
  let reservationCount = 0;
  let zeroPriceCount = 0;
  let futureVacant = 0;
  let futureTotal = 0;
  for (const row of summary.byProperty) {
    if (!included(row.propertyName)) continue;
    addSums(sums, { commission: row.commission, occupiedNights: row.occupiedNights, revenue: row.revenue, roomCount: row.roomCount });
    reservationCount += row.reservationCount;
    zeroPriceCount += row.zeroPriceCount;
    futureVacant += row.futureVacantNights;
    futureTotal += row.futureTotalNights;
    for (const part of row.channels) {
      const target = channels.get(part.channel)!;
      target.arrivals += part.arrivals;
      target.commission += part.commission;
      target.nights += part.nights;
      target.revenue += part.revenue;
    }
  }
  return {
    byChannel: SALES_CHANNELS.map((channel) => {
      const row = channels.get(channel)!;
      return { ...row, net: row.revenue - row.commission };
    }),
    futureVacancy: { days: summary.futureVacancy.days, totalNights: futureTotal, vacantNights: futureVacant },
    reservationCount,
    totals: metricsOf(sums, summary.days),
    zeroPriceCount,
  };
}
