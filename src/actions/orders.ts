"use server";

import { revalidatePath } from "next/cache";
import { canProcessOrders } from "@/lib/order-permissions";
import {
  createOrderDeliveryUpdatedNotification,
  createOrderProcessedNotification,
} from "@/lib/notifications/create";
import type { Database } from "@/types/database";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type OrderStatus = Database["public"]["Enums"]["order_request_status"];

type UpdateOrderStatusInput = {
  orderId: string;
  targetStatus: OrderStatus;
  deliveryMode?: "exact" | "range";
  deliveryDate?: string;
  deliveryStartDate?: string;
  deliveryEndDate?: string;
  /** 거절(closed) 시 요청자에게 보여줄 사유. 어드민 `rejectOrder`와 같은 `admin_memo` 컬럼에 남는다. */
  reason?: string;
};

type UpdateOrderStatusResult =
  | { ok: true; status: OrderStatus }
  | { ok: false; error:
      | "unauthorized"
      | "forbidden"
      | "invalid_transition"
      | "not_found"
      | "save_failed"
      | "missing_delivery_date"
      | "invalid_delivery_date"
      | "missing_delivery_range"
      | "invalid_delivery_range"
    };

/**
 * 현재 사용자가 주문 상태를 처리할 수 있는지 — UI(상세 액션 바 노출)와 서버 게이트가 같은 판정을
 * 쓰도록 노출한다. 판단 로직을 화면 쪽에 복제하면 역할 집합이 두 곳에서 어긋난다.
 */
export async function canCurrentUserProcessOrders(): Promise<boolean> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return false;
  return canProcessOrders(session.organization.id, session.user.id, session.user.role);
}

// Allowed status transitions (server is the single source of truth).
// ordered requires approved first — requested → ordered direct is not allowed.
function isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
  switch (to) {
    case "approved": return from === "requested";
    case "ordered":  return from === "approved";
    case "closed":   return from !== "closed";
    default:         return false;
  }
}

// Accepts YYYY-MM-DD only.
function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return (
    date.getFullYear() === y &&
    date.getMonth() === m - 1 &&
    date.getDate() === d
  );
}

export async function updateOrderRequestStatus(
  input: UpdateOrderStatusInput,
): Promise<UpdateOrderStatusResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) {
    return { ok: false, error: "unauthorized" };
  }

  // Role-based authorization: office-level roles (or an `order_processor` override) may change status.
  if (!(await canProcessOrders(session.organization.id, session.user.id, session.user.role))) {
    return { ok: false, error: "forbidden" };
  }

  // Delivery date is required when transitioning to ordered.
  if (input.targetStatus === "ordered") {
    const mode = input.deliveryMode ?? "exact";
    if (mode === "range") {
      if (!input.deliveryStartDate || !input.deliveryEndDate) {
        return { ok: false, error: "missing_delivery_range" };
      }
      if (
        !isValidDateString(input.deliveryStartDate) ||
        !isValidDateString(input.deliveryEndDate)
      ) {
        return { ok: false, error: "invalid_delivery_range" };
      }
      if (input.deliveryStartDate > input.deliveryEndDate) {
        return { ok: false, error: "invalid_delivery_range" };
      }
    } else {
      if (!input.deliveryDate) return { ok: false, error: "missing_delivery_date" };
      if (!isValidDateString(input.deliveryDate)) return { ok: false, error: "invalid_delivery_date" };
    }
  }

  const supabase = await getSupabaseServerClient();
  const { data: rawCurrent, error: fetchError } = await supabase
    .from("order_requests")
    .select(
      "id, status, organization_id, reported_by_user_id, title, building_name, room_label, delivery_date, delivery_start_date, delivery_end_date",
    )
    .eq("id", input.orderId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  const current = rawCurrent as {
    id: string;
    status: OrderStatus;
    organization_id: string;
    reported_by_user_id: string;
    title: string;
    building_name: string;
    room_label: string;
    delivery_date: string | null;
    delivery_start_date: string | null;
    delivery_end_date: string | null;
  } | null;

  if (fetchError) {
    return { ok: false, error: "save_failed" };
  }
  if (!current) {
    return { ok: false, error: "not_found" };
  }

  if (!isValidTransition(current.status, input.targetStatus)) {
    return { ok: false, error: "invalid_transition" };
  }

  const updatePayload: Database["public"]["Tables"]["order_requests"]["Update"] = { status: input.targetStatus };
  if (input.targetStatus === "ordered") {
    const mode = input.deliveryMode ?? "exact";
    if (mode === "range" && input.deliveryStartDate && input.deliveryEndDate) {
      updatePayload.delivery_date = input.deliveryStartDate;
      updatePayload.delivery_start_date = input.deliveryStartDate;
      updatePayload.delivery_end_date = input.deliveryEndDate;
    } else if (input.deliveryDate) {
      updatePayload.delivery_date = input.deliveryDate;
      updatePayload.delivery_start_date = null;
      updatePayload.delivery_end_date = null;
    }
  }
  if (input.targetStatus === "closed") {
    // 거절/종결은 배송 정보를 정리한다 — 남겨두면 종결된 주문의 배송이 요청 탭 배송 캘린더에 계속 뜬다.
    // 어드민 `rejectOrder`(src/app/admin/orders/actions.ts)와 동일한 처리.
    updatePayload.delivery_date = null;
    updatePayload.delivery_start_date = null;
    updatePayload.delivery_end_date = null;
    // 거절 사유는 요청자가 상세에서 볼 수 있도록 `admin_memo`에 남긴다(어드민과 같은 컬럼).
    const reason = input.reason?.trim();
    if (reason) updatePayload.admin_memo = reason;
  }

  const { data: updatedRows, error: updateError } = await supabase
    .from("order_requests")
    .update(updatePayload)
    .eq("id", input.orderId)
    .eq("organization_id", session.organization.id)
    // Guard against a lost update: only transition from the status we validated against. If another
    // user already moved it, 0 rows match and we report invalid_transition instead of overwriting.
    .eq("status", current.status)
    .select("id");

  if (updateError) {
    const msg = updateError.message.toLowerCase();
    if (msg.includes("permission") || msg.includes("policy") || msg.includes("denied")) {
      return { ok: false, error: "forbidden" };
    }
    return { ok: false, error: "save_failed" };
  }
  if (!updatedRows || updatedRows.length === 0) {
    return { ok: false, error: "invalid_transition" };
  }

  if (input.targetStatus === "ordered") {
    const orderForNotification = {
      ...current,
      delivery_date:
        (updatePayload.delivery_date as string | null | undefined) ?? current.delivery_date,
      delivery_start_date:
        updatePayload.delivery_start_date !== undefined
          ? (updatePayload.delivery_start_date as string | null)
          : current.delivery_start_date,
      delivery_end_date:
        updatePayload.delivery_end_date !== undefined
          ? (updatePayload.delivery_end_date as string | null)
          : current.delivery_end_date,
    };

    await createOrderProcessedNotification({
      supabase,
      organizationId: session.organization.id,
      recipientUserId: current.reported_by_user_id,
      processedByUserId: session.user.id,
      order: orderForNotification,
    });
    revalidatePath("/mobile/notifications");
  }

  return { ok: true, status: input.targetStatus };
}

