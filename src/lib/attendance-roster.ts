// Server-only helper — 출근자 명단 데이터 조회.
// 매니저/오피스 권한 사용자의 일일 출근자 현황을 반환한다.

import "server-only";
import { getDictionary, isLocale, type Locale } from "@/lib/i18n";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { displayRoleKey, fetchPlatformDeveloperIds } from "@/lib/platform-developers";
import type { AttendanceReviewState, AttendanceSessionRow } from "@/lib/attendance";
import { localizeAttendanceSiteName, type AttendanceSiteDisplayRow } from "@/lib/attendance-site-display";

// 문자열 리터럴이어야 타입 수준 파싱이 된다(배열 join 은 GenericStringError 로 떨어진다).
const ROSTER_SESSION_SELECT = "id, user_id, clock_in_at, clock_out_at, clock_in_site_id, clock_out_site_id, review_state, invalidated_at" as const;

/**
 * Roster DISPLAY keys. These are NOT the DB enum — `needs_review` is the roster's own label for a
 * session whose `attendance_sessions.review_state` is the enum value `review_required`
 * (see `AttendanceReviewState` in `@/lib/attendance`). Keep the two apart: comparing a raw
 * `review_state` against the display key silently produces a status that can never occur.
 */
export type RosterStatusKey = "working" | "on_break" | "done" | "needs_review" | "void";

/** The DB `review_state` value that maps to the roster's `needs_review` display key. */
const ROSTER_REVIEW_STATE: AttendanceReviewState = "review_required";

export type RosterEntry = {
  sessionId: string;
  userId: string;
  name: string;
  avatarInitial: string;
  role: string;        // display role label
  roleCode: string;    // raw role enum value from DB
  phoneNumber: string | null;
  siteName: string;         // 출근 사이트명
  clockOutSiteName: string; // 퇴근 사이트명
  clockInTimeLabel: string;    // HH:mm Asia/Tokyo
  clockOutTimeLabel: string | null;
  breakCount: number;
  closedBreakSeconds: number;
  hasOpenBreak: boolean;
  openBreakStartedAt: string | null;
  statusKey: RosterStatusKey;
  isVoid: boolean;
};

export type RosterDay = {
  operatingDate: string;  // "YYYY-MM-DD"
  entries: RosterEntry[];
  counts: {
    total: number;
    working: number;
    on_break: number;
    done: number;
    needs_review: number;
    void: number;
  };
};

function tokyoHHmm(iso: string | null, locale = "ko-KR"): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function resolveRosterLocale(locale: string): Locale {
  if (isLocale(locale)) return locale;
  const normalized = locale.toLowerCase();
  if (normalized.startsWith("ja")) return "ja";
  if (normalized.startsWith("en")) return "en";
  return "ko";
}

function roleDisplayLabel(roleCode: string, locale: string): string {
  const roles = getDictionary(resolveRosterLocale(locale)).roles as Record<string, string>;
  return roles[roleCode] ?? roleCode;
}

function deriveStatus(
  invalidatedAt: string | null,
  reviewState: string | null,
  clockOutAt: string | null,
  hasOpenBreak: boolean,
): RosterStatusKey {
  if (invalidatedAt) return "void";
  if (reviewState === ROSTER_REVIEW_STATE) return "needs_review";
  if (clockOutAt) return "done";
  if (hasOpenBreak) return "on_break";
  return "working";
}

