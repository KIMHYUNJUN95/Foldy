// 근태 — 예약 실행되는 리마인더/이상 평가기 (14단계).
//
// 사용자 동작이 트리거하지 않는 시간 기반 알림 두 가지라서 저빈도 예약
// 스캔이 필요하다 (src/lib/notifications/task-reminders.ts 와 같은 방식):
//   1. 작업자 18:30 미종료 세션 리마인더 — 열린 세션이 있는 사용자당 도쿄 기준 하루 한 번(중복 제거).
//      "아직 근무 중 / 이미 퇴근" 선택은 홈 프롬프트에 있고, 이것은
//      알림 센터에 뜨는 푸시 채널 넛지다.
//   2. 관리자 "미완료 / 오래된" 알림 — 이전 도쿄 날짜부터 계속 열려 있는 세션(퇴근
//      기록 없음, 자정을 넘김)에 대해. 대상은 owner / attendance_payroll_admin 만이며, 세션당 하루
//      한 번 중복 제거. (퇴근 시각의 자정 넘김 알림은 다른 곳에서 동기적으로 발송한다.)
//
// CRON_SECRET 으로 /api/attendance/reminders 가 호출한다. 인스턴스 생성 엔진이 아니다.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  createAttendanceOpenSessionReminder,
  notifyAttendanceAdmins,
} from "@/lib/notifications/create";
import { getMemberIdsWithCapability } from "@/lib/attendance-review";
import { isPastReminderTimeTokyo } from "@/lib/attendance-sessions";
import { tokyoToday } from "@/lib/tokyo-date";

type Service = SupabaseClient<Database>;

export async function runAttendanceReminders(
  service: Service,
  options: { organizationId?: string } = {},
): Promise<{ remindersCreated: number; abnormalAlerts: number; openSessions: number }> {
  let query = service
    .from("attendance_sessions")
    .select("id, organization_id, user_id, operating_date")
    .eq("status", "open");
  if (options.organizationId) query = query.eq("organization_id", options.organizationId);

  const res = await query;
  const openSessions = (res.error ? [] : (res.data ?? [])) as {
    id: string;
    organization_id: string;
    user_id: string;
    operating_date: string;
  }[];

  const today = tokyoToday();
  const past1830 = isPastReminderTimeTokyo();
  const adminCache = new Map<string, string[]>();
  let remindersCreated = 0;
  let abnormalAlerts = 0;

  // 오래된 세션 관리자 알림용 이름.
  const staleUserIds = Array.from(
    new Set(openSessions.filter((s) => s.operating_date < today).map((s) => s.user_id)),
  );
  const names = new Map<string, string>();
  if (staleUserIds.length > 0) {
    const pr = await service.from("profiles").select("id, name").in("id", staleUserIds);
    for (const r of (pr.data ?? []) as { id: string; name: string }[]) names.set(r.id, r.name);
  }

  for (const s of openSessions) {
    // 1) Worker 18:30 reminder (once/day via dedupe). 오늘 운영일 근무에만 — 지난 날 퇴근 미기록에
    //    「아직 근무 중인가요?」를 묻지 않는다(그건 정정 요청 대상, `isStaleOpenSession`).
    if (past1830 && s.operating_date === today) {
      const { created } = await createAttendanceOpenSessionReminder(service, {
        organizationId: s.organization_id,
        userId: s.user_id,
        tokyoDate: today,
        sessionId: s.id,
      });
      if (created) remindersCreated += 1;
    }

    // 2) 오래된(이전 날짜) 열린 세션 → 관리자 미완료/이상 알림.
    if (s.operating_date < today) {
      let admins = adminCache.get(s.organization_id);
      if (!admins) {
        admins = await getMemberIdsWithCapability(service, s.organization_id, "attendance.manage");
        adminCache.set(s.organization_id, admins);
      }
      await notifyAttendanceAdmins(service, {
        organizationId: s.organization_id,
        recipientUserIds: admins,
        actorUserId: null,
        dedupeBase: `attendance_stale:${s.id}:${today}`,
        href: "/mobile/attendance",
        sourceId: s.id,
        payload: {
          event: "abnormal_session",
          subjectUserId: s.user_id,
          subjectName: names.get(s.user_id) ?? null,
          sessionId: s.id,
        },
      });
      abnormalAlerts += 1;
    }
  }

  return { remindersCreated, abnormalAlerts, openSessions: openSessions.length };
}
