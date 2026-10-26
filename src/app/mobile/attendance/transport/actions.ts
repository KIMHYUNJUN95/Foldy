"use server";

// 교통비 정산 — 근무자용 서버 액션(사용자별 월 원장).
//
// 본인 전용: 모든 변경은 인증된 사용자 본인의 보고서/항목에만 적용하며, 다른 사용자의 것은 건드리지 않는다.
// 모든 쓰기는 service-role 클라이언트를 쓴다(RLS가 인증 사용자의 직접 쓰기를 막음). 조직 격리는
// 모든 쿼리에서 강제한다. 이 원장은 급여와 완전히 분리되어 있어 시급 값은 여기서 읽지 않는다.
// 보고서는 `draft` 또는 `rejected` 상태일 때만 수정할 수 있고, 제출하면 관리자가 처리할 때까지 잠긴다.

import { revalidatePath } from "next/cache";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { transportDestinationRequiresMemo } from "@/lib/transport-destinations";
import {
  getOrCreateTransportReport,
  getTransportReport,
  syncReportTotalAmount,
  type TransportEntryMode,
} from "@/lib/transport-reimbursement";

const TRANSPORT_PATH = "/mobile/attendance/transport";
const IMAGE_BUCKET = "request-images";

type Service = ReturnType<typeof getSupabaseServiceClient>;

// transport_reimbursement_* 테이블은 아직 생성된 Database 타입에 없어서, service 클라이언트의
// 테이블 접근은 `untyped` 로 캐스팅한다. src/types/database.ts 를 다시 생성하면 제거한다.
function untyped(service: Service) {
  return service as unknown as {
    from: (table: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      select: (...args: any[]) => any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      insert: (...args: any[]) => any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: (...args: any[]) => any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete: (...args: any[]) => any;
    };
  };
}

// 보고서는 소유자가 draft/rejected 상태일 때 수정할 수 있고, `changes_requested` 상태에서도 수정할 수 있다 —
// 이 상태는 근무자가 표시된 항목을 고쳐 다시 제출하게 하려고 있는 것이다.
const EDITABLE_STATUSES = new Set(["draft", "rejected", "changes_requested"]);

/** 'YYYY-MM' 월 키를 target_month 에 쓰는 'YYYY-MM-01' 첫날 형식으로 바꾼다. */
function monthKeyToFirstDay(targetMonth: string): string | null {
  // 실제 달(01~12)만 — 「2026-13」 같은 키로 보고서 행이 생기지 않게(2026-10-26).
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(targetMonth)) return null;
  return `${targetMonth}-01`;
}

