/**
 * 매출 요약 — 모바일 매출(`/mobile/ops/revenue`)이 쓰는 숫자. **순수하다.**
 *
 * 도메인 계약: docs/product/34-metrics-and-automation.md 「매출 화면」 · 「모바일 매출」
 *
 * 식은 PC 매출 화면(`ops-revenue-console.tsx`)과 **같다** — 같은 칸(`getOpsRevenueData`)을 합계 건물만 골라 더하고
 * (`sumMetrics`) 증감은 `changePct`(전년이 0 이면 `null` = 「신규」). PC 콘솔은 같은 계산을 컴포넌트 안에 두고 있어(다른 작업이
 * 고치는 중이라 손대지 않았다) 가동률 요약(`ops-occupancy-summary.ts`)처럼 여기 순수 함수로 다시 적었다 — 숫자 6개 중 모바일에
 * 쓰는 것 · 월별 15칸(올해 · 전년 · 가동률) · 채널 구성 · 건물별.
 *
 * 서버가 부르고 결과만 클라이언트로 넘긴다(칸 전부를 넘기지 않는다 — 폰에 보낼 양을 줄이려고).
 */

import { shiftMonthKey } from "@/components/admin/shared/admin-month-key";
import { changePct, lastDayOfMonth, monthPhase, sumMetrics, type MonthPhase, type RevenueCell } from "@/lib/ops-revenue";
import type { OpsRevenueData } from "@/lib/ops-revenue-server";

export type RevenueChannelKey = "airbnb" | "booking" | "direct" | "other";

export type RevenueSummaryMonth = {
  month: string;
  phase: MonthPhase;
  /** 합계 건물 매출(앞날은 잡힌 예약). */
  revenue: number;
  /** 전년 같은 달 매출. */
  previous: number;
  /** 0~100. 분모가 0 이면 `null`. */
  occupancyPct: number | null;
  /** 진행 중인 달의 지난 날 비율(0~100) — 막대 아래쪽을 진하게. 지난 달 100 · 앞날 0. */
  donePct: number;
};

export type RevenueSummary = {
  today: string;
  /** 고른 달 `YYYY-MM`. */
  month: string;
  includedCount: number;
  /** 합계에서 뺀 건물 이름(기본 제외 — 오쿠보A · 사노). */
  excluded: string[];
  hasProperties: boolean;
  revenue: number;
  commission: number;
  net: number;
  /** 판매 박이 없으면 `null`. */
  adr: number | null;
  /** 분모(객실박)가 0 이면 `null`. */
  revpar: number | null;
  occupancyPct: number | null;
  /** 수수료 ÷ 매출(%). 매출 0 이면 `null`. */
  commissionShare: number | null;
  /** 전년 같은 달 대비 증감(%) — 전년이 0 이면 `null`. */
  change: { revenue: number | null; net: number | null; adr: number | null; revpar: number | null };
  /** 매출이 있는 채널만 · PC 순서(Airbnb · Booking.com · 직접 · 기타). */
  channels: Array<{ key: RevenueChannelKey; amount: number; pct: number }>;
  /** 합계 건물 중 그 달 매출이 있는 곳 — 높은 순. `change` 가 `null` = 「신규」. */
  buildings: Array<{ name: string; revenue: number; change: number | null }>;
  /** 월별 15칸(기준 달 앞 11 ~ 뒤 3) — PC 그래프와 같은 칸. */
  trend: RevenueSummaryMonth[];
};

const CHANNEL_KEYS: readonly RevenueChannelKey[] = ["airbnb", "booking", "direct", "other"];

export function buildRevenueSummary(data: OpsRevenueData, included: readonly string[]): RevenueSummary {
  const inSet = new Set(included);
  const inProps = data.properties.filter((property) => inSet.has(property.name));
  const inNames = inProps.map((property) => property.name);
  const totalOf = (cells: Record<string, RevenueCell> | undefined) => sumMetrics(inNames.map((name) => cells?.[name]));

  const current = totalOf(data.rangeCells);
  const previous = totalOf(data.previousRangeCells);

  const channels = CHANNEL_KEYS.map((key) => ({
    amount: current[key],
    key,
    pct: current.revenue > 0 ? (current[key] / current.revenue) * 100 : 0,
  })).filter((channel) => channel.amount > 0);

  const buildings = inProps
    .map((property) => {
      const cur = data.rangeCells[property.name]?.revenue ?? 0;
      const prev = data.previousRangeCells[property.name]?.revenue ?? 0;
      return { change: changePct(cur, prev), name: property.name, revenue: cur };
    })
    .filter((row) => row.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue);

  const todayDay = Number(data.today.slice(8, 10));
  const trend = data.months.map((month) => {
    const cur = totalOf(data.monthCells[month]);
    const prev = totalOf(data.monthCells[shiftMonthKey(month, -12)]);
    const phase = monthPhase(month, data.today);
    const days = Number(lastDayOfMonth(month).slice(8, 10));
    return {
      donePct: phase === "current" ? Math.round((todayDay / days) * 100) : phase === "past" ? 100 : 0,
      month,
      occupancyPct: cur.availableNights > 0 ? cur.occupancyPct : null,
      phase,
      previous: prev.revenue,
      revenue: cur.revenue,
    };
  });

  return {
    adr: current.occupiedNights > 0 ? current.adr : null,
    buildings,
    change: {
      adr: changePct(current.adr, previous.adr),
      net: changePct(current.net, previous.net),
      revenue: changePct(current.revenue, previous.revenue),
      revpar: changePct(current.revpar, previous.revpar),
    },
    channels,
    commission: current.commission,
    commissionShare: current.revenue > 0 ? (current.commission / current.revenue) * 100 : null,
    excluded: data.properties.filter((property) => !inSet.has(property.name)).map((property) => property.name),
    hasProperties: data.properties.length > 0,
    includedCount: inNames.length,
    month: data.range.from.slice(0, 7),
    net: current.net,
    occupancyPct: current.availableNights > 0 ? current.occupancyPct : null,
    revenue: current.revenue,
    revpar: current.availableNights > 0 ? current.revpar : null,
    today: data.today,
    trend,
  };
}
