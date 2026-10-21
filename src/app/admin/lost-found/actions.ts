"use server";

// 어드민 분실물(lost & found) 서버 액션 — 능동 처리(반환/폐기/보관 연장) · 상태 정정(예외 개입) · 삭제.
//
// 내보내기(Excel/PDF)는 없다 — 사용자 결정(2026-07-16): 분실물 콘솔은 내보낼 일이 없다. 구 CSV/워크북
// 액션은 전부 제거됐다. See docs/product/09-lost-found-workflow.md.
//
// 일반 처리는 콘솔의 능동 처리 존(반환/폐기/보관연장)에서 하고, 상태 정정은 잘못된 자동/수동 상태를
// 관리자가 되돌리는 예외 경로다. 청소 강제완료와 같은 역할 게이트(canForceCompleteCleaning)를 쓴다.
import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/admin-session";
import { canForceCompleteCleaning } from "@/lib/cleaning";
import {
  isLostReturnMethod,
  LOST_FOUND_STORAGE_DAYS,
  type LostReturnMethod,
} from "@/lib/lost-found-constants";
import { appendAdminRestoreMemo } from "@/lib/lost-found-memo";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type LostActionResult =
  | { ok: true }
  | { ok: false; reason: "forbidden" | "invalid" | "not_found" | "failed" };

