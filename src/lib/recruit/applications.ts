import "server-only";

import { RESUME_BUCKET } from "@/lib/recruit/ingest";
import type { JobApplicationStatus } from "@/lib/recruit/status";
import { parseVisaExpiry, visaAlertOf, visaDaysLeft, type VisaAlert } from "@/lib/recruit/visa-expiry";
import type { AppSession } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { tokyoDateOf, tokyoDayEndExclusive, tokyoDayStart, tokyoToday } from "@/lib/tokyo-date";

/**
 * 채용 콘솔이 읽는 것들.
 *
 * **권한은 여기서 끝낸다.** RLS 가 이미 owner/전무/office_admin 으로 좁히지만, 이 모듈은
 * service-role 로 읽으므로 RLS 를 우회한다 — 그래서 호출 전에 `canReadJobApplications` 로
 * 세션 역할을 직접 확인한다. UI 게이트만 믿지 않는다(CLAUDE.md §6).
 *
 * 도메인 계약: docs/product/30-recruit-workflow.md
 */

// 상태·파일 종류는 클라이언트도 쓰므로 순수 모듈에 있다. 여기서 다시 내보내 서버 쪽 호출부가
// import 경로를 바꾸지 않아도 되게 한다.
export {
  JOB_APPLICATION_STATUSES,
  nextStatusOf,
  prevStatusOf,
  resumeKindOf,
  type JobApplicationStatus,
} from "@/lib/recruit/status";

/**
 * 지원서는 민감 개인정보다 — 어드민 웹에 들어올 수 있는 전 역할에 열지 않는다.
 *
 * **역할이 아니라 권한 키로 판정한다**(2026-09-10). 요구가 「사무직이든 현장직이든 지정된 소수」라
 * 직군으로는 표현할 수 없었다. 누가 이 권한을 갖는지는 `src/config/capabilities.ts` 한 곳에만
 * 있고, 부여·회수는 `/admin/users/[id]` 권한 카드에서 한다.
 *
 * 유효 권한은 서버가 세션을 만들 때 계산해 실어 둔다(`AppSession.capabilities`).
 */
export function canReadJobApplications(session: AppSession): boolean {
  return session.capabilities.includes("job_application.read");
}

/** 심사 상태 변경 · 검토 메모. 열람과 나눈다 — 「보기만 되는 담당자」가 성립한다. */
export function canTriageJobApplications(session: AppSession): boolean {
  return session.capabilities.includes("job_application.triage");
}

/**
 * 지원서 삭제.
 *
 * **담당자라고 자동으로 갖지 않는다.** 하드 삭제이고 이력서 파일까지 지운다 — 되돌릴 수 없는
 * 개인정보 파기다. 필요하면 개인 부여로 연다.
 */
export function canDeleteJobApplications(session: AppSession): boolean {
  return session.capabilities.includes("job_application.delete");
}

export type ApplicationListRow = {
  id: string;
  name: string;
  age: string | null;
  gender: string | null;
  jobTitle: string | null;
  employmentType: string | null;
  daysPerWeek: string | null;
  workDays: string[];
  startDate: string | null;
  appliedAt: string | null;
  status: JobApplicationStatus;
  hasResume: boolean;
  isLegacyForm: boolean;
  hasIndustryExp: boolean;
  industryExpRaw: string | null;
  /** 90일 이내일 때만 값이 있다. */
  visaAlert: VisaAlert;
  visaDaysLeft: number | null;
  /** 같은 전화번호로 접수된 다른 지원서 수(0이면 재지원 아님). */
  repeatCount: number;
  /**
   * 전화번호 **뒤 4자리만**. 목록 검색이 뒷자리로 찾는 방식이라 그 4자리만 내려보낸다
   * (`recruit-panel-client.tsx` 의 마스킹과 같은 계약 — 화면에도 뒷자리만 보인다).
   *
   * 전체 번호를 목록에 싣지 않는 이유: 검색은 클라이언트에서 즉시 걸러야 해서 매칭 재료가
   * 브라우저에 있어야 하는데, 그렇다고 지원자 200명의 전화번호를 통째로 페이지에 실을 이유는
   * 없다. 뒷자리 4개면 문서에 적힌 검색 방식을 그대로 지원한다.
   */
  phoneTail: string | null;
};

