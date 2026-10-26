"use server";

import { revalidatePath } from "next/cache";
import { adminNavigation, getNavigationLabel } from "@/config/navigation";
import { requireAdminSession } from "@/lib/admin-session";
import { buildAdminExportMeta, compactRangePart, type AdminExportMeta } from "@/lib/admin-export-meta";
import type { AdminReportExportResult, AdminWorkbookExportResult } from "@/lib/admin-export-result";
import { buildAdminTableReportHtml } from "@/lib/admin-table-report";
import {
  buildAdminTableWorkbookBase64,
  type AdminTableColumn,
  type AdminTableSheet,
} from "@/lib/admin-table-workbook";
import { getDictionary } from "@/lib/i18n";
import { canProcessOrders } from "@/lib/order-permissions";
import {
  getOrgOrderRequests,
  orderRequestStatuses,
  parseOrderItems,
  type OrderRequestItem,
  type OrderRequestStatus,
} from "@/lib/order-requests";
import { parseRequestDateRange } from "@/lib/request-filters";
import { resolveRequestLocation } from "@/lib/request-location";
import { getActiveRoomCatalogServer } from "@/lib/rooms";
import type { AppSession } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";

// Excel / PDF 내보내기 for 주문·비품. Replaced the old CSV download on 2026-07-14 — the client sends
// only the current filter values and this action re-queries the list server-side, so the file always
// matches exactly what the filtered screen shows. Rendering goes through the canonical admin table
// exporters (src/lib/admin-table-workbook.ts / admin-table-report.ts) shared by every /admin/* export.
// See docs/product/10-order-request-workflow.md.

