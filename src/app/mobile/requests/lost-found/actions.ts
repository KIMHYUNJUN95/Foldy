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
  isLostItemTerminal,
  isLostReturnMethod,
  LOST_FOUND_HANDLING_IMAGE_LIMIT,
  lostItemLinearStatuses,
  type LostItemStatus,
  type LostReturnMethod,
} from "@/lib/lost-found-constants";
import { getCurrentAppSession } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

const REQUEST_IMAGE_BUCKET = "request-images";
const HANDLING_FOLDER = "lost-found-handling";

export type LostItemHandlingInput = {
  itemId: string;
  status: LostItemStatus;
  memo: string;
  handlingImageUrls: string[];
  /** 반환완료(returned)로 넘어갈 때의 반환 방식. 어드민 `returnLostItem`과 같은 컬럼에 기록한다. */
  returnMethod?: LostReturnMethod;
  /** 배송 반환일 때의 송장번호. 손님 클레임 시 증빙이 된다. */
  returnTrackingNo?: string;
};

export type LostItemHandlingResult =
  | { ok: true }
  | { ok: false; error: "forbidden" | "not_found" | "invalid" | "save_failed" };

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * 상태 전이 검증 — 그동안 모바일은 "값이 상태 목록에 있는가"만 봤기 때문에 접수 → 폐기완료 직행이
 * 가능했고, 종결되면 모바일 상세는 읽기 전용이라 되돌릴 수도 없었다(복구는 어드민 `restoreLostItem`
 * 전용). 어드민 콘솔이 지키는 규칙과 같은 기준을 현장에도 적용한다:
 *
 * - 상태 변경 없이 메모·사진만 저장하는 것은 허용한다.
 * - 종결(폐기완료 / 반환완료)에서 다른 상태로 나가는 것은 금지 — 관리자 복원 경로만 되돌릴 수 있다.
 * - 손님 반환(returned)은 진행 중 어느 단계에서든 가능하다(보관 흐름 밖의 종결).
 * - 폐기 경로는 접수 → 보관 → 폐기예정 → 폐기완료를 한 단계씩만 전진한다. 되돌리기(보관 연장 등)는
 *   어드민 `extendLostItemStorage` / `correctLostItemStatus` 담당.
 */
function isValidLostItemTransition(from: LostItemStatus, to: LostItemStatus): boolean {
  if (from === to) return true;
  if (isLostItemTerminal(from)) return false;
  if (to === "returned") return true;
  const fromIdx = lostItemLinearStatuses.indexOf(from);
  const toIdx = lostItemLinearStatuses.indexOf(to);
  return fromIdx >= 0 && toIdx === fromIdx + 1;
}

/** 증빙 사진 URL이 반드시 {orgId}/lost-found-handling/{itemId}/{file} 아래인지 검증한다. */
function isOwnHandlingImage(url: string, organizationId: string, itemId: string): boolean {
  try {
    const parsed = new URL(url);
    const markers = [
      `/storage/v1/object/public/${REQUEST_IMAGE_BUCKET}/`,
      `/storage/v1/object/${REQUEST_IMAGE_BUCKET}/`,
    ];
    for (const marker of markers) {
      const idx = parsed.pathname.indexOf(marker);
      if (idx === -1) continue;
      const segments = parsed.pathname.slice(idx + marker.length).split("/");
      return (
        segments.length === 4 &&
        segments[0] === organizationId &&
        segments[1] === HANDLING_FOLDER &&
        segments[2] === itemId
      );
    }
    return false;
  } catch {
    return false;
  }
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
  const { data: existing } = await supabase
    .from("lost_items")
    .select("id, status")
    .eq("id", itemId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (!existing) return { ok: false, error: "not_found" };

  const currentStatus = (existing as { status: LostItemStatus }).status;
  if (!isValidLostItemTransition(currentStatus, input.status)) {
    return { ok: false, error: "invalid" };
  }

  // 어떤 상태 변경이든 "누가·언제 처리했는지"를 기록으로 남긴다(요구사항). 현장 처리이므로
  // handled_by_admin = false — 관리자 예외 개입(대시보드)이 아니다.
  const update: Database["public"]["Tables"]["lost_items"]["Update"] = {
    status: input.status,
    handling_memo: memo.trim() || null,
    handling_image_urls: handlingImageUrls,
    handled_at: new Date().toISOString(),
    handled_by: session.user.id,
    handled_by_admin: false,
  };

  // 반환 처리는 반환 방식·송장번호까지 남겨야 손님 클레임 시 증빙이 된다 — 어드민 `returnLostItem`과
  // 같은 컬럼·같은 규칙(송장번호는 배송 반환일 때만).
  if (input.status === "returned") {
    update.return_method = returnMethod;
    update.return_tracking_no =
      returnMethod === "delivery" ? (input.returnTrackingNo ?? "").trim() : "";
  }

  const { data: updated, error } = await supabase
    .from("lost_items")
    .update(update)
    .eq("id", itemId)
    .eq("organization_id", session.organization.id)
    .select("id");

  if (error) return { ok: false, error: "save_failed" };
  // RLS가 걸러내면 error 없이 0행이 돌아온다 → 이것을 성공으로 착각하면 안 된다.
  if (!updated || updated.length === 0) return { ok: false, error: "forbidden" };

  revalidatePath(`/mobile/requests/lost-found/${itemId}`);
  revalidatePath("/mobile/requests");
  revalidatePath("/admin/lost-found");
  return { ok: true };
}
