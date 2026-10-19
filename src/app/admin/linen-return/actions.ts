"use server";

// Admin 린넨 반품 콘솔 서버 액션 — 현장(모바일)에서 등록된 기록의 수정 / 삭제만 담당한다.
// 신규 등록은 계속 모바일 전용이므로 create 액션은 의도적으로 없다.
//
// 계약 (docs/product/19-linen-defect-workflow.md → "Record Management Contract"):
//  · 수정 가능: 건물 · 품목/수량 · 메모 · 사진
//  · 증빙값 고정: registered_at / registered_by_user_id 는 절대 수정하지 않는다
//  · 삭제: MVP hard delete (line items 는 FK on delete cascade)
//  · 권한: 작성자 본인 또는 관리자 역할 — UI 노출 여부와 무관하게 서버에서 다시 검증한다
//  · 추적: 수정·삭제는 audit_logs 에 actor / time / action / 변경 스냅샷을 남긴다

import type {
  LinenExportPayload,
  LinenItemExportRow,
} from "@/components/admin/linen-return/linen-console-data";
import { isAdminCapableRole, isOrganizationRole } from "@/lib/admin-linen-returns";
import { requireAdminSession } from "@/lib/admin-session";
import {
  buildAdminExportMeta,
  compactRangePart,
  type AdminExportMeta,
} from "@/lib/admin-export-meta";
import type { AdminReportExportResult, AdminWorkbookExportResult } from "@/lib/admin-export-result";
import { buildAdminTableReportHtml } from "@/lib/admin-table-report";
import {
  buildAdminTableWorkbookBase64,
  type AdminTableColumn,
  type AdminTableSheet,
} from "@/lib/admin-table-workbook";
import { getDictionary } from "@/lib/i18n";
import { replaceLinenRecordLines } from "@/lib/linen-return-lines";
import { revalidateLinenReturnPaths } from "@/lib/linen-returns";
import { getActiveRoomCatalogServer } from "@/lib/rooms";
import { hasOrganizationContext, type AppSession } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";
import type { Json } from "@/types/database";
import { bestEffortWrite } from "@/lib/db-write-guard";

type RecordRow = Database["public"]["Tables"]["linen_return_records"]["Row"];
type ItemRow = Database["public"]["Tables"]["linen_items"]["Row"];
type LineRow = Database["public"]["Tables"]["linen_return_record_items"]["Row"];

/** 사진 상한 — CLAUDE.md §8 의 기능당 5장 정책(프로젝트 업무 예외는 여기 해당 없음). */
const MAX_PHOTOS = 5;

export type LinenConsoleLineInput = { itemId: string; quantity: number };

export type LinenConsoleResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "forbidden"
        | "not_found"
        | "invalid_building"
        | "invalid_item"
        | "invalid_quantity"
        | "duplicate_item"
        | "missing_items"
        | "too_many_photos"
        | "error";
    };

type GuardOk = { ok: true; session: AppSession; record: RecordRow };
type GuardFail = { ok: false; reason: "forbidden" | "not_found" | "error" };

/**
 * 세션 · 조직 스코프 · 레코드 존재 · 관리 권한을 한 번에 검증한다.
 * 조직 격리는 조회 자체를 `organization_id` 로 제한해서 보장한다(UI 신뢰 금지).
 */
