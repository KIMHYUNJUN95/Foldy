// Attendance — admin REVIEW query layer + privilege guard (Step 7).
//
// Org-wide read layer for the attendance review queue + the server-side privilege gate. Only `owner`
// and explicit `attendance_payroll_admin` members (or platform admins) may review org-wide attendance
// and act on correction requests. Site-master management stays owner-only elsewhere (unchanged here).
//
// The review-queue UI is built later in the WEB DASHBOARD (user-confirmed 2026-06-17); this layer is
// caller-agnostic so that dashboard can consume it. The privilege guard MUST be checked by any caller
// before exposing org-wide data; the write actions (admin-actions) enforce it themselves.

import "server-only";
import { cache } from "react";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { SUPABASE_PAGE_SIZE } from "@/lib/supabase/read-all-pages";
import { chunk } from "@/lib/utils";
import { breakSecondsBySession, type BreakInterval, type SessionWindow } from "@/lib/attendance-pay-calculation";
import type {
  AttendanceSessionRow,
  AttendanceSessionStatus,
  AttendanceReviewState,
  AttendanceMethod,
  AttendanceCorrectionStatus,
} from "@/lib/attendance";
import {
  localizeAttendanceSiteName,
  type AttendanceSiteDisplayRow,
} from "@/lib/attendance-site-display";

const TZ = "Asia/Tokyo";

/** 세션 id 를 `.in()` 으로 싣는 조회를 이만큼씩 나눈다(URL 길이). `reservation-internal-notes.ts` 와 같은 값. */
const SESSION_ID_QUERY_CHUNK = 200;

type Service = ReturnType<typeof getSupabaseServiceClient>;

/**
 * Server-side privilege gate for org-wide attendance/payroll review. True for platform admins and for
 * active members who are the org `owner` or carry the `attendance_payroll_admin` flag.
 *
 * `cache()` — 한 화면이 배지 · 본문 · 하위 조회에서 여러 번 부른다(최대 4번). 요청 안에서는 한 번만 읽는다.
 */
