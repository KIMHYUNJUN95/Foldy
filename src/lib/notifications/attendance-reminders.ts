// Attendance — scheduled reminder/abnormal evaluator (Step 14).
//
// Two time-based notifications that no user action triggers, so they need a low-frequency scheduled
// scan (mirrors src/lib/notifications/task-reminders.ts):
//   1. Worker 18:30 open-session reminder — once per Tokyo day per open-session user (deduped). The
//      interactive "still working / already left" choice lives in the home prompt; this is the
//      push-channel nudge that surfaces in the notification center.
//   2. Admin "incomplete / stale" alert — for sessions still OPEN from a PRIOR Tokyo day (never clocked
//      out; crossed midnight). Targets owner / attendance_payroll_admin only, deduped per session per
//      day. (The clock-out-time midnight-crossing alert is fired synchronously elsewhere.)
//
// Driven by CRON_SECRET via /api/attendance/reminders. Not an instance-generation engine.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  createAttendanceOpenSessionReminder,
  notifyAttendanceAdmins,
} from "@/lib/notifications/create";
import { getAttendancePayrollAdminUserIds } from "@/lib/attendance-review";
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

  // Names for stale-session admin alerts.
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

    // 2) Stale (prior-day) open session → admin incomplete/abnormal alert.
    if (s.operating_date < today) {
      let admins = adminCache.get(s.organization_id);
      if (!admins) {
        admins = await getAttendancePayrollAdminUserIds(service, s.organization_id);
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
