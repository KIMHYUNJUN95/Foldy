/**
 * 가격·최소숙박 **되돌리기** 계획 — 어느 칸을 어떤 값으로 다시 보낼지. **순수하다.**
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「수정 되돌리기」
 *
 * - 그 작업의 칸 이력(이전 → 이후)에서 **이전 값**으로 보낸다.
 * - **지금 값이 그 작업이 쓴 값과 다르면 건너뛴다** — 그 뒤에 누가(다른 사람 · Beds24) 고쳤다. 되돌리면 더 새 값을
 *   지운다.
 * - 이전 값이 없거나 이전 = 이후인 칸은 보내지 않는다.
 * - 최소숙박은 판매 중 값(1~49)으로만 되돌린다 — 50+ 는 유닛을 닫는 값이다. 가격은 0 보다 커야 한다.
 * - 차단(`blackout`)은 1 = 막힘 · 0 = 열림. 지금 값도 같은 0/1 로 넘긴다.
 * - 같은 (유닛, 날짜)가 여러 번 나오면 첫 줄만 쓴다.
 */
import { groupSelectionIntoRanges } from "@/lib/ops-calendar-selection";

export type RevertField = "price1" | "min_stay" | "blackout";

export type RevertLog = {
  room_id: string | null;
  room_label: string | null;
  stay_date: string;
  old_value: number | null;
  new_value: number | null;
};

export type RevertCell = { roomId: string; roomLabel: string | null; stayDate: string; value: number };

export function planRevertCells(args: {
  field: RevertField;
  logs: readonly RevertLog[];
  /** `${roomId}|${stayDate}` → 지금 값. */
  current: ReadonlyMap<string, number | null>;
}): { cells: RevertCell[]; skippedChanged: number } {
  const cells: RevertCell[] = [];
  const seen = new Set<string>();
  let skippedChanged = 0;
  for (const log of args.logs) {
    if (!log.room_id || log.old_value === null || log.old_value === log.new_value) continue;
    const valid =
      args.field === "price1"
        ? log.old_value > 0
        : args.field === "blackout"
          ? log.old_value === 0 || log.old_value === 1
          : log.old_value >= 1 && log.old_value < 50;
    if (!valid) continue;
    const key = `${log.room_id}|${log.stay_date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if ((args.current.get(key) ?? null) !== log.new_value) {
      skippedChanged += 1;
      continue;
    }
    cells.push({ roomId: log.room_id, roomLabel: log.room_label, stayDate: log.stay_date, value: log.old_value });
  }
  return { cells, skippedChanged };
}

/**
 * 차단 되돌리기 칸을 **구간 상한(`runBlockChange` 의 60)** 안으로 나눈다 — 큰 묶음(1,000칸 넘는 Beds24 변경 등)이 한 번에
 * 넘어가면 상한에 걸려 통째로 거절됐다(2026-10-19). 구간은 차단 쓰기와 같은 규칙으로 센다(`groupSelectionIntoRanges`).
 * 한 구간은 쪼개지 않는다.
 */
export function chunkCellsByRanges<T extends { roomKey: string; date: string }>(
  cells: readonly T[],
  maxRanges: number,
): T[][] {
  const byRoom = new Map<string, T[]>();
  for (const cell of cells) {
    const list = byRoom.get(cell.roomKey);
    if (list) list.push(cell);
    else byRoom.set(cell.roomKey, [cell]);
  }
  const ranges = groupSelectionIntoRanges(cells.map((cell) => ({ date: cell.date, roomKey: cell.roomKey })));
  const size = Math.max(1, maxRanges);
  const chunks: T[][] = [];
  for (let index = 0; index < ranges.length; index += size) {
    const chunk: T[] = [];
    for (const range of ranges.slice(index, index + size)) {
      for (const cell of byRoom.get(range.roomKey) ?? []) {
        if (cell.date >= range.startDate && cell.date <= range.endDate) chunk.push(cell);
      }
    }
    chunks.push(chunk);
  }
  return chunks;
}
