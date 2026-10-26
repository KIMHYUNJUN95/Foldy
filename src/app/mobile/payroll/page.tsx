import { redirect } from "next/navigation";
import { shiftMonthKey } from "@/components/admin/shared/admin-month-key";
import { MobilePayroll } from "@/components/mobile/payroll/mobile-payroll";
import { MobileShell } from "@/components/shell/mobile-shell";
import { adminLocaleTag } from "@/lib/admin-export-meta";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { PAYROLL_PREP_START_YM } from "@/lib/payroll-prep";
import { attendanceCan } from "@/lib/attendance-review";
import { getPayrollBankCopy } from "@/lib/payroll-bank-i18n";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getPayrollPrepCopy } from "@/lib/payroll-prep-i18n";
import { getPayrollPrep } from "@/lib/payroll-prep-server";
import { getPayrollSettingsCopy } from "@/lib/payroll-settings-i18n";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { tokyoToday } from "@/lib/tokyo-date";

/**
 * 모바일 급여 준비 — 알바 한 달 급여를 이름별로 보고 손 입력을 채운다(2026-10-25, 시안 Prep-Phone · PrepSheet-Phone · Prep-Fold · Prep-Tablet).
 * 도메인 계약: docs/product/39 §5-A. 숫자는 서버(`getPayrollPrep`)가 전부 낸다 — 여기서 다시 셈하지 않는다.
 * `?view=approve` — 폰에서 결재 화면(사장 확인표)을 연다(P5, 결재 단계에서만 의미가 있다).
 * 기본 달 = 도쿄의 지난달(급여는 지난달분을 준비한다), 새 계산이 시작된 달(`PAYROLL_PREP_START_YM`)보다 앞으로는 못 간다.
 */
export const dynamic = "force-dynamic";

const BASE_PATH = "/mobile/payroll";
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MobilePayrollPage({ searchParams }: { searchParams: SearchParams }) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, params] = await Promise.all([getOnboardingState(), getCurrentAppSession(), searchParams]);
  if (state.status === "unauthenticated") redirect(`/auth/login?next=${encodeURIComponent(BASE_PATH)}`);
  if (state.status !== "ready" || !session) redirect("/onboarding");
  if (!hasOrganizationContext(session)) redirect("/mobile/unavailable");

  const todayMonth = tokyoToday().slice(0, 7);
  const lastMonth = shiftMonthKey(todayMonth, -1);
  const defaultYm = lastMonth < PAYROLL_PREP_START_YM ? PAYROLL_PREP_START_YM : lastMonth;
  const requested = typeof params.ym === "string" && YM_RE.test(params.ym) ? params.ym : defaultYm;
  const ym = requested < PAYROLL_PREP_START_YM ? PAYROLL_PREP_START_YM : requested;

  const [data, badges, canViewBank] = await Promise.all([
    getPayrollPrep(session, ym),
    navBadgesPromise,
    attendanceCan(getSupabaseServiceClient(), session.organization.id, session.user.id, "payroll.view"),
  ]);
  if (!data.canView) redirect("/mobile");

  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const settingsCopy = getPayrollSettingsCopy(locale);

  return (
    // `split` — 태블릿 가로는 본문 폭 제한을 풀고 화면이 목록 · 사람 칸으로 나눈다. 폴드는 가운데 칸(표)이 알아서 그린다.
    <MobileShell activeItem="payroll" badges={badges} split title={dictionary.navigation.mobile.payroll}>
      <MobilePayroll
        copy={getPayrollPrepCopy(locale)}
        bankCopy={getPayrollBankCopy(locale)}
        canViewBank={canViewBank}
        data={data}
        localeTag={adminLocaleTag(locale)}
        maxYm={todayMonth}
        view={params.view === "approve" ? "approve" : null}
        minYm={PAYROLL_PREP_START_YM}
        withholdingLabels={{ kou: settingsCopy.classKou, otsu: settingsCopy.classOtsu, hei: settingsCopy.classHei }}
      />
    </MobileShell>
  );
}