export const isAttendancePayrollAdmin = cache(async function isAttendancePayrollAdmin(
  service: Service,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const [pa, m] = await Promise.all([
    service
      .from("platform_admins")
      .select("id")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle(),
    service
      .from("memberships")
      .select("role, attendance_payroll_admin, status")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (pa.data) return true;

  const row = m.data as { role: string; attendance_payroll_admin: boolean; status: string } | null;
  return (
    !!row &&
    row.status === "active" &&
    // 전무(senior_managing_director) is owner-equivalent.
    (row.role === "owner" || row.role === "senior_managing_director" || row.attendance_payroll_admin === true)
  );
});

/**
 * The user ids of org members who should receive privileged attendance admin alerts: active `owner` or
 * `attendance_payroll_admin` members. Used to TARGET notifications (never broadens visibility).
 */
export async function getAttendancePayrollAdminUserIds(
  service: Service,
  organizationId: string,
): Promise<string[]> {
  const res = await service
    .from("memberships")
    .select("user_id, role, attendance_payroll_admin, status")
    .eq("organization_id", organizationId)
    .eq("status", "active");
  const rows = (res.data ?? []) as {
    user_id: string;
    role: string;
    attendance_payroll_admin: boolean;
  }[];
  return rows
    .filter(
      (m) =>
        m.role === "owner" ||
        m.role === "senior_managing_director" ||
        m.attendance_payroll_admin === true,
    )
    .map((m) => m.user_id);
}

export type ReviewQueueFilter =
  | "all"
  | "review_required"
  | "correction_requested"
  | "incomplete"
  | "manual"
  | "not_finalized";

export type ReviewQueueParams = {
  filter?: ReviewQueueFilter;
  nameQuery?: string;
  from?: string; // YYYY-MM-DD (Tokyo operating date, inclusive)
  to?: string; // YYYY-MM-DD inclusive
  siteId?: string;
  limit?: number;
};

export type ReviewQueueItem = {
  sessionId: string;
  userId: string;
  userName: string;
  operatingDate: string;
  dateLabel: string;
  status: AttendanceSessionStatus;
  reviewState: AttendanceReviewState;
  manualCreated: boolean;
  isAbnormal: boolean;
  clockInLabel: string | null;
  /** Tokyo calendar date (YYYY-MM-DD) of the clock-in instant — may differ from `operatingDate`. */
  clockInDate: string | null;
  clockInSiteName: string | null;
  clockInMethod: AttendanceMethod | null;
  clockOutLabel: string | null;
  /** Tokyo calendar date (YYYY-MM-DD) of the clock-out instant — e.g. the next day for a
   *  midnight-crossing session. */
  clockOutDate: string | null;
  clockOutSiteName: string | null;
  clockOutMethod: AttendanceMethod | null;
  breakTotalSec: number;
  /** Paid duration for a completed session (worked minus closed breaks); null while open. */
  paidDurationSec: number | null;
  correctionStatus: AttendanceCorrectionStatus | null;
};

function tokyoDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function tokyoTimeLabel(iso: string | null, localeTag: string): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat(localeTag, {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function tokyoDateOnly(iso: string | null): string | null {
  if (!iso) return null;
  return tokyoDateKey(new Date(iso));
}

function dateLabelOf(operatingDate: string, localeTag: string): string {
  const d = new Date(`${operatingDate}T00:00:00+09:00`);
  return new Intl.DateTimeFormat(localeTag, {
    timeZone: TZ,
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(d);
}

/** Priority rank for the documented review ordering (lower = surfaces first). */
function priorityRank(item: ReviewQueueItem): number {
  if (item.reviewState === "review_required") return 0;
  if (item.correctionStatus === "requested" || item.correctionStatus === "in_review") return 1;
  if (item.status === "open" || !item.clockOutLabel) return 2;
  return 3;
}

/**
 * The org-wide attendance review queue. Caller MUST have verified `isAttendancePayrollAdmin` first.
 * Resolves worker names, site names, break totals, and correction status; applies the documented
 * filters + name/date/site; orders by review priority then most-recent operating date.
 */
export async function getAttendanceReviewQueue(
  organizationId: string,
  params: ReviewQueueParams = {},
  localeTag = "ko-KR",
): Promise<ReviewQueueItem[]> {
  const service = getSupabaseServiceClient();
  const limit = params.limit ?? 100;

  // For the correction-requested filter, pre-resolve the session ids with an open request.
  let correctionSessionIds: string[] | null = null;
  if (params.filter === "correction_requested") {
    const cr = await service
      .from("attendance_correction_requests")
      .select("session_id")
      .eq("organization_id", organizationId)
      .in("status", ["requested", "in_review"]);
    correctionSessionIds = Array.from(
      new Set(
        ((cr.data ?? []) as { session_id: string | null }[])
          .map((r) => r.session_id)
          .filter(Boolean) as string[],
      ),
    );
    if (correctionSessionIds.length === 0) return [];
  }

  // Name search → matching user ids (sessions are org-scoped, so filtering by user id is sufficient).
  let nameUserIds: string[] | null = null;
  const q = params.nameQuery?.trim();
  if (q) {
    const pr = await service.from("profiles").select("id").ilike("name", `%${q}%`).limit(200);
    nameUserIds = ((pr.data ?? []) as { id: string }[]).map((r) => r.id);
    if (nameUserIds.length === 0) return [];
  }

  // 필터가 붙은 쿼리를 **쪽마다 새로** 만든다 — 쪽 나눠 읽을 때 같은 빌더를 다시 쓰지 않는다.
  const buildQuery = () => {
    let query = service
      .from("attendance_sessions")
      .select("*")
      .eq("organization_id", organizationId);

    if (params.from) query = query.gte("operating_date", params.from);
    if (params.to) query = query.lte("operating_date", params.to);
    if (params.siteId) query = query.eq("clock_in_site_id", params.siteId);
    if (nameUserIds) query = query.in("user_id", nameUserIds);
    if (correctionSessionIds) query = query.in("id", correctionSessionIds);

    switch (params.filter) {
      case "review_required":
        // 무효 처리한 세션은 해소된 것으로 본다 — 마감 판정(`countBlockingSessions`)과 같다(2026-10-19).
        query = query.eq("review_state", "review_required").neq("status", "invalid");
        break;
      case "incomplete":
        query = query.is("clock_out_at", null).neq("status", "invalid");
        break;
      case "manual":
        query = query.eq("manual_created", true);
        break;
      case "not_finalized":
        // No finalized snapshots exist until Step 8; current-Tokyo-month sessions are the not-finalized
        // set for now (the finalized-snapshot exclusion plugs in when finalization lands).
        query = query.gte("operating_date", `${tokyoDateKey(new Date()).slice(0, 7)}-01`);
        break;
      default:
        break;
    }
    return query;
  };

  // PostgREST 는 한 번에 1,000행까지만 준다 — `limit` 이 그보다 커도(관리자 큐는 5,000) 조용히 잘렸다
  // (2026-10-01). `limit` 에 닿거나 마지막 쪽이 올 때까지 쪽 나눠 읽는다. 쪽 경계가 흔들리지 않게 `id` 로 끝맺는다.
  const sessions: AttendanceSessionRow[] = [];
  for (let offset = 0; offset < limit; offset += SUPABASE_PAGE_SIZE) {
    const size = Math.min(SUPABASE_PAGE_SIZE, limit - offset);
    const res = await buildQuery()
      .order("operating_date", { ascending: false })
      .order("clock_in_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .range(offset, offset + size - 1);
    if (res.error) return [];
    const batch = (res.data ?? []) as AttendanceSessionRow[];
    sessions.push(...batch);
    if (batch.length < size) break;
  }
  if (sessions.length === 0) return [];

  const sessionIds = sessions.map((s) => s.id);
  const userIds = Array.from(new Set(sessions.map((s) => s.user_id)));
  const siteIds = Array.from(
    new Set(
      sessions.flatMap((s) => [s.clock_in_site_id, s.clock_out_site_id].filter(Boolean) as string[]),
    ),
  );

  const [names, siteNames, breakTotals, correctionStatuses] = await Promise.all([
    loadUserNames(service, userIds),
    loadSiteNames(service, organizationId, siteIds, localeTag),
    loadBreakTotals(service, sessions),
    loadCorrectionStatuses(service, organizationId, sessionIds),
  ]);

  const items: ReviewQueueItem[] = sessions.map((s) => {
    const breakTotalSec = breakTotals.get(s.id) ?? 0;
    let paidDurationSec: number | null = null;
    if (s.status === "completed" && s.clock_in_at && s.clock_out_at) {
      const gross = (new Date(s.clock_out_at).getTime() - new Date(s.clock_in_at).getTime()) / 1000;
      paidDurationSec = Math.max(0, Math.floor(gross) - breakTotalSec);
    }
    const status = s.status as AttendanceSessionStatus;
    const reviewState = s.review_state as AttendanceReviewState;
    return {
      sessionId: s.id,
      userId: s.user_id,
      userName: names.get(s.user_id) ?? "—",
      operatingDate: s.operating_date,
      dateLabel: dateLabelOf(s.operating_date, localeTag),
      status,
      reviewState,
      manualCreated: s.manual_created,
      isAbnormal: reviewState !== "normal" || status === "invalid",
      clockInLabel: tokyoTimeLabel(s.clock_in_at, localeTag),
      clockInDate: tokyoDateOnly(s.clock_in_at),
      clockInSiteName: s.clock_in_site_id ? (siteNames.get(s.clock_in_site_id) ?? null) : null,
      clockInMethod: (s.clock_in_method as AttendanceMethod | null) ?? null,
      clockOutLabel: tokyoTimeLabel(s.clock_out_at, localeTag),
      clockOutDate: tokyoDateOnly(s.clock_out_at),
      clockOutSiteName: s.clock_out_site_id ? (siteNames.get(s.clock_out_site_id) ?? null) : null,
      clockOutMethod: (s.clock_out_method as AttendanceMethod | null) ?? null,
      breakTotalSec,
      paidDurationSec,
      correctionStatus: correctionStatuses.get(s.id) ?? null,
    };
  });

  // Documented ordering: review-required → correction-requested → incomplete → normal; then recency.
  return items.sort((a, b) => {
    const pr = priorityRank(a) - priorityRank(b);
    if (pr !== 0) return pr;
    return b.operatingDate.localeCompare(a.operatingDate);
  });
}

async function loadUserNames(service: Service, userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (userIds.length === 0) return map;
  const res = await service.from("profiles").select("id, name").in("id", userIds);
  for (const r of (res.data ?? []) as { id: string; name: string }[]) map.set(r.id, r.name);
  return map;
}

async function loadSiteNames(
  service: Service,
  organizationId: string,
  siteIds: string[],
  localeTag: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (siteIds.length === 0) return map;
  const res = await service
    .from("attendance_sites")
    .select("id, name, properties(display_name_ko, display_name_ja, display_name_en)")
    .eq("organization_id", organizationId)
    .in("id", siteIds);
  for (const r of (res.data ?? []) as (AttendanceSiteDisplayRow & { id: string })[]) {
    map.set(r.id, localizeAttendanceSiteName(r, localeTag));
  }
  return map;
}

/** 세션별 급여 차감 휴게 초 — 근무 시간 안으로 자르고, 닫힌 세션의 열린 휴게는 퇴근까지(`breakSecondsBySession`). */
async function loadBreakTotals(service: Service, sessions: readonly SessionWindow[]): Promise<Map<string, number>> {
  if (sessions.length === 0) return new Map();
  // 세션 id 를 URL 에 싣는다 — 한 달치 수백 개면 URL 이 넘친다. 나눠서 읽는다.
  const pages = await Promise.all(
    chunk(
      sessions.map((s) => s.id),
      SESSION_ID_QUERY_CHUNK,
    ).map((ids) =>
      service.from("attendance_breaks").select("session_id, started_at, ended_at").in("session_id", ids),
    ),
  );
  return breakSecondsBySession(pages.flatMap((res) => res.data ?? []) as BreakInterval[], sessions);
}

async function loadCorrectionStatuses(
  service: Service,
  organizationId: string,
  sessionIds: string[],
): Promise<Map<string, AttendanceCorrectionStatus>> {
  const map = new Map<string, AttendanceCorrectionStatus>();
  if (sessionIds.length === 0) return map;
  const pages = await Promise.all(
    chunk(sessionIds, SESSION_ID_QUERY_CHUNK).map((ids) =>
      service
        .from("attendance_correction_requests")
        .select("session_id, status, created_at")
        .eq("organization_id", organizationId)
        .in("session_id", ids),
    ),
  );
  // 쪽을 합친 뒤 최신순으로 — 세션마다 가장 최근 요청의 상태를 쓴다.
  const rows = pages
    .flatMap((res) => res.data ?? [])
    .sort((a, b) => (b as { created_at: string }).created_at.localeCompare((a as { created_at: string }).created_at));
  for (const r of rows as {
    session_id: string | null;
    status: string;
    created_at: string;
  }[]) {
    if (r.session_id && !map.has(r.session_id)) {
      map.set(r.session_id, r.status as AttendanceCorrectionStatus);
    }
  }
  return map;
}
