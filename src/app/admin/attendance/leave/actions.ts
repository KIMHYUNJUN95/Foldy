"use server";

// 연차 — 관리자 승인 액션(2단계 Phase 2). annual-leave-approvals-server.ts 를 얇게 감싼다.
// 승인 권한(플랫폼 관리자 / leave_approver_role 이 null 이 아닌 조직 멤버십)은 그 lib 함수 안에서
// 검사한다. 마이그레이션 202607060002 와
// docs/product/26-annual-leave-workflow.md 참고.

import { revalidatePath } from "next/cache";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { buildAdminExportMeta, type AdminExportMeta } from "@/lib/admin-export-meta";
import type { AdminReportExportResult, AdminWorkbookExportResult } from "@/lib/admin-export-result";
import { buildAdminTableReportHtml } from "@/lib/admin-table-report";
import {
  buildAdminTableWorkbookBase64,
  type AdminTableColumn,
  type AdminTableSheet,
} from "@/lib/admin-table-workbook";
import {
  approveLeaveRequestForApprover,
  cancelApprovedLeaveForApprover,
  isSessionLeaveApprover,
  rejectLeaveRequestForApprover,
  type LeaveStatus,
  type LeaveType,
} from "@/lib/annual-leave-approvals-server";
import {
  createAdminLeaveRequest,
  listAdminLeaveBalances,
  listLeaveLedger,
  saveEmployeeLeaveBaseline,
  type AdminLeaveRequestInput,
  type LeaveLedgerEntry,
} from "@/lib/annual-leave-admin-server";
import { getDictionary, type Dictionary } from "@/lib/i18n";
import { filterLeaveLedger, type LeaveLedgerFilter } from "@/lib/annual-leave";

const LEAVE_PATH = "/admin/attendance/leave";

