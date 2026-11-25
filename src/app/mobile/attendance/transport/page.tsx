import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { TransportStatement } from "@/components/attendance/transport-statement";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getDictionary } from "@/lib/i18n";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { signTransportReceiptPaths } from "@/lib/transport-receipt-storage";
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
import { resolveTransportMonth } from "@/lib/transport-month";

// Tokyo 현재 월을 'YYYY-MM' 형식으로 반환.
function getCurrentTokyoMonth(): string {
  const now = new Date();
  const tokyoStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
  return tokyoStr.substring(0, 7);
}


/**
 * `?ym` 검사(2026-10-26). 실제 달(01~12)이고 지금 달 기준 3년 전 ~ 다음 달 사이일 때만 받는다 — 아니면 지금 달.
 * 예전에는 모양만 봐서 `?ym=2026-13` · `?ym=9999-01` 로 열면 그 달 보고서 행이 DB 에 생겼다.
 */
function resolveMonthKey(ym: string | undefined, current: string): string {
  // 서버 액션과 같은 규칙(`src/lib/transport-month.ts`).
  return resolveTransportMonth(ym, current);
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

  // 정산서 · 항목 읽기 오류는 던진다(2026-11-25) — 빈 달로 보이지 않게 이 화면의 오류 화면으로 간다.
  const [rawItems, linkedCandidates, destinations, recentAmounts] = await Promise.all([
    existingReport ? getTransportItems(service, existingReport.id) : Promise.resolve([]),
    getLinkedTransportCandidates(service, organizationId, userId, targetMonthDate),
    listTransportDestinations(service, organizationId, dict),
    getRecentTransportAmounts(service, organizationId, userId),
  ]);

  // 영수증은 비공개 버킷이라 서버가 사진마다 10분짜리 서명 주소를 붙여 넘긴다(2026-11-25). 못 받으면 null + imageUrlsFailed.
  const { urlByPath } = await signTransportReceiptPaths(
    service,
    rawItems.flatMap((item) => item.images.map((img) => img.storagePath)),
  );
  const items = rawItems.map((item) => ({
    ...item,
    images: item.images.map((img) => ({ ...img, signedUrl: urlByPath.get(img.storagePath) ?? null })),
    imageUrlsFailed: item.images.some((img) => !urlByPath.has(img.storagePath)),
  }));

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