export type ApplicationDetail = ApplicationListRow & {
  phone: string | null;
  kakaoId: string | null;
  address: string | null;
  commuteTime: string | null;
  uniformSize: string | null;
  nationality: string | null;
  visaType: string | null;
  visaPeriodRaw: string | null;
  visaExpiryDate: string | null;
  duration: string | null;
  industryTasks: string[];
  sourceChannel: string | null;
  motivation: string | null;
  appliedPosition: string | null;
  resumeFileName: string | null;
  resumePath: string | null;
  reviewNote: string | null;
  statusChangedAt: string | null;
  externalId: string;
};

/** 재지원 이력 한 줄. 이번 건을 제외한 과거·현재 지원서. */
export type ApplicationHistoryRow = {
  id: string;
  appliedAt: string | null;
  status: JobApplicationStatus;
  jobTitle: string | null;
  employmentType: string | null;
  daysPerWeek: string | null;
  reviewNote: string | null;
};

export type ApplicationFilter = {
  status: JobApplicationStatus | "all";
  jobTitle: string | null;
  employmentType: string | null;
  from: string | null;
  to: string | null;
  withResumeOnly: boolean;
  query: string | null;
};

export type ApplicationSummary = {
  pending: number;
  today: number;
  last7: number;
  withResume: number;
  total: number;
  visaAttention: number;
  byStatus: Record<JobApplicationStatus, number>;
};

const LIST_COLUMNS =
  "id, applicant_name, age, gender, job_title, employment_type, days_per_week, work_days, start_date, applied_at, status, resume_path, resume_source_url, source, has_industry_exp, visa_period, phone";

type ListRecord = {
  id: string;
  applicant_name: string;
  age: string | null;
  gender: string | null;
  job_title: string | null;
  employment_type: string | null;
  days_per_week: string | null;
  work_days: string[];
  start_date: string | null;
  applied_at: string | null;
  status: JobApplicationStatus;
  resume_path: string | null;
  resume_source_url: string | null;
  source: string;
  has_industry_exp: string | null;
  visa_period: string | null;
  phone: string | null;
};

/**
 * 「동종업계 경험 있음」 판정. 폼이 `예` / `아니오` 로 받지만 구 폼과 자유 입력이 섞여 있어
 * 부정 표현을 먼저 걸러낸다 — 「없음」에 「음」이 들어 있다고 참이 되면 안 된다.
 */
function readIndustryExp(raw: string | null): boolean {
  if (!raw) return false;
  const value = raw.trim();
  if (/^(아니오|아니요|없음|없습니다|no|なし|いいえ)$/i.test(value)) return false;
  return /^(예|있음|있습니다|yes|あり|はい)$/i.test(value);
}

function toListRow(record: ListRecord, today: string, repeatCounts: Map<string, number>): ApplicationListRow {
  const expiry = parseVisaExpiry(record.visa_period);
  const daysLeft = visaDaysLeft(expiry, today);
  const phoneDigits = (record.phone ?? "").replace(/\D/g, "");
  return {
    phoneTail: phoneDigits.length >= 4 ? phoneDigits.slice(-4) : null,
    id: record.id,
    name: record.applicant_name,
    age: record.age,
    gender: record.gender,
    jobTitle: record.job_title,
    employmentType: record.employment_type,
    daysPerWeek: record.days_per_week,
    workDays: record.work_days ?? [],
    startDate: record.start_date,
    appliedAt: record.applied_at,
    status: record.status,
    // 파일 복사 전이라도 원본 URL 이 있으면 「첨부 있음」이다 — 담당자에게는 같은 사실이다.
    hasResume: Boolean(record.resume_path || record.resume_source_url),
    isLegacyForm: record.source === "applicants",
    hasIndustryExp: readIndustryExp(record.has_industry_exp),
    industryExpRaw: record.has_industry_exp,
    visaAlert: visaAlertOf(daysLeft),
    visaDaysLeft: daysLeft,
    repeatCount: record.phone ? (repeatCounts.get(record.phone) ?? 1) - 1 : 0,
  };
}

/**
 * 전화번호가 같은 지원서를 세어 재지원 회차를 만든다.
 *
 * **왜 전화번호인가.** 이름은 동명이인이 흔하고(대한민국 국적 191건), 이메일은 폼이 받지 않는다.
 * 전화번호는 폼 필수 항목이고 194건 전부 채워져 있다. 완벽한 식별자는 아니므로 화면에서도
 * 「전화번호 일치로 자동 연결」이라고 근거를 밝힌다.
 */
async function loadRepeatCounts(organizationId: string): Promise<Map<string, number>> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("job_applications")
    .select("phone")
    .eq("organization_id", organizationId)
    .not("phone", "is", null);
  if (error) {
    console.error("[recruit/applications] repeat count failed:", error.message);
    return new Map();
  }
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const phone = row.phone;
    if (!phone) continue;
    counts.set(phone, (counts.get(phone) ?? 0) + 1);
  }
  return counts;
}

