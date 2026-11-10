"use server";

// 어드민 수리·점검 서버 액션 — 삭제 · 예외 개입(강제 완료/무효).
//
// 내보내기(Excel/PDF)는 없다 — 사용자 결정(2026-07-14): 수리·점검은 내보낼 일이 없다. 이는
// `docs/product/05-admin-web-ia.md` §"Excel + PDF 내보내기 — 절대 규칙"의 명시적 예외다.
// See docs/product/08-maintenance-workflow.md → "2026-07-14 어드민 수리·점검 대시보드".
//
// 예전 상세 페이지(`/admin/maintenance/[id]`)의 상태 바꾸기 폼(`updateMaintenanceStatus`)은 2026-11-10 에 지웠다 — 권한 검사 없이
// 아무 상태로나 바꿀 수 있었다. 그 주소는 이제 콘솔로 넘겨 그 건을 연다(`?report=<id>`).
import { revalidatePath } from "next/cache";
import { deleteMaintenanceReport } from "@/actions/request-delete";
import { requireAdminSession } from "@/lib/admin-session";
import { isMaintenanceTerminal, type MaintenanceStatus } from "@/lib/maintenance-constants";
import { getSupabaseServerClient } from "@/lib/supabase/server";

function isValidUUID(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// ── 관리자 예외 개입 (강제 완료 / 무효 처리) ────────────────────────────────
// 일반 처리는 현장(모바일)이 한다. 여기는 오래 방치된 건을 관리자가 닫거나, 잘못된·중복 신고를 무효로
// 남기는 예외 경로다. 권한은 모바일 상태 바꾸기와 같은 키 `maintenance_status_change` 하나다(2026-11-10 — 그 전엔 청소
// 강제완료 게이트를 잘못 써서 모바일에서 못 바꾸는 사람이 콘솔에서는 닫을 수 있었다). 세션의 권한 목록은 역할 기본 + 개인 부여 ·
// 차단을 이미 계산한 값이라 모바일 `canHandleMaintenance` 와 같은 결론이다.

export type MaintenanceExceptionKind = "force" | "void";

export type MaintenanceExceptionResult =
  | { ok: true }
  // stale = 읽은 뒤 다른 사람이 상태를 바꿨다.
  | { ok: false; reason: "forbidden" | "invalid" | "not_found" | "failed" | "stale" };

export async function applyMaintenanceException(input: {
  kind: MaintenanceExceptionKind;
  memo: string;
  reportId: string;
}): Promise<MaintenanceExceptionResult> {
  const session = await requireAdminSession();
  if (!session.capabilities.includes("maintenance_status_change")) {
    return { ok: false, reason: "forbidden" };
  }
  if (!isValidUUID(input.reportId)) {
    return { ok: false, reason: "invalid" };
  }

  const supabase = await getSupabaseServerClient();
  const { data: existing } = await supabase
    .from("maintenance_reports")
    .select("id, status, resolution_memo")
    .eq("id", input.reportId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (!existing) return { ok: false, reason: "not_found" };
  // 열림/진행 중인 건에만 개입한다 — 이미 종결된 건의 완료시각 · 처리자를 덮어쓰지 않는다.
  const currentStatus = (existing as { status: MaintenanceStatus }).status;
  if (isMaintenanceTerminal(currentStatus)) return { ok: false, reason: "stale" };

  const previousMemo = (existing as { resolution_memo: string | null }).resolution_memo ?? "";
  const addition = input.memo.trim();
  // 예외 개입 사유는 기존 처리 메모를 덮어쓰지 않고 덧붙인다 — 현장이 남긴 기록이 감사 흔적이다.
  const memo = addition ? (previousMemo ? `${previousMemo}\n${addition}` : addition) : previousMemo;

  const { data: updated, error } = await supabase
    .from("maintenance_reports")
    .update({
      status: input.kind === "force" ? "closed" : "cancelled",
      completed_at: new Date().toISOString(),
      completed_by: session.user.id,
      completed_by_admin: true,
      resolution_memo: memo || null,
    })
    .eq("id", input.reportId)
    .eq("organization_id", session.organization.id)
    .in("status", ["open", "in_progress"])
    .select("id");

  if (error) return { ok: false, reason: "failed" };
  if (!updated || updated.length === 0) return { ok: false, reason: "stale" };

  revalidatePath("/admin/maintenance");
  revalidatePath(`/mobile/requests/maintenance/${input.reportId}`);
  return { ok: true };
}

// 삭제는 모바일 요청 목록과 같은 공용 액션(`src/actions/request-delete.ts`)으로 — 판정(`canDeleteRequestRecord`) · 읽은 상태 조건 ·
// 지운 행 수 확인이 한 곳이다(2026-11-10). 여기서는 콘솔 세션만 먼저 확인한다.
export async function deleteMaintenanceReportById(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdminSession();
  return deleteMaintenanceReport(id);
}
