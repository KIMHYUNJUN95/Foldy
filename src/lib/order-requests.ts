import type { AppSession } from "@/lib/session";
import { getTimestampRange, type RequestDateFilter } from "@/lib/request-filters";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";

export type OrderRequestRow = Database["public"]["Tables"]["order_requests"]["Row"];
export type OrderRequestStatus = Database["public"]["Enums"]["order_request_status"];
export type OrderRequestUrgency = Database["public"]["Enums"]["order_request_urgency"];

export const orderRequestStatuses: readonly OrderRequestStatus[] = [
  "requested",
  "approved",
  "ordered",
  "received",
  "closed",
];

export type OrderRequestItem = {
  id: string;
  imageUrls?: string[];
  link: string;
  memo: string;
  name: string;
  quantity: string;
};

export type OrderRequestWithReporter = OrderRequestRow & {
  reporter_name: string;
};

type ProfileName = { id: string; name: string };
type OrderRequestFilters = RequestDateFilter & { status?: OrderRequestStatus };

export function parseOrderItems(value: Json): OrderRequestItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const name = String(record.name ?? "").trim();
    const quantity = String(record.quantity ?? "").trim();
    if (!name || !quantity) return [];
    const rawImageUrls = record.imageUrls;
    const imageUrls =
      Array.isArray(rawImageUrls)
        ? rawImageUrls.filter((u): u is string => typeof u === "string" && u.length > 0)
        : undefined;
    return [{
      id: String(record.id ?? ""),
      imageUrls: imageUrls && imageUrls.length > 0 ? imageUrls : undefined,
      link: String(record.link ?? ""),
      memo: String(record.memo ?? ""),
      name,
      quantity,
    }];
  });
}

async function attachReporterNames(
  items: OrderRequestRow[],
): Promise<OrderRequestWithReporter[]> {
  if (items.length === 0) return [];
  const supabase = await getSupabaseServerClient();
  const reporterIds = Array.from(new Set(items.map((i) => i.reported_by_user_id)));
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, name")
    .in("id", reporterIds);
  const names = new Map(
    ((profiles ?? []) as ProfileName[]).map((p) => [p.id, p.name] as const),
  );
  return items.map((item) => ({
    ...item,
    items: parseOrderItems(item.items) as unknown as Json,
    reporter_name: names.get(item.reported_by_user_id) ?? "",
  }));
}

export async function getOrgOrderRequests(
  session: AppSession,
  filters: OrderRequestFilters = {},
): Promise<OrderRequestWithReporter[]> {
  const supabase = await getSupabaseServerClient();
  const range = getTimestampRange(filters);
  let query = supabase
    .from("order_requests")
    .select("*")
    .eq("organization_id", session.organization.id);
  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  if (range.from) {
    query = query.gte("created_at", range.from);
  }
  if (range.to) {
    query = query.lt("created_at", range.to);
  }
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("does not exist") || msg.includes("schema cache")) {
      console.warn("[order-requests] table unavailable, returning empty list:", msg);
      return [];
    }
    throw new Error(msg);
  }
  return attachReporterNames((data ?? []) as OrderRequestRow[]);
}

export async function getOrderRequestById(
  session: AppSession,
  id: string,
): Promise<OrderRequestWithReporter | null> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("order_requests")
    .select("*")
    .eq("id", id)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("does not exist") || msg.includes("schema cache")) {
      console.warn("[order-requests] detail unavailable, returning null:", msg);
      return null;
    }
    // URL 의 잘못된(UUID 아닌) id → 500 오류가 아니라 없음으로 처리한다.
    if (error.code === "22P02") return null;
    throw new Error(msg);
  }
  if (!data) return null;
  const row = data as OrderRequestRow;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, name")
    .eq("id", row.reported_by_user_id)
    .maybeSingle();
  return {
    ...row,
    items: parseOrderItems(row.items) as unknown as Json,
    reporter_name: (profile as ProfileName | null)?.name ?? "",
  };
}