async function guard(recordId: string): Promise<GuardOk | GuardFail> {
  // 이 파일의 내보내기 액션들과 같은 어드민 웹 게이트를 쓴다 — 어드민 웹이 막힌 역할이
  // 서버 액션을 직접 호출해 수정/삭제하지 못하게 한다(UI 노출 여부는 인가 근거가 아니다).
  const session = await requireAdminSession();
  if (!hasOrganizationContext(session)) return { ok: false, reason: "forbidden" };
  if (!recordId) return { ok: false, reason: "not_found" };

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("linen_return_records")
    .select("*")
    .eq("id", recordId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  // 22P02 = URL/폼에 들어온 잘못된 uuid → 500 대신 not_found 로 다룬다.
  if (error) return { ok: false, reason: error.code === "22P02" ? "not_found" : "error" };
  if (!data) return { ok: false, reason: "not_found" };

  const record = data as RecordRow;
  const canManage =
    session.user.id === record.registered_by_user_id || isAdminCapableRole(session.user.role);
  if (!canManage) return { ok: false, reason: "forbidden" };

  return { ok: true, session, record };
}

/** 조직의 객실 마스터에 실제로 존재하는 건물명인지 서버에서 확인한다. */
async function isKnownBuilding(session: AppSession, building: string): Promise<boolean> {
  if (!building) return false;
  const catalog = (await getActiveRoomCatalogServer(session.organization.id)) ?? [];
  const names = new Set(catalog.map((item) => item.propertyName));
  // 마스터를 읽을 수 없는 비조직(플랫폼) 세션은 막지 않는다 — 모바일 isKnownBuilding 과 동일 규칙.
  if (names.size === 0) return !isOrganizationRole(session.user.role);
  return names.has(building);
}

async function writeAudit(params: {
  organizationId: string;
  actorId: string;
  action: "linen_return_console_update" | "linen_return_console_delete";
  recordId: string;
  metadata: Json;
}) {
  try {
    const service = getSupabaseServiceClient();
    await bestEffortWrite(
      "audit_logs: insert",
      service.from("audit_logs").insert({
          organization_id: params.organizationId,
          actor_user_id: params.actorId,
          action: params.action,
          target_type: "linen_return_record",
          target_id: params.recordId,
          metadata: params.metadata,
        })
    );
  } catch {
    // 감사 기록 실패가 이미 성공한 업무 처리를 되돌리지는 않는다 — 조용히 무시하지 않고 로그만 남긴다.
    console.error("[linen-return] audit log write failed", params.action, params.recordId);
  }
}

/**
 * 기록 수정 — 건물 · 품목/수량 · 메모 · 사진만 갱신한다.
 * 등록 시각/등록자는 현장 증빙값이므로 update payload 에 아예 넣지 않는다.
 */
export async function updateAdminLinenRecord(input: {
  recordId: string;
  buildingName: string;
  lines: LinenConsoleLineInput[];
  note: string;
  photos: string[];
}): Promise<LinenConsoleResult> {
  const guarded = await guard(input.recordId);
  if (!guarded.ok) return guarded;
  const { session, record } = guarded;

  const building = input.buildingName.trim();
  if (!(await isKnownBuilding(session, building))) return { ok: false, reason: "invalid_building" };

  const photos = (input.photos ?? []).filter((url) => typeof url === "string" && url.length > 0);
  if (photos.length > MAX_PHOTOS) return { ok: false, reason: "too_many_photos" };

  const supabase = await getSupabaseServerClient();

  // 선택 가능한 품목 = 조직의 활성 품목 중 전역(building_name null) 또는 이 건물 전용.
  const { data: itemData, error: itemError } = await supabase
    .from("linen_items")
    .select("id, building_name, is_active")
    .eq("organization_id", session.organization.id)
    .eq("is_active", true);
  if (itemError) return { ok: false, reason: "error" };
  const validItemIds = new Set(
    ((itemData ?? []) as Array<Pick<ItemRow, "id" | "building_name" | "is_active">>)
      .filter((row) => row.building_name === null || row.building_name === building)
      .map((row) => row.id),
  );

  const seen = new Set<string>();
  const lines: LinenConsoleLineInput[] = [];
  for (const raw of input.lines ?? []) {
    const itemId = String(raw?.itemId ?? "").trim();
    const quantity = Number(raw?.quantity);
    if (!itemId || !validItemIds.has(itemId)) return { ok: false, reason: "invalid_item" };
    if (!Number.isInteger(quantity) || quantity <= 0) return { ok: false, reason: "invalid_quantity" };
    if (seen.has(itemId)) return { ok: false, reason: "duplicate_item" };
    seen.add(itemId);
    lines.push({ itemId, quantity });
  }
  if (lines.length === 0) return { ok: false, reason: "missing_items" };

  const note = input.note.trim();
  const headerUpdate: Database["public"]["Tables"]["linen_return_records"]["Update"] = {
    building_name: building,
    note: note || null,
    image_urls: photos,
  };
  const { error: headerError } = await supabase
    .from("linen_return_records")
    .update(headerUpdate)
    .eq("id", record.id)
    .eq("organization_id", session.organization.id);
  if (headerError) return { ok: false, reason: "error" };

  const replaced = await replaceLinenRecordLines(supabase, record.id, lines);
  if (!replaced.ok) return { ok: false, reason: "error" };

  await writeAudit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "linen_return_console_update",
    recordId: record.id,
    metadata: {
      before: {
        building_name: record.building_name,
        note: record.note,
        photo_count: (record.image_urls ?? []).length,
        lines: replaced.before.map((l) => ({ item_id: l.linen_item_id, quantity: l.quantity })),
      },
      after: {
        building_name: building,
        note: note || null,
        photo_count: photos.length,
        lines: lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity })),
      },
      registered_by_user_id: record.registered_by_user_id,
      registered_at: record.registered_at,
    } as Json,
  });

  revalidateLinenReturnPaths();
  return { ok: true };
}

