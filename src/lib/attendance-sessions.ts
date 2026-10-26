// 근태 — 근무자 세션 읽기(Step 3).
//
// 실제 데이터로 근무자 근태 홈을 그리는 서버 전용 헬퍼. Step 3 에 필요한 것은
// 현재 열린 세션뿐(홈을 출근 전 / 근무 중으로 전환하기 위해)이고, 휴게, 이력, 정정,
// 급여는 이후 단계에서 다룬다.

import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isStaleOpenSession, type AttendanceSessionRow } from "@/lib/attendance";
import { tokyoDayStart, tokyoToday } from "@/lib/tokyo-date";
import { localizeAttendanceSiteName, type AttendanceSiteDisplayRow } from "@/lib/attendance-site-display";

// 문자열 리터럴이어야 타입 수준 파싱이 된다(배열 join 은 GenericStringError 로 떨어진다).
const OPEN_SESSION_SELECT = "id, operating_date, clock_in_at, clock_in_site_id" as const;

export type OpenAttendanceSession = {
  id: string;
  clockInAt: string | null;
  clockInTimeLabel: string;
  siteId: string | null;
  siteName: string;
  /** 휴게가 현재 열려 있으면 null 이 아님(사용자가 휴게 중). */
  openBreakStartedAt: string | null;
  /** 이 세션의 닫힌 휴게 시간 합계(초). */
  closedBreakSeconds: number;
  /** 이 세션의 전체 휴게 횟수(닫힌 것 + 열린 것). */
  breakCount: number;
};

/** 사용자가 오늘(도쿄) 18:30 미종료 세션 알림에 이미 답했는가? */
export async function hasOpenReminderResponseToday(
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const res = await getSupabaseServiceClient()
    .from("attendance_open_session_reminders")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("operating_date", today)
    .maybeSingle();
  return !!res.data;
}

/** 도쿄 벽시계 시각이 18:30 이상이면 true(미종료 세션 알림 기준). */
export function isPastReminderTimeTokyo(): boolean {
  const hm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m >= 18 * 60 + 30;
}