export type OrdersExportFilters = {
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

function parseStatus(value: string | undefined): OrderRequestStatus | undefined {
  return (orderRequestStatuses as readonly string[]).includes(value ?? "")
    ? (value as OrderRequestStatus)
    : undefined;
}

function rangeSuffix(filters: OrdersExportFilters): string {
  const parts = [filters.startDate, filters.endDate]
    .filter((v): v is string => Boolean(v))
    .map(compactRangePart);
  return parts.length ? `_${parts.join("_")}` : "";
}

async function buildOrdersSheet(
  session: AppSession,
  filters: OrdersExportFilters,
  meta: AdminExportMeta,
): Promise<AdminTableSheet> {
  const dictionary = getDictionary(meta.locale);
  const form = dictionary.mobile.orderForm;
  const detail = dictionary.mobile.orderDetail;
  const dateRange = parseRequestDateRange(filters);
  const status = parseStatus(filters.status);

  const [allOrders, roomCatalog] = await Promise.all([
    getOrgOrderRequests(session, { ...dateRange, status }),
    getActiveRoomCatalogServer(session.organization.id).catch(() => undefined),
  ]);

  // 화면에 보이는 것과 같은 결과가 나가도록 긴급도 · 건물 · 검색어도 서버에서 거른다.
  const urgency = filters.urgency === "high" || filters.urgency === "normal" ? filters.urgency : undefined;
  const building = filters.building?.trim() || undefined;
  const q = filters.query?.trim().toLowerCase().slice(0, 100) || undefined;
  const orders = allOrders.filter((order) => {
    if (urgency && order.urgency !== urgency) return false;
    if (building && order.building_name !== building) return false;
    if (
      q &&
      !(
        order.title.toLowerCase().includes(q) ||
        order.reporter_name.toLowerCase().includes(q) ||
        parseOrderItems(order.items).some((item) => item.name.toLowerCase().includes(q))
      )
    ) {
      return false;
    }
    return true;
  });

  const columns: AdminTableColumn[] = [
    { key: "building", label: dictionary.cleaning.manualBuildingLabel, width: 15, printWidth: 12 },
    { key: "location", label: detail.locationTitle, width: 12, printWidth: 9 },
    { key: "title", label: detail.title, width: 24, printWidth: 17, wrap: true },
    { key: "status", label: dictionary.common.status, width: 13, printWidth: 10 },
    { key: "urgency", label: form.urgency, width: 10, printWidth: 8 },
    { key: "requester", label: detail.requesterTitle, width: 15, printWidth: 11 },
    { key: "createdAt", label: detail.createdLabel, width: 18, printWidth: 14 },
    { key: "items", label: form.itemsTitle, width: 34, printWidth: 15, wrap: true },
  ];

  const formatter = new Intl.DateTimeFormat(meta.localeTag, {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const navItem = adminNavigation.find((item) => item.id === "orders");
  const title = navItem
    ? getNavigationLabel(navItem, meta.locale)
    : dictionary.mobile.quickActions.order;

  return {
    sheetName: title,
    title,
    rangeLabel:
      dateRange.startDate && dateRange.endDate
        ? `${dateRange.startDate} – ${dateRange.endDate}`
        : undefined,
    colNoLabel: meta.shared.colNo,
    totalLabel: meta.shared.exportTotalLabel,
    columns,
    rows: orders.map((order) => {
      const location = resolveRequestLocation(
        order.room_label,
        roomCatalog,
        dictionary.cleaning.buildingLabels,
      );
      const items = parseOrderItems(order.items);
      return {
        building: location.buildingLabel ?? order.building_name,
        location: location.roomLabel,
        title: order.title,
        status: dictionary.mobile.orderStatusLabels[order.status],
        urgency: order.urgency === "high" ? form.urgencyHigh : form.urgencyNormal,
        requester: order.reporter_name,
        createdAt: formatter.format(new Date(order.created_at)),
        items: items.map((item) => `${item.name} x${item.quantity}`).join("; "),
      };
    }),
  };
}

export async function exportOrdersWorkbook(
  filters: OrdersExportFilters,
): Promise<AdminWorkbookExportResult> {
  const session = await requireAdminSession();
  try {
    const meta = buildAdminExportMeta(session);
    const sheet = await buildOrdersSheet(session, filters, meta);
    if (sheet.rows.length === 0) return { ok: false, reason: "empty" };

    const base64 = await buildAdminTableWorkbookBase64({
      orgName: meta.orgName,
      generatedLabel: meta.generatedLabel,
      sheets: [sheet],
    });
    return {
      ok: true,
      filename: `orders${rangeSuffix(filters)}.xlsx`,
      base64,
      rowCount: sheet.rows.length,
    };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function exportOrdersReport(
  filters: OrdersExportFilters,
): Promise<AdminReportExportResult> {
  const session = await requireAdminSession();
  try {
    const meta = buildAdminExportMeta(session);
    const sheet = await buildOrdersSheet(session, filters, meta);
    if (sheet.rows.length === 0) return { ok: false, reason: "empty" };

    const html = buildAdminTableReportHtml({
      orgName: meta.orgName,
      generatedLabel: meta.generatedLabel,
      printLabel: meta.shared.exportPrint,
      localeTag: meta.localeTag,
      sheets: [sheet],
    });
    return { ok: true, html, rowCount: sheet.rows.length };
  } catch {
    return { ok: false, reason: "error" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 어드민 주문·비품 콘솔 — 예외 개입 액션(거절/재오픈/상태 정정/내용 수정).
//
// 일반 처리(승인/주문처리/배송일수정/삭제)는 기존 액션을 콘솔 클라이언트가 직접 재사용한다:
// updateOrderRequestStatus·updateOrderDeliveryDate(src/actions/orders.ts),
// deleteOrderRequest(src/actions/request-delete.ts). 아래는 관리자 예외 경로다.
// 권한은 모바일 주문 처리와 같은 `canProcessOrders`(사무실 쪽 역할 + `order_processor` 예외)다.
// 2026-10-19 까지는 청소 강제완료 게이트(canForceCompleteCleaning)를 잘못 써서 현장 관리자는 거절·정정이
// 되고 CS 직원은 막혀 있었다(문서 10 과 반대).
// See docs/product/10-order-request-workflow.md.

type OrderActionResult =
  | { ok: true }
  | { ok: false; reason: "forbidden" | "invalid" | "not_found" | "failed" };

function isValidUUID(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function revalidateOrders() {
  revalidatePath("/admin/orders");
  revalidatePath("/mobile/requests");
}

// 예외 개입의 공통 진입 가드: 세션 · 역할 게이트 · UUID.
async function requireOrderAction(orderId: string) {
  const session = await requireAdminSession();
  if (!(await canProcessOrders(session.organization.id, session.user.id, session.user.role))) {
    return { ok: false as const, result: { ok: false, reason: "forbidden" } as OrderActionResult };
  }
  if (!isValidUUID(orderId)) {
    return { ok: false as const, result: { ok: false, reason: "invalid" } as OrderActionResult };
  }
  return { ok: true as const, session };
}

// 진행 중인 건을 거절/종결한다. admin_memo에 거절 사유를 남기고 배송 정보는 초기화한다.
export async function rejectOrder(input: {
  orderId: string;
  reason: string;
}): Promise<OrderActionResult> {
  const gate = await requireOrderAction(input.orderId);
  if (!gate.ok) return gate.result;
  const { session } = gate;

  const supabase = await getSupabaseServerClient();
  const { data: existing } = await supabase
    .from("order_requests")
    .select("id, status, admin_memo")
    .eq("id", input.orderId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (!existing) return { ok: false, reason: "not_found" };
  const current = existing as { status: Database["public"]["Tables"]["order_requests"]["Row"]["status"]; admin_memo: string | null };
  if (current.status === "closed") {
    return { ok: false, reason: "invalid" };
  }

  const { data: updated, error } = await supabase
    .from("order_requests")
    .update({
      status: "closed",
      // 사유를 안 적었으면 기존 메모를 지우지 않는다.
      admin_memo: input.reason.trim() || current.admin_memo,
      delivery_date: null,
      delivery_start_date: null,
      delivery_end_date: null,
    })
    .eq("id", input.orderId)
    .eq("organization_id", session.organization.id)
    .eq("status", current.status)
    .select("id");

  if (error) return { ok: false, reason: "failed" };
  // 0행 = 읽은 뒤 다른 사람이 상태를 바꿨다.
  if (!updated || updated.length === 0) return { ok: false, reason: "invalid" };

  revalidateOrders();
  return { ok: true };
}

// 종결된 건을 다시 승인 대기로 되돌린다. 배송 정보와 거절 사유를 초기화한다.
export async function reopenOrder(input: {
  orderId: string;
}): Promise<OrderActionResult> {
  const gate = await requireOrderAction(input.orderId);
  if (!gate.ok) return gate.result;
  const { session } = gate;

  const supabase = await getSupabaseServerClient();
  const { data: existing } = await supabase
    .from("order_requests")
    .select("id, status")
    .eq("id", input.orderId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (!existing) return { ok: false, reason: "not_found" };
  if ((existing as { status: string }).status !== "closed") {
    return { ok: false, reason: "invalid" };
  }

  const { data: updated, error } = await supabase
    .from("order_requests")
    .update({
      status: "requested",
      delivery_date: null,
      delivery_start_date: null,
      delivery_end_date: null,
      admin_memo: null,
    })
    .eq("id", input.orderId)
    .eq("organization_id", session.organization.id)
    .eq("status", "closed")
    .select("id");

  if (error) return { ok: false, reason: "failed" };
  if (!updated || updated.length === 0) return { ok: false, reason: "invalid" };

  revalidateOrders();
  return { ok: true };
}

// 관리자가 잘못된 상태를 임의 상태로 되돌리는 예외 경로. requested/approved면 배송 정보를 비우고,
// closed가 아니면 거절 사유(admin_memo)를 지운다.
export async function correctOrderStatus(input: {
  orderId: string;
  status: "requested" | "approved" | "ordered" | "closed";
  memo: string;
}): Promise<OrderActionResult> {
  const gate = await requireOrderAction(input.orderId);
  if (!gate.ok) return gate.result;
  const { session } = gate;

  if (!["requested", "approved", "ordered", "closed"].includes(input.status)) {
    return { ok: false, reason: "invalid" };
  }

  const supabase = await getSupabaseServerClient();
  const { data: existing } = await supabase
    .from("order_requests")
    .select("id, status, admin_memo, delivery_date, delivery_start_date")
    .eq("id", input.orderId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (!existing) return { ok: false, reason: "not_found" };
  const current = existing as {
    status: Database["public"]["Tables"]["order_requests"]["Row"]["status"];
    admin_memo: string | null;
    delivery_date: string | null;
    delivery_start_date: string | null;
  };
  if (current.status === input.status) return { ok: false, reason: "invalid" };

  const updatePayload: Database["public"]["Tables"]["order_requests"]["Update"] = { status: input.status };
  if (input.status === "requested" || input.status === "approved") {
    updatePayload.delivery_date = null;
    updatePayload.delivery_start_date = null;
    updatePayload.delivery_end_date = null;
  } else if (input.status === "ordered" && !current.delivery_date && !current.delivery_start_date) {
    // 주문처리(ordered)는 배송일이 있어야 한다 — 없으면 정정이 아니라 배송일 지정부터.
    return { ok: false, reason: "invalid" };
  }
  const memo = input.memo.trim();
  if (input.status === "closed") {
    if (memo) updatePayload.admin_memo = memo;
  } else if (current.status === "closed") {
    // 종결(거절) 건을 되돌릴 때만 거절 사유를 지운다. 그 외 상태 사이 정정은 메모를 건드리지 않는다.
    updatePayload.admin_memo = null;
  }

  const { data: updated, error } = await supabase
    .from("order_requests")
    .update(updatePayload)
    .eq("id", input.orderId)
    .eq("organization_id", session.organization.id)
    .eq("status", current.status)
    .select("id");

  if (error) return { ok: false, reason: "failed" };
  if (!updated || updated.length === 0) return { ok: false, reason: "invalid" };

  revalidateOrders();
  return { ok: true };
}

// 주문 내용(제목/긴급도/사유/품목)을 관리자가 직접 수정한다. 품목 사진(imageUrls)은 기존 항목에서
// 보존한다 — 이름이 같거나 같은 인덱스의 기존 항목을 찾아 imageUrls와 id를 물려준다.
export async function editOrder(input: {
  orderId: string;
  title: string;
  urgency: "high" | "normal";
  reason: string;
  items: { name: string; qty: string; link: string; memo: string }[];
}): Promise<OrderActionResult> {
  const gate = await requireOrderAction(input.orderId);
  if (!gate.ok) return gate.result;
  const { session } = gate;

  if (input.urgency !== "high" && input.urgency !== "normal") {
    return { ok: false, reason: "invalid" };
  }

  const supabase = await getSupabaseServerClient();
  const { data: existing } = await supabase
    .from("order_requests")
    .select("id, title, items")
    .eq("id", input.orderId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (!existing) return { ok: false, reason: "not_found" };

  const existingRow = existing as { id: string; title: string; items: Json };
  const previousItems = parseOrderItems(existingRow.items);

  const cleaned = input.items.filter((item) => item.name.trim().length > 0);
  if (cleaned.length === 0) return { ok: false, reason: "invalid" };

  const used = new Set<number>();
  const nextItems: OrderRequestItem[] = cleaned.map((item, index) => {
    const name = item.name.trim();
    // 사진 보존: 같은 이름의 미사용 기존 항목을 먼저, 없으면 같은 인덱스를 매칭한다.
    let matchIndex = previousItems.findIndex(
      (prev, i) => !used.has(i) && prev.name === name,
    );
    if (matchIndex === -1 && index < previousItems.length && !used.has(index)) {
      matchIndex = index;
    }
    const match = matchIndex >= 0 ? previousItems[matchIndex] : undefined;
    if (matchIndex >= 0) used.add(matchIndex);

    const imageUrls = match?.imageUrls;
    return {
      id: match?.id || crypto.randomUUID(),
      name,
      quantity: item.qty.trim() || "1",
      link: item.link.trim(),
      memo: item.memo.trim(),
      ...(imageUrls && imageUrls.length > 0 ? { imageUrls } : {}),
    };
  });

  const { data: updated, error } = await supabase
    .from("order_requests")
    .update({
      title: input.title.trim() || existingRow.title,
      urgency: input.urgency,
      reason: input.reason.trim(),
      items: nextItems as unknown as Json,
    })
    .eq("id", input.orderId)
    .eq("organization_id", session.organization.id)
    .select("id");

  if (error) return { ok: false, reason: "failed" };
  if (!updated || updated.length === 0) return { ok: false, reason: "not_found" };

  revalidateOrders();
  return { ok: true };
}