/** 실제로 있는 날짜인가(2026-02-30 같은 값 거름). */
function isRealDate(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 항목 하나에 붙는 영수증 사진 상한 — 업로드 공통 규칙(기능당 5장). 화면도 같은 수로 자른다. */
const MAX_ITEM_IMAGES = 5;
const SAFE_FILE = /^[A-Za-z0-9._-]+$/;

/**
 * 영수증 사진 경로는 **그 항목의 폴더 바로 아래 파일 한 장**이어야 한다(2026-10-26):
 * `{조직}/transport-reimbursements/{보고서 id}/{항목 id}/{파일}` — 업로더(`uploadTransportImage`)가 쓰는 모양 그대로.
 * 예전에는 `{조직}/transport-reimbursements/` 로 시작하기만 보면 돼서, 남의 항목 파일 경로를 등록한 뒤
 * 그 사진(또는 항목)을 지우면 **남의 파일이 Storage 에서 지워질** 수 있었다. 삭제 때도 같은 검사를 다시 한다.
 */
function isOwnItemImagePath(
  storagePath: string,
  organizationId: string,
  reportId: string,
  itemId: string,
): boolean {
  if (typeof storagePath !== "string") return false;
  const prefix = `${organizationId}/transport-reimbursements/${reportId}/${itemId}/`;
  if (!storagePath.startsWith(prefix)) return false;
  const file = storagePath.slice(prefix.length);
  return file.length > 0 && file !== "." && file !== ".." && SAFE_FILE.test(file);
}

// ── 생성 ─────────────────────────────────────────────────────────────────

export type CreateTransportItemInput = {
  targetMonth: string; // 'YYYY-MM'
  usageDate: string; // 'YYYY-MM-DD'
  amountYen: number;
  entryMode: TransportEntryMode;
  attendanceSessionId?: string | null;
  propertyId?: string | null;
  /** 안 흔들리는 출근지 키. 건물이면 `property_id` 와 같고, 사무실·기타는 고정값. */
  destinationKey?: string;
  buildingLabel?: string;
  contextSummary?: string;
  memo?: string | null;
};

export type CreateTransportItemResult =
  /** `reportId` — 이 항목이 들어간 보고서. 첫 항목이면 방금 만들어진 것이라 화면이 아직 모른다(영수증 경로에 쓴다). */
  | { ok: true; itemId: string; reportId: string }
  | { ok: false; error: string };

export async function createTransportItemAction(
  input: CreateTransportItemInput,
): Promise<CreateTransportItemResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, error: "auth" };
  const organizationId = session.organization.id;
  const userId = session.user.id;
  const service = getSupabaseServiceClient();

  const targetMonthDate = monthKeyToFirstDay(input.targetMonth);
  if (!targetMonthDate) return { ok: false, error: "invalid_month" };
  if (!isRealDate(input.usageDate)) return { ok: false, error: "invalid_date" };
  // 사용일은 정산서의 달 안이어야 한다 — 다른 달 날짜가 이 달 정산서에 섞이면 월별 합계 · 마감이 어긋난다.
  if (input.usageDate.slice(0, 7) !== input.targetMonth) return { ok: false, error: "date_outside_month" };
  if (!Number.isInteger(input.amountYen) || input.amountYen <= 0) {
    return { ok: false, error: "invalid_amount" };
  }
  if (input.entryMode !== "linked" && input.entryMode !== "manual") {
    return { ok: false, error: "invalid_entry_mode" };
  }
  // `linked` 는 **실제로 무언가에 이어져 있어야** 한다. 예전에는 입력 방식 버튼만 눌러도
  // `entry_mode: 'linked'` 로 찍혀서, 연결된 것이 없는데 연결됐다고 적힌 행이 남았다
  // (기존 29건 전부 `attendance_session_id` 가 null 이었다). 근태 세션이나 건물 중 하나는 있어야
  // 한다 — 청소 기록에서 온 후보는 세션 id 가 없고 건물만 있다.
  if (input.entryMode === "linked" && !input.attendanceSessionId && !input.propertyId) {
    return { ok: false, error: "link_target_required" };
  }
  // 기타는 메모가 있어야 한다. 화면에서도 막지만 여기서 한 번 더 본다 —
  // 화면만 막으면 다른 경로로 들어온 요청이 그대로 통과한다.
  if (
    input.destinationKey &&
    transportDestinationRequiresMemo(input.destinationKey) &&
    !input.memo?.trim()
  ) {
    return { ok: false, error: "memo_required" };
  }

  // 연결 대상은 **내 것 · 우리 조직 것**만(2026-10-26). 화면이 보낸 id 를 그대로 저장하면 남의 근태 기록이나
  // 다른 조직 건물에 이어진 행이 생긴다.
  const attendanceSessionId = input.attendanceSessionId?.trim() || null;
  const propertyId = input.propertyId?.trim() || null;
  if (attendanceSessionId) {
    const sessionRes = await service
      .from("attendance_sessions")
      .select("id")
      .eq("id", attendanceSessionId)
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (sessionRes.error || !sessionRes.data) return { ok: false, error: "invalid_link" };
  }
  if (propertyId) {
    const propertyRes = await service
      .from("properties")
      .select("id")
      .eq("id", propertyId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (propertyRes.error || !propertyRes.data) return { ok: false, error: "invalid_link" };
  }

  // 보고서 행은 **첫 항목을 넣을 때** 만든다 — 화면을 여는 것만으로는 만들지 않는다(page.tsx 는 읽기만).
  const report = await getOrCreateTransportReport(service, organizationId, userId, targetMonthDate);
  if (!EDITABLE_STATUSES.has(report.status)) return { ok: false, error: "report_not_editable" };

  const workContext: Record<string, string> = {};
  // 라벨은 **표시용**이다(로케일마다 다르다). 기억·집계의 키는 `destinationKey` 다.
  if (input.destinationKey?.trim()) workContext.destinationKey = input.destinationKey.trim();
  if (input.buildingLabel?.trim()) workContext.buildingLabel = input.buildingLabel.trim();
  if (input.contextSummary?.trim()) workContext.contextSummary = input.contextSummary.trim();

  const ins = await untyped(service)
    .from("transport_reimbursement_items")
    .insert({
      organization_id: organizationId,
      report_id: report.id,
      user_id: userId,
      usage_date: input.usageDate,
      amount_yen: input.amountYen,
      entry_mode: input.entryMode,
      attendance_session_id: attendanceSessionId,
      property_id: propertyId,
      work_context: workContext,
      memo: input.memo?.trim() ? input.memo.trim() : null,
    })
    .select("id")
    .maybeSingle();
  if (ins.error || !ins.data) return { ok: false, error: "insert_failed" };

  await syncReportTotalAmount(service, report.id);
  revalidatePath(TRANSPORT_PATH);
  return { ok: true, itemId: (ins.data as { id: string }).id, reportId: report.id };
}

