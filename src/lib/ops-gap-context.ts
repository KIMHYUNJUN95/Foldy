/**
 * 1박 갭의 **앞뒤 맥락** — 「무엇과 무엇 사이에 낀 하루인가」.
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「1박 갭 감지」
 * 시안: Claude Design 「Foldy 운영 관리자 영역」 `6-minstay.dc.html` → 갭 목록
 *
 * ## 왜 필요한가
 *
 * 목록에 `402호 · 12/3` 만 적혀 있으면 **그게 진짜 팔 수 없는 날인지 확인하러 격자를 다시
 * 봐야 한다.** 「Booking ▸ 1박 ▸ Airbnb」 라고 적혀 있으면 목록만 보고 판단할 수 있다.
 * 저쪽 화면에도 갭 옆에 앞뒤 예약이 같이 나온다.
 *
 * ## 판정
 *
 * 갭 날짜 `D` 를 기준으로:
 *
 * - **앞**: `checkOut === D` 인 예약 (그날 아침에 나갔다) 또는 `D-1` 을 덮는 블록
 * - **뒤**: `checkIn === D + 1` 인 예약 (다음 날 들어온다) 또는 `D+1` 을 덮는 블록
 *
 * 예약 막대는 체크인~체크아웃이고 **체크아웃 날 밤은 비어 있다.** 그래서 앞 예약은
 * `checkOut === D`, 뒤 예약은 `checkIn === D + 1` 이다 — 하나만 밀려도 엉뚱한 예약이 붙는다.
 *
 * 취소된 예약은 맥락이 아니다. 취소된 자리는 **비어 있는 것**이고, 그 옆의 하루를 「낀 하루」로
 * 만들지 않는다.
 *
 * ## 순수하다
 *
 * DB·네트워크를 모른다. 날짜 산술이 곧 규칙이라 테스트로 고정한다
 * (`src/lib/__tests__/ops-gap-context.test.ts`).
 */

import type { OpsCalendarBar, OpsCalendarBlock, OpsCalendarChannel } from "@/lib/ops-calendar";
import { barOccupiesRoom } from "@/lib/ops-reservation-kind";

/** 갭 한쪽에 무엇이 있는가. `none` 은 「과거라서 못 판다」 또는 「경계 밖」이다. */
export type GapNeighbor = { kind: OpsCalendarChannel | "block" | "none" };

export type GapContextEntry = {
  roomKey: string;
  roomLabel: string;
  /** 건물. 방 번호만으로는 어느 건물인지 모른다 — 여러 건물의 갭을 한 번에 고른다. */
  propertyName: string;
  date: string;
  before: GapNeighbor;
  after: GapNeighbor;
};

/** `YYYY-MM-DD` 하루 이동. 시간대에 의존하지 않도록 UTC 정오로 고정한다. */
export function shiftDay(date: string, days: number): string {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

function coversDate(block: { startDate: string; endDate: string }, date: string): boolean {
  return block.startDate <= date && date <= block.endDate;
}

/**
 * 갭 칸들의 앞뒤 맥락을 만든다.
 *
 * `gapCells` 는 `roomKey|YYYY-MM-DD` 집합 — `ops-calendar.ts` 가 만드는 그 형식 그대로다.
 * 방 순서·날짜 순서로 정렬해 돌려준다. 목록이 매번 다른 순서로 나오면 「뭐가 바뀐 거지?」가 된다.
 */
export function buildGapContext(args: {
  gapCells: ReadonlySet<string>;
  bars: readonly OpsCalendarBar[];
  blocks: readonly OpsCalendarBlock[];
  roomLabels: ReadonlyMap<string, string>;
  /** 행 키 → 건물. 없으면 빈 문자열. */
  propertyNames?: ReadonlyMap<string, string>;
  /** 행 키 → 격자에서의 순서. 주면 **격자와 같은 순서**로 정렬한다(건물 순서 포함). */
  roomOrder?: ReadonlyMap<string, number>;
}): GapContextEntry[] {
  const barsByRoom = new Map<string, OpsCalendarBar[]>();
  for (const bar of args.bars) {
    // 문의 · 요청은 갭의 앞뒤 손님이 아니다(2026-11-26).
    if (!barOccupiesRoom(bar)) continue;
    const list = barsByRoom.get(bar.roomKey);
    if (list) list.push(bar);
    else barsByRoom.set(bar.roomKey, [bar]);
  }

  const blocksByRoom = new Map<string, OpsCalendarBlock[]>();
  for (const block of args.blocks) {
    const list = blocksByRoom.get(block.roomKey);
    if (list) list.push(block);
    else blocksByRoom.set(block.roomKey, [block]);
  }

  const entries: GapContextEntry[] = [];
  for (const key of args.gapCells) {
    const separator = key.indexOf("|");
    if (separator < 0) continue;
    const roomKey = key.slice(0, separator);
    const date = key.slice(separator + 1);
    const roomBars = barsByRoom.get(roomKey) ?? [];
    const roomBlocks = blocksByRoom.get(roomKey) ?? [];

    entries.push({
      roomKey,
      roomLabel: args.roomLabels.get(roomKey) ?? roomKey,
      propertyName: args.propertyNames?.get(roomKey) ?? "",
      date,
      before: neighborAt(roomBars, roomBlocks, { checkOut: date, blockDate: shiftDay(date, -1) }),
      after: neighborAt(roomBars, roomBlocks, {
        checkIn: shiftDay(date, 1),
        blockDate: shiftDay(date, 1),
      }),
    });
  }

  const order = args.roomOrder;
  return entries.sort((a, b) => {
    if (a.roomKey === b.roomKey) return a.date.localeCompare(b.date);
    if (order) {
      const byGrid = (order.get(a.roomKey) ?? Infinity) - (order.get(b.roomKey) ?? Infinity);
      if (byGrid !== 0 && Number.isFinite(byGrid)) return byGrid;
    }
    return a.roomLabel === b.roomLabel
      ? a.date.localeCompare(b.date)
      : a.roomLabel.localeCompare(b.roomLabel, "ko");
  });
}

function neighborAt(
  bars: readonly OpsCalendarBar[],
  blocks: readonly OpsCalendarBlock[],
  probe: { checkIn?: string; checkOut?: string; blockDate: string },
): GapNeighbor {
  // 예약이 블록보다 구체적이다 — 둘 다 있으면 손님 쪽을 보여준다.
  for (const bar of bars) {
    if (probe.checkOut && bar.checkOut === probe.checkOut) return { kind: bar.channel };
    if (probe.checkIn && bar.checkIn === probe.checkIn) return { kind: bar.channel };
  }
  for (const block of blocks) {
    if (coversDate(block, probe.blockDate)) return { kind: "block" };
  }
  return { kind: "none" };
}