/** 목록 한 번에 읽는 최대 건수. 이만큼 오면 더 있을 수 있다(콘솔이 안내를 띄운다). */
export const APPLICATION_LIST_LIMIT = 500;

export async function listJobApplications(args: {
  session: AppSession;
  filter: ApplicationFilter;
}): Promise<ApplicationListRow[]> {
  if (!canReadJobApplications(args.session)) return [];
  const organizationId = args.session.organization.id;
  const supabase = getSupabaseServiceClient();

  let query = supabase
    .from("job_applications")
    .select(LIST_COLUMNS)
    .eq("organization_id", organizationId);

  if (args.filter.status !== "all") query = query.eq("status", args.filter.status);
  if (args.filter.jobTitle) query = query.eq("job_title", args.filter.jobTitle);
  if (args.filter.employmentType) query = query.eq("employment_type", args.filter.employmentType);
  // **도쿄 경계로 자른다.** `T00:00:00Z` 는 UTC 자정이라 9시간 밀린다 — 시작일 오전 0~9시(도쿄)에
  // 들어온 지원서가 빠지고, 종료일 다음 날 새벽 것이 섞인다. 같은 결함이 외부 리뷰 필터에도
  // 있었고 거기서는 실제로 건수가 틀렸다(2026-09-11).
  if (args.filter.from) query = query.gte("applied_at", tokyoDayStart(args.filter.from));
  // `to` 는 그날을 포함해야 한다 — 다음 날 0시(도쿄) 미만으로 받는다.
  if (args.filter.to) query = query.lt("applied_at", tokyoDayEndExclusive(args.filter.to));
  if (args.filter.withResumeOnly) query = query.not("resume_source_url", "is", null);
  if (args.filter.query) {
    const escaped = args.filter.query.replace(/[%,]/g, "");
    if (escaped.length > 0) {
      query = query.or(`applicant_name.ilike.%${escaped}%,phone.ilike.%${escaped}%`);
    }
  }

  const [{ data, error }, repeatCounts] = await Promise.all([
    query.order("applied_at", { ascending: false, nullsFirst: false }).limit(APPLICATION_LIST_LIMIT),
    loadRepeatCounts(organizationId),
  ]);
  if (error) {
    console.error("[recruit/applications] list failed:", error.message);
    return [];
  }

  const today = tokyoToday();
  return ((data ?? []) as unknown as ListRecord[]).map((row) => toListRow(row, today, repeatCounts));
}

