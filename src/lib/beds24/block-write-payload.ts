/**
 * 블록(차단) 쓰기 페이로드 — **순수 함수만.** Beds24 왕복은 호출부가 한다.
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「저쪽 블록의 실제 규칙」
 * 원본: STAY ARI Manager `functions/index.js`
 *   → `createBeds24BlackoutOverride`(7664) · `clearBeds24BlackoutOverride`(7689)
 *
 * ## 블록은 예약이 아니다
 *
 * Beds24 에서 방을 막는 표현은 **인벤토리 오버라이드**다 —
 * `POST /inventory/rooms/calendar` 에 `override: "blackout"`. 저쪽 `createBooking` 이
 * `isBlock` 이면 `/bookings` 를 아예 부르지 않고 이 경로로 빠진다.
 *
 * ## 날짜는 「밤」이다
 *
 * 체크인 10/1 · 체크아웃 10/4 면 막히는 밤은 **10/1 · 10/2 · 10/3** 이다. 10/4 는 아침에
 * 나가는 날이라 그날 밤은 팔 수 있다. 저쪽 `getInventoryOverrideEndDate` 가 `departure - 1`
 * 을 쓰는 이유이고, 우리 `room_blocks.start_date`/`end_date`(양끝 포함)와 같은 규칙이다.
 *
 * 이 모듈은 **밤 범위를 그대로 받는다.** 체크아웃 날짜를 받아서 빼지 않는다 — 두 규칙이
 * 한 코드베이스에 섞이면 어느 쪽인지 매번 확인해야 한다.
 *
 * ## 해제는 `override: none` 만으로는 부족하다
 *
 * blackout 을 걸면 Beds24 가 그 날짜의 재고를 건드린다. 그냥 풀면 **막기 전 재고로 돌아가지
 * 않는다.** 그래서 막기 전에 numAvail 을 찍어 두었다가 해제할 때 같이 써넣는다.
 * 스냅샷이 없는 블록(사람이 Beds24 화면에서 직접 건 것)은 **재고를 건드리지 않고** 오버라이드만
 * 푼다 — 모르는 값을 추측해서 쓰는 것보다 그대로 두는 쪽이 안전하다.
 */

import {
  type CalendarSegment,
  consolidateCalendarRanges,
} from "@/lib/beds24/calendar-write-payload";

/** 가격 쓰기와 **같은 구간 타입**을 쓴다 — 구간을 합치는 규칙도 같아야 한다. */
export type Beds24RoomCalendarPayload = { roomId: number; calendar: CalendarSegment[] };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type BlockRangeError = "invalid_date" | "range_reversed" | "invalid_room_id";

export type BlockRange = { startDate: string; endDate: string };

/**
 * 밤 범위를 검증한다. **하루짜리 블록은 유효하다**(`start === end`) — 그날 밤 하나를 막는 것이다.
 *
 * 저쪽은 체크인/체크아웃을 받아서 `departure > arrival` 을 요구했다. 우리는 밤 범위를 받으므로
 * 같은 날이 정상이고, 뒤집힌 범위만 막는다.
 */
export function validateBlockRange(range: BlockRange): BlockRangeError | null {
  if (!DATE_PATTERN.test(range.startDate) || !DATE_PATTERN.test(range.endDate)) {
    return "invalid_date";
  }
  if (range.endDate < range.startDate) return "range_reversed";
  return null;
}

