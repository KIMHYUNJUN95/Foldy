"use server";

// 현장(모바일) 수리·점검 처리 — 상태 변경 + 처리 메모 + 완료 사진.
// 2026-07-14 신설. 그 전까지 모바일 상세는 상태를 "보여주기만" 했고, 상태를 바꿀 수 있는 경로는
// 어드민 상세 페이지 하나뿐이었다 — 문서(08-maintenance-workflow.md → Status Change Permission)가
// 못박은 "현장이 모바일에서 처리한다"가 구현된 적이 없었다.
//
// 권한: part_time_staff 제외 전원. 앱 레벨에서 먼저 막고, DB의 RLS UPDATE 정책이 최종 게이트다
// (마이그레이션 202607160001). 두 겹 중 RLS가 진짜 방어선이므로 영향 행 수를 반드시 확인한다 —
// RLS가 행을 걸러내면 Supabase는 "0행 업데이트 + 에러 없음"을 돌려주기 때문에, 행 수를 안 보면
// 권한 없는 사용자에게도 "변경됨"이라고 응답하게 된다(구 어드민 액션의 실제 버그).

import { revalidatePath } from "next/cache";
import {
  isMaintenanceStatus,
  isMaintenanceTerminal,
  MAINTENANCE_RESOLUTION_IMAGE_LIMIT,
  type MaintenanceStatus,
} from "@/lib/maintenance-constants";
import { memberCapabilities } from "@/lib/capabilities-server";
import { getCurrentAppSession } from "@/lib/session";
import { isOwnStoragePublicUrl } from "@/lib/storage-url-guard";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

const REQUEST_IMAGE_BUCKET = "request-images";
const RESOLUTION_FOLDER = "maintenance-resolutions";

export type MaintenanceHandlingInput = {
  reportId: string;
  status: MaintenanceStatus;
  /** 화면을 열 때 본 상태. 그 사이 다른 사람이 바꿨으면 덮어쓰지 않고 conflict(2026-10-26). */
  expectedStatus?: MaintenanceStatus;
  memo: string;
  /** 이번에 새로 올린 완료 사진만. 서버가 이미 저장된 사진 뒤에 붙인다(덮어쓰지 않음, 2026-10-26). */
  resolutionImageUrls: string[];
};

export type MaintenanceHandlingResult =
  | { ok: true }
  | {
      ok: false;
      error: "forbidden" | "not_found" | "invalid" | "save_failed" | "too_many_photos" | "conflict";
    };

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * 상태 변경 권한 = part_time_staff 제외 전원, 또는 `maintenance_status_change` 권한 예외(override).
 * 오버라이드는 RLS에는 이미 반영돼 있었는데(마이그레이션 202607130004 → 202607160001에서 유지)
 * 앱 게이트가 파트타임을 먼저 거절해서 부여해도 UI상 아무 변화가 없었다. 조회 패턴은
 * `can_generate_report`(src/actions/task-report.ts)와 같다.
 */
export async function canHandleMaintenance(
  organizationId: string,
  userId: string,
  role: string,
): Promise<boolean> {
  // 권한 키 하나로(역할 기본: 아르바이트 빼고 + 개인 부여 · 차단, 2026-10-21 — 예전엔 차단을 무시했다).
  void role;
  return (await memberCapabilities(organizationId, userId)).includes("maintenance_status_change");
}

/** 완료 사진 URL이 반드시 우리 Storage 의 {orgId}/maintenance-resolutions/{reportId}/{file} 아래인지 검증한다. */
function isOwnResolutionImage(url: string, organizationId: string, reportId: string): boolean {
  return isOwnStoragePublicUrl(url, REQUEST_IMAGE_BUCKET, `${organizationId}/${RESOLUTION_FOLDER}/${reportId}/`);
}