// ── 수정 ─────────────────────────────────────────────────────────────────

export type UpdateTransportItemInput = {
  itemId: string;
  amountYen?: number;
  memo?: string | null;
  buildingLabel?: string;
  contextSummary?: string;
};

export type TransportActionResult = { ok: true } | { ok: false; error: string };

/**
 * 본인 소유 항목과 그 보고서 상태를 찾는다(조직 범위). 항목이 없거나, 다른 사람 소유이거나,
 * 보고서를 수정할 수 없으면 오류 코드를 돌려준다.
 */
async function loadEditableOwnItem(
  service: Service,
  organizationId: string,
  userId: string,
  itemId: string,
): Promise<
  | {
      ok: true;
      item: { id: string; report_id: string; work_context: Record<string, string> | null };
    }
  | { ok: false; error: string }
> {
  const res = await untyped(service)
    .from("transport_reimbursement_items")
    .select("id, report_id, user_id, organization_id, work_context")
    .eq("id", itemId)
    .maybeSingle();
  const row = res.data as {
    id: string;
    report_id: string;
    user_id: string;
    organization_id: string;
    work_context: Record<string, string> | null;
  } | null;
  if (!row || row.organization_id !== organizationId || row.user_id !== userId) {
    return { ok: false, error: "forbidden" };
  }

  const reportRes = await untyped(service)
    .from("transport_reimbursement_reports")
    .select("status")
    .eq("id", row.report_id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  const report = reportRes.data as { status: string } | null;
  if (!report) return { ok: false, error: "forbidden" };
  if (!EDITABLE_STATUSES.has(report.status)) return { ok: false, error: "report_not_editable" };

  return {
    ok: true,
    item: { id: row.id, report_id: row.report_id, work_context: row.work_context },
  };
}

export async function updateTransportItemAction(
  input: UpdateTransportItemInput,
): Promise<TransportActionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, error: "auth" };
  const organizationId = session.organization.id;
  const userId = session.user.id;
  const service = getSupabaseServiceClient();

  const loaded = await loadEditableOwnItem(service, organizationId, userId, input.itemId);
  if (!loaded.ok) return loaded;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = {};
  if (input.amountYen !== undefined) {
    if (!Number.isInteger(input.amountYen) || input.amountYen <= 0) {
      return { ok: false, error: "invalid_amount" };
    }
    update.amount_yen = input.amountYen;
  }
  if (input.memo !== undefined) {
    update.memo = input.memo?.trim() ? input.memo.trim() : null;
  }
  if (input.buildingLabel !== undefined || input.contextSummary !== undefined) {
    const workContext = { ...(loaded.item.work_context ?? {}) };
    if (input.buildingLabel !== undefined) {
      if (input.buildingLabel.trim()) workContext.buildingLabel = input.buildingLabel.trim();
      else delete workContext.buildingLabel;
    }
    if (input.contextSummary !== undefined) {
      if (input.contextSummary.trim()) workContext.contextSummary = input.contextSummary.trim();
      else delete workContext.contextSummary;
    }
    update.work_context = workContext;
  }
  if (Object.keys(update).length === 0) return { ok: true };

  const upd = await untyped(service)
    .from("transport_reimbursement_items")
    .update(update)
    .eq("id", loaded.item.id)
    .eq("organization_id", organizationId)
    .eq("user_id", userId);
  if (upd.error) return { ok: false, error: "update_failed" };

  await syncReportTotalAmount(service, loaded.item.report_id);
  revalidatePath(TRANSPORT_PATH);
  return { ok: true };
}