/** `YYYY-MM-DD` 밤 범위를 날짜 배열로. 시간대에 의존하지 않도록 문자열로만 센다. */
export function eachNight(range: BlockRange): string[] {
  const nights: string[] = [];
  // UTC 정오로 고정한다 — 자정으로 만들면 DST 없는 UTC 라도 파서 구현 차이에 걸릴 여지가 있다.
  const cursor = new Date(`${range.startDate}T12:00:00Z`);
  const last = new Date(`${range.endDate}T12:00:00Z`);
  while (cursor.getTime() <= last.getTime()) {
    nights.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return nights;
}

/**
 * 블록을 거는 페이로드. 같은 밤 범위의 여러 방을 **한 번의 POST** 로 묶는다.
 *
 * 듀얼 ID 객실은 모든 roomId 가 같은 구간이라 따로 보내면 왕복(약 3.5초)이 그 수만큼 직렬로
 * 쌓인다 — 저쪽이 `createBeds24BlackoutOverrideBatch` 를 만든 이유와 같다.
 */
export function buildBlockSegments(args: {
  externalRoomIds: string[];
  range: BlockRange;
}): Beds24RoomCalendarPayload[] {
  const seen = new Set<string>();
  const payloads: Beds24RoomCalendarPayload[] = [];
  for (const raw of args.externalRoomIds) {
    const id = String(raw ?? "").trim();
    if (!id || seen.has(id)) continue;
    const numeric = Number(id);
    if (!Number.isInteger(numeric) || numeric <= 0) continue;
    seen.add(id);
    payloads.push({
      roomId: numeric,
      calendar: [{ from: args.range.startDate, to: args.range.endDate, override: "blackout" }],
    });
  }
  return payloads;
}

/**
 * 블록을 푸는 페이로드.
 *
 * `preBlockNumAvail` 이 있으면 날짜별로 재고를 같이 써넣는다. 값이 날짜마다 다를 수 있어
 * 하루씩 구간을 만든 뒤 **같은 값이 이어지는 구간만 합친다**(`consolidateCalendarRanges`) —
 * 저쪽도 같은 순서로 한다. 스냅샷이 없는 날짜는 `override: none` 만 보낸다.
 */
export function buildUnblockSegments(args: {
  externalRoomId: string;
  range: BlockRange;
  preBlockNumAvail?: Record<string, number> | null;
  /** 이 밤들만 푼다(구간 안). 보상 롤백이 **원래 막혀 있지 않던 밤**만 되돌릴 때 쓴다. 없으면 구간 전부. */
  onlyNights?: readonly string[];
}): Beds24RoomCalendarPayload | null {
  const numeric = Number(String(args.externalRoomId ?? "").trim());
  if (!Number.isInteger(numeric) || numeric <= 0) return null;

  const only = args.onlyNights ? new Set(args.onlyNights) : null;
  const nights = eachNight(args.range).filter((night) => !only || only.has(night));
  if (nights.length === 0) return null;
  const perNight: CalendarSegment[] = nights.map((night) => {
    const restored = args.preBlockNumAvail?.[night];
    const segment: CalendarSegment = { from: night, to: night, override: "none" };
    if (typeof restored === "number" && Number.isInteger(restored) && restored >= 0) {
      segment.numAvail = restored;
    }
    return segment;
  });

  return { roomId: numeric, calendar: consolidateCalendarRanges(perNight) };
}

/**
 * 되읽기 검증 — 걸었으면 `blackout`, 풀었으면 `blackout 아님`이어야 한다.
 *
 * **Beds24 는 아무것도 안 들어갔어도 `success: true` 를 준다.** 가격 쓰기에서 이미 겪었다
 * (`price-write-verification.ts`). 블록은 틀리면 「팔리면 안 되는 방이 팔린다」 또는
 * 「팔아야 할 방이 잠긴다」라 되읽기를 건너뛸 수 없다.
 */
export function diffBlockReadback(args: {
  nights: string[];
  /** 되읽은 날짜별 override. 없으면 `null`. */
  actual: Map<string, string | null>;
  expect: "blackout" | "cleared";
}): string[] {
  const mismatched: string[] = [];
  for (const night of args.nights) {
    const override = args.actual.get(night) ?? null;
    const isBlackout = override === "blackout";
    if (args.expect === "blackout" ? !isBlackout : isBlackout) mismatched.push(night);
  }
  return mismatched;
}

/**
 * 특정 밤들만 다시 막는 페이로드 — 해제가 일부만 들어갔을 때 **풀린 밤을 차단으로 되돌린다**(2026-10-19).
 * 우리 표는 아직 그 구간을 「막힘」으로 들고 있으므로, Beds24 를 그쪽에 맞춰야 둘이 어긋나지 않는다.
 */
export function buildBlockNightSegments(args: {
  externalRoomId: string;
  nights: readonly string[];
}): Beds24RoomCalendarPayload | null {
  const numeric = Number(String(args.externalRoomId ?? "").trim());
  if (!Number.isInteger(numeric) || numeric <= 0 || args.nights.length === 0) return null;
  return {
    calendar: consolidateCalendarRanges(
      [...new Set(args.nights)].map((night) => ({ from: night, override: "blackout", to: night })),
    ),
    roomId: numeric,
  };
}

/**
 * 막기 전 스냅샷에 넣을 재고 — **이미 막혀 있던 밤은 뺀다**(2026-10-19). 막힌 동안 읽은 재고는 「막기 전 재고」가 아니라,
 * 겹쳐 건 차단을 풀 때 그 값을 복원하면 재고가 막힌 상태 값으로 고정된다.
 */
export function preBlockNumAvailOf(args: {
  overrides: ReadonlyMap<string, string | null>;
  numAvail: Readonly<Record<string, number>>;
}): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [night, value] of Object.entries(args.numAvail)) {
    if (args.overrides.get(night) === "blackout") continue;
    result[night] = value;
  }
  return result;
}

