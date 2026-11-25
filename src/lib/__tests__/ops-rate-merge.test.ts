import { describe, expect, it } from "vitest";
import {
  activeExternalIdsByNight,
  activeNightsOf,
  activeUnits,
  dropGhostUnits,
  FULL_READ_GRACE_MS,
  isAnyUnitBlackout,
  isGhostUnit,
  mergeOpsRateUnits,
  type OpsRateUnit,
} from "@/lib/ops-rate-merge";
import { RECENT_WRITE_GUARD_MS } from "@/lib/beds24/room-rates-window";

/**
 * 한 칸에 Beds24 유닛이 여럿일 때의 병합 규칙 고정.
 *
 * **이 규칙은 2026-09-17 에 두 번 틀렸다.**
 *
 * 1. 운영 중 판정에 `numAvail`·`blackout` 을 섞어서, 예약이 찬 날마다 비활성 유닛의
 *    `minStay 99` 가 화면으로 올라왔다
 * 2. 유닛 하나를 골라 그 행을 통째로 써서, 메인 계정에만 있는 부킹닷컴 가격이 사라졌다
 *
 * 둘 다 화면에서는 **「안 파는 날」과 똑같이 보인다** — 눈으로는 못 잡는다. 그래서 여기서
 * 고정한다.
 *
 * 계약: docs/product/33-calendar-write-features.md 「유닛이 여럿인 칸」
 */

function unit(overrides: Partial<OpsRateUnit> = {}): OpsRateUnit {
  return {
    max_stay: 30,
    min_stay: 2,
    num_avail: 1,
    override_kind: "none",
    price1: 40000,
    price2: null,
    price3: null,
    ...overrides,
  };
}

/** 오쿠보C 2026-10-01 실측값. 메인만 부킹닷컴·아고다 가격을 들고 있다. */
const OKUBO_C_OCT_1: OpsRateUnit[] = [
  // 450096 오쿠보 2-1 (메인) — 10/1 부터 비활성
  unit({ min_stay: 50, price1: 79000, price2: 116920, price3: 102700 }),
  // 496532 1-13-1-2 — 계속 비활성
  unit({ min_stay: 99, price1: 79000 }),
  // 648399 OkuboCC — 10/1 부터 판매
  unit({ min_stay: 2, price1: 79000 }),
];

describe("mergeOpsRateUnits", () => {
  it("유닛이 하나면 그대로 쓴다", () => {
    expect(mergeOpsRateUnits([unit({ price1: 42000 })])).toMatchObject({
      minStay: 2,
      numAvail: 1,
      price: 42000,
    });
  });

  it("운영 중인 유닛이 하나도 없으면 칸을 비운다", () => {
    // 비활성 유닛의 minStay 99 를 보여주는 것은 정보가 아니라 오답이다.
    expect(mergeOpsRateUnits([unit({ min_stay: 99 }), unit({ min_stay: 50 })])).toBeNull();
    expect(mergeOpsRateUnits([])).toBeNull();
  });

  it("최소숙박·재고는 **운영 중인 유닛에서만** 읽는다", () => {
    const merged = mergeOpsRateUnits(OKUBO_C_OCT_1);
    // 메인(450096)의 50 이 올라오면 「팔 수 없는 날」이 되고, 그건 팔리는 방을 안 판다는 뜻이다.
    expect(merged?.minStay).toBe(2);
  });

  it("가격은 운영 중인 유닛에 없으면 **그 행의 다른 유닛**에서 가져온다", () => {
    // 오쿠보C 는 방 계정이 셋인데 부킹닷컴·아고다 가격은 메인 하나에만 있다.
    // 유닛 하나를 골라 통째로 쓰면 그 가격이 사라진다.
    const merged = mergeOpsRateUnits(OKUBO_C_OCT_1);
    expect(merged?.price).toBe(79000);
    expect(merged?.bookingPrice).toBe(116920);
    expect(merged?.altPrice).toBe(102700);
  });

  it("가격 폴백은 **항목별**이다 — 한 유닛을 통째로 쓰지 않는다", () => {
    const merged = mergeOpsRateUnits([
      unit({ min_stay: 2, price1: 50000, price2: null }),
      unit({ min_stay: 99, price1: 79000, price2: 116920 }),
    ]);
    // p1 은 운영 중인 유닛 것, p2 는 비활성 유닛 것 — 섞여야 맞다.
    expect(merged?.price).toBe(50000);
    expect(merged?.bookingPrice).toBe(116920);
  });

  it("운영 중인 유닛이 둘이면 최소숙박은 **짧은 쪽**", () => {
    // 하나라도 1박에 팔면 그 칸은 1박이다.
    const merged = mergeOpsRateUnits([unit({ min_stay: 3 }), unit({ min_stay: 1 })]);
    expect(merged?.minStay).toBe(1);
  });

  it("운영 중인 유닛이 둘이면 재고는 **하나라도 있으면 있다**", () => {
    const merged = mergeOpsRateUnits([unit({ num_avail: 0 }), unit({ num_avail: 1 })]);
    expect(merged?.numAvail).toBe(1);
  });

  it("blackout 은 반대로 **하나라도 걸리면 막힘**", () => {
    // 재고와 방향이 다르다 — 막으라고 걸어 둔 것을 다른 유닛이 덮으면 안 된다.
    const merged = mergeOpsRateUnits([
      unit({ override_kind: "none" }),
      unit({ override_kind: "blackout" }),
    ]);
    expect(merged?.overrideKind).toBe("blackout");
  });

  it("비활성 유닛의 blackout 도 칸을 막는다 (2026-10-01 사용자 결정)", () => {
    // 「활성이건 비활성이건 어느 한쪽이 블락하면 룸 매핑대로 블락이 보여야 한다」.
    const merged = mergeOpsRateUnits([
      unit({ min_stay: 2, override_kind: "none" }),
      unit({ min_stay: 99, override_kind: "blackout" }),
    ]);
    expect(merged?.overrideKind).toBe("blackout");
  });

  it("isAnyUnitBlackout — 유닛 상태와 상관없이 하나라도 막히면 참", () => {
    expect(isAnyUnitBlackout([{ override_kind: "none" }, { override_kind: "BLACKOUT" }])).toBe(true);
    expect(isAnyUnitBlackout([{ override_kind: "none" }, { override_kind: null }])).toBe(false);
  });

  it("가격이 어느 유닛에도 없으면 null — 0원으로 만들지 않는다", () => {
    // 0원은 「공짜로 판다」는 뜻이다. 모르는 것은 비워 둔다.
    const merged = mergeOpsRateUnits([unit({ price1: null, price2: null, price3: null })]);
    expect(merged?.price).toBeNull();
    expect(merged?.bookingPrice).toBeNull();
  });
});

