import { redirect } from "next/navigation";
import { AdminShell } from "@/components/shell/admin-shell";
import { AssignDayBoard } from "@/components/admin/cleaning-assign/assign-day-board";
import { AssignMonthBoard } from "@/components/admin/cleaning-assign/assign-month-board";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { loadCleaningRoomOptions } from "@/lib/automation/data";
import { getCleaningOperatingDateKey } from "@/lib/cleaning";
import { getCleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import { isDateKey, isMonthKey, monthOf } from "@/lib/cleaning-assign/day-state";
import { loadDayBoard, loadMonthBoard } from "@/lib/cleaning-assign/data";
import { getDictionary } from "@/lib/i18n";
import { CALENDAR_BUILDING_ORDER, localizePropertyName } from "@/lib/room-label-normalization";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { attendanceCan } from "@/lib/attendance-review";

/**
 * 청소 배정 — PC(하루 보기 · 월 보기). 배정 담당(`cleaning.assign`)만.
 * `?date=YYYY-MM-DD`(하루) · `?view=month&ym=YYYY-MM`(월). 형식이 어긋나면 오늘 · 이번 달로 떨어진다.
 * docs/product/37-cleaning-shift-assignment.md 「4-2」
 */
export default async function AdminCleaningAssignPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string; ym?: string }>;
}) {
  const [session, params] = await Promise.all([requireAdminPageSession({ nextPath: "/admin/cleaning-assign" }), searchParams]);
  if (!session.capabilities.includes("cleaning.assign")) redirect("/admin");

  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const copy = getCleaningAssignCopy(locale);
  const shared = dictionary.admin.shared;
  const today = getCleaningOperatingDateKey();
  const supabase = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  const buildingLabels = dictionary.cleaning.buildingLabels;
  const propertyLabels = Object.fromEntries(CALENDAR_BUILDING_ORDER.map((name) => [name, localizePropertyName(name, buildingLabels)]));
  // 월 비교표는 급여가 보이므로 급여를 볼 수 있는 사람만(근태 · 급여 화면과 같은 기준).
  const canCompare = await attendanceCan(supabase, organizationId, session.user.id, "payroll.view");

  if (params.view === "month") {
    const ym = isMonthKey(params.ym) ? params.ym! : monthOf(today);
    const board = await loadMonthBoard(supabase, organizationId, ym, session.user.id);
    return (
      <AdminShell activeItem="cleaning-assign" title={copy.title}>
        <AssignMonthBoard board={board} copy={copy} locale={locale} today={today} shared={shared} canCompare={canCompare} />
      </AdminShell>
    );
  }

  const date = isDateKey(params.date) ? params.date! : today;
  const [board, roomOptions] = await Promise.all([
    loadDayBoard(supabase, organizationId, date, session.user.id),
    loadCleaningRoomOptions(supabase, organizationId),
  ]);
  return (
    <AdminShell activeItem="cleaning-assign" title={copy.title}>
      <AssignDayBoard
        board={board}
        copy={copy}
        locale={locale}
        today={today}
        shared={shared}
        propertyLabels={{ ...propertyLabels, ...Object.fromEntries(board.properties.map((name) => [name, propertyLabels[name] ?? localizePropertyName(name, buildingLabels)])) }}
        roomOptions={roomOptions.map((option) => ({ label: option.roomLabel, propertyName: option.propertyName, roomKey: option.roomKey }))}
        canCompare={canCompare}
        canSwap={session.capabilities.includes("cleaning.assign_swap")}
      />
    </AdminShell>
  );
}
