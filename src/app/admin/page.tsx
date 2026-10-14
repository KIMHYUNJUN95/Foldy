import { redirect } from "next/navigation";
import { AdminShell } from "@/components/shell/admin-shell";
import { DashboardHome } from "@/components/admin/dashboard-home";
import { canAccessAdminWeb } from "@/config/roles";
import { getDictionary } from "@/lib/i18n";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession } from "@/lib/session";
import { getAdminDashboard } from "@/lib/admin-dashboard";
import { Beds24LiveRefresh } from "@/components/shared/beds24-live-refresh";
import { canAccessOpsAdmin } from "@/lib/ops-admin";
import { getDashboardOpsSummary } from "@/lib/ops-revenue-server";

// Admin operations console — desktop dashboard home. Top-priority blocks wired to
// real domain data (cleaning / requests / attendance / announcements / tasks /
// reservations). See docs/product/05-admin-web-ia.md → "Dashboard Home Screen".
export default async function AdminDashboardPage({ searchParams }: { searchParams: Promise<{ ym?: string }> }) {
  const [state, session] = await Promise.all([getOnboardingState(), getCurrentAppSession()]);

  if (state.status === "unauthenticated") {
    redirect("/auth/login?next=/admin");
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!canAccessAdminWeb(session.user.role)) {
    redirect("/mobile");
  }

  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const localeTag = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
  // 운영 관리자는 시안대로 숫자 줄 + 매출 · 가동률 · 최근 6개월(화이트 리디자인 2026-10-09). 실패해도 홈은 열린다.
  const isOpsAdmin = Boolean(session.organization) && canAccessOpsAdmin(session);
  const { ym } = await searchParams;
  const [data, opsSummary] = await Promise.all([
    getAdminDashboard(session),
    isOpsAdmin
      ? getDashboardOpsSummary(session, ym).catch((error) => {
          console.warn("[admin-dashboard] ops summary failed", error);
          return null;
        })
      : Promise.resolve(null),
  ]);
  const shared = dictionary.admin.shared;

  return (
    <AdminShell activeItem="dashboard" title={dictionary.admin.console.headerToday}>
      {/* 하루 첫 진입 모션(약 1.8초) — 시안 Motion-PC-Entry-PC */}
      {session.organization ? <Beds24LiveRefresh organizationId={session.organization.id} /> : null}
      <DashboardHome
        c={dictionary.admin.console}
        data={data}
        locale={localeTag}
        ops={
          opsSummary
            ? {
                monthPickerLabels: {
                  nextMonth: shared.dateNextMonth,
                  nextYear: shared.dateNextYear,
                  open: shared.dateSelect,
                  prevMonth: shared.datePrevMonth,
                  prevYear: shared.datePrevYear,
                  thisMonth: shared.dateThisMonth,
                },
                summary: opsSummary,
              }
            : null
        }
      />
    </AdminShell>
  );
}
