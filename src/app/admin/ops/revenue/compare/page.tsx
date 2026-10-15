import { OpsRevenueCompareConsole } from "@/components/admin/ops/ops-revenue-compare";
import { Beds24LiveRefresh } from "@/components/shared/beds24-live-refresh";
import { AdminShell } from "@/components/shell/admin-shell";
import { toJstDateString } from "@/lib/admin-calendar-dashboard";
import { adminLocaleTag } from "@/lib/admin-export-meta";
import { shiftMonthKey } from "@/components/admin/shared/admin-month-key";
import { getDictionary } from "@/lib/i18n";
import { opsNavId } from "@/lib/ops-admin";
import { lastDayOfMonth, normalizeRange, previousYearRange, REVENUE_MODES, type RevenueMode } from "@/lib/ops-revenue";
import { getOpsRevenueCompareData, type OpsRevenueComparePeriod } from "@/lib/ops-revenue-server";
import { requireOpsAdminPage } from "../../ops-page-session";

/**
 * 매출 비교 — 두 기간 A · B 를 골라 맞대어 본다 (2026-10-08, 시안 「매출 비교」 1번 v4).
 *
 * 도메인 계약: docs/product/34-metrics-and-automation.md 「매출 비교」
 *
 * 주소: `?am=month&af=2026-09-01&at=2026-09-30&bm=…&bf=…&bt=…&ex=오쿠보A&ex=사노`. 값은 믿지 않고 모드마다 바로잡는다.
 * 없으면 A = 지난달, B = 그 전년 같은 달. `ex` = 합계에서 뺄 건물(없으면 매출 화면 기본값).
 */
export const dynamic = "force-dynamic";

const LIVE_KINDS = ["reservations"] as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function OpsRevenueComparePage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireOpsAdminPage("revenue");
  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);
  const many = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  };

  const today = toJstDateString(new Date());
  const lastMonth = shiftMonthKey(today.slice(0, 7), -1);
  const period = (prefix: "a" | "b", fallback: OpsRevenueComparePeriod): OpsRevenueComparePeriod => {
    const requested = one(`${prefix}m`);
    if (!requested && !one(`${prefix}f`)) return fallback;
    const mode: RevenueMode = REVENUE_MODES.includes(requested as RevenueMode) ? (requested as RevenueMode) : "month";
    const from = one(`${prefix}f`);
    return { mode, range: normalizeRange(mode, { from, to: one(`${prefix}t`), ym: from?.slice(0, 7) }, today) };
  };
  const a = period("a", { mode: "month", range: { from: `${lastMonth}-01`, to: lastDayOfMonth(lastMonth) } });
  const b = period("b", { mode: a.mode, range: previousYearRange(a.range) });
  const data = await getOpsRevenueCompareData(session, { a, b });
  const excludedParam = many("ex");

  return (
    <AdminShell activeItem={opsNavId("revenue")} title={dictionary.opsRevenue.title}>
      {/* 예약 웹훅이 들어오면 새로고침 없이 다시 읽는다 — 예약 신호만(2026-10-08, 매출 · 가동률과 같다). */}
      <Beds24LiveRefresh kinds={LIVE_KINDS} organizationId={session.organization.id} />
      <OpsRevenueCompareConsole
        copy={dictionary.opsRevenueCompare}
        data={data}
        initialExcluded={excludedParam.length > 0 ? excludedParam : null}
        localeTag={adminLocaleTag(locale)}
        rcopy={dictionary.opsRevenue}
        shared={dictionary.admin.shared}
      />
    </AdminShell>
  );
}