type UpdateDeliveryInput = {
  orderId: string;
  deliveryMode?: "exact" | "range";
  deliveryDate?: string;
  deliveryStartDate?: string;
  deliveryEndDate?: string;
};

// Edit the delivery date of an already-ordered request (office-level roles). Status is unchanged —
// only the delivery_date / range columns are updated. The Requests delivery calendar reads these
// columns directly, so it reflects the edit automatically (no separate calendar entry).
export async function updateOrderDeliveryDate(
  input: UpdateDeliveryInput,
): Promise<UpdateOrderStatusResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) {
    return { ok: false, error: "unauthorized" };
  }

  if (!(await canProcessOrders(session.organization.id, session.user.id, session.user.role))) {
    return { ok: false, error: "forbidden" };
  }

  const mode = input.deliveryMode ?? "exact";
  if (mode === "range") {
    if (!input.deliveryStartDate || !input.deliveryEndDate) {
      return { ok: false, error: "missing_delivery_range" };
    }
    if (!isValidDateString(input.deliveryStartDate) || !isValidDateString(input.deliveryEndDate)) {
      return { ok: false, error: "invalid_delivery_range" };
    }
    if (input.deliveryStartDate > input.deliveryEndDate) {
      return { ok: false, error: "invalid_delivery_range" };
    }
  } else {
    if (!input.deliveryDate) return { ok: false, error: "missing_delivery_date" };
    if (!isValidDateString(input.deliveryDate)) return { ok: false, error: "invalid_delivery_date" };
  }

  const supabase = await getSupabaseServerClient();
  const { data: rawCurrent, error: fetchError } = await supabase
    .from("order_requests")
    .select("id, status, reported_by_user_id, title, building_name, room_label")
    .eq("id", input.orderId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  const current = rawCurrent as {
    id: string;
    status: OrderStatus;
    reported_by_user_id: string;
    title: string;
    building_name: string;
    room_label: string;
  } | null;

  if (fetchError) return { ok: false, error: "save_failed" };
  if (!current) return { ok: false, error: "not_found" };
  // Delivery date is only meaningful once the order has been processed.
  if (current.status !== "ordered") return { ok: false, error: "invalid_transition" };

  const updatePayload: Database["public"]["Tables"]["order_requests"]["Update"] =
    mode === "range" && input.deliveryStartDate && input.deliveryEndDate
      ? {
          delivery_date: input.deliveryStartDate,
          delivery_start_date: input.deliveryStartDate,
          delivery_end_date: input.deliveryEndDate,
        }
      : { delivery_date: input.deliveryDate, delivery_start_date: null, delivery_end_date: null };

  const { data: updatedRows, error: updateError } = await supabase
    .from("order_requests")
    .update(updatePayload)
    .eq("id", input.orderId)
    .eq("organization_id", session.organization.id)
    // Only edit while still in the status we validated (ordered); 0 rows → it changed under us.
    .eq("status", current.status)
    .select("id");

  if (updateError) {
    const msg = updateError.message.toLowerCase();
    if (msg.includes("permission") || msg.includes("policy") || msg.includes("denied")) {
      return { ok: false, error: "forbidden" };
    }
    return { ok: false, error: "save_failed" };
  }
  if (!updatedRows || updatedRows.length === 0) {
    return { ok: false, error: "invalid_transition" };
  }

  // Notify the requester that the delivery date changed (self-suppressed for the editor).
  await createOrderDeliveryUpdatedNotification({
    supabase,
    organizationId: session.organization.id,
    recipientUserId: current.reported_by_user_id,
    editedByUserId: session.user.id,
    order: {
      id: current.id,
      title: current.title,
      building_name: current.building_name,
      room_label: current.room_label,
      delivery_date: (updatePayload.delivery_date as string | null) ?? null,
      delivery_start_date: (updatePayload.delivery_start_date as string | null) ?? null,
      delivery_end_date: (updatePayload.delivery_end_date as string | null) ?? null,
    },
  });

  revalidatePath("/mobile/requests");
  revalidatePath("/mobile/notifications");
  return { ok: true, status: "ordered" };
}
