import { OpsRevenueConsole } from "@/components/admin/ops/ops-revenue-console";
import { Beds24LiveRefresh } from "@/components/shared/beds24-live-refresh";
import { AdminShell } from "@/components/shell/admin-shell";
import { toJstDateString } from "@/lib/admin-calendar-dashboard";
import { adminLocaleTag } from "@/lib/admin-export-meta";
import { getDictionary } from "@/lib/i18n";
import { opsNavId } from "@/lib/ops-admin";
import { normalizeRange, REVENUE_MODES, type RevenueMode } from "@/lib/ops-revenue";
import { getOpsRevenueData } from "@/lib/ops-revenue-server";
import { requireOpsAdminPage } from "../ops-page-session";

/**
 * 매출 — 기간별 매출 · 수수료 · 가동률 · ADR · RevPAR, 건물별 표와 「건물 × 월」 매트릭스 (2026-10-06, 시안 A v2).
 *
 * 도메인 계약: docs/product/34-metrics-and-automation.md 「매출 화면」
 *
 * 식은 판매 캘린더 「매출 요약」과 같다(같은 읽기 · 같은 계산 모듈). 기간은 주소에 있다 — 월은 공용 월 선택기의
 * `?ym=`, 그 밖은 `?mode=…&from=…(&to=…)`. 주소 값은 믿지 않고 모드마다 모양을 바로잡는다.
 */
export const dynamic = "force-dynamic";

const LIVE_KINDS = ["reservations"] as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function OpsRevenuePage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireOpsAdminPage("revenue");
  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);

  const today = toJstDateString(new Date());
  const requested = one("mode");
  const mode: RevenueMode = REVENUE_MODES.includes(requested as RevenueMode) ? (requested as RevenueMode) : "month";
  const range = normalizeRange(mode, { from: one("from"), to: one("to"), ym: one("ym") }, today);
  const data = await getOpsRevenueData(session, { mode, range });

  return (
    <AdminShell activeItem={opsNavId("revenue")} title={dictionary.opsRevenue.title}>
      {/* 예약 웹훅이 들어오면 새로고침 없이 다시 읽는다 — 예약 신호만(요금 · 차단은 숫자에 안 쓴다), 2026-10-08. */}
      <Beds24LiveRefresh kinds={LIVE_KINDS} organizationId={session.organization.id} />
      <OpsRevenueConsole
        copy={dictionary.opsRevenue}
        data={data}
        initialTab={one("tab") === "matrix" ? "matrix" : "report"}
        localeTag={adminLocaleTag(locale)}
        shared={dictionary.admin.shared}
      />
    </AdminShell>
  );
}
