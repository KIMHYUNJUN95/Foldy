// 주문·비품 내보내기의 「무엇을 담나」 규칙 — 콘솔 보기마다 화면에 보이는 것과 파일이 같아야 한다(2026-11-10).
//
// - 전체 기록(`scope` 없음): 고른 기간(요청일) · 상태 · 긴급도 · 건물 · 검색어.
// - 처리 중(`scope: "open"`): 그 보기는 기간 고르기가 없다 — 종결 안 된 주문 전부(승인 대기 · 주문 대기 · 주문함). 예전엔 화면에
//   보이지 않는 기본 30일 기간이 같이 넘어가서, 한 달 넘게 묵은 요청이 파일에서 빠졌다. 건물 고르기만 따른다.
// 순수 모듈(서버 액션 `exportOrdersWorkbook` · `exportOrdersReport` 가 쓴다).
import { parseRequestDateRange, type RequestDateRangeFilter } from "@/lib/request-filters";
import type { Database } from "@/types/database";

type OrderRequestStatus = Database["public"]["Enums"]["order_request_status"];
const ORDER_STATUSES: readonly OrderRequestStatus[] = ["requested", "approved", "ordered", "received", "closed"];

export type OrdersExportFilters = {
  /** "open" = 처리 중 보기(기간 없음, 종결 제외). 그 외 값은 전체 기록 보기로 본다. */
  scope?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  /** "high" | "normal" — 그 외 값은 무시. */
  urgency?: string;
  /** 건물 한국어 원본 이름(= order_requests.building_name). */
  building?: string;
  /** 제목 · 요청자 · 품목명 검색어(콘솔 전체 기록 보기와 같은 규칙). */
  query?: string;
};

type ExportableOrder = {
  building_name: string;
  reporter_name: string;
  status: OrderRequestStatus;
  title: string;
  urgency: string;
  itemNames: string[];
};

export function isOpenScope(filters: OrdersExportFilters): boolean {
  return filters.scope === "open";
}

/** DB 에서 읽을 조건 — 처리 중 보기는 기간 · 상태 없이 읽고 아래에서 종결을 뺀다. */
export function ordersExportQuery(filters: OrdersExportFilters): {
  dateRange: RequestDateRangeFilter;
  status?: OrderRequestStatus;
} {
  if (isOpenScope(filters)) return { dateRange: {} };
  const status = (ORDER_STATUSES as readonly string[]).includes(filters.status ?? "")
    ? (filters.status as OrderRequestStatus)
    : undefined;
  return { dateRange: parseRequestDateRange(filters), status };
}

/** 읽어 온 주문에서 화면과 같은 것만 남긴다. */
export function filterOrdersForExport<T extends ExportableOrder>(orders: T[], filters: OrdersExportFilters): T[] {
  const open = isOpenScope(filters);
  const urgency = !open && (filters.urgency === "high" || filters.urgency === "normal") ? filters.urgency : undefined;
  const building = filters.building?.trim() || undefined;
  const q = open ? undefined : filters.query?.trim().toLowerCase().slice(0, 100) || undefined;
  return orders.filter((order) => {
    if (open && order.status === "closed") return false;
    if (urgency && order.urgency !== urgency) return false;
    if (building && order.building_name !== building) return false;
    if (
      q &&
      !(
        order.title.toLowerCase().includes(q) ||
        order.reporter_name.toLowerCase().includes(q) ||
        order.itemNames.some((name) => name.toLowerCase().includes(q))
      )
    ) {
      return false;
    }
    return true;
  });
}
