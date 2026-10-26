import "server-only";

// 관리자 주문·비품(order requests) 콘솔의 실데이터 레이어. `admin-lost-found.ts` 를 따른다:
// 화면용으로 가공된 평평한 뷰 모델, 조직 범위 쿼리(getOrgOrderRequests 경유), 그리고
// KPI 띠가 오해를 부르는 0 대신 "-" 를 보일 수 있게 하는 `loadError` 플래그.
//
// 상태 표시는 4상태(requested/approved/ordered/closed)로 좁힌다. DB enum의 비활성 단계 'received'는
// 콘솔에서 'ordered'로 매핑한다. 배송일/도쿄 날짜는 조회 시점에 파생한다.
// 참고: docs/product/10-order-request-workflow.md.

import {
  getOrgOrderRequests,
  parseOrderItems,
  type OrderRequestWithReporter,
} from "@/lib/order-requests";
import { resolveRequestLocation } from "@/lib/request-location";
import { getActiveRoomCatalogServer, type ActiveRoomCatalogItem } from "@/lib/rooms";
import type { AppSession } from "@/lib/session";

export type OrderDeliv =
  | { mode: "point"; date: string }
  | { mode: "range"; start: string; end: string };

export type OrderItemVM = {
  name: string;
  qty: string;
  link: string;
  memo: string;
  /** imageUrls?.length ?? 0 */
  photos: number;
  /** 품목 사진 주소(패널 썸네일 · 2026-10-14 화이트 리디자인). */
  photoUrls: string[];
  /** linkDomain(link) */
  domain: "amazon" | "ikea" | "other" | null;
};

export type AdminOrderVM = {
  /** 실제 uuid. */
  id: string;
  /** 표시용 짧은 번호. "#" + id.slice(0,6). */
  shortId: string;
  title: string;
  /** building_name 원본. */
  buildingKey: string;
  /** resolveRequestLocation 라벨 (없으면 building_name). */
  buildingLabel: string;
  /** room_label, "-"/"" → null. */
  room: string | null;
  reporterId: string;
  reporterName: string;
  /** "YYYY-MM-DD HH:MM" (Asia/Tokyo, created_at). */
  reqAt: string;
  /** "YYYY-MM-DD" (Asia/Tokyo). */
  reqDate: string;
  /** DB 'received' → 'ordered'. */
  status: "requested" | "approved" | "ordered" | "closed";
  urgency: "high" | "normal";
  /** 요청자 reason. */
  reason: string;
  /** admin_memo (거절 사유). */
  closedMemo: string;
  items: OrderItemVM[];
  itemCount: number;
  /** Σ parseInt(qty). */
  totalQty: number;
  /** items.some(domain != null). */
  hasLink: boolean;
  /** delivery_start&&end → range; else delivery_date → point; else null. */
  deliv: OrderDeliv | null;
};

export type AdminOrdersData = {
  orders: AdminOrderVM[];
  loadError: boolean;
  todayKey: string;
};

const TOKYO_TZ = "Asia/Tokyo";

/** 도쿄 기준 "YYYY-MM-DD". */
function tokyoDateKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TOKYO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** 도쿄 기준 "YYYY-MM-DD HH:MM". */
function tokyoStamp(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TOKYO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function todayKeyTokyo(): string {
  return tokyoDateKey(new Date().toISOString());
}

/** 링크 host로 판매처를 추정한다. http/https 아니면 null. */
export function linkDomain(url: string): "amazon" | "ikea" | "other" | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  let host: string;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    host = parsed.host.toLowerCase();
  } catch {
    return null;
  }
  if (host.includes("amazon.")) return "amazon";
  if (host.includes("ikea.")) return "ikea";
  return "other";
}

export async function getAdminOrders(
  session: AppSession,
  /** 건물 라벨 사전 (dictionary.cleaning.buildingLabels) — 청소 콘솔과 같은 표기를 쓰기 위해. */
  buildingLabels: Record<string, string>,
): Promise<AdminOrdersData> {
  let loadError = false;

  const [rawOrders, roomCatalog] = await Promise.all([
    getOrgOrderRequests(session).catch(() => {
      loadError = true;
      return [] as OrderRequestWithReporter[];
    }),
    getActiveRoomCatalogServer(session.organization.id).catch(() => undefined),
  ]);

  const catalog: ActiveRoomCatalogItem[] | undefined = roomCatalog;
  const todayKey = todayKeyTokyo();

  const orders: AdminOrderVM[] = rawOrders.map((row) => {
    const location = resolveRequestLocation(
      row.room_label,
      catalog,
      buildingLabels,
      row.building_name,
    );

    const parsed = parseOrderItems(row.items);
    const items: OrderItemVM[] = parsed.map((item) => ({
      name: item.name,
      qty: item.quantity,
      link: item.link,
      memo: item.memo,
      photos: item.imageUrls?.length ?? 0,
      photoUrls: item.imageUrls ?? [],
      domain: linkDomain(item.link),
    }));

    const totalQty = items.reduce((sum, item) => {
      const n = parseInt(item.qty, 10);
      return sum + (Number.isNaN(n) ? 0 : n);
    }, 0);

    const status: AdminOrderVM["status"] =
      row.status === "received" ? "ordered" : (row.status as AdminOrderVM["status"]);

    const deliv: OrderDeliv | null =
      row.delivery_start_date && row.delivery_end_date
        ? { mode: "range", start: row.delivery_start_date, end: row.delivery_end_date }
        : row.delivery_date
          ? { mode: "point", date: row.delivery_date }
          : null;

    const roomLabel = location.roomLabel;
    const room = roomLabel && roomLabel !== "-" ? roomLabel : null;

    return {
      id: row.id,
      shortId: `#${row.id.slice(0, 6)}`,
      title: row.title,
      buildingKey: row.building_name,
      buildingLabel: location.buildingLabel ?? row.building_name,
      room,
      reporterId: row.reported_by_user_id,
      reporterName: row.reporter_name,
      reqAt: tokyoStamp(row.created_at),
      reqDate: tokyoDateKey(row.created_at),
      status,
      urgency: row.urgency === "high" ? "high" : "normal",
      reason: row.reason ?? "",
      closedMemo: row.admin_memo ?? "",
      items,
      itemCount: items.length,
      totalQty,
      hasLink: items.some((item) => item.domain != null),
      deliv,
    };
  });

  return { orders, loadError, todayKey };
}
