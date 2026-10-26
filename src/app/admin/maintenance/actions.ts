"use server";

// 어드민 수리·점검 서버 액션 — 상태 변경(구 상세 페이지) · 삭제 · 예외 개입(강제 완료/무효).
//
// 내보내기(Excel/PDF)는 없다 — 사용자 결정(2026-07-14): 수리·점검은 내보낼 일이 없다. 이는
// `docs/product/05-admin-web-ia.md` §"Excel + PDF 내보내기 — 절대 규칙"의 명시적 예외다.
// See docs/product/08-maintenance-workflow.md → "2026-07-14 어드민 수리·점검 대시보드".
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/admin-session";
import { canForceCompleteCleaning } from "@/lib/cleaning";
import {
  isMaintenanceTerminal,
  maintenanceStatuses,
  type MaintenanceStatus,
} from "@/lib/maintenance-constants";
import type { Database } from "@/types/database";
import { getSupabaseServerClient } from "@/lib/supabase/server";

function isValidUUID(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isValidStatus(value: string): value is MaintenanceStatus {
  return (maintenanceStatuses as readonly string[]).includes(value);
}

export async function updateMaintenanceStatus(formData: FormData) {
  const session = await requireAdminSession();

  const reportId = String(formData.get("reportId") ?? "").trim();
  const newStatus = String(formData.get("status") ?? "").trim();

  if (!isValidUUID(reportId)) {
    redirect("/admin/maintenance?error=not_found");
  }
  if (!isValidStatus(newStatus)) {
    redirect(`/admin/maintenance/${reportId}?error=status_update_failed`);
  }

  const supabase = await getSupabaseServerClient();

  const { data: existingRow } = await supabase
    .from("maintenance_reports")
    .select("id, status")
    .eq("id", reportId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();

  if (!existingRow) {
    redirect("/admin/maintenance?error=not_found");
  }
  const existing = existingRow as { id: string; status: MaintenanceStatus };

  // 완료시각 · 처리자는 진행 → 종료 전환에만 찍고, 다시 열면 지운다(모바일 updateMaintenanceHandling 과 같은 규칙).
  const update: Database["public"]["Tables"]["maintenance_reports"]["Update"] = { status: newStatus };
  const wasTerminal = isMaintenanceTerminal(existing.status);
  const terminal = isMaintenanceTerminal(newStatus);
  if (!wasTerminal && terminal) {
    update.completed_at = new Date().toISOString();
    update.completed_by = session.user.id;
    update.completed_by_admin = true;
  } else if (wasTerminal && !terminal) {
    update.completed_at = null;
    update.completed_by = null;
    update.completed_by_admin = false;
  }

  // RLS가 행을 걸러내면 Supabase는 에러 없이 0행을 돌려준다. 영향 행 수를 확인하지 않으면 권한이
  // 없는 사용자(예: 남의 신고를 건드리는 staff)에게도 "변경됨"이라고 응답하게 된다 — 실제 버그였다.
  // 읽은 상태 그대로일 때만 쓴다(동시 변경 덮어쓰기 방지).
  const { data: updated, error } = await supabase
    .from("maintenance_reports")
    .update(update)
    .eq("id", reportId)
    .eq("organization_id", session.organization.id)
    .eq("status", existing.status)
    .select("id");

  if (error || !updated || updated.length === 0) {
    redirect(`/admin/maintenance/${reportId}?error=status_update_failed`);
  }

  redirect(`/admin/maintenance/${reportId}?statusUpdated=1`);
}

// ── 관리자 예외 개입 (강제 완료 / 무효 처리) ────────────────────────────────
// 일반 처리는 현장(모바일)이 한다. 여기는 오래 방치된 건을 관리자가 닫거나, 잘못된·중복 신고를 무효로
// 남기는 예외 경로다. 청소 강제완료와 같은 역할 게이트(canForceCompleteCleaning)를 쓴다.

export type MaintenanceExceptionKind = "force" | "void";

export type MaintenanceExceptionResult =
  | { ok: true }
  | { ok: false; reason: "forbidden" | "invalid" | "not_found" | "failed" };

export async function applyMaintenanceException(input: {
  kind: MaintenanceExceptionKind;
  memo: string;
  reportId: string;
}): Promise<MaintenanceExceptionResult> {
  const session = await requireAdminSession();
  if (!canForceCompleteCleaning(session)) {
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
  if (isMaintenanceTerminal(currentStatus)) return { ok: false, reason: "invalid" };

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
  if (!updated || updated.length === 0) return { ok: false, reason: "invalid" };

  revalidatePath("/admin/maintenance");
  revalidatePath(`/mobile/requests/maintenance/${input.reportId}`);
  return { ok: true };
}

function canDeleteAnyMaintenanceReport(who: { capabilities: readonly string[] }): boolean {
  return who.capabilities.includes("request.delete_any");
}

export async function deleteMaintenanceReportById(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdminSession();

  if (!isValidUUID(id)) {
    return { ok: false, error: "not_found" };
  }

  const supabase = await getSupabaseServerClient();
  const { data: existing } = await supabase
    .from("maintenance_reports")
    .select("id, reported_by_user_id")
    .eq("id", id)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (!existing) {
    return { ok: false, error: "not_found" };
  }
  const owner = (existing as { reported_by_user_id: string }).reported_by_user_id;
  if (owner !== session.user.id && !canDeleteAnyMaintenanceReport(session)) {
    return { ok: false, error: "unauthorized" };
  }

  const { data, error } = await supabase
    .from("maintenance_reports")
    .delete()
    .eq("id", id)
    .eq("organization_id", session.organization.id)
    .select("id");

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("permission") || msg.includes("policy") || msg.includes("denied")) {
      return { ok: false, error: "unauthorized" };
    }
    return { ok: false, error: "delete_failed" };
  }

  if (!data || data.length === 0) {
    return { ok: false, error: "not_found" };
  }

  revalidatePath("/admin/maintenance");
  return { ok: true };
}
