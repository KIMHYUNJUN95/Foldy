import { notFound } from "next/navigation";
import { MobileMemberDetail } from "@/components/mobile/users/mobile-member-detail";
import { MemberShiftRow } from "@/components/mobile/shift/member-shift-row";
import { MemberPayrollSection } from "@/components/mobile/users/member-payroll-section";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getPayrollSettingsCopy } from "@/lib/payroll-settings-i18n";
import { loadMemberPayrollPanel } from "@/lib/payroll-settings-server";
import { getCleaningOperatingDateKey } from "@/lib/cleaning";
import { getCleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import { monthOf } from "@/lib/cleaning-assign/day-state";
import { loadPersonShift } from "@/lib/cleaning-assign/person-shift";
import { hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { loadMemberPanel, loadUserDirectory } from "@/lib/user-management-data";
import { requireMobileUserManagement } from "../gate";

/**
 * 모바일 사용자 관리 — 멤버 상세(2026-10-20, 시안 ④ ~ ⑩). 폰 · 폴드는 이 화면으로 넘어오고(뒤로 = 화면 스와이프), 태블릿 가로는
 * 목록 오른쪽 칸에 이 화면이 그대로 열린다. 데이터 · 판정은 대시보드 패널과 같다.
 */
export default async function MobileMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const navBadgesPromise = getMobileNavBadges();
  const session = await requireMobileUserManagement(`/mobile/users/${id}`);
  const directory = await loadUserDirectory(session);
  const [panel, navBadges] = await Promise.all([loadMemberPanel(session, directory, id), navBadgesPromise]);
  if (!panel) notFound();
  const locale = session.user.preferredLanguage;
  // 「시프트」 줄 — 배정 권한이 있고 이 사람이 현장 인원이면(docs/product/37 「4-6」). 같은 조직 사람만.
  const userId = directory.memberships.find((membership) => membership.id === id)?.user_id ?? null;
  const today = getCleaningOperatingDateKey();
  const shift =
    userId && hasOrganizationContext(session) && session.capabilities.includes("cleaning.assign")
      ? await loadPersonShift(getSupabaseServiceClient(), session.organization.id, userId, monthOf(today), today, session.user.id).catch(() => null)
      : null;
  // 「급여 설정」 구역 — `wages.manage` 가 없으면 null(구역 없음, docs/product/39 §3-A).
  const payroll =
    userId && hasOrganizationContext(session)
      ? await loadMemberPayrollPanel(getSupabaseServiceClient(), session.organization.id, session.user.id, userId, today).catch(() => null)
      : null;
  return (
    <MobileShell activeItem="users" badges={navBadges} title={getDictionary(locale).admin.users.console.mDetailTitle}>
      <MobileMemberDetail
        key={panel.member.membershipId}
        panel={panel}
        locale={locale}
        actorRole={session.user.role}
        payrollSlot={
          payroll ? (
            <MemberPayrollSection
              key={panel.member.membershipId}
              panel={payroll}
              copy={getPayrollSettingsCopy(locale)}
              locale={locale}
              memberName={panel.member.name}
              today={today}
            />
          ) : null
        }
        shiftSlot={shift ? <MemberShiftRow data={shift} copy={getCleaningAssignCopy(locale)} today={today} href={`/mobile/users/${id}/shift`} locale={locale} /> : null}
      />
    </MobileShell>
  );
}
