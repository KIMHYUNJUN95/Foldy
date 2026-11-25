import { buildRoomRatesWindow, RECENT_WRITE_GUARD_MS } from "@/lib/beds24/room-rates-window";
import { isActiveUnitMinStay } from "@/lib/ops-gap-detection";

/**
 * 한 캘린더 칸(객실 행 × 날짜)에 걸친 Beds24 유닛들을 하나로 합친다.
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md 「유닛이 여럿인 칸」
 * 원본: STAY ARI Manager `BuildingCalendar.jsx` — `getDisplayUnitInfosForDate` +
 * `getMergedRoomChannelPrices` + `getMinStayFromUnitInfos`
 *
 * **순수 모듈이다.** 이 규칙은 2026-09-17 에 두 번 틀렸고(비활성 유닛 값이 올라옴 →
 * 부킹닷컴 가격이 사라짐) 둘 다 화면에서는 「팔지 않는 날」처럼 보여 눈으로 못 잡는다.
 * 그래서 판정을 여기로 빼고 테스트로 고정한다.
 *
 * ## 운영 값과 가격을 다르게 다루는 것이 요점이다
 *
 * ### 운영 값(최소숙박·재고·blackout)은 **운영 중인 유닛에서만** 읽는다
 *
 * 운영 중 = `1 ≤ minStay < 50`. 하나도 없으면 그 칸은 **비운다** — 비활성 유닛의 `minStay 99`
 * 를 보여주는 것은 정보가 아니라 오답이다(저쪽 `EMPTY_PRICE_CELL`). 화면에는 `–` 로 나가고
 * 갭 판정에서는 `unknown` 이 되어 제외된다.
 *
 * ### 가격은 **항목별로** 따로 내려온다
 *
 * 가격이 운영 중인 유닛에 다 있지는 않다. 오쿠보C 는 Beds24 방 계정이 셋인데
 * **부킹닷컴·아고다 가격은 메인 계정 하나에만** 있다. 나머지 둘은 에어비앤비 가격만 연결로
 * 받는다.
 *
 * ```
 * 450096 오쿠보 2-1 (메인)  p1 79000  p2 116920  p3 102700   minStay 50 ← 10/1 부터 비활성
 * 496532 1-13-1-2           p1 79000  p2 —       p3 —        minStay 99
 * 648399 OkuboCC            p1 79000  p2 —       p3 —        minStay 2  ← 10/1 부터 판매
 * ```
 *
 * 10/1 이후 운영 중인 유닛은 648399 뿐인데 그 유닛에는 부킹닷컴 가격이 없다. 유닛 하나를
 * 골라 그 행을 통째로 쓰면 **부킹닷컴 가격이 사라진다.** 그래서 저쪽처럼 항목마다
 * 「운영 중인 유닛 먼저, 없으면 그 행의 아무 유닛」 순으로 **처음 나오는 값**을 쓴다.
 *
 * 이 폴백은 **가격에만** 건다. 최소숙박까지 끌어오면 위 표에서 450096 의 `50` 이 올라와
 * 「팔 수 없는 날」이 되고, 그건 팔리는 방을 안 판다는 뜻이다.
 *
 * ## Beds24 가 더는 돌려주지 않는 유닛은 **아예 뺀다** (2026-11-25)
 *
 * 유닛이 Beds24 에서 사라지면 동기화가 그 유닛 행을 더 쓰지 않는다 — 지우지도 않는다. 사라진 날의 값이 먼
 * 미래 날짜까지 그대로 남는다. 오쿠보C 2027-05~10 이 이랬다:
 *
 * ```
 * 450096 오쿠보 2-1 (메인)  minStay 2   p2 있음   매일 동기화
 * 648399 OkuboCC            minStay 99            매일 동기화
 * 496532 1-13-1-2           minStay 1   p1 없음   마지막 동기화 2026-10-01 ← Beds24 가 더는 안 돌려줌
 * ```
 *
 * 496532 의 낡은 `1` 이 운영 중으로 잡혀 칸마다 「1·2」(유닛마다 다름)가 떴다. Beds24 는 2 였다.
 * 다카다노바바 401_2(556719)도 같은 모양이다.
 *
 * `rooms.status` 로는 못 가른다 — 450096 은 `inactive` 인데 여전히 매일 동기화되는 **정답** 유닛이다.
 * 같은 칸의 다른 유닛과 비교하는 것도 틀린다 — 앱 쓰기(가격 작업 · 차단)는 **쓴 유닛의** `synced_at` 만 앞당기므로,
 * 동기화가 멈춘 사이 소스 유닛에만 쓰면 판매 유닛이 「낡은 쪽」으로 몰려 빠진다.
 *
 * 그래서 기준은 **그 건물의 마지막 전체 읽기**(`beds24_property_rates_state.last_full_read_at`)다. 전체 읽기는 Beds24
 * 가 돌려준 유닛의 창 안 행을 **전부** 읽기 시작 시각 이후로 찍는다(오쿠보C 실측: 읽기 18:11:34.015 → 450096 ·
 * 648399 최소 18:11:34.064, 496532 는 9/30~10/1). 그러니 그 창 안 날짜인데 `synced_at` 이 읽기 시작보다
 * `FULL_READ_GRACE_MS`(최근 쓰기 가드 1시간 + 5분) 넘게 이르면 **그 읽기에서 Beds24 가 돌려주지 않은 유닛** — 유령이다(`isGhostUnit`).
 * 유령은 병합에서 통째로 뺀다(최소숙박 · 재고 · 가격 폴백 · blackout 모두).
 *
 * - **blackout 도 뺀다.** Beds24 에 없는 유닛의 차단은 아무것도 막지 않는다. 「어느 유닛이든 막히면 막힘」
 *   (2026-10-01)은 Beds24 에 **있는** 유닛 얘기다.
 * - 빼지 않는 경우: 건물의 전체 읽기 기록이 없음 · `synced_at` 없음 · 그 읽기 창(읽은 날 도쿄 어제 ~ +12개월,
 *   `buildRoomRatesWindow`)의 양 끝 날짜와 그 밖 날짜(지난 날짜 포함 — 그 읽기가 읽지 않았다). 동기화가 멈춰 전체 읽기가 오래됐으면
 *   그 시각 이전에 사라진 유닛만 빠지고, 살아 있는 유닛은 그 읽기 때 찍혔으니 남는다.
 *
 * 칸마다 유닛을 고르는 곳(격자 · 겹침 · 수기 예약 · 옮기기 · 매출 차단 칸 · 쓰기 대상)은 모두 이 함수를 거친다.
 * 건물 기준 시각은 `loadUnitFullReadAt`(`src/lib/beds24/property-rates-state.ts`) 하나로 붙인다.
 */