// ── 항목 삭제 ──────────────────────────────────────────────────────────────

export async function deleteTransportItemAction(itemId: string): Promise<TransportActionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, error: "auth" };
  const organizationId = session.organization.id;
  const userId = session.user.id;
  const service = getSupabaseServiceClient();

  const loaded = await loadEditableOwnItem(service, organizationId, userId, itemId);
  if (!loaded.ok) return loaded;
  const reportId = loaded.item.report_id;

  // 항목의 스토리지 파일을 먼저 완전 삭제한다(DB cascade 가 이미지 행을 지운다).
  const imgRes = await untyped(service)
    .from("transport_reimbursement_item_images")
    .select("storage_path")
    .eq("item_id", itemId)
    .eq("organization_id", organizationId);
  // 이 항목 폴더의 파일만 지운다 — 예전 검사가 느슨할 때 들어간 남의 경로가 있어도 건드리지 않는다.
  const paths = ((imgRes.data ?? []) as { storage_path: string }[])
    .map((r) => r.storage_path)
    .filter((path) => Boolean(path) && isOwnItemImagePath(path, organizationId, reportId, itemId));
  if (paths.length > 0) {
    const { error } = await service.storage.from(IMAGE_BUCKET).remove(paths);
    if (error) {
      // 치명적이지 않음: 남은 파일이 있어도 최악일 뿐이고, DB 행은 아래 cascade 로 지워진다.
      console.error("[deleteTransportItemAction] storage remove failed:", error.message);
    }
  }

  const del = await untyped(service)
    .from("transport_reimbursement_items")
    .delete()
    .eq("id", itemId)
    .eq("organization_id", organizationId)
    .eq("user_id", userId);
  if (del.error) return { ok: false, error: "delete_failed" };

  await syncReportTotalAmount(service, reportId);
  revalidatePath(TRANSPORT_PATH);
  return { ok: true };
}

// ── 항목 이미지 ────────────────────────────────────────────────────────────

export async function addTransportItemImageAction(
  itemId: string,
  storagePath: string,
): Promise<TransportActionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, error: "auth" };
  const organizationId = session.organization.id;
  const userId = session.user.id;
  const service = getSupabaseServiceClient();

  const loaded = await loadEditableOwnItem(service, organizationId, userId, itemId);
  if (!loaded.ok) return loaded;

  if (!isOwnItemImagePath(storagePath, organizationId, loaded.item.report_id, loaded.item.id)) {
    return { ok: false, error: "invalid_path" };
  }

  // 다음 sort_order: 기존 이미지 뒤에 붙인다. 5장이 차 있으면 더 받지 않는다(서버가 상한을 다시 건다).
  const countRes = await untyped(service)
    .from("transport_reimbursement_item_images")
    .select("id")
    .eq("item_id", itemId)
    .eq("organization_id", organizationId);
  if (countRes.error) return { ok: false, error: "insert_failed" };
  const nextOrder = ((countRes.data ?? []) as { id: string }[]).length;
  if (nextOrder >= MAX_ITEM_IMAGES) return { ok: false, error: "too_many_images" };

  const ins = await untyped(service)
    .from("transport_reimbursement_item_images")
    .insert({
      organization_id: organizationId,
      report_id: loaded.item.report_id,
      item_id: itemId,
      user_id: userId,
      storage_path: storagePath,
      sort_order: nextOrder,
    });
  if (ins.error) return { ok: false, error: "insert_failed" };

  revalidatePath(TRANSPORT_PATH);
  return { ok: true };
}