export async function getAttendanceRoster(
  organizationId: string,
  operatingDate: string,
  locale = "ko-KR",
): Promise<RosterDay> {
  const supabase = getSupabaseServiceClient();

  const { data: rawSessions, error: sessErr } = await supabase
    .from("attendance_sessions")
    .select(ROSTER_SESSION_SELECT)
    .eq("organization_id", organizationId)
    .eq("operating_date", operatingDate)
    .order("clock_in_at", { ascending: true });

  if (sessErr) throw sessErr;
  const sessions = (rawSessions ?? []) as AttendanceSessionRow[];
  if (sessions.length === 0) {
    return {
      operatingDate,
      entries: [],
      counts: { total: 0, working: 0, on_break: 0, done: 0, needs_review: 0, void: 0 },
    };
  }

  const userIds = [...new Set(sessions.map((s) => s.user_id).filter(Boolean))] as string[];
  const sessionIds = sessions.map((s) => s.id);
  const siteIds = [
    ...new Set([
      ...sessions.map((s) => s.clock_in_site_id),
      ...sessions.map((s) => s.clock_out_site_id),
    ].filter(Boolean)),
  ] as string[];

  // 2. 프로필, 멤버십, 사이트 이름, 브레이크 병렬 조회
  type ProfileSnap = { id: string; name: string | null; phone_number: string | null };
  type MembershipSnap = { user_id: string; role: string };
  type SiteSnap = AttendanceSiteDisplayRow & { id: string };
  type BreakSnap = { session_id: string; started_at: string; ended_at: string | null };

  const [profilesRes, membershipsRes, sitesRes, breaksRes] = await Promise.all([
    supabase.from("profiles").select("id, name, phone_number").in("id", userIds),
    supabase.from("memberships").select("user_id, role").in("user_id", userIds).eq("organization_id", organizationId).eq("status", "active"),
    siteIds.length > 0
      ? supabase.from("attendance_sites").select("id, name, properties(display_name_ko, display_name_ja, display_name_en)").in("id", siteIds)
      : Promise.resolve({ data: [] as SiteSnap[], error: null }),
    supabase.from("attendance_breaks").select("session_id, started_at, ended_at").in("session_id", sessionIds),
  ]);

  const profiles = (profilesRes.data ?? []) as unknown as ProfileSnap[];
  const memberships = (membershipsRes.data ?? []) as unknown as MembershipSnap[];
  const sites = (sitesRes.data ?? []) as unknown as SiteSnap[];

  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  const membershipMap = new Map(memberships.map((m) => [m.user_id, m.role]));
  // 근무지 이름은 보는 사람 언어로(2026-10-22) — 전엔 저장된 이름(사무실 · 아라키초A)을 그대로 보였다.
  const siteMap = new Map(sites.map((s) => [s.id, localizeAttendanceSiteName(s, locale)]));

  // session별 break 그룹핑
  const breaksData = (breaksRes.data ?? []) as unknown as BreakSnap[];
  const breaksBySession = new Map<string, { started_at: string; ended_at: string | null }[]>();
  for (const b of breaksData) {
    const arr = breaksBySession.get(b.session_id) ?? [];
    arr.push({ started_at: b.started_at, ended_at: b.ended_at });
    breaksBySession.set(b.session_id, arr);
  }

  // 3. 엔트리 조합
  const devIds = await fetchPlatformDeveloperIds(sessions.map((s) => s.user_id));
  const allEntries: RosterEntry[] = sessions.map((session) => {
    const profile = profileMap.get(session.user_id);
    const roleCode = membershipMap.get(session.user_id) ?? "";
    const breaks = breaksBySession.get(session.id) ?? [];
    const openBreak = breaks.find((b) => !b.ended_at) ?? null;
    const closedBreaks = breaks.filter((b) => b.ended_at);
    const closedBreakSeconds = closedBreaks.reduce((acc, b) => {
      if (!b.ended_at) return acc;
      return acc + Math.max(0, Math.floor(
        (new Date(b.ended_at).getTime() - new Date(b.started_at).getTime()) / 1000,
      ));
    }, 0);
    const hasOpenBreak = !!openBreak;
    const statusKey = deriveStatus(
      session.invalidated_at,
      session.review_state,
      session.clock_out_at,
      hasOpenBreak,
    );
    const rawName = profile?.name?.trim() ?? "";

    return {
      sessionId: session.id,
      userId: session.user_id,
      name: rawName || "?",
      avatarInitial: rawName ? rawName.slice(0, 1) : "?",
      role: roleDisplayLabel(displayRoleKey(roleCode, session.user_id, devIds), locale),
      roleCode,
      phoneNumber: profile?.phone_number ?? null,
      siteName: siteMap.get(session.clock_in_site_id ?? "") ?? "",
      clockOutSiteName: siteMap.get(session.clock_out_site_id ?? "") ?? "",
      clockInTimeLabel: tokyoHHmm(session.clock_in_at, locale) ?? "--:--",
      clockOutTimeLabel: tokyoHHmm(session.clock_out_at, locale),
      breakCount: breaks.length,
      closedBreakSeconds,
      hasOpenBreak,
      openBreakStartedAt: openBreak?.started_at ?? null,
      statusKey,
      isVoid: !!session.invalidated_at,
    };
  });

  // 4. 사용자별 중복 제거 — 같은 날 여러 세션이 있으면 1명으로 표시.
  //    우선순위: working/on_break(현재 출근 중) > 가장 최근 세션 (sessions는 clock_in_at 오름차순).
  const activeStatuses: RosterStatusKey[] = ["working", "on_break"];
  const deduped = new Map<string, RosterEntry>();
  for (const e of allEntries) {
    const existing = deduped.get(e.userId);
    if (!existing) {
      deduped.set(e.userId, e);
      continue;
    }
    const curActive = activeStatuses.includes(e.statusKey);
    const prevActive = activeStatuses.includes(existing.statusKey);
    if (curActive && !prevActive) {
      deduped.set(e.userId, e); // 활성 세션 우선
    } else if (!prevActive && !curActive) {
      deduped.set(e.userId, e); // 둘 다 완료면 최신 세션 유지
    }
  }
  const entries = [...deduped.values()];

  // 5. counts 집계
  const counts = {
    total: entries.length,
    working: 0,
    on_break: 0,
    done: 0,
    needs_review: 0,
    void: 0,
  };
  for (const e of entries) {
    counts[e.statusKey] += 1;
  }

  return { operatingDate, entries, counts };
}
