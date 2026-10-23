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
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

const REQUEST_IMAGE_BUCKET = "request-images";
const RESOLUTION_FOLDER = "maintenance-resolutions";

export type MaintenanceHandlingInput = {
  reportId: string;
  status: MaintenanceStatus;
  memo: string;
  resolutionImageUrls: string[];
};

export type MaintenanceHandlingResult =
  | { ok: true }
  | { ok: false; error: "forbidden" | "not_found" | "invalid" | "save_failed" };

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

/** 완료 사진 URL이 반드시 {orgId}/maintenance-resolutions/{reportId}/{file} 아래인지 검증한다. */
function isOwnResolutionImage(url: string, organizationId: string, reportId: string): boolean {
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
        segments[1] === RESOLUTION_FOLDER &&
        segments[2] === reportId
      );
    }
    return false;
  } catch {
    return false;
  }
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
  if (resolutionImageUrls.length > MAINTENANCE_RESOLUTION_IMAGE_LIMIT) {
    return { ok: false, error: "invalid" };
  }
  for (const url of resolutionImageUrls) {
    if (!isOwnResolutionImage(url, session.organization.id, reportId)) {
      return { ok: false, error: "invalid" };
    }
  }

  const supabase = await getSupabaseServerClient();
  const { data: existing } = await supabase
    .from("maintenance_reports")
    .select("id, status")
    .eq("id", reportId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (!existing) return { ok: false, error: "not_found" };

  const terminal = isMaintenanceTerminal(input.status);
  const nowIso = new Date().toISOString();

  const update: Database["public"]["Tables"]["maintenance_reports"]["Update"] = {
    status: input.status,
    resolution_memo: memo.trim() || null,
    resolution_image_urls: resolutionImageUrls,
    // 종료(완료/무효)로 가면 완료시각·처리자를 찍고, 다시 열면 되돌린다 (재오픈 허용).
    completed_at: terminal ? nowIso : null,
    completed_by: terminal ? session.user.id : null,
    // 현장이 직접 처리한 건 — 관리자 예외 개입이 아니다.
    completed_by_admin: false,
  };

  const { data: updated, error } = await supabase
    .from("maintenance_reports")
    .update(update)
    .eq("id", reportId)
    .eq("organization_id", session.organization.id)
    .select("id");

  if (error) return { ok: false, error: "save_failed" };
  // RLS가 걸러내면 error 없이 0행이 돌아온다 → 이것을 성공으로 착각하면 안 된다.
  if (!updated || updated.length === 0) return { ok: false, error: "forbidden" };

  revalidatePath(`/mobile/requests/maintenance/${reportId}`);
  revalidatePath("/mobile/requests");
  revalidatePath("/admin/maintenance");
  return { ok: true };
}