function isValidUUID(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isValidDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

// 도쿄 기준 오늘 + days 만큼 더한 "YYYY-MM-DD". 복원 시 보관 시계 재설정에 쓴다 — 자동 폐기 배치가
// 발견일+14 기준으로 다시 즉시 걸리지 않도록 새 만료일을 준다.
function tokyoDateKeyPlusDays(days: number): string {
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = todayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function revalidateItem(itemId: string) {
  revalidatePath("/admin/lost-found");
  revalidatePath(`/mobile/requests/lost-found/${itemId}`);
}

// 관리자 예외 개입(반환/폐기/연장/정정)의 공통 진입 가드: 세션 · 역할 게이트 · UUID.
async function requireLostFoundAction(itemId: string) {
  const session = await requireAdminSession();
  if (!canForceCompleteCleaning(session)) {
    return { ok: false as const, result: { ok: false, reason: "forbidden" } as LostActionResult };
  }
  if (!isValidUUID(itemId)) {
    return { ok: false as const, result: { ok: false, reason: "invalid" } as LostActionResult };
  }
  return { ok: true as const, session };
}

export async function returnLostItem(input: {
  itemId: string;
  method: LostReturnMethod;
  tracking: string;
  memo: string;
}): Promise<LostActionResult> {
  const gate = await requireLostFoundAction(input.itemId);
  if (!gate.ok) return gate.result;
  const { session } = gate;

  if (!isLostReturnMethod(input.method)) {
    return { ok: false, reason: "invalid" };
  }

  const trackingNo = input.method === "delivery" ? input.tracking.trim() : "";
  const memo = input.memo.trim();

  const supabase = await getSupabaseServerClient();
  const { data: updated, error } = await supabase
    .from("lost_items")
    .update({
      status: "returned",
      return_method: input.method,
      return_tracking_no: trackingNo,
      handling_memo: memo || null,
      handled_at: new Date().toISOString(),
      handled_by: session.user.id,
      handled_by_admin: true,
    })
    .eq("id", input.itemId)
    .eq("organization_id", session.organization.id)
    .select("id");

  if (error) return { ok: false, reason: "failed" };
  if (!updated || updated.length === 0) return { ok: false, reason: "not_found" };

  revalidateItem(input.itemId);
  return { ok: true };
}

export async function disposeLostItem(input: {
  itemId: string;
  memo: string;
}): Promise<LostActionResult> {
  const gate = await requireLostFoundAction(input.itemId);
  if (!gate.ok) return gate.result;
  const { session } = gate;

  const memo = input.memo.trim();

  const supabase = await getSupabaseServerClient();
  const { data: updated, error } = await supabase
    .from("lost_items")
    .update({
      status: "disposed",
      handling_memo: memo || null,
      handled_at: new Date().toISOString(),
      handled_by: session.user.id,
      handled_by_admin: true,
    })
    .eq("id", input.itemId)
    .eq("organization_id", session.organization.id)
    .select("id");

  if (error) return { ok: false, reason: "failed" };
  if (!updated || updated.length === 0) return { ok: false, reason: "not_found" };

  revalidateItem(input.itemId);
  return { ok: true };
}

export async function extendLostItemStorage(input: {
  itemId: string;
  dueDate: string; // "YYYY-MM-DD"
  reason: string;
}): Promise<LostActionResult> {
  const gate = await requireLostFoundAction(input.itemId);
  if (!gate.ok) return gate.result;
  const { session } = gate;

  if (!isValidDateKey(input.dueDate)) {
    return { ok: false, reason: "invalid" };
  }
  const reason = input.reason.trim();

  const supabase = await getSupabaseServerClient();
  const { data: existing } = await supabase
    .from("lost_items")
    .select("id, status")
    .eq("id", input.itemId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (!existing) return { ok: false, reason: "not_found" };

  // 폐기예정 건을 연장하면 다시 보관중으로 되돌린다(종결 아님). 그 외 상태는 유지.
  const currentStatus = (existing as { status: string }).status;
  // `currentStatus` 는 그 행에서 읽은 값이라 항상 유효한 상태다(TS 가 좁히지 못할 뿐).
  const nextStatus = (currentStatus === "disposal_scheduled" ? "stored" : currentStatus) as
    Database["public"]["Tables"]["lost_items"]["Row"]["status"];

  const { data: updated, error } = await supabase
    .from("lost_items")
    .update({
      hold_until: input.dueDate,
      hold_reason: reason || null,
      status: nextStatus,
    })
    .eq("id", input.itemId)
    .eq("organization_id", session.organization.id)
    .select("id");

  if (error) return { ok: false, reason: "failed" };
  if (!updated || updated.length === 0) return { ok: false, reason: "not_found" };

  revalidateItem(input.itemId);
  return { ok: true };
}

export async function correctLostItemStatus(input: {
  itemId: string;
  status: "registered" | "stored" | "disposal_scheduled";
  memo: string;
}): Promise<LostActionResult> {
  const gate = await requireLostFoundAction(input.itemId);
  if (!gate.ok) return gate.result;
  const { session } = gate;

  // 진행 상태 3종만 허용 — 종결(disposed/returned)로의 정정은 능동 처리 액션이 담당한다.
  if (!["registered", "stored", "disposal_scheduled"].includes(input.status)) {
    return { ok: false, reason: "invalid" };
  }

  const supabase = await getSupabaseServerClient();
  const { data: existing } = await supabase
    .from("lost_items")
    .select("id, handling_memo")
    .eq("id", input.itemId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (!existing) return { ok: false, reason: "not_found" };

  const previousMemo = (existing as { handling_memo: string | null }).handling_memo ?? "";
  const addition = input.memo.trim();
  // 정정 사유는 기존 처리 메모를 덮어쓰지 않고 덧붙인다 — 감사 흔적을 남긴다.
  const memo = addition ? (previousMemo ? `${previousMemo}\n${addition}` : addition) : previousMemo;

  const { data: updated, error } = await supabase
    .from("lost_items")
    .update({
      status: input.status,
      handling_memo: memo || null,
    })
    .eq("id", input.itemId)
    .eq("organization_id", session.organization.id)
    .select("id");

  if (error) return { ok: false, reason: "failed" };
  if (!updated || updated.length === 0) return { ok: false, reason: "not_found" };

  revalidateItem(input.itemId);
  return { ok: true };
}

// 완료(폐기/반환) 건을 다시 진행 상태로 되돌린다 — 관리자 실수, 고객 재방문 등 변수 대응.
// 상태는 '보관중'으로, 보관 시계는 복원일+14일로 재설정하고 폐기/반환 처리 정보는 초기화한다.
export async function restoreLostItem(input: {
  itemId: string;
  reason: string;
}): Promise<LostActionResult> {
  const gate = await requireLostFoundAction(input.itemId);
  if (!gate.ok) return gate.result;
  const { session } = gate;

  const supabase = await getSupabaseServerClient();
  const { data: existing } = await supabase
    .from("lost_items")
    .select("id, status, handling_memo")
    .eq("id", input.itemId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (!existing) return { ok: false, reason: "not_found" };

  // 완료(폐기/반환) 건만 복원 대상 — 진행 중인 건은 정정/연장 경로가 담당한다.
  const current = existing as { status: string; handling_memo: string | null };
  if (current.status !== "disposed" && current.status !== "returned") {
    return { ok: false, reason: "invalid" };
  }

  // 복원 사유는 locale-neutral marker로 저장하고 각 뷰어의 언어로 렌더링한다.
  const previousMemo = current.handling_memo ?? "";
  const reason = input.reason.trim();
  const memo = appendAdminRestoreMemo(previousMemo, reason);

  const { data: updated, error } = await supabase
    .from("lost_items")
    .update({
      status: "stored",
      hold_until: tokyoDateKeyPlusDays(LOST_FOUND_STORAGE_DAYS),
      hold_reason: null,
      return_method: null,
      return_tracking_no: null,
      handled_at: null,
      handled_by: null,
      handled_by_admin: false,
      handling_memo: memo,
    })
    .eq("id", input.itemId)
    .eq("organization_id", session.organization.id)
    .select("id");

  if (error) return { ok: false, reason: "failed" };
  if (!updated || updated.length === 0) return { ok: false, reason: "not_found" };

  revalidateItem(input.itemId);
  return { ok: true };
}

function canDeleteAnyLostItem(who: { capabilities: readonly string[] }): boolean {
  return who.capabilities.includes("request.delete_any");
}

export async function deleteLostItemById(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdminSession();

  if (!isValidUUID(id)) {
    return { ok: false, error: "not_found" };
  }

  const supabase = await getSupabaseServerClient();
  const { data: existing } = await supabase
    .from("lost_items")
    .select("id, reported_by_user_id")
    .eq("id", id)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (!existing) {
    return { ok: false, error: "not_found" };
  }
  const owner = (existing as { reported_by_user_id: string }).reported_by_user_id;
  if (owner !== session.user.id && !canDeleteAnyLostItem(session)) {
    return { ok: false, error: "unauthorized" };
  }

  const { data, error } = await supabase
    .from("lost_items")
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

  revalidatePath("/admin/lost-found");
  return { ok: true };
}