/** 내보내기용 — 클라이언트가 넘긴 행 대신 id 로 DB 에서 다시 읽는다(조직 범위, 최대 500건). */
export async function listJobApplicationsByIds(args: {
  session: AppSession;
  ids: string[];
}): Promise<ApplicationListRow[]> {
  if (!canReadJobApplications(args.session)) return [];
  const ids = args.ids.filter(isUuid).slice(0, 500);
  if (ids.length === 0) return [];
  const organizationId = args.session.organization.id;
  const supabase = getSupabaseServiceClient();
  const [{ data, error }, repeatCounts] = await Promise.all([
    supabase
      .from("job_applications")
      .select(LIST_COLUMNS)
      .eq("organization_id", organizationId)
      .in("id", ids)
      .order("applied_at", { ascending: false, nullsFirst: false }),
    loadRepeatCounts(organizationId),
  ]);
  if (error) {
    console.error("[recruit/applications] list by ids failed:", error.message);
    return [];
  }
  const today = tokyoToday();
  return ((data ?? []) as unknown as ListRecord[]).map((row) => toListRow(row, today, repeatCounts));
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function summarizeJobApplications(session: AppSession): Promise<ApplicationSummary> {
  const empty: ApplicationSummary = {
    pending: 0,
    today: 0,
    last7: 0,
    withResume: 0,
    total: 0,
    visaAttention: 0,
    byStatus: { pending: 0, screening: 0, interview: 0 },
  };
  if (!canReadJobApplications(session)) return empty;

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("job_applications")
    .select("status, applied_at, resume_source_url, visa_period")
    .eq("organization_id", session.organization.id);
  if (error) {
    console.error("[recruit/applications] summary failed:", error.message);
    return empty;
  }

  const today = tokyoToday();
  const weekAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  const summary = { ...empty, byStatus: { pending: 0, screening: 0, interview: 0 } };

  for (const row of data ?? []) {
    summary.total += 1;
    summary.byStatus[row.status] += 1;
    if (row.status === "pending") summary.pending += 1;
    if (row.resume_source_url) summary.withResume += 1;
    // 도쿄 달력 날짜로 센다 — UTC 로 자르면 오전 0~9시(도쿄) 지원이 전날로 센다.
    const day = tokyoDateOf(row.applied_at);
    if (day === today) summary.today += 1;
    if (day && day >= weekAgo) summary.last7 += 1;
    // 「확인 필요」는 90일 이내 만료만 센다. 읽지 못한 값과 영주는 빠진다.
    if (visaAlertOf(visaDaysLeft(parseVisaExpiry(row.visa_period), today))) summary.visaAttention += 1;
  }
  return summary;
}

/** 필터 드롭다운의 선택지 — 실제로 존재하는 값만 (공고 대부분이 비어 있다). */
export async function listApplicationFacets(session: AppSession): Promise<{
  jobTitles: string[];
  employmentTypes: string[];
}> {
  if (!canReadJobApplications(session)) return { jobTitles: [], employmentTypes: [] };
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("job_applications")
    .select("job_title, employment_type")
    .eq("organization_id", session.organization.id);
  if (error) return { jobTitles: [], employmentTypes: [] };

  const jobTitles = new Set<string>();
  const employmentTypes = new Set<string>();
  for (const row of data ?? []) {
    if (row.job_title) jobTitles.add(row.job_title);
    if (row.employment_type) employmentTypes.add(row.employment_type);
  }
  return {
    jobTitles: Array.from(jobTitles).sort(),
    employmentTypes: Array.from(employmentTypes).sort(),
  };
}

export async function getJobApplication(args: {
  session: AppSession;
  id: string;
}): Promise<ApplicationDetail | null> {
  if (!canReadJobApplications(args.session)) return null;
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("job_applications")
    .select("*")
    .eq("organization_id", args.session.organization.id)
    .eq("id", args.id)
    .maybeSingle();
  if (error || !data) return null;

  const today = tokyoToday();
  const repeatCounts = data.phone ? await loadRepeatCounts(args.session.organization.id) : new Map();
  const base = toListRow(data as unknown as ListRecord, today, repeatCounts);
  const expiry = parseVisaExpiry(data.visa_period);

  return {
    ...base,
    phone: data.phone,
    kakaoId: data.kakao_id,
    address: data.address,
    commuteTime: data.commute_time,
    uniformSize: data.uniform_size,
    nationality: data.nationality,
    visaType: data.visa_type,
    visaPeriodRaw: data.visa_period,
    visaExpiryDate: expiry.kind === "date" ? expiry.date : null,
    duration: data.duration,
    industryTasks: data.industry_tasks ?? [],
    sourceChannel: data.source_channel,
    motivation: data.motivation,
    appliedPosition: data.applied_position,
    resumeFileName: data.resume_file_name,
    resumePath: data.resume_path,
    reviewNote: data.review_note,
    statusChangedAt: data.status_changed_at,
    externalId: data.external_id,
  };
}

/** 같은 전화번호의 다른 지원서 — 최신순. 이번 건은 제외한다. */
export async function listApplicationHistory(args: {
  session: AppSession;
  id: string;
  phone: string | null;
}): Promise<ApplicationHistoryRow[]> {
  if (!args.phone || !canReadJobApplications(args.session)) return [];
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("job_applications")
    .select("id, applied_at, status, job_title, employment_type, days_per_week, review_note")
    .eq("organization_id", args.session.organization.id)
    .eq("phone", args.phone)
    .neq("id", args.id)
    .order("applied_at", { ascending: false, nullsFirst: false });
  if (error) return [];
  return (data ?? []).map((row) => ({
    id: row.id,
    appliedAt: row.applied_at,
    status: row.status,
    jobTitle: row.job_title,
    employmentType: row.employment_type,
    daysPerWeek: row.days_per_week,
    reviewNote: row.review_note,
  }));
}

/**
 * 이력서 열람용 서명 URL.
 *
 * 버킷이 비공개라 매번 서명해서 준다. 유효기간은 10분 — 패널을 열어 보는 동안이면 충분하고,
 * 실수로 복사해 공유해도 오래 살아 있지 않다.
 */
export async function signResumeUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.storage.from(RESUME_BUCKET).createSignedUrl(path, 600);
  if (error || !data) {
    console.warn("[recruit/applications] sign failed:", error?.message);
    return null;
  }
  return data.signedUrl;
}

