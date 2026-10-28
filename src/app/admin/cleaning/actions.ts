"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/admin-session";
import { signalCleaningAssignChange } from "@/lib/cleaning-assign/live";
import {
  getAdminCleaningHistory,
  type AdminCleaningHistoryItem,
  type AdminCleaningStatus,
} from "@/lib/admin-cleaning";
import {
  canForceCompleteCleaning,
  getCleaningOperatingDateKey,
  resolveForceCompleteDate,
} from "@/lib/cleaning";
import {
  buildAdminExportMeta,
  compactRangePart,
  type AdminExportMeta,
} from "@/lib/admin-export-meta";
import {
  buildAdminTableWorkbookBase64,
  type AdminTableColumn,
  type AdminTableExportRow,
  type AdminTableSheet,
} from "@/lib/admin-table-workbook";
import { buildAdminTableReportHtml } from "@/lib/admin-table-report";
import type { AdminReportExportResult, AdminWorkbookExportResult } from "@/lib/admin-export-result";
import { getDictionary, type Locale } from "@/lib/i18n";
import {
  buildSessionRoomLabel,
  getCanonicalPropertyName,
  getCanonicalRoomLabel,
  localizeRoomPlaceLabel,
} from "@/lib/room-label-normalization";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
// 소요시간 포맷은 화면(오늘 현황 카드·기록 표·상세 패널)이 쓰는 fmtDur 를 그대로 재사용한다 —
// 예전에는 여기에 같은 규칙을 한 번 더 구현해 두 벌이 갈릴 위험이 있었다.
import { fmtDate, fmtDur, toMin, type BuildingKey, type CleaningTaskType } from "@/components/admin/cleaning/cleaning-console-data";

// 기록 탭의 Excel/PDF 내보내기를 받치는 서버 액션. 클라이언트는 원본인
// 이미 필터링된 기록 행(표시 문자열이 아니라 정규 건물/유형 키)을 보내면, 눈에 보이는 모든
// 문자열을 여기서 실행자 본인의 세션 로케일로 변환한다. 그래서 클라이언트가 어떻게 렌더했든
// 내보낸 파일은 항상 로그인한 사용자의 언어와 일치한다. 다른 모든 /admin/* 내보내기도 쓰는
// 공용 관리자 표 내보내기(src/lib/admin-table-workbook.ts / admin-table-report.ts)로 만든다.
// 참고: docs/product/07-cleaning-workflow.md →
// "2026-07-14 청소 기록 내보내기".

export type CleaningHistoryExportRow = {
  date: string; // yyyy-mm-dd
  building: BuildingKey | null;
  buildingRaw: string;
  room: string;
  type: CleaningTaskType;
  staffName: string;
  start: string;
  dur: number | null; // minutes; 진행중/취소 세션은 null
  status: AdminCleaningStatus;
  proxy: boolean;
  closed?: boolean;
  note: string;
};

export type CleaningHistoryWorkbookResult = AdminWorkbookExportResult;
export type CleaningHistoryReportResult = AdminReportExportResult;

export type FetchCleaningHistoryResult =
  | { ok: true; items: AdminCleaningHistoryItem[] }
  | { ok: false; reason: "invalid" | "error" };

// 기록 보드에서 AdminDateRangePicker 로 새 기간을 고를 때마다 호출된다 —
// page.tsx 가 서버에서 미리 불러오는 건 이번 달뿐이므로, 그 밖의 기간은 여기서 가져온다.
export async function fetchAdminCleaningHistory(
  from: string,
  to: string,
): Promise<FetchCleaningHistoryResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return { ok: false, reason: "invalid" };
  }
  const session = await requireAdminSession();
  try {
    const items = await getAdminCleaningHistory(session, { startDate: from, endDate: to });
    return { ok: true, items };
  } catch {
    return { ok: false, reason: "error" };
  }
}

function minToHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function typeLabelOf(type: CleaningTaskType, t: ReturnType<typeof getDictionary>["cleaning"]["console"]): string {
  if (type === "checkout") return t.tyCheckout;
  if (type === "simple") return t.tySimple;
  if (type === "longstay") return t.tyLongstay;
  return t.tySetup;
}