describe("유닛마다 최소숙박이 다를 때 (2026-09-30 가부키초 802 10/1)", () => {
  it("짧은 값을 보이되 긴 값과 유닛별 값을 함께 준다 — 어긋남을 숨기지 않는다", () => {
    const merged = mergeOpsRateUnits([unit({ label: "802#", min_stay: 1 }), unit({ label: "K802", min_stay: 2 })]);
    expect(merged).toMatchObject({
      minStay: 1,
      minStayByUnit: [
        { label: "802#", minStay: 1 },
        { label: "K802", minStay: 2 },
      ],
      minStayMax: 2,
    });
  });

  it("같으면 유닛별 값은 없다", () => {
    const merged = mergeOpsRateUnits([unit({ label: "802#", min_stay: 2 }), unit({ label: "K802", min_stay: 2 })]);
    expect(merged?.minStayByUnit).toBeNull();
    expect(merged?.minStayMax).toBe(2);
  });

  it("잠긴 유닛(50+)은 비교에 넣지 않는다", () => {
    const merged = mergeOpsRateUnits([unit({ label: "802#", min_stay: 1 }), unit({ label: "K802", min_stay: 99 })]);
    expect(merged).toMatchObject({ minStay: 1, minStayByUnit: null, minStayMax: 1 });
  });
});

