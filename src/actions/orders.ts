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
import { getSupabaseServiceClient } from "@/lib/supabase/service";

type OrderStatus = Database["public"]["Enums"]["order_request_status"];

/**
 * 알림 받는 사람이 이 조직의 active 멤버인가(2026-11-20). 알림을 서버 키로 만들면서 사라진 예전 INSERT 정책의 조건
 * (`memberships` 에 organization_id · user_id · status = 'active')을 여기서 다시 본다. 조회가 실패하거나 예외가 나도
 * false — 알림만 건너뛰고 발주 처리는 그대로 성공한다. 공용 `createNotification` 은 다른 호출자가 많아 건드리지 않는다.
 */
async function isActiveOrgMember(
  service: ReturnType<typeof getSupabaseServiceClient>,
  organizationId: string,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  try {
    const { data, error } = await service
      .from("memberships")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("status", "active")
      .limit(1);
    return !error && Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

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

// 허용되는 상태 전환(서버가 유일한 기준).
// ordered 로 가려면 먼저 approved 여야 한다 — requested → ordered 직행은 허용하지 않는다.
function isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
  switch (to) {
    case "approved": return from === "requested";
    case "ordered":  return from === "approved";
    case "closed":   return from !== "closed";
    default:         return false;
  }
}

// YYYY-MM-DD 형식만 받는다.
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

  // 역할 기반 권한: 사무 이상 역할(또는 `order_processor` 예외)만 상태를 바꿀 수 있다.
  if (!(await canProcessOrders(session.organization.id, session.user.id, session.user.role))) {
    return { ok: false, error: "forbidden" };
  }

  // ordered 로 전환할 때는 배송일이 필수다.
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
    // 동시 수정 덮어쓰기 방지: 검증한 상태에서만 전환한다. 다른
    // 사용자가 이미 옮겼다면 일치하는 행이 0개라 덮어쓰지 않고 invalid_transition 을 돌려준다.
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

    // 알림은 서버 키로 만든다 — 일반 사용자는 notifications 에 쓰지 못한다(202611200003, 05 → notifications).
    // 받는 사람이 이 조직의 active 멤버일 때만(예전 INSERT 정책이 보던 조건). 아니면 알림만 건너뛰고 처리는 그대로 성공.
    const service = getSupabaseServiceClient();
    if (await isActiveOrgMember(service, session.organization.id, current.reported_by_user_id)) {
      await createOrderProcessedNotification({
        supabase: service,
        organizationId: session.organization.id,
        recipientUserId: current.reported_by_user_id,
        processedByUserId: session.user.id,
        order: orderForNotification,
      });
    }
    revalidatePath("/mobile/notifications");
  }

  // 승인 · 주문 · 거절 모두 두 화면을 다시 그린다(2026-11-10 — 예전엔 주문 처리 때만 알림 화면을 재검증하고, 승인 · 거절 뒤엔
  // 부른 화면이 `router.refresh()` 로 때웠다. 다른 쪽 화면은 낡은 채로 남았다).
  revalidatePath("/mobile/requests");
  revalidatePath(`/mobile/requests/orders/${input.orderId}`);
  revalidatePath("/admin/orders");
  return { ok: true, status: input.targetStatus };
}

type UpdateDeliveryInput = {
  orderId: string;
  deliveryMode?: "exact" | "range";
  deliveryDate?: string;
  deliveryStartDate?: string;
  deliveryEndDate?: string;
};

// 이미 ordered 인 요청의 배송일을 고친다(사무 이상 역할). 상태는 그대로 두고
// delivery_date / 범위 컬럼만 갱신한다. 요청 배송 캘린더가 이 컬럼을
// 직접 읽으므로 수정이 자동 반영된다(별도 캘린더 항목 없음).
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
  // 배송일은 주문 처리가 끝난 뒤에만 의미가 있다. `received`(DB 에만 있는 비활성 단계 — 화면은 `ordered` 로 보여 준다)도 같이
  // 받는다 — 화면에 「배송일 수정」 단추가 보이는데 저장이 막혔다(2026-11-10, 문서 10 「received」).
  if (current.status !== "ordered" && current.status !== "received") {
    return { ok: false, error: "invalid_transition" };
  }

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
    // 검증한 상태(ordered · received)일 때만 수정한다. 0행이면 그 사이에 바뀐 것이다.
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

  // 요청자에게 배송일이 바뀐 것을 알린다(수정한 본인에게는 알리지 않음).
  // 알림은 서버 키로 만든다(202611200003). 받는 사람이 이 조직의 active 멤버가 아니면 알림만 건너뛴다.
  const service = getSupabaseServiceClient();
  if (await isActiveOrgMember(service, session.organization.id, current.reported_by_user_id)) {
    await createOrderDeliveryUpdatedNotification({
      supabase: service,
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
  }

  revalidatePath("/mobile/requests");
  revalidatePath(`/mobile/requests/orders/${input.orderId}`);
  revalidatePath("/mobile/notifications");
  revalidatePath("/admin/orders");
  return { ok: true, status: current.status };
}
