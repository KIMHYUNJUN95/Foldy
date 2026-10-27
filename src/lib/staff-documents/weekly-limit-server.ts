import "server-only";

import type { AppSession } from "@/lib/session";
import type { BreakInterval } from "@/lib/attendance-pay-calculation";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { tokyoToday, ymdShift } from "@/lib/tokyo-date";
import {
  computeWeeklyLimit,
  weeklyLimitChipOf,
  WEEKLY_WINDOW_DAYS,
  type WeeklyLimitChip,
  type WeeklyLimitResult,
  type WeeklyLimitSession,
} from "@/lib/staff-documents/weekly-limit";

/**
 * 「주 28시간」 판정 읽기(docs/product/41 §R4). 판정 규칙은 `weekly-limit.ts`(순수)에 있다.
 *
 * 대상: 이 조직의 **지금 재류카드**(`is_current`)가 `extra_activity = 'weekly_28h'` 이고 확인 대기 · 확인됨인 사람.
 * 다시 찍기 요청(`returned`) 상태 카드는 값이 틀렸을 수 있어 보지 않는다. 일본 국적 · 취업 제한 없는 사람은 대상이 아니다.
 *
 * 권한: 칩은 체류 자격을 드러내므로 `staff_documents.view`(서류 보기) 또는 `attendance.manage`(근태 관리 — 시프트를 짜며 막아야 하는 사람,
 * 2026-10-27 사용자 결정)가 있는 사람에게만 보인다(`canSeeWeeklyLimit`). 근태 관리만 있는 사람은 칩만 — 재류카드 내용은 여전히 서류 보기 권한.
 * 본인 화면은 자기 것만 읽는다(권한 불필요). 읽기는 service client + `organization_id` 로 조직을 가른다.
 */

export function canSeeWeeklyLimit(session: AppSession): boolean {
  return (
    session.organization.id !== "platform" &&
    (session.capabilities.includes("staff_documents.view") || session.capabilities.includes("attendance.manage"))
  );
}

const SESSION_SELECT = "id, user_id, operating_date, status, clock_in_at, clock_out_at, invalidated_at" as const;
const IN_CHUNK = 200;

/**
 * 끝날이 `from` ~ `to`(도쿄, 포함)인 7일 창으로 사람마다 판정한다. `to` 는 오늘보다 늦으면 오늘로 줄인다.
 * `userIds` 를 주면 그 사람들만 본다.
 */