export async function deleteTransportItemImageAction(
  imageId: string,
): Promise<TransportActionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, error: "auth" };
  const organizationId = session.organization.id;
  const userId = session.user.id;
  const service = getSupabaseServiceClient();

  const imgRes = await untyped(service)
    .from("transport_reimbursement_item_images")
    .select("id, item_id, storage_path, user_id, organization_id")
    .eq("id", imageId)
    .maybeSingle();
  const image = imgRes.data as {
    id: string;
    item_id: string;
    storage_path: string;
    user_id: string;
    organization_id: string;
  } | null;
  if (!image || image.organization_id !== organizationId || image.user_id !== userId) {
    return { ok: false, error: "forbidden" };
  }

  // 해당 보고서는 아직 수정할 수 있는 상태여야 한다.
  const loaded = await loadEditableOwnItem(service, organizationId, userId, image.item_id);
  if (!loaded.ok) return loaded;

  // 이 항목 폴더의 파일일 때만 Storage 에서 지운다(행은 아래에서 지운다).
  if (
    image.storage_path &&
    isOwnItemImagePath(image.storage_path, organizationId, loaded.item.report_id, loaded.item.id)
  ) {
    const { error } = await service.storage.from(IMAGE_BUCKET).remove([image.storage_path]);
    if (error) {
      console.error("[deleteTransportItemImageAction] storage remove failed:", error.message);
    }
  }

  const del = await untyped(service)
    .from("transport_reimbursement_item_images")
    .delete()
    .eq("id", imageId)
    .eq("organization_id", organizationId)
    .eq("user_id", userId);
  if (del.error) return { ok: false, error: "delete_failed" };

  revalidatePath(TRANSPORT_PATH);
  return { ok: true };
}

// ── 제출 ─────────────────────────────────────────────────────────────────

export async function submitTransportReportAction(
  targetMonth: string,
): Promise<TransportActionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, error: "auth" };
  const organizationId = session.organization.id;
  const userId = session.user.id;
  const service = getSupabaseServiceClient();

  const targetMonthDate = monthKeyToFirstDay(targetMonth);
  if (!targetMonthDate) return { ok: false, error: "invalid_month" };

  const report = await getTransportReport(service, organizationId, userId, targetMonthDate);
  if (!report) return { ok: false, error: "no_report" };
  if (!EDITABLE_STATUSES.has(report.status)) return { ok: false, error: "report_not_editable" };

  // 항목이 최소 1개 있어야 한다.
  const itemsRes = await untyped(service)
    .from("transport_reimbursement_items")
    .select("id")
    .eq("report_id", report.id)
    .eq("organization_id", organizationId);
  const itemIds = ((itemsRes.data ?? []) as { id: string }[]).map((r) => r.id);
  if (itemIds.length === 0) return { ok: false, error: "no_items" };

  // 모든 항목에는 증빙 이미지가 최소 1장 있어야 한다.
  const imgRes = await untyped(service)
    .from("transport_reimbursement_item_images")
    .select("item_id")
    .in("item_id", itemIds)
    .eq("organization_id", organizationId);
  const withImage = new Set(
    ((imgRes.data ?? []) as { item_id: string }[]).map((r) => r.item_id),
  );
  const missing = itemIds.some((id) => !withImage.has(id));
  if (missing) return { ok: false, error: "missing_evidence" };

  const upd = await untyped(service)
    .from("transport_reimbursement_reports")
    .update({ status: "submitted", submitted_at: new Date().toISOString() })
    .eq("id", report.id)
    .eq("organization_id", organizationId)
    .eq("user_id", userId);
  if (upd.error) return { ok: false, error: "submit_failed" };

  revalidatePath(TRANSPORT_PATH);
  return { ok: true };
}
