// 근태 — 근로자 본인 보기 이력 쿼리 (Step 5).
//
// 서버 전용, 엄격히 본인 범위: 모든 쿼리가 현재 사용자 id (호출자가 인증된 세션에서
// 넘김)와 조직 id 로 거른다. 다른 사용자의 데이터로 가는 경로는
// 없다 — 호출자는 클라이언트에서 대상 사용자 id 를 절대 받지 않는다. 전반에 도쿄 운영 날짜 경계를
// 쓴다. 급여 계산, 관리자/조직 전체 읽기, 정정/마감은 여기에 없다 (이후
// 단계). 모양은 그런 것들(예: reviewState / manualCreated / 향후
// correctionStatus)을 위한 여지를 남겨 다시 쓰지 않고도 붙일 수 있다.

import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  localizeAttendanceSiteName,
  type AttendanceSiteDisplayRow,
} from "@/lib/attendance-site-display";
import type {
  AttendanceSessionRow,
  AttendanceSessionStatus,
  AttendanceReviewState,
  AttendanceMethod,
  AttendanceCorrectionStatus,
} from "@/lib/attendance";
import { getCorrectionStatusBySession } from "@/lib/attendance-corrections";

export type AttendanceBreakView = {
  startedAt: string;
  endedAt: string | null;
  /** 닫힌 휴게 시간(초); 휴게가 아직 열려 있으면 null. */
  durationSec: number | null;
  startedLabel: string;
  endedLabel: string | null;
};

export type AttendanceSessionView = {
  id: string;
  operatingDate: string; // YYYY-MM-DD (도쿄)
  dateLabel: string; // e.g. "6월 17일 (화)"
  status: AttendanceSessionStatus;
  reviewState: AttendanceReviewState;
  manualCreated: boolean;
  isAbnormal: boolean;
  clockInAt: string | null;
  clockInLabel: string | null;
  clockInSiteName: string | null;
  clockInMethod: AttendanceMethod | null;
  clockOutAt: string | null;
  clockOutLabel: string | null;
  clockOutSiteName: string | null;
  clockOutMethod: AttendanceMethod | null;
  breaks: AttendanceBreakView[];
  breakCount: number;
  breakTotalSec: number; // 닫힌 휴게만
  /** 완료된 세션의 근무 초(출근→퇴근에서 닫힌 휴게 제외); 열려 있으면 null. */
  workedSec: number | null;
  /** 이 세션의 최근 정정 요청 상태, 있으면 (Step 6). */
  correctionStatus: AttendanceCorrectionStatus | null;
  /** 이 세션의 최근 정정 요청 id — 해당 요청으로 바로 연결하는 데 쓴다. */
  correctionRequestId: string | null;
};

export type AttendanceTodaySummary = {
  date: string; // YYYY-MM-DD (도쿄)
  sessionCount: number;
  hasOpenSession: boolean;
  workedSec: number; // 오늘 완료된 세션 + 열린 세션의 로드 시점 경과-휴게
  breakTotalSec: number; // 오늘 세션들의 닫힌 휴게
};

const TZ = "Asia/Tokyo";
// 문자열 리터럴이어야 타입 수준 파싱이 된다(배열 join 은 GenericStringError 로 떨어진다).
const HISTORY_SESSION_SELECT = "id, operating_date, status, review_state, manual_created, clock_in_at, clock_in_site_id, clock_in_method, clock_out_at, clock_out_site_id, clock_out_method" as const;

function tokyoDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function tokyoTimeLabel(iso: string | null, locale = "ko-KR"): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat(locale, {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** "6월 17일 (화)" / "6月17日(火)" / "Jun 17 (Tue)" from a Tokyo YYYY-MM-DD operating date. */
function dateLabelOf(operatingDate: string, locale = "ko-KR"): string {
  const d = new Date(`${operatingDate}T00:00:00+09:00`);
  return new Intl.DateTimeFormat(locale, {
    timeZone: TZ,
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(d);
}

function closedBreakSeconds(startedAt: string, endedAt: string | null): number | null {
  if (!endedAt) return null;
  const secs = (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000;
  return secs > 0 ? Math.floor(secs) : 0;
}

type BreakRow = { session_id: string; started_at: string; ended_at: string | null };

function buildSessionView(
  s: AttendanceSessionRow,
  breakRows: BreakRow[],
  siteNames: Map<string, string>,
  locale = "ko-KR",
): AttendanceSessionView {
  const breaks: AttendanceBreakView[] = breakRows
    .slice()
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
    .map((b) => ({
      startedAt: b.started_at,
      endedAt: b.ended_at,
      durationSec: closedBreakSeconds(b.started_at, b.ended_at),
      startedLabel: tokyoTimeLabel(b.started_at, locale) ?? "--:--",
      endedLabel: tokyoTimeLabel(b.ended_at, locale),
    }));

  const breakTotalSec = breaks.reduce((sum, b) => sum + (b.durationSec ?? 0), 0);

  let workedSec: number | null = null;
  if (s.status === "completed" && s.clock_in_at && s.clock_out_at) {
    const gross = (new Date(s.clock_out_at).getTime() - new Date(s.clock_in_at).getTime()) / 1000;
    workedSec = Math.max(0, Math.floor(gross) - breakTotalSec);
  }

  const status = s.status as AttendanceSessionStatus;
  const reviewState = s.review_state as AttendanceReviewState;

  return {
    id: s.id,
    operatingDate: s.operating_date,
    dateLabel: dateLabelOf(s.operating_date, locale),
    status,
    reviewState,
    manualCreated: s.manual_created,
    isAbnormal: reviewState !== "normal" || status === "invalid",
    clockInAt: s.clock_in_at,
    clockInLabel: tokyoTimeLabel(s.clock_in_at, locale),
    clockInSiteName: s.clock_in_site_id ? (siteNames.get(s.clock_in_site_id) ?? null) : null,
    clockInMethod: (s.clock_in_method as AttendanceMethod | null) ?? null,
    clockOutAt: s.clock_out_at,
    clockOutLabel: tokyoTimeLabel(s.clock_out_at, locale),
    clockOutSiteName: s.clock_out_site_id ? (siteNames.get(s.clock_out_site_id) ?? null) : null,
    clockOutMethod: (s.clock_out_method as AttendanceMethod | null) ?? null,
    breaks,
    breakCount: breaks.length,
    breakTotalSec,
    workedSec,
    correctionStatus: null,
    correctionRequestId: null,
  };
}

/** 현장 id 묶음의 표시 이름을 구한다 (쿼리 한 번). */
async function loadSiteNames(
  service: ReturnType<typeof getSupabaseServiceClient>,
  organizationId: string,
  siteIds: string[],
  locale: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (siteIds.length === 0) return map;
  const res = await service
    .from("attendance_sites")
    .select("id, name, properties(display_name_ko, display_name_ja, display_name_en)")
    .eq("organization_id", organizationId)
    .in("id", siteIds);
  for (const row of (res.data ?? []) as (AttendanceSiteDisplayRow & { id: string })[]) {
    map.set(row.id, localizeAttendanceSiteName(row, locale));
  }
  return map;
}

/** 세션 id 묶음의 휴게 행을 불러와 세션별로 묶는다 (쿼리 한 번). */
async function loadBreaks(
  service: ReturnType<typeof getSupabaseServiceClient>,
  sessionIds: string[],
): Promise<Map<string, BreakRow[]>> {
  const map = new Map<string, BreakRow[]>();
  if (sessionIds.length === 0) return map;
  const res = await service
    .from("attendance_breaks")
    .select("session_id, started_at, ended_at")
    .in("session_id", sessionIds)
    .order("started_at", { ascending: true });
  for (const row of (res.data ?? []) as BreakRow[]) {
    const list = map.get(row.session_id) ?? [];
    list.push(row);
    map.set(row.session_id, list);
  }
  return map;
}

/** YYYY-MM 의 [첫날, 다음 달 첫날), 도쿄 운영 날짜 문자열. */
function monthRange(ym: string): { start: string; nextStart: string } {
  const [y, m] = ym.split("-").map(Number);
  const nextIdx = y * 12 + m; // m 은 1부터 시작 → 이미 다음 달을 가리킨다
  const ny = Math.floor(nextIdx / 12);
  const nm = (nextIdx % 12) + 1;
  return {
    start: `${ym}-01`,
    nextStart: `${ny}-${String(nm).padStart(2, "0")}-01`,
  };
}

/**
 * 현재 사용자 본인의 근태 세션(최신순), 각각 휴게 행을 해석해 붙인다.
 * 본인 범위: `userId` 는 인증된 사용자이며 클라이언트가 넘긴 대상이 아니다.
 * `ym` (YYYY-MM, 도쿄)이 주어지면 결과를 그 운영 월로 제한한다.
 */
export async function getAttendanceHistory(
  organizationId: string,
  userId: string,
  ym?: string,
  limit = 60,
  locale = "ko-KR",
): Promise<AttendanceSessionView[]> {
  const service = getSupabaseServiceClient();
  let query = service
    .from("attendance_sessions")
    .select(HISTORY_SESSION_SELECT)
    .eq("organization_id", organizationId)
    .eq("user_id", userId);
  if (ym && /^\d{4}-\d{2}$/.test(ym)) {
    const { start, nextStart } = monthRange(ym);
    query = query.gte("operating_date", start).lt("operating_date", nextStart);
  }
  const res = await query
    .order("operating_date", { ascending: false })
    .order("clock_in_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (res.error) return [];

  const sessions = (res.data ?? []) as AttendanceSessionRow[];
  if (sessions.length === 0) return [];

  const sessionIds = sessions.map((s) => s.id);
  const siteIds = Array.from(
    new Set(
      sessions.flatMap((s) => [s.clock_in_site_id, s.clock_out_site_id].filter(Boolean) as string[]),
    ),
  );

  const [breaksBySession, siteNames, correctionBySession] = await Promise.all([
    loadBreaks(service, sessionIds),
    loadSiteNames(service, organizationId, siteIds, locale),
    getCorrectionStatusBySession(organizationId, userId, sessionIds),
  ]);

  return sessions.map((s) => {
    const view = buildSessionView(s, breaksBySession.get(s.id) ?? [], siteNames, locale);
    const correction = correctionBySession.get(s.id) ?? null;
    view.correctionStatus = correction?.status ?? null;
    view.correctionRequestId = correction?.id ?? null;
    return view;
  });
}

/**
 * 오늘(도쿄) 본인 요약: 세션 수, 열린 세션 여부, 근무 + 휴게 합계.
 * 본인 범위. 열린 세션의 근무는 로드 시점에 계산한다 (홈에는 실시간 틱이 있다).
 */
export async function getAttendanceTodaySummary(
  organizationId: string,
  userId: string,
): Promise<AttendanceTodaySummary> {
  const service = getSupabaseServiceClient();
  const today = tokyoDateKey(new Date());

  const res = await service
    .from("attendance_sessions")
    .select(HISTORY_SESSION_SELECT)
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("operating_date", today);

  const sessions = res.error ? [] : ((res.data ?? []) as AttendanceSessionRow[]);
  const sessionIds = sessions.map((s) => s.id);
  const breaksBySession = await loadBreaks(service, sessionIds);

  let workedSec = 0;
  let breakTotalSec = 0;
  let hasOpenSession = false;
  const nowMs = Date.now();

  for (const s of sessions) {
    const view = buildSessionView(s, breaksBySession.get(s.id) ?? [], new Map());
    breakTotalSec += view.breakTotalSec;
    if (s.status === "completed" && view.workedSec != null) {
      workedSec += view.workedSec;
    } else if (s.status === "open" && s.clock_in_at) {
      hasOpenSession = true;
      const gross = (nowMs - new Date(s.clock_in_at).getTime()) / 1000;
      workedSec += Math.max(0, Math.floor(gross) - view.breakTotalSec);
    }
  }

  return {
    date: today,
    sessionCount: sessions.length,
    hasOpenSession,
    workedSec,
    breakTotalSec,
  };
}
