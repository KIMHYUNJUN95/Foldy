import { OpsOccupancyConsole, type OccupancyTab } from "@/components/admin/ops/ops-occupancy-console";
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
 * 가동률 — 추이 · 건물별(시안 A) · 객실 × 월(B) · 앞으로 6달(C) (2026-10-07).
 *
 * 도메인 계약: docs/product/34-metrics-and-automation.md 「가동률 화면」
 *
 * 읽기는 매출 화면과 같다(`getOpsRevenueData` — 같은 칸, 같은 식). 「앞으로」 탭 때문에 이번 달부터 6달을 더 읽는다.
 * 기간 · 탭은 주소에 있다(`?mode=…&ym=…&tab=rooms|forward`), 주소 값은 서버가 모드마다 바로잡는다.
 */
export const dynamic = "force-dynamic";

const FORWARD_MONTHS = 6;

const LIVE_KINDS = ["reservations"] as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function OpsOccupancyPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireOpsAdminPage("occupancy");
  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);

  const today = toJstDateString(new Date());
  const requested = one("mode");
  const mode: RevenueMode = REVENUE_MODES.includes(requested as RevenueMode) ? (requested as RevenueMode) : "month";
  const range = normalizeRange(mode, { from: one("from"), to: one("to"), ym: one("ym") }, today);
  const data = await getOpsRevenueData(session, { forward: FORWARD_MONTHS, mode, range });
  const tab: OccupancyTab = one("tab") === "rooms" ? "rooms" : one("tab") === "forward" ? "forward" : "report";

  return (
    <AdminShell activeItem={opsNavId("occupancy")} title={dictionary.opsOccupancy.title}>
      {/* 예약 웹훅이 들어오면 새로고침 없이 다시 읽는다 — 예약 신호만(요금 · 차단은 숫자에 안 쓴다), 2026-10-08. */}
      <Beds24LiveRefresh kinds={LIVE_KINDS} organizationId={session.organization.id} />
      <OpsOccupancyConsole
        copy={dictionary.opsOccupancy}
        data={data}
        initialTab={tab}
        localeTag={adminLocaleTag(locale)}
        rcopy={dictionary.opsRevenue}
        shared={dictionary.admin.shared}
      />
    </AdminShell>
  );
}