describe("마지막 전체 읽기에서 Beds24 가 돌려주지 않은 유닛 — 유령은 뺀다 (2026-11-25 오쿠보C)", () => {
  /** 오쿠보C 실측 — 건물 전체 읽기 시작 18:11:34.015, 돌려준 유닛 행은 그 뒤 .064 로 찍혔다. */
  const FULL_READ = "2026-11-25T09:11:34.015Z";
  const FRESH = "2026-11-25T09:11:34.064Z";
  const GONE = "2026-10-01T03:00:00.000Z";
  const NIGHT = "2027-08-10";

  const read = { full_read_at: FULL_READ, stay_date: NIGHT };

  /** 496532 는 Beds24 가 10/1 부터 돌려주지 않아 그날 값(min 1 · p1 없음)이 남았다. 그 `1` 때문에 칸마다 「1·2」가 떴다. */
  const OKUBO_C_AUG_2027: OpsRateUnit[] = [
    unit({ ...read, label: "450096", min_stay: 2, price1: 79000, price2: 116920, synced_at: FRESH }),
    unit({ ...read, label: "OkuboCC", min_stay: 99, price1: 79000, synced_at: FRESH }),
    unit({ ...read, label: "1-13-1-2", min_stay: 1, price1: null, synced_at: GONE }),
  ];

  it("유령 유닛의 최소숙박은 칸에 섞지 않는다", () => {
    expect(mergeOpsRateUnits(OKUBO_C_AUG_2027)).toMatchObject({
      bookingPrice: 116920,
      minStay: 2,
      minStayByUnit: null,
      minStayMax: 2,
      price: 79000,
    });
  });

  it("유령 유닛의 blackout 도 세지 않는다 — Beds24 에 없는 유닛의 차단은 아무것도 막지 않는다", () => {
    const units = [
      unit({ ...read, min_stay: 2, override_kind: "none", synced_at: FRESH }),
      unit({ ...read, min_stay: 99, override_kind: "blackout", synced_at: GONE }),
    ];
    expect(isAnyUnitBlackout(units)).toBe(false);
    expect(mergeOpsRateUnits(units)?.overrideKind).toBe("none");
  });

  it("남은 유닛이 전부 잠겼으면 유령의 1박 때문에 칸이 살아나지 않는다", () => {
    const units = [
      { ...read, min_stay: 99, synced_at: FRESH },
      { ...read, min_stay: 1, synced_at: GONE },
    ];
    expect(activeUnits(units)).toEqual([]);
    expect(mergeOpsRateUnits(units.map((row) => unit(row)))).toBeNull();
  });

  it("최근 쓰기 가드가 남긴 행(앱이 1시간 안에 쓴 값)은 유령이 아니다 — 재확인 실패로 덮지 못한 행", () => {
    // 가드 재확인이 실패하면 그 행은 upsert 에서 빠지고 synced_at 은 앱이 쓴 시각(최대 1시간 전)으로 남는다.
    // 그래도 그 회차는 전체 읽기로 찍힌다 — 그 유닛은 Beds24 가 돌려준 살아 있는 유닛이다.
    expect(FULL_READ_GRACE_MS).toBe(RECENT_WRITE_GUARD_MS + 5 * 60 * 1000);
    const readAt = Date.parse(FULL_READ);
    const appWrite = new Date(readAt - RECENT_WRITE_GUARD_MS).toISOString();
    expect(isGhostUnit({ ...read, synced_at: appWrite })).toBe(false);
  });

  it("전체 읽기 시작 FULL_READ_GRACE_MS 전까지는 그 읽기가 쓴 것으로 본다", () => {
    const readAt = Date.parse(FULL_READ);
    const edge = new Date(readAt - FULL_READ_GRACE_MS).toISOString();
    const beyond = new Date(readAt - FULL_READ_GRACE_MS - 1).toISOString();
    expect(isGhostUnit({ ...read, synced_at: edge })).toBe(false);
    expect(isGhostUnit({ ...read, synced_at: beyond })).toBe(true);
  });

  it("앱이 한 유닛에만 써서 그 행만 새로워도 다른 유닛은 빠지지 않는다 (형제 비교 회귀)", () => {
    // 동기화가 며칠 멈춘 사이 가격 작업이 소스 유닛에만 썼다. 형제끼리 비교하면 판매 유닛이 빠져 칸이 비었다.
    const staleRead = { full_read_at: "2026-11-20T00:00:00.000Z", stay_date: NIGHT };
    const units = [
      unit({ ...staleRead, label: "source", min_stay: 99, price1: 90000, synced_at: "2026-11-25T09:00:00.000Z" }),
      unit({ ...staleRead, label: "selling", min_stay: 2, price1: 80000, synced_at: "2026-11-20T00:00:05.000Z" }),
    ];
    expect(dropGhostUnits(units)).toHaveLength(2);
    expect(mergeOpsRateUnits(units)).toMatchObject({ minStay: 2, price: 80000 });
  });

  it("동기화가 멈춰 마지막 전체 읽기가 오래됐으면 아무것도 빼지 않는다", () => {
    const oldRead = { full_read_at: "2026-11-01T00:00:00.000Z", stay_date: NIGHT };
    const units = [
      { ...oldRead, synced_at: "2026-11-01T00:00:10.000Z" },
      { ...oldRead, synced_at: "2026-11-01T00:00:20.000Z" },
    ];
    expect(dropGhostUnits(units)).toHaveLength(2);
  });

  it("전체 읽기 기록 · synced_at 이 없으면 빼지 않는다", () => {
    expect(isGhostUnit({ full_read_at: null, stay_date: NIGHT, synced_at: GONE })).toBe(false);
    expect(isGhostUnit({ full_read_at: FULL_READ, stay_date: NIGHT, synced_at: null })).toBe(false);
    expect(isGhostUnit({ stay_date: NIGHT, synced_at: GONE })).toBe(false);
  });

  it("판정 창은 그 읽기 창(도쿄 어제 ~ +12개월)에서 양 끝 하루씩 줄인다 — 읽지 않은 날은 빼지 않는다", () => {
    // 2026-11-25 18:11 JST 읽기 → 읽기 창 2026-11-24 ~ 2027-11-25, 판정 창 2026-11-25 ~ 2027-11-24.
    expect(isGhostUnit({ full_read_at: FULL_READ, stay_date: "2026-11-24", synced_at: GONE })).toBe(false);
    expect(isGhostUnit({ full_read_at: FULL_READ, stay_date: "2026-11-25", synced_at: GONE })).toBe(true);
    expect(isGhostUnit({ full_read_at: FULL_READ, stay_date: "2027-11-24", synced_at: GONE })).toBe(true);
    expect(isGhostUnit({ full_read_at: FULL_READ, stay_date: "2027-11-25", synced_at: GONE })).toBe(false);
  });

  it("도쿄 자정 경계 — 창을 잡은 시각과 읽기 시작 시각이 날을 넘겨도 읽지 않은 날을 유령으로 보지 않는다", () => {
    // 안전망: 라우트가 23:59:50 JST 에 창(11-24 ~ 2027-11-25)을 잡고 건물 읽기는 00:00:10 JST(11-26)에 시작했다.
    // readAt 으로 다시 잡으면 창 끝이 2027-11-26 — 실제로 읽지 않은 날이다.
    const routeStart = "2026-11-25T14:59:50.000Z";
    const readStart = "2026-11-25T15:00:10.000Z";
    expect(isGhostUnit({ full_read_at: readStart, stay_date: "2027-11-26", synced_at: GONE })).toBe(false);
    expect(isGhostUnit({ full_read_at: readStart, stay_date: "2027-11-25", synced_at: GONE })).toBe(true);
    // 웹훅: 읽기 시작 23:59:50 JST, 창은 읽는 중 00:00:10 에 잡혀 시작이 11-25 — 11-24 는 읽지 않았다.
    expect(isGhostUnit({ full_read_at: routeStart, stay_date: "2026-11-24", synced_at: GONE })).toBe(false);
    expect(isGhostUnit({ full_read_at: routeStart, stay_date: "2026-11-25", synced_at: GONE })).toBe(true);
  });

  it("activeNightsOf — 밤마다 유령을 빼고 운영 중인 유닛이 있는 밤만", () => {
    const nights = activeNightsOf([
      { full_read_at: FULL_READ, min_stay: 99, stay_date: "2027-08-01", synced_at: FRESH },
      { full_read_at: FULL_READ, min_stay: 1, stay_date: "2027-08-01", synced_at: GONE },
      { full_read_at: FULL_READ, min_stay: 99, stay_date: "2027-08-02", synced_at: FRESH },
      { full_read_at: FULL_READ, min_stay: 2, stay_date: "2027-08-02", synced_at: FRESH },
    ]);
    expect([...nights]).toEqual(["2027-08-02"]);
  });

  it("수기 예약 · 옮기기 — activeExternalIdsByNight 는 유령 유닛을 고르지 않는다", () => {
    const units = [
      { external_room_id: "450096", id: "u-main" },
      { external_room_id: "648399", id: "u-cc" },
      { external_room_id: 496532, id: "u-gone" },
    ];
    const rates = [
      { full_read_at: FULL_READ, min_stay: 2, room_id: "u-main", stay_date: "2027-08-01", synced_at: FRESH },
      { full_read_at: FULL_READ, min_stay: 99, room_id: "u-cc", stay_date: "2027-08-01", synced_at: FRESH },
      { full_read_at: FULL_READ, min_stay: 1, room_id: "u-gone", stay_date: "2027-08-01", synced_at: GONE },
      { full_read_at: FULL_READ, min_stay: 99, room_id: "u-main", stay_date: "2027-08-02", synced_at: FRESH },
      { full_read_at: FULL_READ, min_stay: 99, room_id: "u-cc", stay_date: "2027-08-02", synced_at: FRESH },
      { full_read_at: FULL_READ, min_stay: 1, room_id: "u-gone", stay_date: "2027-08-02", synced_at: GONE },
    ];
    const byNight = activeExternalIdsByNight(units, rates, ["2027-08-01", "2027-08-02"]);
    expect(byNight.get("2027-08-01")).toEqual(["450096"]);
    // 유령만 활성인 밤 — 빈 목록이라 호출부가 no_active_unit 으로 막는다.
    expect(byNight.get("2027-08-02")).toEqual([]);
  });
});