/**
 * 전체 읽기 시작 시각보다 이만큼까지 이른 `synced_at` 은 그 읽기가 쓴 것으로 본다. 최근 쓰기 가드
 * (`RECENT_WRITE_GUARD_MS`, 1시간)가 재확인에 실패한 행은 upsert 에서 빠져 `synced_at` 이 앱이 쓴 시각으로 남는데,
 * 그 회차도 전체 읽기로 찍힌다 — 그 행을 유령으로 보지 않도록 가드 시간 + 시계 차 5분이다. 진짜 유령은 한 시간 늦게
 * 잡힐 뿐이다(그 회차를 전체 읽기로 안 찍으면 놓친 웹훅 알림이 사라지고 재시도가 크레딧을 쓴다).
 */
export const FULL_READ_GRACE_MS = RECENT_WRITE_GUARD_MS + 5 * 60 * 1000;

/** 유령 판정에 쓰는 칸. 셋 중 하나라도 없으면 판정하지 않는다(빼지 않는다). */
export type UnitReadMark = {
  /** 그 행을 마지막으로 쓴 시각. */
  synced_at?: string | null;
  stay_date?: string;
  /** 그 유닛 건물의 마지막 전체 읽기 시작 시각(`beds24_property_rates_state.last_full_read_at`). */
  full_read_at?: string | null;
};

/** 병합에 필요한 것만. `room_daily_rates` 한 행의 부분집합이다. */
export type OpsRateUnit = UnitReadMark & {
  price1: number | null;
  price2: number | null;
  price3: number | null;
  min_stay: number | null;
  max_stay: number | null;
  num_avail: number | null;
  override_kind: string | null;
  /** Beds24 유닛 이름(`802#` · `K802`). 유닛마다 최소숙박이 다를 때 화면이 어느 쪽인지 적는다. */
  label?: string;
};

