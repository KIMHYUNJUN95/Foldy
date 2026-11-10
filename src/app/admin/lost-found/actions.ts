"use server";

// 어드민 분실물(lost & found) 서버 액션 — 능동 처리(반환/폐기/보관 연장) · 상태 정정(예외 개입) · 삭제.
//
// 내보내기(Excel/PDF)는 없다 — 사용자 결정(2026-07-16): 분실물 콘솔은 내보낼 일이 없다. 구 CSV/워크북
// 액션은 전부 제거됐다. See docs/product/09-lost-found-workflow.md.
//
// 일반 처리는 콘솔의 능동 처리 존(반환/폐기/보관연장)에서 하고, 상태 정정은 잘못된 자동/수동 상태를
// 관리자가 되돌리는 예외 경로다. 권한은 모바일 처리와 같은 키 `lost_found.handle` 하나다(2026-11-10 — 그 전엔 청소 강제완료
// 게이트를 잘못 써서 키를 꺼 둔 사람도 콘솔에서는 처리할 수 있었다).
import { revalidatePath } from "next/cache";
import { deleteLostItem } from "@/actions/request-delete";
import { requireAdminSession } from "@/lib/admin-session";
import {
  isLostReturnMethod,
  LOST_FOUND_STORAGE_DAYS,
  type LostReturnMethod,
} from "@/lib/lost-found-constants";
import { appendAdminRestoreMemo } from "@/lib/lost-found-memo";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isCalendarYmd, tokyoToday, ymdShift } from "@/lib/tokyo-date";
import type { Database } from "@/types/database";

type LostActionResult =
  | { ok: true }
  // stale = 읽은 뒤 다른 사람이 상태를 바꿨다(새로 보고 다시 해야 한다).
  | { ok: false; reason: "forbidden" | "invalid" | "not_found" | "failed" | "stale" };