export async function approveLeaveRequestAction(
  requestId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdminPageSession({ nextPath: LEAVE_PATH });
  const result = await approveLeaveRequestForApprover(session, requestId);
  if (result.ok) revalidatePath(LEAVE_PATH);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function rejectLeaveRequestAction(
  requestId: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdminPageSession({ nextPath: LEAVE_PATH });
  const result = await rejectLeaveRequestForApprover(session, requestId, reason);
  if (result.ok) revalidatePath(LEAVE_PATH);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function cancelApprovedLeaveAction(
  requestId: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdminPageSession({ nextPath: LEAVE_PATH });
  const result = await cancelApprovedLeaveForApprover(session, requestId, reason);
  if (result.ok) revalidatePath(LEAVE_PATH);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function createAdminLeaveRequestAction(
  input: AdminLeaveRequestInput,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const session = await requireAdminPageSession({ nextPath: LEAVE_PATH });
  // 대리 신청(남의 이름)은 휴가 승인권자만 — 본인 신청은 누구나(모바일과 같은 권한, 2026-10-26).
  if (input.targetUserId !== session.user.id && !(await isSessionLeaveApprover(session))) {
    return { ok: false, error: "forbidden" };
  }
  const result = await createAdminLeaveRequest(session, input);
  if (result.ok) revalidatePath(LEAVE_PATH);
  return result.ok ? { ok: true, id: result.id } : { ok: false, error: result.error };
}

/** 직원의 입사일 + 부여 잔여를 수정한다(직원 잔여·부여 drawer 편집기). 승인권자만. */
export async function saveEmployeeLeaveBaselineAction(input: {
  userId: string;
  hireDate: string;
  grant: number;
  bonus: number;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdminPageSession({ nextPath: LEAVE_PATH });
  if (!(await isSessionLeaveApprover(session))) return { ok: false, error: "not_approver" };
  const result = await saveEmployeeLeaveBaseline(session, input);
  if (result.ok) revalidatePath(LEAVE_PATH);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

// ── Excel / PDF 내보내기 (이력 / 잔여) ──────────────────────────────────────
// 2026-07-14 에 이력 탭의 클라이언트 Blob CSV 와 잔여 탭의 임시 토스트를 대체했다.
// 둘 다 공용 관리자 표 내보내기(src/lib/admin-table-workbook.ts /
// admin-table-report.ts)로 그리고, 위 변경 액션과 똑같이 승인권자만 쓸 수 있다.
//
// 이력(ledger): 클라이언트는 필터(상태 / 검색 / 기간)만 보낸다. 서버가 listLeaveLedger 로 장부를 다시 읽고
// 같은 순수 필터(`filterLeaveLedger`)를 적용한다 — 클라이언트가 보낸 행은 내보내기에 절대 믿고 쓰지 않는다
// (2026-10-26). 눈에 보이는 *라벨*은 모두 여기서
// 행위자 본인의 언어로 정한다.
// 잔여(balance): 필터 없는 스냅샷이라 행을 서버에서 다시 조회한다.

type Lc = Dictionary["admin"]["leaveConsole"];

function leaveTypeLabel(type: LeaveType, lc: Lc): string {
  if (type === "paid") return lc.typePaid;
  if (type === "annual") return lc.typeAnnual;
  if (type === "special") return lc.typeSpecial;
  return lc.typeOther;
}

function leaveStatusLabel(status: LeaveStatus, lc: Lc): string {
  if (status === "requested") return lc.statusRequested;
  if (status === "approved") return lc.statusApproved;
  if (status === "rejected") return lc.statusRejected;
  return lc.statusCancelled;
}

function roleLabelOf(role: string | null, dictionary: Dictionary): string {
  if (!role) return "";
  return (dictionary.roles as Record<string, string>)[role] ?? role;
}

function ledgerSheet(entries: LeaveLedgerEntry[], meta: AdminExportMeta): AdminTableSheet {
  const dictionary = getDictionary(meta.locale);
  const lc = dictionary.admin.leaveConsole;

  const columns: AdminTableColumn[] = [
    { key: "processedAt", label: lc.ledgerColProcessedAt, width: 17, printWidth: 11 },
    { key: "docNo", label: lc.ledgerColDocNo, width: 15, printWidth: 10 },
    { key: "applicant", label: lc.ledgerColApplicant, width: 14, printWidth: 9 },
    { key: "role", label: lc.approversColRole, width: 13, printWidth: 8 },
    { key: "type", label: lc.ledgerColType, width: 11, printWidth: 7 },
    { key: "start", label: lc.formStart, width: 12, printWidth: 8 },
    { key: "end", label: lc.formEnd, width: 12, printWidth: 8 },
    { key: "days", label: lc.ledgerColDays, width: 8, printWidth: 5, bold: true },
    { key: "status", label: lc.ledgerColStatus, width: 11, printWidth: 7 },
    { key: "processor", label: lc.ledgerColProcessor, width: 14, printWidth: 8 },
    { key: "reason", label: lc.formReason, width: 26, printWidth: 13, wrap: true },
    { key: "decisionReason", label: lc.ledgerColDecisionReason, width: 22, printWidth: 12, wrap: true },
  ];

  const totalDays = entries.reduce((sum, e) => sum + e.daysCount, 0);

  return {
    sheetName: lc.subTabLedger,
    title: lc.subTabLedger,
    colNoLabel: meta.shared.colNo,
    totalLabel: meta.shared.exportTotalLabel,
    columns,
    rows: entries.map((e) => ({
      processedAt: e.processedAt,
      docNo: e.documentNumber ?? "",
      applicant: e.applicantName,
      role: roleLabelOf(e.applicantRole, dictionary),
      type: leaveTypeLabel(e.leaveType, lc),
      start: e.startDate,
      end: e.endDate,
      days: String(e.daysCount),
      status: leaveStatusLabel(e.status, lc),
      processor: e.processorName ?? "",
      reason: e.reason,
      decisionReason: e.decisionReason ?? "",
    })),
    totals: { days: String(totalDays) },
  };
}

const LEDGER_STATUSES = new Set(["requested", "approved", "rejected", "cancelled"]);
const LEDGER_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 클라이언트가 보낸 조건을 검증하고, 서버에서 다시 읽은 이력을 같은 규칙으로 거른다. 조건이 틀리면 null. */
async function ledgerEntriesFor(
  session: Awaited<ReturnType<typeof requireAdminPageSession>>,
  filter: LeaveLedgerFilter,
): Promise<LeaveLedgerEntry[] | null> {
  if (!filter || typeof filter !== "object") return null;
  if (filter.status !== null && !LEDGER_STATUSES.has(filter.status)) return null;
  if (typeof filter.query !== "string" || filter.query.length > 200) return null;
  if (!LEDGER_DATE.test(filter.from) || !LEDGER_DATE.test(filter.to)) return null;
  const all = await listLeaveLedger(session);
  return filterLeaveLedger(all, {
    status: filter.status,
    query: filter.query,
    from: filter.from,
    to: filter.to,
  });
}

export async function exportLeaveLedgerWorkbook(
  filter: LeaveLedgerFilter,
): Promise<AdminWorkbookExportResult> {
  const session = await requireAdminPageSession({ nextPath: LEAVE_PATH });
  if (!(await isSessionLeaveApprover(session))) return { ok: false, reason: "forbidden" };
  const entries = await ledgerEntriesFor(session, filter);
  if (!entries) return { ok: false, reason: "error" };
  if (entries.length === 0) return { ok: false, reason: "empty" };

  try {
    const meta = buildAdminExportMeta(session);
    const sheet = ledgerSheet(entries, meta);
    const base64 = await buildAdminTableWorkbookBase64({
      orgName: meta.orgName,
      generatedLabel: meta.generatedLabel,
      sheets: [sheet],
    });
    return { ok: true, filename: "leave-ledger.xlsx", base64, rowCount: sheet.rows.length };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function exportLeaveLedgerReport(
  filter: LeaveLedgerFilter,
): Promise<AdminReportExportResult> {
  const session = await requireAdminPageSession({ nextPath: LEAVE_PATH });
  if (!(await isSessionLeaveApprover(session))) return { ok: false, reason: "forbidden" };
  const entries = await ledgerEntriesFor(session, filter);
  if (!entries) return { ok: false, reason: "error" };
  if (entries.length === 0) return { ok: false, reason: "empty" };

  try {
    const meta = buildAdminExportMeta(session);
    const html = buildAdminTableReportHtml({
      orgName: meta.orgName,
      generatedLabel: meta.generatedLabel,
      printLabel: meta.shared.exportPrint,
      localeTag: meta.localeTag,
      sheets: [ledgerSheet(entries, meta)],
    });
    return { ok: true, html, rowCount: entries.length };
  } catch {
    return { ok: false, reason: "error" };
  }
}

async function balanceSheet(
  session: Awaited<ReturnType<typeof requireAdminPageSession>>,
  meta: AdminExportMeta,
  userId?: string,
): Promise<AdminTableSheet> {
  const dictionary = getDictionary(meta.locale);
  const lc = dictionary.admin.leaveConsole;

  const all = await listAdminLeaveBalances(session);
  const rows = userId ? all.filter((e) => e.userId === userId) : all;

  const columns: AdminTableColumn[] = [
    { key: "staff", label: lc.balanceColStaff, width: 16, printWidth: 14 },
    { key: "role", label: lc.approversColRole, width: 14, printWidth: 12 },
    { key: "hire", label: lc.balanceColHire, width: 13, printWidth: 11 },
    { key: "paid", label: lc.balanceColPaidRemaining, width: 14, printWidth: 12, bold: true },
    { key: "special", label: lc.balanceColSpecialRemaining, width: 14, printWidth: 12 },
    { key: "used", label: lc.balanceColUsedThisMonth, width: 12, printWidth: 10, bold: true },
    { key: "expiring", label: lc.balanceColExpiring, width: 16, printWidth: 13 },
    { key: "nextGrant", label: lc.balanceColNextGrant, width: 16, printWidth: 12 },
  ];

  return {
    sheetName: lc.subTabBalance,
    title: lc.subTabBalance,
    // 기간이 아닌 스냅샷 — 기준일을 찍어 두어 인쇄본이 헷갈리지 않게 한다.
    rangeLabel: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date()),
    colNoLabel: meta.shared.colNo,
    totalLabel: meta.shared.exportTotalLabel,
    columns,
    rows: rows.map((e) => ({
      staff: e.name,
      role: roleLabelOf(e.role, dictionary),
      hire: e.hireDate ?? "",
      paid: e.ineligible ? lc.balanceIneligiblePill : `${e.grant - e.usedBase} / ${e.grant}`,
      special: e.bonus ? `${e.bonus - e.usedBonus} / ${e.bonus}` : "",
      used: String(e.usedBase + e.usedBonus),
      expiring:
        e.expiringDate && e.expiringAmount
          ? `${e.expiringDate} (${lc.daysUnit(e.expiringAmount)})`
          : "",
      nextGrant: e.nextGrantDate ? `${e.nextGrantDate} (+${e.nextGrantAmount})` : "",
    })),
  };
}

export async function exportLeaveBalanceWorkbook(
  userId?: string,
): Promise<AdminWorkbookExportResult> {
  const session = await requireAdminPageSession({ nextPath: LEAVE_PATH });
  if (!(await isSessionLeaveApprover(session))) return { ok: false, reason: "forbidden" };

  try {
    const meta = buildAdminExportMeta(session);
    const sheet = await balanceSheet(session, meta, userId);
    if (sheet.rows.length === 0) return { ok: false, reason: "empty" };

    const base64 = await buildAdminTableWorkbookBase64({
      orgName: meta.orgName,
      generatedLabel: meta.generatedLabel,
      sheets: [sheet],
    });
    return {
      ok: true,
      filename: userId ? `leave-balance_${userId}.xlsx` : "leave-balance.xlsx",
      base64,
      rowCount: sheet.rows.length,
    };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function exportLeaveBalanceReport(userId?: string): Promise<AdminReportExportResult> {
  const session = await requireAdminPageSession({ nextPath: LEAVE_PATH });
  if (!(await isSessionLeaveApprover(session))) return { ok: false, reason: "forbidden" };

  try {
    const meta = buildAdminExportMeta(session);
    const sheet = await balanceSheet(session, meta, userId);
    if (sheet.rows.length === 0) return { ok: false, reason: "empty" };

    const html = buildAdminTableReportHtml({
      orgName: meta.orgName,
      generatedLabel: meta.generatedLabel,
      printLabel: meta.shared.exportPrint,
      localeTag: meta.localeTag,
      sheets: [sheet],
    });
    return { ok: true, html, rowCount: sheet.rows.length };
  } catch {
    return { ok: false, reason: "error" };
  }
}
