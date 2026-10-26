"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/admin-session";
import { buildAdminExportMeta, type AdminExportMeta } from "@/lib/admin-export-meta";
import type { AdminReportExportResult, AdminWorkbookExportResult } from "@/lib/admin-export-result";
import { buildAdminTableReportHtml } from "@/lib/admin-table-report";
import {
  buildAdminTableWorkbookBase64,
  type AdminTableColumn,
  type AdminTableSheet,
} from "@/lib/admin-table-workbook";
import { bestEffortWrite, mustWrite } from "@/lib/db-write-guard";
import { getDictionary } from "@/lib/i18n";
import {
  localizeRecruitDaysPerWeek,
  localizeRecruitEmployment,
  localizeRecruitGender,
  localizeRecruitStartDate,
  localizeRecruitWorkDays,
} from "@/lib/recruit/choice-labels";
import { isYmd, tokyoDateOf, tokyoToday } from "@/lib/tokyo-date";
import {
  canDeleteJobApplications,
  isUuid,
  listJobApplicationsByIds,
  canReadJobApplications,
  canTriageJobApplications,
  JOB_APPLICATION_STATUSES,
  type JobApplicationStatus,
} from "@/lib/recruit/applications";
import { RESUME_BUCKET } from "@/lib/recruit/ingest";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * 채용 콘솔의 쓰기 — 상태 전환 · 검토 메모 · 삭제 · 내보내기.
 *
 * **권한을 매번 다시 본다.** 읽기와 같은 이유로(service-role 은 RLS 를 우회한다) 모든 액션이
 * 역할을 직접 확인한다. 화면에서 버튼을 감추는 것만으로는 막은 게 아니다(CLAUDE.md §6).
 *
 * 도메인 계약: docs/product/30-recruit-workflow.md
 */

const CONSOLE_PATH = "/admin/recruit";
/** 한 번에 바꿀 수 있는 지원서 수 상한(목록 조회 상한과 같다). */
const MAX_BULK_IDS = 500;

export type RecruitActionResult =
  | { ok: true; count?: number }
  | { ok: false; error: "forbidden" | "not_found" | "invalid" | "failed" };

function isStatus(value: string): value is JobApplicationStatus {
  return (JOB_APPLICATION_STATUSES as readonly string[]).includes(value);
}

/** 열람 권한. 목록·상세·내보내기가 쓴다. */
async function requireRecruitSession() {
  const session = await requireAdminSession();
  if (!canReadJobApplications(session)) return null;
  return session;
}

/**
 * 심사(상태 변경·검토 메모) 권한.
 *
 * 열람과 나눠 둔 이유: 「보기만 되는 담당자」가 실무적으로 성립한다. 열람만 가진 사람이 상태를
 * 바꾸면 다른 사람의 분류 작업을 덮어쓴다.
 */
async function requireTriageSession() {
  const session = await requireAdminSession();
  if (!canTriageJobApplications(session)) return null;
  return session;
}

/**
 * 삭제 권한.
 *
 * 하드 삭제이고 이력서 파일까지 지운다 — 되돌릴 수 없는 개인정보 파기라 담당자라고 자동으로
 * 갖지 않는다(기본은 대표·전무, 필요하면 개인 부여).
 */
async function requireDeleteSession() {
  const session = await requireAdminSession();
  if (!canDeleteJobApplications(session)) return null;
  return session;
}

/**
 * 상태 변경. 여러 건을 한 번에 받는다(목록의 벌크 바가 같은 액션을 쓴다).
 *
 * **조직 조건을 반드시 함께 건다.** id 만으로 업데이트하면 다른 조직의 지원서를 건드릴 수 있다 —
 * service-role 은 RLS 를 우회하므로 이 `.eq("organization_id", ...)` 가 유일한 방어선이다.
 */
