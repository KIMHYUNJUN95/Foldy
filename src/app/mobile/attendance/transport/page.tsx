import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { TransportStatement } from "@/components/attendance/transport-statement";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getDictionary } from "@/lib/i18n";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  getTransportReport,
  getTransportItems,
  getLinkedTransportCandidates,
  type TransportReportRow,
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

/** 'YYYY-MM' 를 달 수(년×12+월)로 — 범위 비교용. */
function monthIndex(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
}

/**
 * `?ym` 검사(2026-10-26). 실제 달(01~12)이고 지금 달 기준 3년 전 ~ 다음 달 사이일 때만 받는다 — 아니면 지금 달.
 * 예전에는 모양만 봐서 `?ym=2026-13` · `?ym=9999-01` 로 열면 그 달 보고서 행이 DB 에 생겼다.
 */
function resolveMonthKey(ym: string | undefined, current: string): string {
  if (!ym || !/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return current;
  const diff = monthIndex(ym) - monthIndex(current);
  return diff >= -36 && diff <= 1 ? ym : current;
}

// Mobile — 교통비 정산서 (Transport Expense Statement).
// 참고: docs/product/24-attendance-workflow.md.
export default async function MobileTransportPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const navBadgesPromise = getMobileNavBadges();
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
  const monthKey = resolveMonthKey(ym, getCurrentTokyoMonth());
  const targetMonthDate = `${monthKey}-01`;

  const locale = session.user.preferredLanguage;
  const localeTag = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
  const organizationId = session.organization.id;
  const userId = session.user.id;

  const service = getSupabaseServiceClient();

  // 열기만 해서는 보고서 행을 만들지 않는다 — 읽기만. 없으면 빈 「작성 중」으로 그리고, 첫 항목을 넣을 때
  // createTransportItemAction 이 만든다(2026-10-26).
  const [navBadges, dict, existingReport] = await Promise.all([
    navBadgesPromise,
    Promise.resolve(getDictionary(locale)),
    getTransportReport(service, organizationId, userId, targetMonthDate),
  ]);
  const report: TransportReportRow = existingReport ?? {
    id: "",
    organizationId,
    userId,
    targetMonth: targetMonthDate,
    status: "draft",
    submittedAt: null,
    reviewedAt: null,
    reviewedByUserId: null,
    reviewNote: null,
    totalAmountCached: 0,
    createdAt: "",
    updatedAt: "",
  };

  const [items, linkedCandidates, destinations, recentAmounts] = await Promise.all([
    existingReport ? getTransportItems(service, existingReport.id) : Promise.resolve([]),
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