export type OpsMergedRate = {
  maxStay: number | null;
  minStay: number | null;
  /**
   * 운영 중 유닛들의 **가장 긴** 최소숙박(2026-09-30). 1박 갭 판정은 이것을 본다 — 한 유닛이라도 2박이면
   * 그 유닛에 연결된 채널은 1박을 못 판다. 유닛이 하나면 `minStay` 와 같다.
   */
  minStayMax: number | null;
  /**
   * 운영 중 유닛끼리 최소숙박이 **다를 때만** 유닛별 값(아니면 `null`). 화면이 칸에 표시하고
   * 「802# 1박 · K802 2박」처럼 알린다 — 짧은 값 하나만 보이면 어긋남이 숨는다(2026-09-30 가부키초 802 10/1).
   */
  minStayByUnit: Array<{ label: string; minStay: number }> | null;
  numAvail: number | null;
  overrideKind: string | null;
  /** 에어비앤비 가격(엔) = `price1`. 격자의 가격 트랙이 쓰는 값이다. */
  price: number | null;
  /** 부킹닷컴 가격(엔) = `price2`. 메인 계정에만 있는 경우가 있다. */
  bookingPrice: number | null;
  /** 대체가(엔) = `price3`. 아고다·자사 홈페이지가 쓴다. */
  altPrice: number | null;
};

/** 첫 번째로 값이 있는 유닛의 값을 쓴다. 없으면 `null`. */
function firstNonNull(
  units: OpsRateUnit[],
  read: (unit: OpsRateUnit) => number | null,
): number | null {
  for (const unit of units) {
    const value = read(unit);
    if (value !== null) return value;
  }
  return null;
}

/** 마지막 전체 읽기에서 Beds24 가 돌려주지 않은 유닛 행인가. 모듈 머리말 참고. */
export function isGhostUnit(unit: UnitReadMark): boolean {
  if (!unit.full_read_at || !unit.synced_at || !unit.stay_date) return false;
  const readAt = Date.parse(unit.full_read_at);
  const syncedAt = Date.parse(unit.synced_at);
  if (Number.isNaN(readAt) || Number.isNaN(syncedAt)) return false;
  // 실제로 읽은 창은 읽기 시작과 다른 시각에 잡힌다(안전망은 라우트 시작 · 웹훅은 읽는 중). 도쿄 자정을 끼면 하루
  // 어긋나므로 판정 창은 양 끝 하루씩 줄인다 — 읽지 않은 날을 유령으로 보는 쪽보다 하루 덜 보는 쪽이 안전하다.
  const window = buildRoomRatesWindow(new Date(readAt));
  if (unit.stay_date <= window.from || unit.stay_date >= window.to) return false;
  return syncedAt < readAt - FULL_READ_GRACE_MS;
}

export function dropGhostUnits<T extends UnitReadMark>(units: readonly T[]): T[] {
  return units.filter((unit) => !isGhostUnit(unit));
}

/** 한 칸의 유닛 중 **운영 중**(유령 제외 · `1 ≤ minStay < 50`)인 것. 비면 그 칸은 팔 수 없다. */
export function activeUnits<T extends UnitReadMark & { min_stay: number | null }>(units: readonly T[]): T[] {
  return dropGhostUnits(units).filter((unit) => isActiveUnitMinStay(unit.min_stay));
}

/** 한 캘린더 행의 유닛 행들(여러 날) → 운영 중인 유닛이 하나라도 있는 밤. 밤마다 `activeUnits` 로 본다. */
export function activeNightsOf<T extends UnitReadMark & { stay_date: string; min_stay: number | null }>(
  rows: readonly T[],
): Set<string> {
  const byNight = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = byNight.get(row.stay_date);
    if (bucket) bucket.push(row);
    else byNight.set(row.stay_date, [row]);
  }
  const nights = new Set<string>();
  for (const [night, units] of byNight) if (activeUnits(units).length > 0) nights.add(night);
  return nights;
}

/** 수기 예약 · 옮기기가 읽는 요금 행. */
export type UnitNightRate = UnitReadMark & { room_id: string; stay_date: string; min_stay: number | null };

/**
 * 밤마다 **그때 팔고 있는** 유닛의 Beds24 번호(수기 예약 · 예약 옮기기). 칸마다 `activeUnits` 로 보므로 유령 유닛은
 * 고르지 않는다 — Beds24 에 없는 유닛에 예약을 쓰려다 거절당하지 않는다. 요금 행이 없는 유닛은 그 밤에 못 판다.
 */