export async function updateMaintenanceHandling(
  input: MaintenanceHandlingInput,
): Promise<MaintenanceHandlingResult> {
  const session = await getCurrentAppSession();
  if (!session) return { ok: false, error: "forbidden" };
  // 파트타임은 상태를 바꿀 수 없다 (기존 규칙 + `maintenance_status_change` 오버라이드 예외).
  // RLS도 같은 결론을 내지만 여기서 먼저 끊는다.
  if (
    !(await canHandleMaintenance(session.organization.id, session.user.id, session.user.role))
  ) {
    return { ok: false, error: "forbidden" };
  }

  const { reportId, memo, resolutionImageUrls } = input;
  if (!isValidUuid(reportId)) return { ok: false, error: "invalid" };
  if (!isMaintenanceStatus(input.status)) return { ok: false, error: "invalid" };
  if (!Array.isArray(resolutionImageUrls) || typeof memo !== "string") return { ok: false, error: "invalid" };
  if (resolutionImageUrls.length > MAINTENANCE_RESOLUTION_IMAGE_LIMIT) {
    return { ok: false, error: "invalid" };
  }
  for (const url of resolutionImageUrls) {
    if (!isOwnResolutionImage(url, session.organization.id, reportId)) {
      return { ok: false, error: "invalid" };
    }
  }

  const supabase = await getSupabaseServerClient();
  const { data: existingRow } = await supabase
    .from("maintenance_reports")
    .select("id, status, resolution_image_urls")
    .eq("id", reportId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (!existingRow) return { ok: false, error: "not_found" };
  const existing = existingRow as {
    id: string;
    status: MaintenanceStatus;
    resolution_image_urls: string[] | null;
  };

  // 완료 사진은 덮어쓰지 않고 이어 붙인다(2026-10-26) — 예전엔 새로 올린 사진 목록으로 통째로 바꿔서, 상태만 바꾸려고
  // 다시 저장하면 이전 완료 사진이 사라졌다. 합친 장수도 5장 상한을 넘을 수 없다.
  const previousImages = existing.resolution_image_urls ?? [];
  const mergedImages = Array.from(new Set([...previousImages, ...resolutionImageUrls]));
  if (mergedImages.length > MAINTENANCE_RESOLUTION_IMAGE_LIMIT) {
    return { ok: false, error: "too_many_photos" };
  }

  if (input.expectedStatus !== undefined && input.expectedStatus !== existing.status) {
    return { ok: false, error: "conflict" };
  }
  const wasTerminal = isMaintenanceTerminal(existing.status);
  const terminal = isMaintenanceTerminal(input.status);
  const nowIso = new Date().toISOString();

  const update: Database["public"]["Tables"]["maintenance_reports"]["Update"] = {
    status: input.status,
    resolution_memo: memo.trim() || null,
    resolution_image_urls: mergedImages,
  };
  // 완료시각 · 처리자는 "진행 → 종료"로 넘어가는 순간에만 찍는다(2026-10-26). 예전엔 종료 건의 메모 · 사진만 고쳐도
  // 완료시각이 지금으로 바뀌고 처리자가 고친 사람으로 덮였다. 다시 열면(종료 → 진행) 지운다. 종료 → 종료(완료 ↔ 무효)는 그대로.
  if (!wasTerminal && terminal) {
    update.completed_at = nowIso;
    update.completed_by = session.user.id;
    // 현장이 직접 처리한 건 — 관리자 예외 개입이 아니다.
    update.completed_by_admin = false;
  } else if (wasTerminal && !terminal) {
    update.completed_at = null;
    update.completed_by = null;
    update.completed_by_admin = false;
  }

  // 읽은 뒤 다른 사람이 상태를 바꿨으면 덮어쓰지 않는다 — 읽은 상태 그대로일 때만 쓴다.
  const { data: updated, error } = await supabase
    .from("maintenance_reports")
    .update(update)
    .eq("id", reportId)
    .eq("organization_id", session.organization.id)
    .eq("status", existing.status)
    .select("id");

  if (error) return { ok: false, error: "save_failed" };
  if (!updated || updated.length === 0) {
    // 0행 = RLS 가 걸렀거나(권한), 그 사이 상태가 바뀌었다(동시 변경). 다시 읽어 구분한다.
    const { data: recheck } = await supabase
      .from("maintenance_reports")
      .select("status")
      .eq("id", reportId)
      .eq("organization_id", session.organization.id)
      .maybeSingle();
    const nowStatus = (recheck as { status: MaintenanceStatus } | null)?.status;
    if (nowStatus && nowStatus !== existing.status) return { ok: false, error: "conflict" };
    return { ok: false, error: "forbidden" };
  }

  revalidatePath(`/mobile/requests/maintenance/${reportId}`);
  revalidatePath("/mobile/requests");
  revalidatePath("/admin/maintenance");
  return { ok: true };
}
