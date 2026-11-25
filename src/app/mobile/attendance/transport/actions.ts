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
import { getDictionary } from "@/lib/i18n";
import { getCanonicalPropertyName } from "@/lib/room-label-normalization";
import {
  TRANSPORT_OFFICE_KEY,
  TRANSPORT_OTHER_KEY,
  transportDestinationRequiresMemo,
} from "@/lib/transport-destinations";
import {
  getOrCreateTransportReport,
  getTransportReport,
  LINKABLE_ATTENDANCE_EXCLUDED_STATUS,
  LINKABLE_CLEANING_STATUS,
  type LinkedTransportPlace,
  resolveLinkedTransportPlace,
  syncReportTotalAmount,
  syncReportTotalAmountQuietly,
  type TransportEntryMode,
} from "@/lib/transport-reimbursement";
import { tokyoToday } from "@/lib/tokyo-date";
import { transportMonthAllowed } from "@/lib/transport-month";
import {
  removeTransportReceiptFiles,
  signTransportReceiptPaths,
  transportReceiptExists,
} from "@/lib/transport-receipt-storage";

const TRANSPORT_PATH = "/mobile/attendance/transport";
// 영수증 버킷은 src/lib/transport-receipt-storage.ts 한 곳에서 정한다(2026-11-25 — 새 비공개 버킷 → 예전 공개 버킷).

/** DB 트리거 오류 문장 → 화면 오류 코드(202611110002 · 202611250002). */
function triggerErrorCode(message: string | undefined, fallback: string): string {
  const text = message ?? "";
  if (text.includes("transport item image limit")) return "too_many_images";
  if (text.includes("transport report is not editable")) return "report_not_editable";
  return fallback;
}

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
const EDITABLE_STATUS_LIST = Array.from(EDITABLE_STATUSES);

/** 'YYYY-MM' 월 키를 target_month 에 쓰는 'YYYY-MM-01' 첫날 형식으로 바꾼다. */
function monthKeyToFirstDay(targetMonth: string): string | null {
  // 실제 달(01~12)만 — 「2026-13」 같은 키로 보고서 행이 생기지 않게(2026-10-26).
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(targetMonth)) return null;
  // 받는 달은 화면과 같은 규칙(3년 전 ~ 다음 달, `transportMonthAllowed`) — 다다음 달 · 너무 먼 달로 정산서가 생기지 않게(2026-11-11).
  if (!transportMonthAllowed(targetMonth, tokyoToday().slice(0, 7))) return null;
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

/**
 * 저장할 건물 이름(2026-11-25). 화면은 정규 이름을 보내지만 서버가 화면 값을 믿지 않는다 — 로케일 이름(`荒木町A`)이나
 * 엉뚱한 이름이 저장되면 관리자 화면 · 내보내기의 이름 바꾸기(`localizeStoredPlaceText`)가 안 걸린다.
 * - 자동 연결: 서버가 연결된 기록에서 정한 이름(`linkedLabel`, `resolveLinkedTransportPlace` — 근태 근무지 이름 ·
 *   청소 건물 이름, 후보 목록과 같은 판정 함수). 화면 값은 받지 않는다.
 * - 직접 입력 · 건물: 같은 조직 `properties.name` → `getCanonicalPropertyName`(목적지 목록의 `canonicalLabel` 과 같은 값).
 * - 직접 입력 · 사무실 · 기타: 한국어 사전 값. 그 밖에는 비운다.
 */
function resolveBuildingLabel(
  input: CreateTransportItemInput,
  propertyName: string | null,
  linkedLabel: string | null,
): string | null {
  if (input.entryMode === "linked") return linkedLabel?.trim() || null;
  if (propertyName) return getCanonicalPropertyName(propertyName);
  const key = input.destinationKey?.trim();
  const ko = getDictionary("ko");
  if (key === TRANSPORT_OFFICE_KEY) return ko.transport.buildings.office;
  if (key === TRANSPORT_OTHER_KEY) return ko.transport.destinationOther;
  return null;
}

