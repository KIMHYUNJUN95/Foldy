"use server";

// 현장(모바일) 분실물 처리 — 상태 변경 + 처리 메모 + 증빙 사진.
// 2026-07-15 신설. 그 전까지 모바일 상세는 상태를 "보여주기만" 했고(읽기 전용 진행바), 상태를
// 바꿀 경로가 없었다. 수리·점검(202607160001)과 동일한 매커니즘을 분실물에 이식한다.
//
// 핵심 요구사항: "반환은 등록자와 무관하게 누구나 처리할 수 있고, 누가·언제 처리했는지 기록으로 남는다."
//   → 권한 = part_time_staff 제외 전원. 앱에서 먼저 끊고, DB의 RLS UPDATE 정책이 최종 게이트다
//     (마이그레이션 202607170001에서 staff 추가). RLS가 행을 걸러내면 Supabase는 "0행 + 에러 없음"을
//     돌려주므로, 영향 행 수를 확인하지 않으면 권한 없는 사용자에게도 "처리됨"이라고 응답하게 된다.

import { revalidatePath } from "next/cache";
import {
  isLostItemStatus,
  isLostReturnMethod,
  LOST_FOUND_HANDLING_IMAGE_LIMIT,
  type LostItemStatus,
  type LostReturnMethod,
} from "@/lib/lost-found-constants";
import { getCurrentAppSession } from "@/lib/session";
import { isOwnStoragePublicUrl } from "@/lib/storage-url-guard";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isValidLostItemTransition, splitLostFoundHandlingMemo } from "@/lib/lost-found-handling";
import type { Database } from "@/types/database";

const REQUEST_IMAGE_BUCKET = "request-images";
const HANDLING_FOLDER = "lost-found-handling";

export type LostItemHandlingInput = {
  itemId: string;
  status: LostItemStatus;
  /** 화면을 열 때 본 상태. 그 사이 다른 사람이 바꿨으면 덮어쓰지 않고 conflict(2026-10-26). */
  expectedStatus?: LostItemStatus;
  memo: string;
  /** 이번에 새로 올린 증빙 사진만. 서버가 이미 저장된 사진 뒤에 붙인다(덮어쓰지 않음, 2026-10-26). */
  handlingImageUrls: string[];
  /** 반환완료(returned)로 넘어갈 때의 반환 방식(필수). 어드민 `returnLostItem`과 같은 컬럼에 기록한다. */
  returnMethod?: LostReturnMethod;
  /** 배송 반환일 때의 송장번호. 손님 클레임 시 증빙이 된다. */
  returnTrackingNo?: string;
};

export type LostItemHandlingResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "forbidden"
        | "not_found"
        | "invalid"
        | "save_failed"
        | "too_many_photos"
        | "conflict"
        | "return_method_required";
    };

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// 상태 전이 규칙(`isValidLostItemTransition`)은 모바일 처리 폼과 같이 쓰도록 `@/lib/lost-found-handling` 에 있다.

/** 증빙 사진 URL이 반드시 우리 Storage 의 {orgId}/lost-found-handling/{itemId}/{file} 아래인지 검증한다. */
function isOwnHandlingImage(url: string, organizationId: string, itemId: string): boolean {
  return isOwnStoragePublicUrl(url, REQUEST_IMAGE_BUCKET, `${organizationId}/${HANDLING_FOLDER}/${itemId}/`);
}

