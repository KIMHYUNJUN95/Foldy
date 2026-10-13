import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { TransportStatement } from "@/components/attendance/transport-statement";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getDictionary } from "@/lib/i18n";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  getOrCreateTransportReport,
  getTransportItems,
  getLinkedTransportCandidates,
} from "@/lib/transport-reimbursement";
import {
  getRecentTransportAmounts,
  listTransportDestinations,
} from "@/lib/transport-destinations-server";

// Tokyo 현재 월을 'YYYY-MM' 형식으로 반환.
function getCurrentTokyoMonth(): string {
  const now = new Date();
  const tokyoStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
  return tokyoStr.substring(0, 7);
}

// Mobile — 교통비 정산서 (Transport Expense Statement).
// See docs/product/24-attendance-workflow.md.
export default async function MobileTransportPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const [state, session] = await Promise.all([getOnboardingState(), getCurrentAppSession()]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/attendance/transport")}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const { ym } = await searchParams;
  const monthKey = ym && /^\d{4}-\d{2}$/.test(ym) ? ym : getCurrentTokyoMonth();
  const targetMonthDate = `${monthKey}-01`;

  const locale = session.user.preferredLanguage;
  const localeTag = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
  const organizationId = session.organization.id;
  const userId = session.user.id;

  const service = getSupabaseServiceClient();

  const [navBadges, dict, report] = await Promise.all([
    getMobileNavBadges(),
    Promise.resolve(getDictionary(locale)),
    getOrCreateTransportReport(service, organizationId, userId, targetMonthDate),
  ]);

  const [items, linkedCandidates, destinations, recentAmounts] = await Promise.all([
    getTransportItems(service, report.id),
    getLinkedTransportCandidates(service, organizationId, userId, targetMonthDate),
    listTransportDestinations(service, organizationId, dict),
    getRecentTransportAmounts(service, organizationId, userId),
  ]);

  const monthLabel = new Intl.DateTimeFormat(localeTag, {
    year: "numeric",
    month: "long",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${targetMonthDate}T00:00:00+09:00`));

  const userName = session.user.name?.trim() || dict.attendance.userFallback;

  return (
    <MobileShell activeItem="attendance" badges={navBadges} title={dict.transport.pageTitle} wide>
      <TransportStatement
        locale={locale}
        userName={userName}
        organizationId={organizationId}
        report={report}
        initialItems={items}
        linkedCandidates={linkedCandidates}
        monthKey={monthKey}
        monthLabel={monthLabel}
        destinations={destinations}
        recentAmounts={recentAmounts}
      />
    </MobileShell>
  );
}
