import { redirect } from "next/navigation";
import { MobileOpsCalendar } from "@/components/mobile/ops/mobile-ops-calendar";
import { MobileShell } from "@/components/shell/mobile-shell";
import { Beds24LiveRefresh } from "@/components/shared/beds24-live-refresh";
import { shiftMonthKey } from "@/components/admin/shared/admin-month-key";
import "@/components/admin/admin-console.css";
import "@/components/admin/ops/ops-console.css";
import { hasAdminWebAccess } from "@/config/capabilities";
import { countOpsHistoryAlerts } from "@/lib/beds24/ops-history-alerts";
import { getDictionary } from "@/lib/i18n";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { canAccessOpsAdmin, canWriteOpsCalendar } from "@/lib/ops-admin";
import { getOpsCalendarData, OPS_CALENDAR_ROLLING_DAYS } from "@/lib/ops-calendar";
import { scheduleOpsCalendarOpenRefresh } from "@/lib/ops-calendar-open-refresh";
import { resolveOpsCalendarMode } from "@/lib/ops-calendar-mode-preference";
import { isOpsRatesStale, opsRatesSyncedLabel } from "@/lib/ops-rates-freshness";
import {
  buildOpsCalendarHref,
  parsePropertyParam,
} from "@/lib/ops-calendar-properties";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";

/**
 * 모바일 판매 캘린더 — 데스크톱 `/admin/ops/calendar` 의 폰 화면(2026-10-01, 시안 1a v2).
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「모바일 판매 캘린더」
 *
 * **데이터와 쓰기는 데스크톱과 같다** — 같은 `getOpsCalendarData`, 같은 서버 액션, 같은 가격 · 최소숙박 · 차단 패널.
 * 다른 것은 화면과 입력 방식(길게 눌러 끌기 · 하단 시트)뿐이다. 권한도 같은 키(`ops_admin.access`) — 없으면
 * 모바일 홈으로 보낸다(데스크톱이 대시보드로 보내는 것과 같다).
 */
export const dynamic = "force-dynamic";

const BASE_PATH = "/mobile/ops/calendar";

type SearchParams = {
  mode?: string;
  ym?: string;
  property?: string | string[];
  start?: string;
  cancelled?: string;
};

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export default async function MobileOpsCalendarPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, params] = await Promise.all([getOnboardingState(), getCurrentAppSession(), searchParams]);
  if (state.status === "unauthenticated") redirect(`/auth/login?next=${encodeURIComponent(BASE_PATH)}`);
  if (state.status !== "ready" || !session) redirect("/onboarding");
  if (!hasOrganizationContext(session)) redirect("/mobile/unavailable");
  // 쓰기 액션이 `requireAdminSession`(관리자 웹 역할)을 거친다 — 개별 부여로 키만 받은 현장 역할이 들어와
  // 보기만 되고 저장에서 튕기지 않게 같은 두 조건으로 막는다.
  if (!canAccessOpsAdmin(session) || !hasAdminWebAccess(session)) redirect("/mobile");

  const dictionary = getDictionary(session.user.preferredLanguage);
  const copy = dictionary.opsAdmin.calendar;
  const showCancelled = params.cancelled === "1";

  // 주소에 30일/월간이 없으면 이 사용자가 마지막으로 본 보기로 연다(있으면 그게 새 기억) — 대시보드 · 모바일 공용.
  const mode = await resolveOpsCalendarMode(session.user.id, params.mode);
  const [data, badges, historyAlerts] = await Promise.all([
    getOpsCalendarData(session, {
      mode,
      month: params.ym,
      // 모바일은 **한 건물씩만** 본다(2026-10-05 사용자 결정 — 다중 선택은 데스크톱 전용). 옛 링크 · 관리자 화면에서
      // 여러 건물이 붙어 와도 첫 건물만.
      properties: parsePropertyParam(params.property).slice(0, 1),
      showCancelled,
      start: params.start,
    }),
    navBadgesPromise,
    // 「이력」 칩의 빨간 숫자(최근 7일 전송 실패 + 멈춘 작업) — 데스크톱과 같은 셈.
    countOpsHistoryAlerts(getSupabaseServiceClient(), session.organization.id),
  ]);
  scheduleOpsCalendarOpenRefresh(session.organization.id, data);

  const isRolling = data.mode === "rolling";
  const hrefWith = (next: Partial<SearchParams>) =>
    buildOpsCalendarHref(
      {
        cancelled: showCancelled ? "1" : undefined,
        mode: data.mode,
        property: data.selectedProperties,
        start: data.mode === "rolling" ? data.start : undefined,
        ym: data.mode === "monthly" ? data.month : undefined,
        ...next,
      },
      BASE_PATH,
    );

  const selectedSet = new Set(data.selectedProperties);
  // 데스크톱과 같은 문구 규칙(`ops-rates-freshness.ts`).
  const syncedLabel = opsRatesSyncedLabel({ ageMinutes: data.ratesAgeMinutes, pending: data.ratesPendingRefresh }, copy);
  const first = data.days.at(0)?.date;
  const last = data.days.at(-1)?.date;

  return (
    <MobileShell activeItem="ops-calendar" badges={badges} title={copy.title} wide>
      <Beds24LiveRefresh
        organizationId={session.organization.id}
        scope={{
          from: first ? addDays(first, -1) : null,
          propertyNames: data.selectedProperties.length > 0 ? data.selectedProperties : null,
          to: last ? addDays(last, 1) : null,
        }}
      />
      <MobileOpsCalendar
        canWrite={canWriteOpsCalendar(session)}
        copy={copy}
        days={data.days}
        historyAlerts={historyAlerts}
        jump={{
          base: {
            cancelled: showCancelled ? "1" : undefined,
            mode: data.mode,
            property: data.selectedProperties,
          },
          month: data.month,
          start: data.start,
        }}
        nav={{
          allHref: hrefWith({ property: undefined }),
          cancelledHref: hrefWith({ cancelled: showCancelled ? undefined : "1" }),
          isRolling,
          monthlyHref: hrefWith({ mode: "monthly", start: undefined }),
          nextHref: isRolling
            ? hrefWith({ start: addDays(data.start, OPS_CALENDAR_ROLLING_DAYS) })
            : hrefWith({ ym: shiftMonthKey(data.month, 1) }),
          prevHref: isRolling
            ? hrefWith({ start: addDays(data.start, -OPS_CALENDAR_ROLLING_DAYS) })
            : hrefWith({ ym: shiftMonthKey(data.month, -1) }),
          rangeLabel: isRolling
            ? first && last
              ? `${first.slice(5).replace("-", "/")}–${last.slice(5).replace("-", "/")}`
              : ""
            : data.month,
          rollingHref: hrefWith({ mode: "rolling", start: undefined, ym: undefined }),
          showCancelled,
          todayHref: isRolling ? hrefWith({ start: addDays(data.today, -1) }) : hrefWith({ ym: data.today.slice(0, 7) }),
        }}
        properties={data.propertyOptions.map((name) => ({
          href: hrefWith({ property: name }),
          name,
          selected: selectedSet.has(name),
        }))}
        rows={data.rows}
        selectedProperties={data.selectedProperties}
        staleRates={isOpsRatesStale({ ageMinutes: data.ratesAgeMinutes, pending: data.ratesPendingRefresh })}
        syncedLabel={syncedLabel}
        today={data.today}
      />
    </MobileShell>
  );
}