export async function updateLostItemHandling(
  input: LostItemHandlingInput,
): Promise<LostItemHandlingResult> {
  const session = await getCurrentAppSession();
  if (!session) return { ok: false, error: "forbidden" };
  // 분실물 처리 = 권한 키 `lost_found.handle`(역할 기본: 아르바이트 빼고 전원, 사람마다 켜고 끔 — 2026-10-21). RLS 도 같은 키로 본다.
  if (!session.capabilities.includes("lost_found.handle")) return { ok: false, error: "forbidden" };

  const { itemId, memo, handlingImageUrls } = input;
  if (!isValidUuid(itemId)) return { ok: false, error: "invalid" };
  if (!isLostItemStatus(input.status)) return { ok: false, error: "invalid" };
  if (!Array.isArray(handlingImageUrls) || typeof memo !== "string") return { ok: false, error: "invalid" };
  if (handlingImageUrls.length > LOST_FOUND_HANDLING_IMAGE_LIMIT) {
    return { ok: false, error: "invalid" };
  }
  for (const url of handlingImageUrls) {
    if (!isOwnHandlingImage(url, session.organization.id, itemId)) {
      return { ok: false, error: "invalid" };
    }
  }

  const returnMethod =
    input.returnMethod && isLostReturnMethod(input.returnMethod) ? input.returnMethod : null;
  if (input.returnMethod && !returnMethod) return { ok: false, error: "invalid" };

  const supabase = await getSupabaseServerClient();
  const { data: existingRow } = await supabase
    .from("lost_items")
    .select("id, status, handling_memo, handling_image_urls")
    .eq("id", itemId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (!existingRow) return { ok: false, error: "not_found" };
  const existing = existingRow as {
    id: string;
    status: LostItemStatus;
    handling_memo: string | null;
    handling_image_urls: string[] | null;
  };

  const currentStatus = existing.status;
  if (input.expectedStatus !== undefined && input.expectedStatus !== existing.status) {
    return { ok: false, error: "conflict" };
  }
  if (!isValidLostItemTransition(currentStatus, input.status)) {
    return { ok: false, error: "invalid" };
  }

  // 반환완료로 새로 넘어갈 때는 반환 방식(직접 수령 | 배송)이 반드시 있어야 한다(문서 09 「능동 처리 — 반환 처리」).
  // 예전 모바일은 방식을 묻지 않아 return_method 가 비어 저장됐다. 송장번호는 어드민과 같이 선택.
  const becomingReturned = input.status === "returned" && currentStatus !== "returned";
  if (becomingReturned && !returnMethod) return { ok: false, error: "return_method_required" };

  // 증빙 사진은 덮어쓰지 않고 이어 붙인다(2026-10-26). 합친 장수도 5장 상한.
  const mergedImages = Array.from(new Set([...(existing.handling_image_urls ?? []), ...handlingImageUrls]));
  if (mergedImages.length > LOST_FOUND_HANDLING_IMAGE_LIMIT) {
    return { ok: false, error: "too_many_photos" };
  }

  // 화면에서 고치는 메모에는 시스템 줄(관리자 복원 표시)이 빠져 있다 — 저장할 때 원래 자리 끝에 다시 붙여 기록이 사라지지 않게.
  const { systemLines } = splitLostFoundHandlingMemo(existing.handling_memo);
  const nextMemo = [memo.trim(), ...systemLines].filter(Boolean).join("\n");

  // 어떤 상태 변경이든 "누가·언제 처리했는지"를 기록으로 남긴다(요구사항). 현장 처리이므로
  // handled_by_admin = false — 관리자 예외 개입(대시보드)이 아니다.
  const update: Database["public"]["Tables"]["lost_items"]["Update"] = {
    status: input.status,
    handling_memo: nextMemo || null,
    handling_image_urls: mergedImages,
    handled_at: new Date().toISOString(),
    handled_by: session.user.id,
    handled_by_admin: false,
  };

  // 반환 처리는 반환 방식·송장번호까지 남겨야 손님 클레임 시 증빙이 된다 — 어드민 `returnLostItem`과
  // 같은 컬럼·같은 규칙(송장번호는 배송 반환일 때만).
  if (becomingReturned) {
    update.return_method = returnMethod;
    update.return_tracking_no =
      returnMethod === "delivery" ? (input.returnTrackingNo ?? "").trim().slice(0, 100) : "";
  }

  // 읽은 뒤 다른 사람이 상태를 바꿨으면 덮어쓰지 않는다 — 읽은 상태 그대로일 때만 쓴다.
  const { data: updated, error } = await supabase
    .from("lost_items")
    .update(update)
    .eq("id", itemId)
    .eq("organization_id", session.organization.id)
    .eq("status", currentStatus)
    .select("id");

  if (error) return { ok: false, error: "save_failed" };
  if (!updated || updated.length === 0) {
    // 0행 = RLS 가 걸렀거나(권한), 그 사이 상태가 바뀌었다(동시 변경). 다시 읽어 구분한다.
    const { data: recheck } = await supabase
      .from("lost_items")
      .select("status")
      .eq("id", itemId)
      .eq("organization_id", session.organization.id)
      .maybeSingle();
    const nowStatus = (recheck as { status: LostItemStatus } | null)?.status;
    if (nowStatus && nowStatus !== currentStatus) return { ok: false, error: "conflict" };
    return { ok: false, error: "forbidden" };
  }

  revalidatePath(`/mobile/requests/lost-found/${itemId}`);
  revalidatePath("/mobile/requests");
  revalidatePath("/admin/lost-found");
  return { ok: true };
}