export async function setApplicationStatus(
  ids: string[],
  status: string,
): Promise<RecruitActionResult> {
  const session = await requireTriageSession();
  if (!session) return { ok: false, error: "forbidden" };
  if (!isStatus(status)) return { ok: false, error: "invalid" };

  if (!Array.isArray(ids)) return { ok: false, error: "invalid" };
  const targets = Array.from(
    new Set(ids.filter((id): id is string => typeof id === "string").map((id) => id.trim()).filter(isUuid)),
  );
  if (targets.length === 0 || targets.length > MAX_BULK_IDS) return { ok: false, error: "invalid" };

  const supabase = getSupabaseServiceClient();
  const ok = await mustWrite(
    "job_applications: status",
    supabase
      .from("job_applications")
      .update({
        status,
        status_changed_at: new Date().toISOString(),
        status_changed_by_user_id: session.user.id,
      })
      .eq("organization_id", session.organization.id)
      .in("id", targets),
  );
  if (!ok) return { ok: false, error: "failed" };

  revalidatePath(CONSOLE_PATH);
  return { ok: true, count: targets.length };
}

/** 검토 메모. 면접 단계에서 「왜 멈췄는지」를 남기는 자리다 — 재지원 이력에 그대로 보인다. */
export async function saveApplicationNote(id: string, note: string): Promise<RecruitActionResult> {
  const session = await requireTriageSession();
  if (!session) return { ok: false, error: "forbidden" };
  const target = id.trim();
  if (!isUuid(target)) return { ok: false, error: "invalid" };

  const trimmed = note.trim();
  const supabase = getSupabaseServiceClient();
  const ok = await mustWrite(
    "job_applications: note",
    supabase
      .from("job_applications")
      .update({ review_note: trimmed.length > 0 ? trimmed.slice(0, 2000) : null })
      .eq("organization_id", session.organization.id)
      .eq("id", target),
  );
  if (!ok) return { ok: false, error: "failed" };

  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

/**
 * 지원서 삭제 — **되돌릴 수 없다.**
 *
 * Foldy 의 기본 정책대로 하드 삭제이며, 이력서 파일도 함께 지운다. 순서가 중요하다:
 * **행을 먼저 지우고 파일을 지운다.** 파일부터 지우면, 행 삭제가 실패했을 때 화면에는 지원서가
 * 남아 있는데 첨부만 사라진 상태가 된다 — 담당자는 파일이 깨졌다고 판단한다.
 * 반대 순서에서 파일 삭제만 실패하면 아무도 접근할 수 없는 파일이 스토리지에 남을 뿐이다.
 */
export async function deleteApplication(id: string): Promise<RecruitActionResult> {
  const session = await requireDeleteSession();
  if (!session) return { ok: false, error: "forbidden" };
  const target = id.trim();
  if (!isUuid(target)) return { ok: false, error: "invalid" };

  const supabase = getSupabaseServiceClient();
  const { data: row, error: lookupError } = await supabase
    .from("job_applications")
    .select("id, resume_path, source, external_id")
    .eq("organization_id", session.organization.id)
    .eq("id", target)
    .maybeSingle();
  if (lookupError) return { ok: false, error: "failed" };
  if (!row) return { ok: false, error: "not_found" };

  // **삭제 기록을 먼저 남긴다.**
  //
  // Foldy 는 Firestore 를 읽기만 하므로 원본 문서는 그대로 남는다. 기록이 없으면 하루 1회 도는
  // 전량 훑기가 다시 읽어 넣고 이력서까지 다시 복사한다 — 지운 개인정보가 되돌아온다.
  //
  // 순서가 중요하다. 기록을 먼저 남기므로, 행 삭제가 실패해도 「지웠다고 했는데 되살아나는」 상태는
  // 생기지 않는다. 반대 순서에서 기록만 실패하면 조용히 되살아난다.
  const tombstoned = await mustWrite(
    "job_application_deletions: insert",
    supabase.from("job_application_deletions").upsert({
      organization_id: session.organization.id,
      source: row.source,
      external_id: row.external_id,
      deleted_by_user_id: session.user.id,
    }),
  );
  if (!tombstoned) return { ok: false, error: "failed" };

  const deleted = await mustWrite(
    "job_applications: delete",
    supabase
      .from("job_applications")
      .delete()
      .eq("organization_id", session.organization.id)
      .eq("id", target),
  );
  if (!deleted) return { ok: false, error: "failed" };

  if (row.resume_path) {
    await bestEffortWrite(
      "recruit-resumes: remove",
      supabase.storage.from(RESUME_BUCKET).remove([row.resume_path]).then(({ error }) => ({
        error: error ? { message: error.message } : null,
      })),
    );
  }

  revalidatePath(CONSOLE_PATH);
  return { ok: true };
}

// ── 내보내기 ─────────────────────────────────────────────────────────────────
// 공용 계약(CLAUDE.md §4b): 버튼은 <AdminExportButtons>, 워크북은 buildAdminTableWorkbookBase64,
// 인쇄본은 buildAdminTableReportHtml — 같은 입력 형태를 쓴다. CSV 는 없다.
// 로케일은 buildAdminExportMeta(session) 가 서버에서 정한다(클라이언트가 넘기지 않는다).
//
// **연락처는 내보내지 않는다.** 전화번호·카카오 ID·주소가 담긴 파일은 한번 나가면 회수할 수
// 없다. 화면에서도 기본 마스킹인 값을 파일로 통째로 흘리는 것은 앞뒤가 맞지 않는다. 내보내기는
// 「누가 어떤 조건으로 지원했는가」를 회의에서 함께 보기 위한 것이다.

export type RecruitExportRow = {
  appliedAt: string;
  name: string;
  age: string;
  gender: string;
  jobTitle: string;
  employmentType: string;
  daysPerWeek: string;
  workDays: string;
  startDate: string;
  experience: string;
  visa: string;
  resume: string;
  status: JobApplicationStatus;
};

/**
 * 내보내기 요청 — 행 내용은 받지 않는다. 클라이언트가 넘긴 값을 그대로 파일에 찍으면 조작된 내용이
 * 「회사 문서」가 된다. id 만 받아 서버가 DB 에서 다시 읽고 로케일에 맞게 만든다.
 */
export type RecruitExportRequest = {
  ids: string[];
  /** 파일 제목에 찍을 기간(도쿄 날짜). 선택 내보내기면 비운다. */
  from: string | null;
  to: string | null;
  selected: boolean;
};

type RecruitExportPayload = {
  rows: RecruitExportRow[];
  rangeLabel: string;
};

async function buildExportPayload(
  session: NonNullable<Awaited<ReturnType<typeof requireRecruitSession>>>,
  request: RecruitExportRequest,
  meta: AdminExportMeta,
): Promise<RecruitExportPayload> {
  const copy = getDictionary(meta.locale).recruit;
  const ids = Array.isArray(request.ids)
    ? request.ids.filter((id): id is string => typeof id === "string")
    : [];
  const list = await listJobApplicationsByIds({ session, ids });
  const rows = list.map<RecruitExportRow>((row) => ({
    appliedAt: tokyoDateOf(row.appliedAt) ?? "—",
    name: row.name,
    age: row.age ?? "—",
    gender: localizeRecruitGender(row.gender, copy.choice) ?? "—",
    jobTitle: row.jobTitle ?? "—",
    employmentType: localizeRecruitEmployment(row.employmentType, copy.choice) ?? "—",
    daysPerWeek: localizeRecruitDaysPerWeek(row.daysPerWeek, copy.choice) ?? "—",
    workDays: localizeRecruitWorkDays(row.workDays, copy.weekDays).join(" "),
    startDate: localizeRecruitStartDate(row.startDate, copy.choice) ?? "—",
    experience: row.hasIndustryExp ? copy.labelExperienceYes : copy.labelExperienceNo,
    visa: row.visaDaysLeft === null ? "—" : copy.chipVisaDays.replace("{n}", String(row.visaDaysLeft)),
    resume: row.hasResume ? "O" : "—",
    status: row.status,
  }));
  // 파일 제목에도 「선택분」임을 남긴다. 1건짜리 파일에 「전체 기간」이 찍혀 있으면 나중에 받은 사람이 전수로 오해한다.
  const rangeLabel = request.selected
    ? copy.exportSelected.replace("{n}", String(rows.length))
    : isYmd(request.from) && isYmd(request.to)
      ? `${request.from} ~ ${request.to}`
      : copy.exportRangeAll;
  return { rows, rangeLabel };
}

function columnsOf(meta: AdminExportMeta): AdminTableColumn[] {
  const t = getDictionary(meta.locale).recruit;
  return [
    { key: "appliedAt", label: t.colApplied, width: 13, printWidth: 9 },
    { key: "name", label: t.colName, width: 14, printWidth: 11, bold: true },
    { key: "age", label: t.colAge, width: 7, printWidth: 5 },
    { key: "jobTitle", label: t.colJob, width: 22, printWidth: 15 },
    { key: "employmentType", label: t.colEmployment, width: 12, printWidth: 8 },
    { key: "daysPerWeek", label: t.colDaysPerWeek, width: 10, printWidth: 7 },
    { key: "workDays", label: t.colWorkDays, width: 18, printWidth: 12 },
    { key: "startDate", label: t.colStart, width: 14, printWidth: 10 },
    { key: "experience", label: t.colExperience, width: 12, printWidth: 8 },
    { key: "visa", label: t.colVisa, width: 16, printWidth: 10 },
    { key: "resume", label: t.colResume, width: 10, printWidth: 6 },
    { key: "status", label: t.colStatus, width: 11, printWidth: 9 },
  ];
}

function sheetsOf(payload: RecruitExportPayload, meta: AdminExportMeta): AdminTableSheet[] {
  const t = getDictionary(meta.locale).recruit;
  return [
    {
      sheetName: t.exportTitle,
      title: t.exportTitle,
      rangeLabel: payload.rangeLabel,
      colNoLabel: meta.shared.colNo,
      totalLabel: meta.shared.exportTotalLabel,
      columns: columnsOf(meta),
      rows: payload.rows.map((row) => ({
        appliedAt: row.appliedAt,
        name: row.name,
        age: row.age,
        jobTitle: row.jobTitle,
        employmentType: row.employmentType,
        daysPerWeek: row.daysPerWeek,
        workDays: row.workDays,
        startDate: row.startDate,
        experience: row.experience,
        visa: row.visa,
        resume: row.resume,
        status: t.status[row.status],
      })),
    },
  ];
}

export async function exportRecruitWorkbook(
  request: RecruitExportRequest,
): Promise<AdminWorkbookExportResult> {
  const session = await requireRecruitSession();
  if (!session) return { ok: false, reason: "error" };
  try {
    const meta = buildAdminExportMeta(session);
    const payload = await buildExportPayload(session, request, meta);
    if (payload.rows.length === 0) return { ok: false, reason: "empty" };
    const base64 = await buildAdminTableWorkbookBase64({
      orgName: meta.orgName,
      generatedLabel: meta.generatedLabel,
      sheets: sheetsOf(payload, meta),
    });
    return {
      ok: true,
      filename: `job-applications_${tokyoToday().replace(/-/g, "")}.xlsx`,
      base64,
      rowCount: payload.rows.length,
    };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function exportRecruitReport(
  request: RecruitExportRequest,
): Promise<AdminReportExportResult> {
  const session = await requireRecruitSession();
  if (!session) return { ok: false, reason: "error" };
  try {
    const meta = buildAdminExportMeta(session);
    const payload = await buildExportPayload(session, request, meta);
    if (payload.rows.length === 0) return { ok: false, reason: "empty" };
    const html = buildAdminTableReportHtml({
      orgName: meta.orgName,
      generatedLabel: meta.generatedLabel,
      printLabel: meta.shared.exportPrint,
      localeTag: meta.localeTag,
      sheets: sheetsOf(payload, meta),
    });
    return { ok: true, html, rowCount: payload.rows.length };
  } catch {
    return { ok: false, reason: "error" };
  }
}
