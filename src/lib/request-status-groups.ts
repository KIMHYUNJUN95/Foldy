import type { Database } from "@/types/database";

type LostItemStatus = Database["public"]["Enums"]["lost_item_status"];
type MaintenanceStatus = Database["public"]["Enums"]["maintenance_status"];
type OrderStatus = Database["public"]["Enums"]["order_request_status"];

/** 줄 오른쪽 상태 글자 톤 — 묶음(진행 중 / 끝남) 판정도 이 값 하나에서 나온다(done 이면 끝남). */
export type RequestRowTone = "open" | "prog" | "done" | "soon";

export const activeLostStatuses: ReadonlySet<LostItemStatus> = new Set<LostItemStatus>(["registered", "stored", "disposal_scheduled"]);
export const activeMaintenanceStatuses: ReadonlySet<MaintenanceStatus> = new Set<MaintenanceStatus>(["open", "in_progress"]);
export const activeOrderStatuses: ReadonlySet<OrderStatus> = new Set<OrderStatus>(["requested", "approved", "ordered"]);

/** 분실물 — 보관 중이고 자동 폐기 3일 이내 · 만료면 soon(빨간 점). `clock` 은 `lostItemClock()` 결과. */
export function lostRowTone(status: LostItemStatus, clock: { isDueSoon: boolean; isExpired: boolean } | null): RequestRowTone {
  if (clock && (clock.isDueSoon || clock.isExpired)) return "soon";
  return activeLostStatuses.has(status) ? "open" : "done";
}

export function maintenanceRowTone(status: MaintenanceStatus): RequestRowTone {
  if (status === "in_progress") return "prog";
  return activeMaintenanceStatuses.has(status) ? "open" : "done";
}

export function orderRowTone(status: OrderStatus): RequestRowTone {
  return activeOrderStatuses.has(status) ? "open" : "done";
}

/**
 * 모바일 요청 목록(「전체」 · 수리 탭)의 묶음 — 날짜 대신 「진행 중」 위 · 「끝남」 아래(2026-11-27 unslop).
 * 끝남 = 줄 상태 글자가 done 톤인 것. 각 묶음 안 순서는 들어온 순서 그대로 둔다.
 */
export function splitRequestRowsByStatus<T extends { done: boolean }>(rows: readonly T[]): { open: T[]; done: T[] } {
  const open: T[] = [];
  const done: T[] = [];
  for (const row of rows) (row.done ? done : open).push(row);
  return { open, done };
}

/** 줄 오른쪽 날짜 「M/D」 — 도쿄 운영 날짜. */
export function tokyoMonthDayLabel(value: string): string {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
  const [, m, d] = key.split("-");
  return `${Number(m)}/${Number(d)}`;
}
