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

import {
  buildLinenExportPayload,
  type LinenExportPayload,
  type LinenExportQuery,
  type LinenItemExportRow,
} from "@/components/admin/linen-return/linen-console-data";
import { getAdminLinenReturns, isAdminCapableRole, isOrganizationRole } from "@/lib/admin-linen-returns";
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
import {
  LINEN_MAX_PHOTOS,
  areLinenPhotoUrlsAllowed,
  clampLinenRange,
  linenAllowedItemIds,
  linenRpcErrorReason,
  parseLinenLines,
} from "@/lib/linen-return-rules";
import { isValidIsoDate, revalidateLinenReturnPaths } from "@/lib/linen-returns";
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
        | "invalid_photo"
        /** 그사이 다른 사람이 먼저 고쳤다 — 다시 열어서 고친다. */
        | "stale"
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
    session.user.id === record.registered_by_user_id || isAdminCapableRole(session);
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
  /** 수정 창을 연 때의 updated_at — 그사이 다른 사람이 고쳤으면 `stale`. 없으면 이 검사만 건너뛴다. */
  updatedAt?: string | null;
}): Promise<LinenConsoleResult> {
  const guarded = await guard(input.recordId);
  if (!guarded.ok) return guarded;
  const { session, record } = guarded;

  const building = input.buildingName.trim();
  if (!(await isKnownBuilding(session, building))) return { ok: false, reason: "invalid_building" };

  const photos = [...new Set((Array.isArray(input.photos) ? input.photos : []).filter((url): url is string => typeof url === "string" && url.length > 0))];
  if (photos.length > LINEN_MAX_PHOTOS) return { ok: false, reason: "too_many_photos" };
  // 새로 붙은 사진 주소는 업로더가 쓰는 우리 저장소 `{조직}/linen-returns/{기록 id}/` 아래 파일만 받는다.
  // 이미 저장돼 있던 주소(모바일 등록 때의 다른 폴더 포함)는 그대로 둔다 — 모바일 수정과 같은 함수.
  if (
    !areLinenPhotoUrlsAllowed(photos, {
      organizationId: session.organization.id,
      folderId: record.id,
      kept: record.image_urls ?? [],
    })
  ) {
    return { ok: false, reason: "invalid_photo" };
  }

  const supabase = await getSupabaseServerClient();

  // 선택 가능한 품목 = 조직의 활성 품목 중 전역(building_name null) 또는 이 건물 전용 + (건물이 그대로면) 이미 이 기록에 있던 품목.
  const [{ data: itemData, error: itemError }, { data: beforeData, error: beforeError }] = await Promise.all([
    supabase
      .from("linen_items")
      .select("id, building_name, is_active")
      .eq("organization_id", session.organization.id)
      .eq("is_active", true),
    supabase
      .from("linen_return_record_items")
      .select("linen_item_id, quantity, sort_order")
      .eq("return_record_id", record.id)
      .order("sort_order", { ascending: true }),
  ]);
  if (itemError || beforeError) return { ok: false, reason: "error" };
  const beforeLines = (beforeData ?? []) as Array<Pick<LineRow, "linen_item_id" | "quantity" | "sort_order">>;
  const parsed = parseLinenLines(
    Array.isArray(input.lines) ? input.lines : [],
    linenAllowedItemIds({
      activeIds: ((itemData ?? []) as Array<Pick<ItemRow, "id" | "building_name" | "is_active">>)
        .filter((row) => row.building_name === null || row.building_name === building)
        .map((row) => row.id),
      building,
      existing: { building: record.building_name, itemIds: beforeLines.map((line) => line.linen_item_id) },
    }),
  );
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const lines = parsed.lines;

  // 머리 · 품목 줄을 한 트랜잭션으로(반쪽 저장 없음) + 동시 수정 막기. 등록 시각 · 등록자는 DB 트리거가 지킨다.
  const note = input.note.trim();
  const { error: saveError } = await supabase.rpc("linen_update_return", {
    p_record_id: record.id,
    p_expected_updated_at: input.updatedAt ?? null,
    p_building: building,
    p_note: note,
    p_image_urls: photos,
    p_lines: lines,
  });
  if (saveError) {
    const reason = linenRpcErrorReason(saveError.message);
    if (reason && reason !== "too_many_photos_merged") return { ok: false, reason };
    return { ok: false, reason: "error" };
  }


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
        lines: beforeLines.map((l) => ({ item_id: l.linen_item_id, quantity: l.quantity })),
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

  // 지워진 행 수를 본다 — RLS 가 막으면 오류 없이 0행이다.
  const { data: deleted, error } = await supabase
    .from("linen_return_records")
    .delete()
    .eq("id", record.id)
    .eq("organization_id", session.organization.id)
    .select("id");
  if (error) return { ok: false, reason: "error" };
  // 오류 없이 0행 = RLS 가 막았다(권한이 그사이 바뀜 등).
  if (!deleted || deleted.length === 0) return { ok: false, reason: "forbidden" };


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

function cleanFilter(value: unknown): string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 ? value : "all";
}

/**
 * 내보낼 표를 서버에서 다시 만든다 — 콘솔은 기간 · 보기 · 필터만 보낸다(클라이언트가 보낸 행은 받지 않는다).
 * 기간은 화면과 같은 규칙(달력 날짜 · 366일 상한), 조회는 세션 조직 범위의 getAdminLinenReturns.
 */
async function loadExportPayload(
  session: AppSession,
  query: LinenExportQuery,
  meta: AdminExportMeta,
): Promise<LinenExportPayload | null> {
  if (!hasOrganizationContext(session)) return null;
  if (!isValidIsoDate(String(query?.from)) || !isValidIsoDate(String(query?.to))) return null;
  const range = clampLinenRange(query.from, query.to);
  const data = await getAdminLinenReturns(
    session,
    range.from,
    range.to,
    getDictionary(meta.locale).cleaning.buildingLabels,
  );
  if (data.loadError) return null;
  return buildLinenExportPayload(
    data,
    {
      from: range.from,
      to: range.to,
      view: query.view === "items" ? "items" : "records",
      building: cleanFilter(query.building),
      item: cleanFilter(query.item),
      registrant: cleanFilter(query.registrant),
    },
    meta.localeTag,
  );
}

export async function exportLinenReturnWorkbook(
  query: LinenExportQuery,
): Promise<AdminWorkbookExportResult> {
  const session = await requireAdminSession();

  try {
    const meta = buildAdminExportMeta(session);
    const payload = await loadExportPayload(session, query, meta);
    if (!payload) return { ok: false, reason: "error" };
    if (isEmpty(payload)) return { ok: false, reason: "empty" };
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
  query: LinenExportQuery,
): Promise<AdminReportExportResult> {
  const session = await requireAdminSession();

  try {
    const meta = buildAdminExportMeta(session);
    const payload = await loadExportPayload(session, query, meta);
    if (!payload) return { ok: false, reason: "error" };
    if (isEmpty(payload)) return { ok: false, reason: "empty" };
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