export type BlockSnapshotRow = {
  id: string;
  external_room_id: string;
  start_date: string;
  end_date: string;
  created_at: string;
  pre_block_num_avail: unknown;
};

function readNumAvailMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [night, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) result[night] = raw;
  }
  return result;
}

/**
 * 해제할 구간과 **겹치는** 스냅샷들 → 방별 · 밤별 복원 재고(2026-10-19).
 *
 * 전에는 시작일 · 종료일이 **똑같은** 스냅샷만 찾았다. 그래서 10/1~10/5 차단에서 10/2~10/3 만 풀거나, 끊긴 날짜가 여러
 * 구간으로 나뉘어 풀리면 스냅샷을 못 찾아 재고를 복원하지 않았다 — 막을 때 Beds24 가 줄인 재고가 그대로 남아 방이 안 팔릴
 * 수 있었다. 이제 밤 단위로 맞춘다. 같은 밤이 여러 스냅샷에 있으면 **먼저 만든 것**(막기 전에 더 가까운 값)을 쓴다.
 */
export function mergeSnapshotNumAvail(
  rows: readonly BlockSnapshotRow[],
  range: BlockRange,
): Map<string, Record<string, number>> {
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const byRoom = new Map<string, Record<string, number>>();
  for (const row of sorted) {
    const values = readNumAvailMap(row.pre_block_num_avail);
    const target = byRoom.get(row.external_room_id) ?? {};
    for (const [night, value] of Object.entries(values)) {
      if (night < range.startDate || night > range.endDate) continue;
      if (night < row.start_date || night > row.end_date) continue;
      if (night in target) continue;
      target[night] = value;
    }
    byRoom.set(row.external_room_id, target);
  }
  return byRoom;
}

function shiftDate(date: string, days: number): string {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/**
 * 해제가 끝난 뒤 스냅샷에서 **푼 밤만 잘라 낸다**(`room_blocks` 의 `trimBlockRows` 와 같은 규칙, 2026-10-19).
 * 겹친 줄은 지우고, 구간 앞 · 뒤에 남는 밤이 있으면 그 밤의 재고만 들고 새 줄로 남긴다 — 나머지 밤을 나중에 풀 때 복원할 값이다.
 */
export function planSnapshotTrim(
  rows: readonly BlockSnapshotRow[],
  range: BlockRange,
): {
  deleteIds: string[];
  keep: Array<{
    external_room_id: string;
    start_date: string;
    end_date: string;
    created_at: string;
    pre_block_num_avail: Record<string, number>;
  }>;
} {
  const deleteIds: string[] = [];
  const keep: ReturnType<typeof planSnapshotTrim>["keep"] = [];
  for (const row of rows) {
    if (row.end_date < range.startDate || row.start_date > range.endDate) continue;
    deleteIds.push(row.id);
    const values = readNumAvailMap(row.pre_block_num_avail);
    const pieces: Array<{ start: string; end: string }> = [];
    if (row.start_date < range.startDate) pieces.push({ end: shiftDate(range.startDate, -1), start: row.start_date });
    if (row.end_date > range.endDate) pieces.push({ end: row.end_date, start: shiftDate(range.endDate, 1) });
    for (const piece of pieces) {
      const kept: Record<string, number> = {};
      for (const [night, value] of Object.entries(values)) {
        if (night >= piece.start && night <= piece.end) kept[night] = value;
      }
      keep.push({
        created_at: row.created_at,
        end_date: piece.end,
        external_room_id: row.external_room_id,
        pre_block_num_avail: kept,
        start_date: piece.start,
      });
    }
  }
  return { deleteIds, keep };
}