function cleaningColumns(locale: Locale): AdminTableColumn[] {
  const t = getDictionary(locale).cleaning.console;
  return [
    { key: "date", label: t.colDate, width: 11, printWidth: 8 },
    { key: "building", label: t.building, width: 14, printWidth: 11 },
    { key: "room", label: t.colRoom, width: 10, printWidth: 7 },
    { key: "type", label: t.colType, width: 13, printWidth: 10 },
    { key: "staff", label: t.colStaff, width: 16, printWidth: 12 },
    { key: "start", label: t.colStart, width: 10, printWidth: 7 },
    { key: "end", label: t.colEnd, width: 10, printWidth: 7 },
    { key: "dur", label: t.colDur, width: 11, printWidth: 8, bold: true },
    { key: "status", label: t.colStatus, width: 14, printWidth: 10 },
    { key: "note", label: t.colNote, width: 34, printWidth: 16, wrap: true },
  ];
}

/** 세션 상태(진행중/완료/취소) 문구. 모바일과 같은 사전 키를 쓴다 — 콘솔 네임스페이스에는
 * 아직 취소 문구가 없다. */
function sessionStatusLabelOf(
  status: AdminCleaningStatus,
  dictionary: ReturnType<typeof getDictionary>,
): string {
  if (status === "progress") return dictionary.cleaning.records.status.in_progress;
  if (status === "cancelled") return dictionary.cleaning.records.status.cancelled;
  if (status === "pending") return dictionary.cleaning.console.stPending;
  return dictionary.cleaning.records.status.completed;
}

function cleaningTableRows(
  rows: CleaningHistoryExportRow[],
  locale: Locale,
  localeTag: string,
): AdminTableExportRow[] {
  const dictionary = getDictionary(locale);
  const t = dictionary.cleaning.console;
  const buildingLabels = dictionary.cleaning.buildingLabels;

  return rows.map((r) => {
    const startMin = toMin(r.start) ?? 0;
    // "상태" 열은 실제 세션 상태를 쓴다. 정상/대리 완료는 상태가 아니라 완료 유형이라
    // 담당자 셀에 함께 표기한다(화면의 대리 완료 태그와 같은 축).
    const staffLabel = r.staffName || "—";
    return {
      date: fmtDate(r.date, localeTag),
      building: (r.building ? buildingLabels[r.building] : null) ?? r.buildingRaw,
      // 독채(오쿠보 · 사노)는 객실 이름이 한국어 건물 이름이다(2026-10-23).
      room: localizeRoomPlaceLabel(r.room, buildingLabels),
      type: typeLabelOf(r.type, t),
      staff: r.closed ? `${staffLabel} · ${t.stClosed}` : r.proxy ? `${staffLabel} · ${t.stProxy}` : staffLabel,
      start: r.start,
      end: r.dur == null ? "—" : minToHHMM(startMin + r.dur),
      dur: fmtDur(r.dur),
      status: sessionStatusLabelOf(r.status, dictionary),
      note: r.note,
    };
  });
}

function cleaningSheet(
  rows: CleaningHistoryExportRow[],
  meta: AdminExportMeta,
  from: string,
  to: string,
): AdminTableSheet {
  const t = getDictionary(meta.locale).cleaning.console;
  const totalMinutes = rows.reduce((sum, r) => sum + (r.dur ?? 0), 0);
  return {
    sheetName: t.exportTitle,
    title: t.exportTitle,
    rangeLabel: `${fmtDate(from, meta.localeTag)} – ${fmtDate(to, meta.localeTag)}`,
    colNoLabel: meta.shared.colNo,
    totalLabel: meta.shared.exportTotalLabel,
    columns: cleaningColumns(meta.locale),
    rows: cleaningTableRows(rows, meta.locale, meta.localeTag),
    totals: { dur: fmtDur(totalMinutes) },
  };
}