/** 기록 삭제 — MVP hard delete. 품목 행은 FK cascade 로 함께 사라진다. */
export async function deleteAdminLinenRecord(recordId: string): Promise<LinenConsoleResult> {
  const guarded = await guard(recordId);
  if (!guarded.ok) return guarded;
  const { session, record } = guarded;

  const supabase = await getSupabaseServerClient();
  const { data: beforeLines } = await supabase
    .from("linen_return_record_items")
    .select("linen_item_id, quantity")
    .eq("return_record_id", record.id);

  const { error } = await supabase
    .from("linen_return_records")
    .delete()
    .eq("id", record.id)
    .eq("organization_id", session.organization.id);
  if (error) return { ok: false, reason: "error" };

  await writeAudit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "linen_return_console_delete",
    recordId: record.id,
    metadata: {
      building_name: record.building_name,
      note: record.note,
      photo_count: (record.image_urls ?? []).length,
      registered_by_user_id: record.registered_by_user_id,
      registered_at: record.registered_at,
      lines: ((beforeLines ?? []) as Array<Pick<LineRow, "linen_item_id" | "quantity">>).map((l) => ({
        item_id: l.linen_item_id,
        quantity: l.quantity,
      })),
    } as Json,
  });

  revalidateLinenReturnPaths();
  return { ok: true };
}

// ── Excel / PDF 내보내기 ────────────────────────────────────────────────────
// 공용 계약(CLAUDE.md §4b): 버튼은 <AdminExportButtons>, 워크북은 buildAdminTableWorkbookBase64,
// 인쇄본은 buildAdminTableReportHtml — 둘 다 같은 입력 형태를 쓴다. CSV 는 없다.
// 로케일은 buildAdminExportMeta(session) 가 서버에서 정한다(클라이언트가 넘기지 않는다).
//
// 한 파일 안에 시트 2개를 담는다: 「린넨 반품 기록」 + 「품목별 수량」. 사무실의 실제 대조 업무가
// "기록 목록"과 "품목 합계"를 함께 보기 때문이며, 콘솔의 두 탭과 1:1로 대응한다.