export type CreateTransportItemInput = {
  targetMonth: string; // 'YYYY-MM'
  usageDate: string; // 'YYYY-MM-DD'
  amountYen: number;
  entryMode: TransportEntryMode;
  attendanceSessionId?: string | null;
  /** 청소 기록에서 온 후보의 청소 세션 id(2026-11-11 H2). */
  cleaningSessionId?: string | null;
  propertyId?: string | null;
  /** 안 흔들리는 출근지 키. 건물이면 `property_id` 와 같고, 사무실·기타는 고정값. */
  destinationKey?: string;
  // 건물 이름(`buildingLabel`)은 받지 않는다(2026-11-25) — 직접 입력은 출근지에서, 자동 연결은 연결된 기록에서 서버가 정한다.
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
  // `linked` 는 **근태 기록이나 청소 기록 하나에 실제로 이어져 있어야** 한다(2026-11-11 H2). 예전에는 건물만 있어도
  // 통과했는데, DB 검사 트리거(validate_transport_reimbursement_item)는 연결 출처(linkedSourceType · linkedSourceId)를
  // 요구해서 자동 후보 저장이 늘 실패했다. 출처는 아래에서 서버가 확인한 뒤 work_context 에 적는다.
  const attendanceSessionId = input.attendanceSessionId?.trim() || null;
  const cleaningSessionId = input.cleaningSessionId?.trim() || null;
  if (input.entryMode === "linked" && !attendanceSessionId && !cleaningSessionId) {
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

  // 연결 대상은 **내 것 · 우리 조직 것 · 그날 것**만(2026-10-26, 날짜는 2026-11-11). 화면이 보낸 id 를 그대로
  // 저장하면 남의 근태 기록이나 다른 조직 건물에 이어진 행이 생긴다. DB 트리거와 같은 조건이다.
  // 연결 항목의 건물 정보(이름 · 요약 · 건물 id)는 서버가 연결 기록에서 정한다(2026-11-25, 후보 목록과 같은 판정).
  let linkedSource: { type: "attendance" | "cleaning"; id: string } | null = null;
  let linkedPlace: LinkedTransportPlace | null = null;
  if (input.entryMode === "linked" && attendanceSessionId) {
    const sessionRes = await service
      .from("attendance_sessions")
      .select("id, clock_in_site_id")
      .eq("id", attendanceSessionId)
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("operating_date", input.usageDate)
      .neq("status", LINKABLE_ATTENDANCE_EXCLUDED_STATUS)
      .maybeSingle();
    if (sessionRes.error || !sessionRes.data) return { ok: false, error: "invalid_link" };
    linkedSource = { type: "attendance", id: attendanceSessionId };
    const resolved = await resolveLinkedTransportPlace(service, organizationId, {
      type: "attendance",
      siteId: (sessionRes.data as { clock_in_site_id?: string | null }).clock_in_site_id ?? null,
    });
    if (!resolved.ok) return resolved;
    linkedPlace = resolved.place;
  } else if (input.entryMode === "linked" && cleaningSessionId) {
    const cleaningRes = await service
      .from("cleaning_sessions")
      .select("id, room_label")
      .eq("id", cleaningSessionId)
      .eq("organization_id", organizationId)
      .eq("staff_user_id", userId)
      .eq("cleaning_date", input.usageDate)
      // 후보 목록과 같은 「청소한 기록」만 — 후보에 안 나오는 기록은 저장도 거절한다(2026-11-25).
      .eq("status", LINKABLE_CLEANING_STATUS)
      .eq("closed_without_cleaning", false)
      .maybeSingle();
    if (cleaningRes.error || !cleaningRes.data) return { ok: false, error: "invalid_link" };
    linkedSource = { type: "cleaning", id: cleaningSessionId };
    const resolved = await resolveLinkedTransportPlace(service, organizationId, {
      type: "cleaning",
      roomLabel: (cleaningRes.data as { room_label?: string | null }).room_label ?? null,
    });
    if (!resolved.ok) return resolved;
    linkedPlace = resolved.place;
  }
  // 건물 id: 연결 기록이 건물을 가리키면(근무지 FK · 청소 방의 건물) 그것을 쓰고 화면 값은 버린다. 가리키지 않으면
  // (FK 가 빈 근무지 — 화면이 이름으로 출근지를 맞춘 값) 지금처럼 화면 값을 아래에서 같은 조직인지 확인해 쓴다.
  // 후보의 `propertyId` 도 같은 판정이라, 화면이 후보 값을 그대로 보내던 지금까지의 저장값 · 금액 기억 키와 같다.
  const propertyId = linkedPlace?.propertyId ?? (input.propertyId?.trim() || null);
  const destinationKey = linkedPlace?.propertyId ?? (input.destinationKey?.trim() || null);
  let propertyName: string | null = null;
  if (propertyId) {
    const propertyRes = await service
      .from("properties")
      .select("id, name")
      .eq("id", propertyId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (propertyRes.error || !propertyRes.data) return { ok: false, error: "invalid_link" };
    const name = (propertyRes.data as { name?: string | null }).name;
    propertyName = typeof name === "string" && name.trim() ? name : null;
  }

  // 보고서 행은 **첫 항목을 넣을 때** 만든다 — 화면을 여는 것만으로는 만들지 않는다(page.tsx 는 읽기만).
  let report: Awaited<ReturnType<typeof getOrCreateTransportReport>>;
  try {
    report = await getOrCreateTransportReport(service, organizationId, userId, targetMonthDate);
  } catch (error) {
    console.error("[createTransportItemAction] report read/create failed:", error instanceof Error ? error.message : error);
    return { ok: false, error: "insert_failed" };
  }
  if (!EDITABLE_STATUSES.has(report.status)) return { ok: false, error: "report_not_editable" };

  const workContext: Record<string, string> = {};
  // 라벨은 **표시용**이다(로케일마다 다르다). 기억·집계의 키는 `destinationKey` 다.
  if (destinationKey) workContext.destinationKey = destinationKey;
  const buildingLabel = resolveBuildingLabel(input, propertyName, linkedPlace?.buildingLabel ?? null);
  if (buildingLabel) workContext.buildingLabel = buildingLabel;
  // 요약: 연결 항목은 서버가 연결 기록에서 만든 글(후보 목록과 글자까지 같음), 직접 입력은 화면 값.
  const contextSummary = linkedPlace ? linkedPlace.contextSummary : input.contextSummary?.trim() || "";
  if (contextSummary) workContext.contextSummary = contextSummary;
  if (linkedSource) {
    workContext.linkedSourceType = linkedSource.type;
    workContext.linkedSourceId = linkedSource.id;
  }

  const ins = await untyped(service)
    .from("transport_reimbursement_items")
    .insert({
      organization_id: organizationId,
      report_id: report.id,
      user_id: userId,
      usage_date: input.usageDate,
      amount_yen: input.amountYen,
      entry_mode: input.entryMode,
      // 직접 입력은 근태 기록에 잇지 않는다(트리거도 manual 이면 비운다). 청소 연결도 근태 칸은 비운다.
      attendance_session_id: linkedSource?.type === "attendance" ? attendanceSessionId : null,
      property_id: propertyId,
      work_context: workContext,
      memo: input.memo?.trim() ? input.memo.trim() : null,
    })
    .select("id")
    .maybeSingle();
  if (ins.error || !ins.data) return { ok: false, error: triggerErrorCode(ins.error?.message, "insert_failed") };

  await syncReportTotalAmountQuietly(service, report.id);
  revalidatePath(TRANSPORT_PATH);
  return { ok: true, itemId: (ins.data as { id: string }).id, reportId: report.id };
}

// ── 수정 ─────────────────────────────────────────────────────────────────

export type UpdateTransportItemInput = {
  itemId: string;
  amountYen?: number;
  memo?: string | null;
  // 건물 이름(`buildingLabel`)은 받지 않는다(2026-11-25) — 출근지는 수정에서 못 바꾸고, 이름은 만들 때 서버가 정한다.
  contextSummary?: string;
  /**
   * 입력 방식 바꾸기(2026-11-25). **자동 연결 → 직접 입력(`"manual"`)만** 받는다 — 연결 출처(linkedSourceType ·
   * linkedSourceId)와 근태 칸(attendance_session_id)을 비운다. 직접 입력 → 자동 연결은 출처를 서버가 다시 확인해야 해서
   * 여기서 받지 않는다(`invalid_entry_mode`) — 그때는 항목을 지우고 후보에서 다시 만든다. 같은 값이면 아무것도 안 한다.
   */
  entryMode?: TransportEntryMode;
};

export type TransportActionResult = { ok: true } | { ok: false; error: string };

type OwnItem = {
  id: string;
  report_id: string;
  work_context: Record<string, string> | null;
  entry_mode: TransportEntryMode;
};

/**
 * 본인 소유 항목과 그 보고서 상태를 찾는다(조직 범위). 상태와 상관없이 돌려준다(다시 받기는 승인된 정산서도 본다).
 * 읽기 오류는 `read_failed` — 「남의 것」(forbidden)과 섞지 않는다(2026-11-25).
 */
async function loadOwnItem(
  service: Service,
  organizationId: string,
  userId: string,
  itemId: string,
): Promise<{ ok: true; item: OwnItem; reportStatus: string } | { ok: false; error: string }> {
  const res = await untyped(service)
    .from("transport_reimbursement_items")
    .select("id, report_id, user_id, organization_id, work_context, entry_mode")
    .eq("id", itemId)
    .maybeSingle();
  if (res.error) return { ok: false, error: "read_failed" };
  const row = res.data as (OwnItem & { user_id: string; organization_id: string }) | null;
  if (!row || row.organization_id !== organizationId || row.user_id !== userId) {
    return { ok: false, error: "forbidden" };
  }

  const reportRes = await untyped(service)
    .from("transport_reimbursement_reports")
    .select("status")
    .eq("id", row.report_id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (reportRes.error) return { ok: false, error: "read_failed" };
  const report = reportRes.data as { status: string } | null;
  if (!report) return { ok: false, error: "forbidden" };

  return {
    ok: true,
    item: { id: row.id, report_id: row.report_id, work_context: row.work_context, entry_mode: row.entry_mode },
    reportStatus: report.status,
  };
}

/** loadOwnItem + 보고서를 고칠 수 있어야 한다. */
async function loadEditableOwnItem(
  service: Service,
  organizationId: string,
  userId: string,
  itemId: string,
): Promise<{ ok: true; item: OwnItem } | { ok: false; error: string }> {
  const loaded = await loadOwnItem(service, organizationId, userId, itemId);
  if (!loaded.ok) return loaded;
  if (!EDITABLE_STATUSES.has(loaded.reportStatus)) return { ok: false, error: "report_not_editable" };
  return { ok: true, item: loaded.item };
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
  let workContext: Record<string, string> | null = null;
  if (input.entryMode !== undefined && input.entryMode !== loaded.item.entry_mode) {
    if (input.entryMode !== "manual") return { ok: false, error: "invalid_entry_mode" };
    workContext = { ...(loaded.item.work_context ?? {}) };
    delete workContext.linkedSourceType;
    delete workContext.linkedSourceId;
    update.entry_mode = "manual";
    update.attendance_session_id = null;
  } else if (input.entryMode !== undefined && input.entryMode !== "manual" && input.entryMode !== "linked") {
    return { ok: false, error: "invalid_entry_mode" };
  }
  // 연결 항목으로 남는 항목의 요약은 고치지 않는다(2026-11-25) — 연결 기록에서 서버가 만든 글이다. 화면은 연결 항목의
  // 방 칸을 잠그고(직접 입력으로 바꾸면 풀림), 같은 저장에서 직접 입력으로 바꾸면 그때부터 화면 값을 받는다.
  const staysLinked = (update.entry_mode ?? loaded.item.entry_mode) === "linked";
  if (input.contextSummary !== undefined && !staysLinked) {
    workContext ??= { ...(loaded.item.work_context ?? {}) };
    if (input.contextSummary.trim()) workContext.contextSummary = input.contextSummary.trim();
    else delete workContext.contextSummary;
  }
  if (workContext) update.work_context = workContext;
  if (Object.keys(update).length === 0) return { ok: true };

  const upd = await untyped(service)
    .from("transport_reimbursement_items")
    .update(update)
    .eq("id", loaded.item.id)
    .eq("organization_id", organizationId)
    .eq("user_id", userId);
  if (upd.error) return { ok: false, error: triggerErrorCode(upd.error.message, "update_failed") };

  await syncReportTotalAmountQuietly(service, loaded.item.report_id);
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

  // 지울 파일 목록을 먼저 읽는다 — 못 읽으면 지우지 않는다(행만 지워지고 파일이 영영 남지 않게).
  const imgRes = await untyped(service)
    .from("transport_reimbursement_item_images")
    .select("storage_path")
    .eq("item_id", itemId)
    .eq("organization_id", organizationId);
  if (imgRes.error) return { ok: false, error: "read_failed" };
  // 이 항목 폴더의 파일만 지운다 — 예전 검사가 느슨할 때 들어간 남의 경로가 있어도 건드리지 않는다.
  const paths = ((imgRes.data ?? []) as { storage_path: string }[])
    .map((r) => r.storage_path)
    .filter((path) => Boolean(path) && isOwnItemImagePath(path, organizationId, reportId, itemId));

  // 행 먼저(2026-11-25) — DB 잠금 트리거(제출 · 승인 뒤)에 걸리면 파일은 그대로 남아 증빙이 깨지지 않는다.
  // 사진 행은 cascade 로 함께 지워진다.
  const del = await untyped(service)
    .from("transport_reimbursement_items")
    .delete()
    .eq("id", itemId)
    .eq("organization_id", organizationId)
    .eq("user_id", userId);
  if (del.error) return { ok: false, error: triggerErrorCode(del.error.message, "delete_failed") };

  // 파일은 그 뒤 두 버킷에서. 실패해도 행은 이미 없다 — 남은 파일은 기록만 남긴다(사용자에겐 성공).
  if (paths.length > 0) await removeTransportReceiptFiles(service, paths);

  await syncReportTotalAmountQuietly(service, reportId);
  revalidatePath(TRANSPORT_PATH);
  return { ok: true };
}

// ── 항목 이미지 ────────────────────────────────────────────────────────────

/**
 * 거절된 업로드 정리 — 그 항목 폴더의 파일이고, 그 경로를 쓰는 사진 행이 없을 때만 두 버킷에서 지운다
 * (이미 등록된 다른 사진의 파일을 지우지 않게).
 */
async function discardRejectedUpload(
  service: Service,
  organizationId: string,
  item: OwnItem,
  storagePath: string,
): Promise<void> {
  if (!isOwnItemImagePath(storagePath, organizationId, item.report_id, item.id)) return;
  const used = await untyped(service)
    .from("transport_reimbursement_item_images")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("storage_path", storagePath)
    .limit(1);
  if (used.error || ((used.data ?? []) as unknown[]).length > 0) return;
  await removeTransportReceiptFiles(service, [storagePath]);
}

export async function addTransportItemImageAction(
  itemId: string,
  storagePath: string,
): Promise<TransportActionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, error: "auth" };
  const organizationId = session.organization.id;
  const userId = session.user.id;
  const service = getSupabaseServiceClient();

  const loaded = await loadOwnItem(service, organizationId, userId, itemId);
  if (!loaded.ok) return loaded;
  const item = loaded.item;

  if (!isOwnItemImagePath(storagePath, organizationId, item.report_id, item.id)) {
    return { ok: false, error: "invalid_path" };
  }

  // 파일이 실제로 올라가 있어야 등록한다(2026-11-25) — 없는 경로로 사진 행만 생기면 증빙이 깨진 채 제출된다.
  const exists = await transportReceiptExists(service, storagePath);
  if (exists === "error") return { ok: false, error: "storage_failed" };
  if (!exists) return { ok: false, error: "file_missing" };

  const reject = async (error: string): Promise<TransportActionResult> => {
    await discardRejectedUpload(service, organizationId, item, storagePath);
    return { ok: false, error };
  };

  if (!EDITABLE_STATUSES.has(loaded.reportStatus)) return reject("report_not_editable");

  // 같은 경로가 이미 등록돼 있으면(두 번 누름 · 응답을 못 받고 다시 시도) 새 행 없이 성공 — 파일은 그 행이 쓰고 있다(2026-11-25).
  const already = await untyped(service)
    .from("transport_reimbursement_item_images")
    .select("id")
    .eq("item_id", itemId)
    .eq("organization_id", organizationId)
    .eq("storage_path", storagePath)
    .limit(1);
  if (already.error) return { ok: false, error: "read_failed" };
  if (((already.data ?? []) as unknown[]).length > 0) return { ok: true };

  // 5장 상한 — 화면 · 여기 · DB 트리거(동시에 올릴 때) 세 곳에서 건다. 순서(sort_order)는 DB 트리거가 매긴다.
  const countRes = await untyped(service)
    .from("transport_reimbursement_item_images")
    .select("id")
    .eq("item_id", itemId)
    .eq("organization_id", organizationId);
  if (countRes.error) return { ok: false, error: "read_failed" };
  if (((countRes.data ?? []) as unknown[]).length >= MAX_ITEM_IMAGES) return reject("too_many_images");

  const ins = await untyped(service)
    .from("transport_reimbursement_item_images")
    .insert({
      organization_id: organizationId,
      report_id: item.report_id,
      item_id: itemId,
      user_id: userId,
      storage_path: storagePath,
    });
  if (ins.error) {
    // 동시에 같은 경로를 넣어 (item_id, storage_path) 유일 색인(202611250002)에 걸림 — 다른 요청이 이미 등록했다.
    // 파일은 그 행이 쓰므로 지우지 않는다.
    if ((ins.error as { code?: string }).code === "23505") {
      revalidatePath(TRANSPORT_PATH);
      return { ok: true };
    }
    return reject(triggerErrorCode(ins.error.message, "insert_failed"));
  }

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
  if (imgRes.error) return { ok: false, error: "read_failed" };
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

  // 행 먼저(2026-11-25) — DB 잠금 트리거에 걸리면 파일은 남는다. 파일을 먼저 지우면 행만 남아 깨진 증빙이 된다.
  const del = await untyped(service)
    .from("transport_reimbursement_item_images")
    .delete()
    .eq("id", imageId)
    .eq("organization_id", organizationId)
    .eq("user_id", userId);
  if (del.error) return { ok: false, error: triggerErrorCode(del.error.message, "delete_failed") };

  // 이 항목 폴더의 파일일 때만 두 버킷에서 지운다. 실패해도 행은 이미 없다 — 기록만 남긴다.
  if (
    image.storage_path &&
    isOwnItemImagePath(image.storage_path, organizationId, loaded.item.report_id, loaded.item.id)
  ) {
    await removeTransportReceiptFiles(service, [image.storage_path]);
  }

  revalidatePath(TRANSPORT_PATH);
  return { ok: true };
}

// ── 영수증 주소 다시 받기 ────────────────────────────────────────────────────

export type TransportReceiptUrlsResult =
  | { ok: true; images: Array<{ id: string; url: string | null }>; imageUrlsFailed: boolean }
  | { ok: false; error: string };

/**
 * 본인 항목의 영수증 서명 주소를 새로 받는다(2026-11-25). 서명 주소는 10분이라, 화면을 오래 열어 둔 뒤 사진을 열 때 쓴다.
 * 정산서 상태와 상관없이 본인 항목이면 된다(제출 · 승인된 것도 본다).
 */
export async function refreshTransportReceiptUrlsAction(itemId: string): Promise<TransportReceiptUrlsResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, error: "auth" };
  const organizationId = session.organization.id;
  const userId = session.user.id;
  const service = getSupabaseServiceClient();

  const loaded = await loadOwnItem(service, organizationId, userId, itemId);
  if (!loaded.ok) return loaded;

  const imgRes = await untyped(service)
    .from("transport_reimbursement_item_images")
    .select("id, storage_path, sort_order, created_at")
    .eq("item_id", itemId)
    .eq("organization_id", organizationId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (imgRes.error) return { ok: false, error: "read_failed" };
  const rows = (imgRes.data ?? []) as { id: string; storage_path: string }[];
  const { urlByPath, failedPaths } = await signTransportReceiptPaths(
    service,
    rows.map((r) => r.storage_path),
  );
  return {
    ok: true,
    images: rows.map((r) => ({ id: r.id, url: urlByPath.get(r.storage_path) ?? null })),
    imageUrlsFailed: rows.some((r) => failedPaths.has(r.storage_path) || !urlByPath.has(r.storage_path)),
  };
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

  let report: Awaited<ReturnType<typeof getTransportReport>>;
  try {
    report = await getTransportReport(service, organizationId, userId, targetMonthDate);
  } catch (error) {
    console.error("[submitTransportReportAction] report read failed:", error instanceof Error ? error.message : error);
    return { ok: false, error: "submit_failed" };
  }
  if (!report) return { ok: false, error: "no_report" };
  if (!EDITABLE_STATUSES.has(report.status)) return { ok: false, error: "report_not_editable" };

  // 항목이 최소 1개 있어야 한다.
  const itemsRes = await untyped(service)
    .from("transport_reimbursement_items")
    .select("id")
    .eq("report_id", report.id)
    .eq("organization_id", organizationId);
  if (itemsRes.error) return { ok: false, error: "submit_failed" };
  const itemIds = ((itemsRes.data ?? []) as { id: string }[]).map((r) => r.id);
  if (itemIds.length === 0) return { ok: false, error: "no_items" };

  // 모든 항목에는 증빙 이미지가 최소 1장 있어야 한다.
  const imgRes = await untyped(service)
    .from("transport_reimbursement_item_images")
    .select("item_id")
    .in("item_id", itemIds)
    .eq("organization_id", organizationId);
  if (imgRes.error) return { ok: false, error: "submit_failed" };
  const withImage = new Set(
    ((imgRes.data ?? []) as { item_id: string }[]).map((r) => r.item_id),
  );
  const missing = itemIds.some((id) => !withImage.has(id));
  if (missing) return { ok: false, error: "missing_evidence" };

  // 제출 직전에 합계를 항목에서 다시 맞춘다(2026-11-11 M12) — 관리자가 보는 금액이 항목 합과 어긋나지 않게.
  try {
    await syncReportTotalAmount(service, report.id);
  } catch (error) {
    console.error("[submitTransportReportAction] total sync failed:", error instanceof Error ? error.message : error);
    return { ok: false, error: "submit_failed" };
  }

  // 고칠 수 있는 상태일 때만 넘긴다 — 위에서 읽은 뒤 관리자가 처리했으면 0행이 바뀌고 실패로 돌려준다.
  const upd = await untyped(service)
    .from("transport_reimbursement_reports")
    .update({ status: "submitted", submitted_at: new Date().toISOString() })
    .eq("id", report.id)
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .in("status", EDITABLE_STATUS_LIST)
    .select("id");
  if (upd.error) return { ok: false, error: "submit_failed" };
  if (((upd.data ?? []) as unknown[]).length === 0) return { ok: false, error: "report_not_editable" };

  revalidatePath(TRANSPORT_PATH);
  return { ok: true };
}