export async function exportCleaningHistoryWorkbook(
  rows: CleaningHistoryExportRow[],
  from: string,
  to: string,
): Promise<CleaningHistoryWorkbookResult> {
  const session = await requireAdminSession();
  if (rows.length === 0) return { ok: false, reason: "empty" };

  const meta = buildAdminExportMeta(session);
  const sheet = cleaningSheet(rows, meta, from, to);
  const base64 = await buildAdminTableWorkbookBase64({
    orgName: meta.orgName,
    generatedLabel: meta.generatedLabel,
    sheets: [sheet],
  });

  return {
    ok: true,
    filename: `cleaning-history_${compactRangePart(from)}_${compactRangePart(to)}.xlsx`,
    base64,
    rowCount: sheet.rows.length,
  };
}

export async function exportCleaningHistoryReport(
  rows: CleaningHistoryExportRow[],
  from: string,
  to: string,
): Promise<CleaningHistoryReportResult> {
  const session = await requireAdminSession();
  if (rows.length === 0) return { ok: false, reason: "empty" };

  const meta = buildAdminExportMeta(session);
  const sheet = cleaningSheet(rows, meta, from, to);
  const html = buildAdminTableReportHtml({
    orgName: meta.orgName,
    generatedLabel: meta.generatedLabel,
    printLabel: meta.shared.exportPrint,
    localeTag: meta.localeTag,
    sheets: [sheet],
  });

  return { ok: true, html, rowCount: sheet.rows.length };
}

// ── 강제완료 (관리자 대리 완료) ─────────────────────────────────────────────
// 콘솔의 유일한 변경 액션. 앱 수준 역할 확인 후 서비스 롤 클라이언트(RLS 우회)로 쓴다.
// 근태 관리자 쓰기 패턴과 같다
// (src/app/admin/attendance/actions.ts 의 attendanceCan + getSupabaseServiceClient) —
// cleaning_sessions UPDATE/INSERT RLS 정책에는 관리자가 다른 직원을 대신하는 분기가 없으므로
// 의도적으로 권한 판단을 RLS 에 맡기지 않는다.

export type ForceCompleteCleaningInput = {
  sessionId: string | null; // 기존 세션 → UPDATE, null(시작된 적 없는 객실) → INSERT
  /**
   * canonical `cleaning_sessions.room_label` — 예: "아라키초A 501_2", 오쿠보처럼 단독 건물은 "오쿠보A".
   * 콘솔 카드가 보여주는 축약 라벨("아라키초A 501")을 저장하면 getCleaningTargets 의 canonical
   * roomKey 와 매칭되지 않아 모바일 큐에 미처리로 남고(중복 청소) 콘솔에는 매칭 안 되는 유령
   * 완료 카드가 생긴다. 아래에서 서버가 한 번 더 canonical 로 정규화한다.
   */
  sessionRoomLabel: string;
  taskType: CleaningTaskType;
  staffId: string;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  note: string;
  /**
   * 콘솔이 보고 있던 운영일(도쿄, YYYY-MM-DD). 과거 날짜 화면에서 강제 완료하면 그날로 저장돼야 한다 —
   * 오늘로 저장하면 오늘 청소 큐에서 같은 방이 「완료」로 빠진다. 기존 세션은 세션의 cleaning_date 를 따른다.
   */
  cleaningDate: string;
};

export type ForceCompleteCleaningResult =
  | { ok: true }
  | { ok: false; reason: "forbidden" | "invalid" | "error" };

function taskTypeToTaskLabel(type: CleaningTaskType): string {
  if (type === "longstay") return "long_stay";
  if (type === "simple") return "simple";
  return "checkout";
}

function tokyoDateTimeIso(dateKey: string, hhmm: string): string | null {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return null;
  return `${dateKey}T${hhmm}:00+09:00`;
}

/**
 * 클라이언트가 보낸 세션 라벨을 다시 canonical 형태로 정규화한다 — 모바일이 저장하는 값
 * (`${propertyName} ${canonicalRoomLabel}`, src/app/mobile/cleaning/actions.ts)과 정확히 같은
 * 모양이어야 getCleaningTargets / resolveRoomKey 매칭이 성립한다.
 * 새 정규화 규칙을 만들지 않고 room-label-normalization.ts 의 기존 헬퍼만 조합한다.
 */