function isValidUUID(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// 도쿄 기준 오늘 + days 만큼 더한 "YYYY-MM-DD". 복원 · 보관 상태로 정정할 때 보관 시계 재설정에 쓴다 — 자동 폐기 배치가
// 발견일+14 기준으로 다시 즉시 걸리지 않도록 새 만료일을 준다.
function tokyoDateKeyPlusDays(days: number): string {
  return ymdShift(tokyoToday(), days);
}

// 진행 중(반환/폐기/연장/정정 대상) 상태. 종결 건은 복원 경로(restoreLostItem)만 건드린다.
const IN_PROGRESS_STATUSES = ["registered", "stored", "disposal_scheduled"] as const;
type InProgressStatus = (typeof IN_PROGRESS_STATUSES)[number];

function isInProgressStatus(value: string): value is InProgressStatus {
  return (IN_PROGRESS_STATUSES as readonly string[]).includes(value);
}

// 기존 처리 메모 뒤에 덧붙인다(덮어쓰지 않음 — 감사 흔적).
function appendMemo(previous: string | null, addition: string): string | null {
  const prev = previous ?? "";
  const merged = addition ? (prev ? `${prev}\n${addition}` : addition) : prev;
  return merged || null;
}

function revalidateItem(itemId: string) {
  revalidatePath("/admin/lost-found");
  revalidatePath(`/mobile/requests/lost-found/${itemId}`);
}

// 관리자 예외 개입(반환/폐기/연장/정정)의 공통 진입 가드: 세션 · 역할 게이트 · UUID.
async function requireLostFoundAction(itemId: string) {
  const session = await requireAdminSession();
  if (!session.capabilities.includes("lost_found.handle")) {
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
  const { data: existing } = await supabase
    .from("lost_items")
    .select("id, status, handling_memo")
    .eq("id", input.itemId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (!existing) return { ok: false, reason: "not_found" };
  const current = existing as { status: string; handling_memo: string | null };
  // 화면이 본 뒤 이미 종결됐다 — 새로 보고 다시.
  if (!isInProgressStatus(current.status)) return { ok: false, reason: "stale" };

  const { data: updated, error } = await supabase
    .from("lost_items")
    .update({
      status: "returned",
      return_method: input.method,
      return_tracking_no: trackingNo,
      handling_memo: appendMemo(current.handling_memo, memo),
      handled_at: new Date().toISOString(),
      handled_by: session.user.id,
      handled_by_admin: true,
    })
    .eq("id", input.itemId)
    .eq("organization_id", session.organization.id)
    .eq("status", current.status)
    .select("id");

  if (error) return { ok: false, reason: "failed" };
  // 0행 = 읽은 뒤 다른 사람이 상태를 바꿨다.
  if (!updated || updated.length === 0) return { ok: false, reason: "stale" };

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
  const { data: existing } = await supabase
    .from("lost_items")
    .select("id, status, handling_memo")
    .eq("id", input.itemId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (!existing) return { ok: false, reason: "not_found" };
  const current = existing as { status: string; handling_memo: string | null };
  // 화면이 본 뒤 이미 종결됐다 — 새로 보고 다시.
  if (!isInProgressStatus(current.status)) return { ok: false, reason: "stale" };

  const { data: updated, error } = await supabase
    .from("lost_items")
    .update({
      status: "disposed",
      handling_memo: appendMemo(current.handling_memo, memo),
      handled_at: new Date().toISOString(),
      handled_by: session.user.id,
      handled_by_admin: true,
    })
    .eq("id", input.itemId)
    .eq("organization_id", session.organization.id)
    .eq("status", current.status)
    .select("id");

  if (error) return { ok: false, reason: "failed" };
  if (!updated || updated.length === 0) return { ok: false, reason: "stale" };

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

  // 연장일은 도쿄 오늘 이후여야 한다 — 과거 날짜면 곧바로 자동 폐기 배치에 걸린다.
  if (!isCalendarYmd(input.dueDate) || input.dueDate <= tokyoToday()) {
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
  // 진행 중인 건만 연장한다 — 종결 건을 연장하면 상태가 어긋난다(복원 경로 사용).
  if (!isInProgressStatus((existing as { status: string }).status)) {
    return { ok: false, reason: "stale" };
  }

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
    .eq("status", currentStatus as InProgressStatus)
    .select("id");

  if (error) return { ok: false, reason: "failed" };
  if (!updated || updated.length === 0) return { ok: false, reason: "stale" };

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
    .select("id, status, handling_memo")
    .eq("id", input.itemId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (!existing) return { ok: false, reason: "not_found" };

  const currentRow = existing as { status: Database["public"]["Tables"]["lost_items"]["Row"]["status"]; handling_memo: string | null };
  // 같은 상태로의 「정정」은 아무것도 바꾸지 않는다 — 기록만 남기는 저장을 막는다.
  if (currentRow.status === input.status) return { ok: false, reason: "invalid" };
  const previousMemo = currentRow.handling_memo ?? "";
  const addition = input.memo.trim();
  // 정정 사유는 기존 처리 메모를 덮어쓰지 않고 덧붙인다 — 감사 흔적을 남긴다.
  const memo = addition ? (previousMemo ? `${previousMemo}\n${addition}` : addition) : previousMemo;

  // 종결(반환/폐기) 건을 진행 상태로 되돌리면 restoreLostItem 과 똑같이 처리 정보를 비우고 보관 시계를 새로 준다.
  const wasTerminal = currentRow.status === "returned" || currentRow.status === "disposed";
  // 보관 중 · 접수로 되돌리면 보관 시계를 새로 준다 — 지난 기한을 그대로 두면 밤 자동 폐기 배치(202607180001)가
  // 곧바로 폐기 예정 · 폐기로 다시 넘긴다(2026-11-10).
  const backToHolding = input.status === "registered" || input.status === "stored";
  const holdFields = backToHolding
    ? { hold_until: tokyoDateKeyPlusDays(LOST_FOUND_STORAGE_DAYS), hold_reason: null }
    : {};
  const resetFields = wasTerminal
    ? {
        hold_until: tokyoDateKeyPlusDays(LOST_FOUND_STORAGE_DAYS),
        hold_reason: null,
        return_method: null,
        return_tracking_no: null,
        handled_at: null,
        handled_by: null,
        handled_by_admin: false,
      }
    : {};

  const { data: updated, error } = await supabase
    .from("lost_items")
    .update({
      status: input.status,
      handling_memo: memo || null,
      ...holdFields,
      ...resetFields,
    })
    .eq("id", input.itemId)
    .eq("organization_id", session.organization.id)
    .eq("status", currentRow.status)
    .select("id");

  if (error) return { ok: false, reason: "failed" };
  if (!updated || updated.length === 0) return { ok: false, reason: "stale" };

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
  const current = existing as { status: "disposed" | "returned" | InProgressStatus; handling_memo: string | null };
  if (current.status !== "disposed" && current.status !== "returned") {
    return { ok: false, reason: "stale" };
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
    // 읽은 상태 그대로일 때만 — 그 사이 다른 사람이 복원 · 정정했으면 그 기록을 덮지 않는다(2026-11-10).
    .eq("status", current.status)
    .select("id");

  if (error) return { ok: false, reason: "failed" };
  if (!updated || updated.length === 0) return { ok: false, reason: "stale" };

  revalidateItem(input.itemId);
  return { ok: true };
}

// 삭제는 모바일 요청 목록과 같은 공용 액션(`src/actions/request-delete.ts`)으로 — 판정(`canDeleteRequestRecord`) · 읽은 상태 조건 ·
// 지운 행 수 확인이 한 곳이다(2026-11-10). 여기서는 콘솔 세션만 먼저 확인한다.
export async function deleteLostItemById(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdminSession();
  return deleteLostItem(id);
}