export async function loadWeeklyLimitResults(
  organizationId: string,
  range: { from: string; to: string },
  userIds?: readonly string[],
): Promise<Map<string, WeeklyLimitResult>> {
  const results = new Map<string, WeeklyLimitResult>();
  if (organizationId === "platform") return results;
  const today = tokyoToday();
  if (range.from > today) return results; // 아직 오지 않은 달 · 날
  const to = range.to > today ? today : range.to;
  const from = range.from > to ? to : range.from;

  const service = getSupabaseServiceClient();
  let docQuery = service
    .from("staff_id_documents")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("is_current", true)
    .eq("kind", "residence_card")
    .eq("extra_activity", "weekly_28h")
    .in("status", ["pending", "confirmed"]);
  if (userIds) {
    if (userIds.length === 0) return results;
    docQuery = docQuery.in("user_id", [...userIds].slice(0, 1000));
  }
  const { data: docs, error: docError } = await docQuery.limit(5000);
  if (docError) {
    console.error("[weekly-limit] documents", docError.message);
    return results;
  }
  const targets = [...new Set(((docs ?? []) as { user_id: string }[]).map((d) => d.user_id))];
  if (targets.length === 0) return results;

  // 창의 첫날(from - 6) 보다 하루 앞 운영일까지 — 자정을 넘는 근무가 다음 날로 넘어올 수 있다.
  const sessionFrom = ymdShift(from, -WEEKLY_WINDOW_DAYS);
  const sessions: (WeeklyLimitSession & { user_id: string })[] = [];
  for (let i = 0; i < targets.length; i += IN_CHUNK) {
    // PostgREST 는 한 번에 1,000행까지만 준다(`.limit` 이 더 커도 조용히 잘린다) — 200명 × 38일이면 넘으므로 쪽으로 끝까지 읽는다.
    const chunk = targets.slice(i, i + IN_CHUNK);
    const { data, error } = await readAllPages<WeeklyLimitSession & { user_id: string }>((rangeFrom, rangeTo) =>
      service
        .from("attendance_sessions")
        .select(SESSION_SELECT)
        .eq("organization_id", organizationId)
        .in("user_id", chunk)
        .gte("operating_date", sessionFrom)
        .lte("operating_date", to)
        .order("id", { ascending: true })
        .range(rangeFrom, rangeTo) as unknown as PromiseLike<{
        data: (WeeklyLimitSession & { user_id: string })[] | null;
        error: { message: string } | null;
      }>,
    );
    if (error) {
      console.error("[weekly-limit] sessions", error.message);
      return results;
    }
    sessions.push(...data);
  }

  const breaks: BreakInterval[] = [];
  const sessionIds = sessions.map((s) => s.id);
  for (let i = 0; i < sessionIds.length; i += IN_CHUNK) {
    const chunk = sessionIds.slice(i, i + IN_CHUNK);
    const { data, error } = await readAllPages<BreakInterval & { id: string }>((rangeFrom, rangeTo) =>
      service
        .from("attendance_breaks")
        .select("id, session_id, started_at, ended_at")
        .eq("organization_id", organizationId)
        .in("session_id", chunk)
        .order("id", { ascending: true })
        .range(rangeFrom, rangeTo) as unknown as PromiseLike<{
        data: (BreakInterval & { id: string })[] | null;
        error: { message: string } | null;
      }>,
    );
    if (error) {
      console.error("[weekly-limit] breaks", error.message);
      return results;
    }
    breaks.push(...data);
  }

  const sessionsByUser = new Map<string, WeeklyLimitSession[]>();
  const userBySession = new Map<string, string>();
  for (const s of sessions) {
    userBySession.set(s.id, s.user_id);
    const list = sessionsByUser.get(s.user_id);
    if (list) list.push(s);
    else sessionsByUser.set(s.user_id, [s]);
  }
  const breaksByUser = new Map<string, BreakInterval[]>();
  for (const b of breaks) {
    const userId = userBySession.get(b.session_id);
    if (!userId) continue;
    const list = breaksByUser.get(userId);
    if (list) list.push(b);
    else breaksByUser.set(userId, [b]);
  }

  const nowMs = Date.now();
  for (const userId of targets) {
    results.set(
      userId,
      computeWeeklyLimit(sessionsByUser.get(userId) ?? [], breaksByUser.get(userId) ?? [], { from, to, today, nowMs }),
    );
  }
  return results;
}

/** 관리자 화면용 — 근접 · 초과인 사람만 칩으로. 권한이 없으면 빈 객체(읽지도 않는다). 실패해도 화면은 그린다. */
export async function loadWeeklyLimitChips(
  session: AppSession,
  range: { from: string; to: string },
  userIds?: readonly string[],
): Promise<Record<string, WeeklyLimitChip>> {
  if (!canSeeWeeklyLimit(session)) return {};
  try {
    const results = await loadWeeklyLimitResults(session.organization.id, range, userIds);
    const chips: Record<string, WeeklyLimitChip> = {};
    for (const [userId, result] of results) {
      const chip = weeklyLimitChipOf(result);
      if (chip) chips[userId] = chip;
    }
    return chips;
  } catch (error) {
    console.error("[weekly-limit] chips", error);
    return {};
  }
}

/** 본인 화면용 — 최근 7일(오늘에서 끝나는 창). 대상이 아니거나 괜찮으면 null. */
export async function loadOwnWeeklyLimit(
  organizationId: string,
  userId: string,
): Promise<{ status: "over" | "near"; minutes: number } | null> {
  try {
    const today = tokyoToday();
    const result = (await loadWeeklyLimitResults(organizationId, { from: today, to: today }, [userId])).get(userId);
    if (!result || result.status === "ok") return null;
    return { status: result.status, minutes: result.current.minutes };
  } catch (error) {
    console.error("[weekly-limit] own", error);
    return null;
  }
}

/** 월 화면(급여 · 직원 상세)의 범위 — 그달 1일 ~ 말일(오늘까지). */
export function monthWeeklyRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(lastDay).padStart(2, "0")}` };
}

/** 하루 화면(명단)의 범위 — 그날에서 끝나는 창과 그 앞 6일에 끝나는 창(최근 일주일 안에 넘은 적이 있으면 보인다). */
export function dayWeeklyRange(date: string): { from: string; to: string } {
  return { from: ymdShift(date, -(WEEKLY_WINDOW_DAYS - 1)), to: date };
}