function fmtRangeDate(value: string, localeTag: string): string {
  return new Intl.DateTimeFormat(localeTag, {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00+09:00`));
}

/** 제목 앞에 붙는 "기간 · 적용 필터" 라벨. 내보낸 파일만 봐도 조건을 알 수 있어야 한다. */
function rangeLabelOf(payload: LinenExportPayload, meta: AdminExportMeta): string {
  const range = `${fmtRangeDate(payload.from, meta.localeTag)} – ${fmtRangeDate(payload.to, meta.localeTag)}`;
  return payload.scopeLabel ? `${range} · ${payload.scopeLabel}` : range;
}

function recordColumns(meta: AdminExportMeta): AdminTableColumn[] {
  const t = getDictionary(meta.locale).linenReturn.console;
  return [
    { key: "registeredAt", label: t.colRegisteredAt, width: 18, printWidth: 13 },
    { key: "building", label: t.colBuilding, width: 15, printWidth: 11 },
    { key: "items", label: t.colItems, width: 40, printWidth: 30, wrap: true },
    { key: "kinds", label: t.colKinds, width: 9, printWidth: 7 },
    { key: "totalQuantity", label: t.colTotalQty, width: 11, printWidth: 8, bold: true },
    { key: "registrant", label: t.colRegistrant, width: 16, printWidth: 12 },
    { key: "note", label: t.colNote, width: 34, printWidth: 19, wrap: true },
  ];
}

function recordSheet(payload: LinenExportPayload, meta: AdminExportMeta): AdminTableSheet {
  const t = getDictionary(meta.locale).linenReturn.console;
  const total = payload.records.reduce((sum, row) => sum + row.totalQuantity, 0);
  return {
    sheetName: t.exportRecordsTitle,
    title: t.exportRecordsTitle,
    rangeLabel: rangeLabelOf(payload, meta),
    colNoLabel: meta.shared.colNo,
    totalLabel: meta.shared.exportTotalLabel,
    columns: recordColumns(meta),
    rows: payload.records.map((row) => ({
      registeredAt: row.registeredAt,
      building: row.building,
      items: row.items,
      kinds: String(row.kinds),
      totalQuantity: String(row.totalQuantity),
      registrant: row.registrant || "—",
      note: row.note,
    })),
    totals: { totalQuantity: String(total) },
  };
}

function itemColumns(payload: LinenExportPayload, meta: AdminExportMeta): AdminTableColumn[] {
  const t = getDictionary(meta.locale).linenReturn.console;
  const columns: AdminTableColumn[] = [
    { key: "name", label: t.colItem, width: 22, printWidth: 26 },
    {
      key: "quantity",
      // 건물을 좁혔으면 그 건물 이름이 곧 수량 열의 의미가 된다(콘솔 화면과 같은 규칙).
      label: payload.building ?? t.colQty,
      width: 14,
      printWidth: 14,
      bold: true,
    },
  ];
  if (payload.building) {
    columns.push({ key: "allBuildingQuantity", label: t.colAllBuildings, width: 14, printWidth: 14 });
  }
  columns.push({ key: "recordCount", label: t.colRecordCount, width: 11, printWidth: 12 });
  columns.push({ key: "lastAt", label: t.colLastReturn, width: 18, printWidth: 20 });
  return columns;
}

function itemSheet(payload: LinenExportPayload, meta: AdminExportMeta): AdminTableSheet {
  const t = getDictionary(meta.locale).linenReturn.console;
  const total = payload.items.reduce((sum, row) => sum + row.quantity, 0);
  const allTotal = payload.items.reduce((sum, row) => sum + (row.allBuildingQuantity ?? 0), 0);
  const totals: Record<string, string> = { quantity: String(total) };
  if (payload.building) totals.allBuildingQuantity = String(allTotal);
  return {
    sheetName: t.exportItemsTitle,
    title: t.exportItemsTitle,
    rangeLabel: rangeLabelOf(payload, meta),
    colNoLabel: meta.shared.colNo,
    totalLabel: meta.shared.exportTotalLabel,
    columns: itemColumns(payload, meta),
    rows: payload.items.map((row: LinenItemExportRow) => {
      const cells: Record<string, string> = {
        name: row.name,
        quantity: String(row.quantity),
        recordCount: String(row.recordCount),
        lastAt: row.lastAt ?? "—",
      };
      if (payload.building) cells.allBuildingQuantity = String(row.allBuildingQuantity ?? 0);
      return cells;
    }),
    totals,
  };
}

function sheetsOf(payload: LinenExportPayload, meta: AdminExportMeta): AdminTableSheet[] {
  return [recordSheet(payload, meta), itemSheet(payload, meta)];
}

function isEmpty(payload: LinenExportPayload): boolean {
  return payload.records.length === 0;
}

export async function exportLinenReturnWorkbook(
  payload: LinenExportPayload,
): Promise<AdminWorkbookExportResult> {
  const session = await requireAdminSession();
  if (isEmpty(payload)) return { ok: false, reason: "empty" };

  try {
    const meta = buildAdminExportMeta(session);
    const sheets = sheetsOf(payload, meta);
    const base64 = await buildAdminTableWorkbookBase64({
      orgName: meta.orgName,
      generatedLabel: meta.generatedLabel,
      sheets,
    });
    return {
      ok: true,
      filename: `linen-returns_${compactRangePart(payload.from)}_${compactRangePart(payload.to)}.xlsx`,
      base64,
      rowCount: payload.records.length,
    };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function exportLinenReturnReport(
  payload: LinenExportPayload,
): Promise<AdminReportExportResult> {
  const session = await requireAdminSession();
  if (isEmpty(payload)) return { ok: false, reason: "empty" };

  try {
    const meta = buildAdminExportMeta(session);
    const html = buildAdminTableReportHtml({
      orgName: meta.orgName,
      generatedLabel: meta.generatedLabel,
      printLabel: meta.shared.exportPrint,
      localeTag: meta.localeTag,
      sheets: sheetsOf(payload, meta),
    });
    return { ok: true, html, rowCount: payload.records.length };
  } catch {
    return { ok: false, reason: "error" };
  }
}
