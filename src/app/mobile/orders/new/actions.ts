"use server";

import { redirect } from "next/navigation";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getActiveRoomCatalogServer } from "@/lib/rooms";
import { isOwnStoragePublicUrl } from "@/lib/storage-url-guard";
import type { Database, Json } from "@/types/database";

type RawOrderItem = {
  id?: string;
  imageUrls?: unknown;
  link?: string;
  memo?: string;
  name?: string;
  quantity?: string;
};

const REQUEST_IMAGE_BUCKET = "request-images";
/** 품목 하나에 붙일 수 있는 사진 장수(업로드 공통 5장 정책). */
const MAX_IMAGES_PER_ITEM = 5;

function cleanText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function parseItems(value: string): RawOrderItem[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item === "object") as RawOrderItem[];
  } catch {
    return [];
  }
}

export async function createOrderRequest(formData: FormData) {
  const session = await getCurrentAppSession();
  if (!session) {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/orders/new")}`);
  }

  const requestedId = cleanText(formData.get("id"));
  const buildingName = cleanText(formData.get("buildingName"));
  const reason = cleanText(formData.get("reason"));
  const urgency = cleanText(formData.get("urgency"));
  const itemsJson = cleanText(formData.get("itemsJson"));

  if (!buildingName) {
    redirect("/mobile/orders/new?error=missing_building");
  }

  // Validate buildingName against the org's active room catalog.
  // Fail closed when catalog is unavailable so spoofed values cannot be saved.
  if (hasOrganizationContext(session)) {
    const catalog = await getActiveRoomCatalogServer(session.organization.id).catch(() => null);
    if (!catalog || catalog.length === 0) {
      redirect("/mobile/orders/new?error=save_failed");
    }
    const validBuildings = new Set(catalog.map((item) => item.propertyName));
    if (!validBuildings.has(buildingName)) {
      redirect("/mobile/orders/new?error=invalid_building");
    }
  }

  if (requestedId && !isValidUuid(requestedId)) {
    redirect("/mobile/orders/new?error=save_failed");
  }
  if (urgency !== "normal" && urgency !== "high") {
    redirect("/mobile/orders/new?error=save_failed");
  }

  const requestId = requestedId || crypto.randomUUID();
  // 품목 사진 주소는 우리 Storage 의 `{조직}/order-images/{요청 id}/{파일}` 아래만 받고, 품목마다 5장까지(2026-10-26).
  // 예전엔 http(s) 로 시작하기만 하면 아무 주소나 저장됐고 장수도 서버가 보지 않았다.
  const imagePrefix = `${session.organization.id}/order-images/${requestId}/`;
  let invalidImages = false;

  const parsedItems = parseItems(itemsJson)
    .map((item) => {
      const rawImageUrls = item.imageUrls;
      const imageUrls = Array.isArray(rawImageUrls)
        ? rawImageUrls.filter((u): u is string => typeof u === "string" && u.length > 0)
        : undefined;
      if (imageUrls) {
        if (
          imageUrls.length > MAX_IMAGES_PER_ITEM ||
          !imageUrls.every((u) => isOwnStoragePublicUrl(u, REQUEST_IMAGE_BUCKET, imagePrefix))
        ) {
          invalidImages = true;
        }
      }
      return {
        id: String(item.id ?? ""),
        ...(imageUrls && imageUrls.length > 0 ? { imageUrls } : {}),
        link: String(item.link ?? "").trim(),
        memo: String(item.memo ?? "").trim(),
        name: String(item.name ?? "").trim(),
        quantity: String(item.quantity ?? "").trim(),
      };
    })
    .filter((item) => item.name.length > 0 && Number(item.quantity) > 0);

  if (invalidImages) {
    redirect("/mobile/orders/new?error=save_failed");
  }

  if (parsedItems.length === 0) {
    redirect("/mobile/orders/new?error=missing_items");
  }

  const title = parsedItems[0].name;
  const description = parsedItems[0].memo || null;
  const roomLabel = "-";

  const insert: Database["public"]["Tables"]["order_requests"]["Insert"] = {
    id: requestId,
    building_name: buildingName,
    description,
    items: parsedItems as unknown as Json,
    organization_id: session.organization.id,
    reason: reason || null,
    reported_by_user_id: session.user.id,
    room_label: roomLabel,
    title,
    urgency: urgency as Database["public"]["Enums"]["order_request_urgency"],
  };

  const supabase = await getSupabaseServerClient();
  const { data: created, error } = await supabase
    .from("order_requests")
    .insert(insert)
    .select("id")
    .single();
  const createdId = (created as { id: string } | null)?.id ?? null;

  if (error || !createdId) {
    redirect("/mobile/orders/new?error=save_failed");
  }

  redirect(`/mobile/requests/orders/${createdId}?created=1&type=order`);
}