export function activeExternalIdsByNight(
  units: ReadonlyArray<{ id: string; external_room_id: string | number | null }>,
  rates: readonly UnitNightRate[],
  nights: readonly string[],
): Map<string, string[]> {
  const rateByKey = new Map(rates.map((rate) => [`${rate.room_id}|${rate.stay_date}`, rate]));
  const activeByNight = new Map<string, string[]>();
  for (const night of nights) {
    const cell = units.flatMap((unit) => {
      const rate = rateByKey.get(`${unit.id}|${night}`);
      return rate ? [{ ...rate, externalRoomId: String(unit.external_room_id) }] : [];
    });
    activeByNight.set(night, activeUnits(cell).map((unit) => unit.externalRoomId));
  }
  return activeByNight;
}

/**
 * 그 칸의 유닛 중 **하나라도** blackout 이면 막힌 칸이다 — 활성 · 비활성(최소숙박 잠금)을 가리지 않는다.
 *
 * 2026-10-01 사용자 결정: 「활성이건 비활성이건 어느 한쪽이 블락하면 우리 쪽에도 룸 매핑대로 블락이 보여야 한다」.
 * 예전에는 운영 중 유닛의 blackout 만 셌다(「안 파는 유닛의 blackout 은 그 유닛 사정」). 그러면 Beds24 에서
 * 잠긴 유닛만 막아 둔 방은 우리 격자에 BLOCK 이 안 보였다. 판매 캘린더 격자 · 수기 예약 겹침 · 매출 요약이
 * 모두 이 규칙을 쓴다. 예약 캘린더(`room_blocks`)는 원래부터 유닛 상태를 보지 않았다.
 * 마지막 전체 읽기에서 Beds24 가 돌려주지 않은 유령 유닛의 blackout 은 세지 않는다(`dropGhostUnits`, 2026-11-25).
 */
export function isAnyUnitBlackout(
  units: ReadonlyArray<UnitReadMark & { override_kind: string | null }>,
): boolean {
  return dropGhostUnits(units).some((unit) => (unit.override_kind ?? "").toLowerCase() === "blackout");
}

/** 운영 중인 유닛이 하나도 없으면 `null` — 칸을 비우라는 뜻이다. */
export function mergeOpsRateUnits(cellUnits: OpsRateUnit[]): OpsMergedRate | null {
  const units = dropGhostUnits(cellUnits);
  const active = units.filter((unit) => isActiveUnitMinStay(unit.min_stay));
  if (active.length === 0) return null;

  // 최소숙박은 운영 중인 유닛 중 **가장 짧은 값** — 하나라도 1박에 팔면 그 칸은 1박이다
  // (저쪽 `getMinStayFromUnitInfos`).
  let minStay: number | null = null;
  let minStayMax: number | null = null;
  let numAvail: number | null = null;
  // blackout 은 **유닛 전부**에서 본다(활성 · 비활성 — `isAnyUnitBlackout`).
  const blackout = isAnyUnitBlackout(units);
  for (const unit of active) {
    if (unit.min_stay !== null && (minStay === null || unit.min_stay < minStay)) {
      minStay = unit.min_stay;
    }
    if (unit.min_stay !== null && (minStayMax === null || unit.min_stay > minStayMax)) {
      minStayMax = unit.min_stay;
    }
    // 하나라도 팔 수 있으면 그 칸은 팔 수 있다.
    if (unit.num_avail !== null && (numAvail === null || unit.num_avail > numAvail)) {
      numAvail = unit.num_avail;
    }
  }

  const minStayByUnit =
    minStay !== null && minStayMax !== null && minStay !== minStayMax
      ? active
          .filter((unit) => unit.min_stay !== null)
          .map((unit, index) => ({ label: unit.label ?? `#${index + 1}`, minStay: unit.min_stay as number }))
      : null;

  // 가격은 운영 중인 유닛 먼저, 그다음 그 행의 나머지 유닛.
  const priceOrder = [...active, ...units.filter((unit) => !active.includes(unit))];

  return {
    altPrice: firstNonNull(priceOrder, (unit) => unit.price3),
    bookingPrice: firstNonNull(priceOrder, (unit) => unit.price2),
    maxStay: active[0].max_stay,
    minStay,
    minStayByUnit,
    minStayMax,
    numAvail,
    overrideKind: blackout ? "blackout" : active[0].override_kind,
    price: firstNonNull(priceOrder, (unit) => unit.price1),
  };
}
