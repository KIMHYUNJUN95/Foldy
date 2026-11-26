import type { OpsCalendarBar } from "@/lib/ops-calendar";
import { isOpsBarShown, type OpsStatusFilterKey } from "@/lib/ops-calendar-status-filter";
import { barOccupiesRoom } from "@/lib/ops-reservation-kind";

/**
 * 판매 캘린더 **점유** — 「예약 표시」 필터와 무관하다(2026-11-26). **순수하다.**
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「예약 표시 — 상태 필터」
 *
 * 필터는 **무엇을 그릴지**만 정한다. 방이 찼는지(팔린 밤 · 1박 갭 · 오늘 빈방 · 옮기기 충돌 · 가격/최소박 고르기)는
 * 늘 **확정 예약 전부**로 본다 — 확정을 꺼도 팔린 밤은 팔린 밤이다. 예전에는 보이는 막대로 점유를 세서, 「취소」만
 * 켜면 팔린 밤이 1박 갭 · 빈 방이 되고 가격 · 최소박을 고를 수 있었다(독립 검사 2026-11-26).
 *
 * 그래서 서버가 행마다 `stays`(방을 차지하는 확정 숙박 — 필터와 무관)를 따로 싣고, 서버 · 데스크톱 · 모바일이
 * 모두 이것 하나로 점유를 센다. 판정은 `barOccupiesRoom` 하나다.
 */
/** 방을 차지하는 숙박 — 막대와 같은 모양이고 늘 확정(`kind: "confirmed"`)이다. 갭 맥락 · 옮기기 충돌이 채널 · 손님을 쓴다. */
export type OpsRoomStay = OpsCalendarBar;

/** 막대 전부 → (그릴 막대, 방을 차지하는 숙박). 그릴 막대는 필터로, 숙박은 필터와 무관하게 확정만. */
export function splitOpsBars(
  bars: readonly OpsCalendarBar[],
  filter: readonly OpsStatusFilterKey[],
): { shown: OpsCalendarBar[]; stays: OpsRoomStay[] } {
  const shown: OpsCalendarBar[] = [];
  const stays: OpsRoomStay[] = [];
  for (const bar of bars) {
    if (isOpsBarShown(bar.kind, filter)) shown.push(bar);
    if (barOccupiesRoom(bar)) stays.push(bar);
  }
  return { shown, stays };
}

/** 숙박이 차지하는 칸 → `행키|YYYY-MM-DD`. `dates` 를 주면 그 날짜만(격자 창), 안 주면 숙박의 모든 밤. */
export function opsStayCellKeys(stays: readonly OpsRoomStay[], dates?: readonly string[]): Set<string> {
  const cells = new Set<string>();
  for (const stay of stays) {
    if (dates) {
      for (const date of dates) if (date >= stay.checkIn && date < stay.checkOut) cells.add(`${stay.roomKey}|${date}`);
      continue;
    }
    for (let date = stay.checkIn; date < stay.checkOut; date = nextDay(date)) {
      cells.add(`${stay.roomKey}|${date}`);
      if (cells.size > 200_000) break;
    }
  }
  return cells;
}

/** 그 줄 그 숙박에 겹치는 확정 숙박(옮기기 충돌). 없으면 `null`. */
export function opsStayClash(
  stays: readonly OpsRoomStay[],
  roomKey: string,
  arrival: string,
  departure: string,
  excludeId: string,
): OpsRoomStay | null {
  for (const stay of stays) {
    if (stay.roomKey !== roomKey || stay.id === excludeId) continue;
    if (stay.checkIn < departure && stay.checkOut > arrival) return stay;
  }
  return null;
}

function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