function canonicalizeSessionRoomLabel(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > 100) return null;

  const spaceIndex = trimmed.indexOf(" ");
  // 공백이 없으면 오쿠보처럼 "건물 = 객실"인 단독 건물 라벨이다.
  const rawProperty = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
  const rawRoom = spaceIndex === -1 ? trimmed : trimmed.slice(spaceIndex + 1);

  const canonicalProperty = getCanonicalPropertyName(rawProperty);
  const canonicalRoom = getCanonicalRoomLabel(canonicalProperty, rawRoom);
  if (!canonicalProperty || !canonicalRoom) return null;

  return buildSessionRoomLabel(canonicalProperty, canonicalRoom);
}

export async function forceCompleteCleaningSession(
  input: ForceCompleteCleaningInput,
): Promise<ForceCompleteCleaningResult> {
  const session = await requireAdminSession();
  if (!canForceCompleteCleaning(session)) {
    return { ok: false, reason: "forbidden" };
  }

  const roomLabel = canonicalizeSessionRoomLabel(input.sessionRoomLabel);
  const viewDate = resolveForceCompleteDate(input.cleaningDate, getCleaningOperatingDateKey());
  if (!input.staffId || !roomLabel || !viewDate) {
    return { ok: false, reason: "invalid" };
  }

  const service = getSupabaseServiceClient();
  const organizationId = session.organization.id;

  let cleaningDate = viewDate;
  if (input.sessionId) {
    const existing = await service
      .from("cleaning_sessions")
      .select("cleaning_date")
      .eq("id", input.sessionId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!existing.data) return { ok: false, reason: "invalid" };
    cleaningDate = existing.data.cleaning_date;
  }

  const startIso = tokyoDateTimeIso(cleaningDate, input.start);
  const endIso = tokyoDateTimeIso(cleaningDate, input.end);
  if (!startIso || !endIso) {
    return { ok: false, reason: "invalid" };
  }
  const durationSeconds = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000);
  // 종료가 시작보다 늦지 않으면 소요 0초 완료 기록이 생긴다 — 서버에서 막는다.
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { ok: false, reason: "invalid" };
  }

  // 직원은 이 조직의 실제 활성 구성원이어야 한다 — 클라이언트가 보낸 id 를 무조건 믿지 않는다.
  const membership = await service
    .from("memberships")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", input.staffId)
    .eq("status", "active")
    .maybeSingle();
  if (!membership.data) {
    return { ok: false, reason: "invalid" };
  }

  if (input.sessionId) {
    const { error } = await service
      .from("cleaning_sessions")
      .update({
        status: "completed",
        staff_user_id: input.staffId,
        started_at: startIso,
        completed_at: endIso,
        duration_seconds: durationSeconds,
        notes: input.note || null,
        completed_by_admin: session.user.id,
      })
      .eq("id", input.sessionId)
      .eq("organization_id", organizationId);
    if (error) return { ok: false, reason: "error" };
    await afterForceComplete(organizationId);
    return { ok: true };
  }

  const { error } = await service.from("cleaning_sessions").insert({
    organization_id: organizationId,
    room_label: roomLabel,
    task_label: taskTypeToTaskLabel(input.taskType),
    staff_user_id: input.staffId,
    cleaning_date: cleaningDate,
    status: "completed",
    started_at: startIso,
    completed_at: endIso,
    duration_seconds: durationSeconds,
    notes: input.note || null,
    completed_by_admin: session.user.id,
  });
  if (error) return { ok: false, reason: "error" };
  await afterForceComplete(organizationId);
  return { ok: true };
}

/**
 * 강제 완료는 어드민 콘솔 · 모바일 청소 · 오늘 내 방 · 청소 현황판 · PC 배정 모두에 반영돼야 한다.
 * 재검증만으로는 열려 있는 다른 사람 화면이 낡은 채로 남는다 — 청소 시작 · 끝내기와 같은 `cleaning_assign` 신호를 보낸다(2026-10-28).
 */
async function afterForceComplete(organizationId: string) {
  revalidatePath("/admin/cleaning");
  revalidatePath("/mobile/cleaning");
  revalidatePath("/mobile/shift/today");
  await signalCleaningAssignChange(organizationId).catch(() => undefined);
}