/** Asia/Tokyo 기준 HH:mm. */
function tokyoTimeLabel(iso: string | null): string {
  if (!iso) return "--:--";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/**
 * 퇴근을 찍지 않은 채 운영일이 넘어가 `abandoned` 로 밀린 세션들(2026-08-04).
 *
 * 이 세션들은 더 이상 새 출근을 막지 않지만 **월 마감은 막는다.** 본인이 먼저 알아야 정정 요청을
 * 낼 수 있으므로 근태 홈에 배너로 띄운다 — 청소의 "지난 날짜 미완료" 배너와 같은 취지다.
 * 관리자만 볼 수 있게 두면 직원은 자기 급여에서 그날이 빠진 이유를 끝까지 모른다.
 */
export async function getAbandonedSessions(
  organizationId: string,
  userId: string,
): Promise<{ id: string; operatingDate: string }[]> {
  // 지난 운영일인데 아직 `open` 인 근무도 같은 처지다(2026-10-21) — 다음 출근 · 퇴근 시도 때 `abandoned` 로
  // 넘어가지만, 그 전에도 홈은 「근무 중」이 아니라 이 배너로 보여 준다(`isStaleOpenSession`).
  const { data, error } = await getSupabaseServiceClient()
    .from("attendance_sessions")
    .select("id, operating_date")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .or(`status.eq.abandoned,and(status.eq.open,operating_date.lt.${tokyoToday()})`)
    .order("operating_date", { ascending: false })
    .limit(10);
  if (error || !data) return [];
  return (data as { id: string; operating_date: string }[]).map((r) => ({
    id: r.id,
    operatingDate: r.operating_date,
  }));
}

/**
 * 사용자의 현재 열린 근무 세션(status = 'open'), 없으면 null. 조직 범위; 부분 unique
 * 인덱스가 최대 하나를 보장한다. 홈의 정보 스트립용으로 출근 사이트 이름을 해석한다.
 * 지난 운영일의 열린 근무는 null — 퇴근을 잊은 것이지 근무 중이 아니다(`isStaleOpenSession`, 2026-10-21).
 * 홈은 출근 버튼과 퇴근 미기록 배너(`getAbandonedSessions`)를 보여 준다.
 */
export async function getCurrentOpenSession(
  organizationId: string,
  userId: string,
  /** 근무지 이름을 이 언어로(2026-10-22) — 빠지면 한국어. 사무실 · 건물 근무지가 일본어 · 영어 화면에 한국어로 남았다. */
  locale = "ko",
): Promise<OpenAttendanceSession | null> {
  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from("attendance_sessions")
    .select(OPEN_SESSION_SELECT)
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "open")
    .maybeSingle();
  if (error || !data) return null;

  const session = data as AttendanceSessionRow;
  if (isStaleOpenSession(session.operating_date, tokyoToday())) return null;

  // 쿼리 2(site name)와 쿼리 3(break rows)는 sessionId/siteId만 있으면 독립적으로 실행 가능하므로
  // Promise.all로 병렬 실행하여 직렬 대기 시간을 제거한다.
  const sitePromise = session.clock_in_site_id
    ? service
        .from("attendance_sites")
        .select("name, properties(display_name_ko, display_name_ja, display_name_en)")
        .eq("organization_id", organizationId)
        .eq("id", session.clock_in_site_id)
        .maybeSingle()
    : Promise.resolve({ data: null });

  // 휴게 집계: 개별 행은 DB 에 두고, 여기서는 홈이 필요로 하는 실시간 요약만
  // 도출한다(휴게 중인지 + 닫힌 휴게 합계 + 횟수). 열린 휴게의 시간은 클라이언트에서 실시간 계산한다.
  const breaksPromise = service
    .from("attendance_breaks")
    .select("started_at, ended_at")
    .eq("session_id", session.id)
    .order("started_at", { ascending: true });

  const [siteRes, breaksRes] = await Promise.all([sitePromise, breaksPromise]);

  const site = siteRes.data as AttendanceSiteDisplayRow | null;
  const siteName = site ? localizeAttendanceSiteName(site, locale) : "—";
  const breaks = (breaksRes.data ?? []) as { started_at: string; ended_at: string | null }[];

  let closedBreakSeconds = 0;
  let openBreakStartedAt: string | null = null;
  for (const b of breaks) {
    if (b.ended_at) {
      const secs = (new Date(b.ended_at).getTime() - new Date(b.started_at).getTime()) / 1000;
      if (secs > 0) closedBreakSeconds += secs;
    } else {
      openBreakStartedAt = b.started_at;
    }
  }

  return {
    id: session.id,
    clockInAt: session.clock_in_at,
    clockInTimeLabel: tokyoTimeLabel(session.clock_in_at),
    siteId: session.clock_in_site_id,
    siteName,
    openBreakStartedAt,
    closedBreakSeconds: Math.floor(closedBreakSeconds),
    breakCount: breaks.length,
  };
}

/**
 * 홈 인사말용 오늘 근무 상태(2026-10-15) — 오늘(도쿄) 운영일의 열린 세션이 있으면 근무 중, 오늘 출근해서
 * 닫혔으면 퇴근, 아니면 none. 실패하면 none(인사말만 덜 맞을 뿐 홈은 그대로).
 * 지난 날 퇴근 미기록 · 무효 · 방치 근무는 세지 않는다(2026-10-21) — 전엔 어제 연 근무가 「근무 중」,
 * 무효 처리된 오늘 근무가 「퇴근」으로 잡혔다.
 */
export async function getTodayWorkState(
  organizationId: string,
  userId: string,
): Promise<"working" | "done" | "none"> {
  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from("attendance_sessions")
    .select("status")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .gte("clock_in_at", tokyoDayStart(tokyoToday()))
    .in("status", ["open", "completed", "reopened"])
    .limit(5);
  if (error || !data?.length) return "none";
  return data.some((r) => r.status === "open") ? "working" : "done";
}
