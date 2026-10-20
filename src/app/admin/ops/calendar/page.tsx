import { ChevronLeft, ChevronRight } from "lucide-react";
import { AdminShell } from "@/components/shell/admin-shell";
import { OpsCalendarGrid } from "@/components/admin/ops/ops-calendar-grid";
import { OpsCalendarJump } from "@/components/admin/ops/ops-calendar-jump";
import { OpsNavLink, OpsNavScope } from "@/components/admin/ops/ops-nav";
import { OpsPropertyTabs } from "@/components/admin/ops/ops-property-tabs";
import { AdminMonthPicker } from "@/components/admin/shared/admin-month-picker";
import { shiftMonthKey } from "@/components/admin/shared/admin-month-key";
import "@/components/admin/ops/ops-console.css";
import "@/components/admin/ops/ops-calendar-white.css";
import { countOpsHistoryAlerts } from "@/lib/beds24/ops-history-alerts";
import { getDictionary } from "@/lib/i18n";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getOpsCalendarData, OPS_CALENDAR_ROLLING_DAYS } from "@/lib/ops-calendar";
import { scheduleOpsCalendarOpenRefresh } from "@/lib/ops-calendar-open-refresh";
import { resolveOpsCalendarMode } from "@/lib/ops-calendar-mode-preference";
import { canWriteOpsCalendar, opsNavId } from "@/lib/ops-admin";
import { isOpsRatesStale, opsRatesSyncedLabel } from "@/lib/ops-rates-freshness";
import {
  buildOpsCalendarHref,
  parsePropertyParam,
  togglePropertySelection,
} from "@/lib/ops-calendar-properties";
import { requireOpsAdminPage } from "../ops-page-session";
import { Beds24LiveRefresh } from "@/components/shared/beds24-live-refresh";

/**
 * 판매 캘린더 — 운영 관리자 영역의 핵심 화면.
 *
 * 1차에서는 **읽기만** 한다. 예약·블락·가격·최소 숙박일 전부 우리 DB 의 실제 데이터다
 * (가격은 `room_daily_rates`, 2026-09-17 신설).
 *
 * 쓰기(가격·최소숙박·블락·예약생성)는 병행 기간에는 켜지 않는다 —
 * docs/product/33-calendar-write-features.md → 「켜기 전까지 쓰지 않는다」.
 *
 * 상태는 전부 쿼리스트링이라 서버 렌더 한 번으로 끝난다(채용·컴플레인 콘솔과 같은 방식).
 */
export const dynamic = "force-dynamic";

type SearchParams = {
  /** `rolling`(기본) | `monthly` */
  mode?: string;
  /**
   * 월간 뷰의 대상 달(`YYYY-MM`).
   *
   * 이름이 `ym` 인 이유 — 공용 `AdminMonthPicker` 가 이 키로 이동한다. 우리만 `month` 로
   * 두면 그 컴포넌트를 못 쓰고 달력을 또 만들게 된다(CLAUDE.md §4a).
   */
  ym?: string;
  /**
   * 고른 건물. **반복될 수 있다**(`?property=A&property=B`, 2026-09-30 다중 선택) — Next 는 반복 키를
   * 배열로 준다. 하나면 예전과 같은 `?property=A`.
   */
  property?: string | string[];
  /** 30일 뷰의 시작일. 없으면 도쿄 기준 어제. */
  start?: string;
  cancelled?: string;
};

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export default async function OpsCalendarPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireOpsAdminPage("calendar");
  const params = await searchParams;
  const dictionary = getDictionary(session.user.preferredLanguage);
  const copy = dictionary.opsAdmin.calendar;
  const localeTag = { en: "en-US", ja: "ja-JP", ko: "ko-KR" }[session.user.preferredLanguage];

  // 「이력」 버튼의 빨간 숫자(최근 7일 전송 실패 + 멈춘 작업)도 **같이** 센다 — 달력 데이터를 다 받은
  // 뒤에 따로 세면 그만큼 화면이 늦게 온다(2026-09-30 속도).
  // 주소에 30일/월간이 없으면 이 사용자가 마지막으로 본 보기로 연다(있으면 그게 새 기억) — 대시보드 · 모바일 공용.
  const mode = await resolveOpsCalendarMode(session.user.id, params.mode);
  const [data, historyAlerts] = await Promise.all([
    getOpsCalendarData(session, {
      mode,
      month: params.ym,
      properties: parsePropertyParam(params.property),
      start: params.start,
      showCancelled: params.cancelled === "1",
    }),
    countOpsHistoryAlerts(getSupabaseServiceClient(), session.organization.id),
  ]);

  const showCancelled = params.cancelled === "1";
  const isRolling = data.mode === "rolling";

  /*
   * **보고 있는 창이 낡았으면 그 자리에서 당겨 온다.**
   *
   * 주기 동기화(GitHub Actions)가 15분으로 걸려 있는데 실제 간격이 3~5시간이다. 그 사이
   * Beds24 화면에서 가격을 바꾸면 우리 화면은 몇 시간째 옛 값이고, **그 값을 기준으로
   * 퍼센트 조정을 하게 된다.**
   *
   * `after()` 라 **응답을 보낸 뒤에** 돈다 — 화면이 느려지지 않는다. 이번 화면은 여전히 옛
   * 값이지만 다음 화면은 맞고, 그동안 얼마나 오래됐는지는 위에 적어 둔다.
   *
   * 보이는 창 + 고른 건물만 당긴다. 9건물 × 12개월은 30초에 크레딧도 그만큼 쓴다 —
   * 화면을 열 때마다 할 일이 아니다.
   */
  // 「가격 실시간 반영 중」 / 웹훅 반영이 밀렸거나 24시간 넘게 아무것도 못 받았으면 빨강 — 모바일과 같은 규칙(`ops-rates-freshness.ts`).
  const syncedLabel = opsRatesSyncedLabel({ ageMinutes: data.ratesAgeMinutes, pending: data.ratesPendingRefresh }, copy);
  const staleRates = isOpsRatesStale({ ageMinutes: data.ratesAgeMinutes, pending: data.ratesPendingRefresh });

  const firstVisibleDate = data.days.at(0)?.date;
  const lastVisibleDate = data.days.at(-1)?.date;
  // 대기 작업 깨우기 + 낡은 창 당기기 — 모바일과 같은 규칙(`ops-calendar-open-refresh.ts`).
  scheduleOpsCalendarOpenRefresh(session.organization.id, data);

  // 건물이 여럿이면 `property` 를 **반복**해 싣는다(탭 순서). 빈 목록은 키 자체를 뺀다 = 전체.
  const hrefWith = (next: Partial<SearchParams>) =>
    buildOpsCalendarHref({
      mode: data.mode,
      ym: data.mode === "monthly" ? data.month : undefined,
      property: data.selectedProperties,
      start: data.mode === "rolling" ? data.start : undefined,
      cancelled: showCancelled ? "1" : undefined,
      ...next,
    });

  const selectedSet = new Set(data.selectedProperties);
  const propertyTabs = data.propertyOptions.map((name) => ({
    href: hrefWith({ property: name }),
    name,
    selected: selectedSet.has(name),
    toggleHref: hrefWith({
      property: togglePropertySelection(data.selectedProperties, name, data.propertyOptions),
    }),
  }));

  // 30일 뷰는 ±30일, 월간 뷰는 ±1개월. **월 단위로 바꾸지 않는다** — 바꾸면 오늘이 다시
  // 격자 끝으로 밀린다.
  const prevHref = isRolling
    ? hrefWith({ start: addDays(data.start, -OPS_CALENDAR_ROLLING_DAYS) })
    : hrefWith({ ym: shiftMonthKey(data.month, -1) });
  const nextHref = isRolling
    ? hrefWith({ start: addDays(data.start, OPS_CALENDAR_ROLLING_DAYS) })
    : hrefWith({ ym: shiftMonthKey(data.month, 1) });
  // 「오늘」은 30일 뷰에서 시작일을 다시 **어제**로 돌린다(저쪽 `goToRollingToday` 와 같다).
  const todayHref = isRolling
    ? hrefWith({ start: addDays(data.today, -1) })
    : hrefWith({ ym: data.today.slice(0, 7) });

  const first = data.days.at(0);
  const last = data.days.at(-1);
  const rangeLabel = isRolling
    ? first && last
      ? `${first.date.slice(5).replace("-", "/")} → ${last.date.slice(5).replace("-", "/")}`
      : ""
    : data.month;

  return (
    <AdminShell activeItem={opsNavId("calendar")} title={copy.title}>
      {/* 이 화면이 그리는 건물·날짜(갭 판정용 앞뒤 하루 포함)에 닿는 신호만 받는다 — 다른 건물 동기화로
          다시 읽지 않는다. */}
      <Beds24LiveRefresh
        organizationId={session.organization.id}
        scope={{
          from: firstVisibleDate ? addDays(firstVisibleDate, -1) : null,
          propertyNames: data.selectedProperties.length > 0 ? data.selectedProperties : null,
          to: lastVisibleDate ? addDays(lastVisibleDate, 1) : null,
        }}
      />
      <OpsNavScope>
        {/*
          2026-10-16 화이트 리디자인(시안 Sales-PC) — 도구 줄 · 범례 · 상태 줄은 **격자가 그린다.** 「가격 수정」 ·
          「+ 수기 예약」 · 필터 · 편집 범위 바가 격자의 상태(모드 · 선택 · 반영 중)를 쥐고 있어서다. 서버가 만드는
          이동(30일/월간 · 앞뒤 · 날짜 점프 · 건물)은 여기서 만들어 자리(slot)로 넘긴다.
        */}
        {/* 격자에는 **행 단위** 데이터만 간다(`ops-calendar-rows.ts`) — 칸 이력 목록과 가격 개입 판정은
            격자가 필요할 때 서버 액션으로 따로 받는다(2026-09-30 속도). */}
        <OpsCalendarGrid
          canWrite={canWriteOpsCalendar(session)}
          cancelledHref={hrefWith({ cancelled: showCancelled ? undefined : "1" })}
          copy={copy}
          days={data.days}
          pickerLabels={{
            apply: dictionary.admin.shared.dateApply,
            nextMonth: dictionary.admin.shared.dateNextMonth,
            pickMonth: dictionary.admin.shared.datePickMonth,
            pickYear: dictionary.admin.shared.datePickYear,
            prevMonth: dictionary.admin.shared.datePrevMonth,
            reset: dictionary.admin.shared.dateReset,
            thisMonth: dictionary.admin.shared.dateThisMonth,
            typeEnd: dictionary.admin.shared.dateTypeEnd,
            typeStart: dictionary.admin.shared.dateTypeStart,
          }}
          hasRates={data.hasRates}
          historyAlerts={historyAlerts}
          navBar={
            <>
              <div className="ops__seg scw-seg">
                <OpsNavLink
                  className={`ops__segbtn${isRolling ? " on" : ""}`}
                  href={hrefWith({ mode: "rolling", start: undefined, ym: undefined })}
                >
                  {copy.viewRolling}
                </OpsNavLink>
                <OpsNavLink
                  className={`ops__segbtn${isRolling ? "" : " on"}`}
                  href={hrefWith({ mode: "monthly", start: undefined })}
                >
                  {copy.viewMonthly}
                </OpsNavLink>
              </div>
              {/*
                화살표는 30일(또는 한 달)씩 옮긴다. **먼 날짜로 가려면 여러 번 눌러야 하므로**
                라벨 자체를 달력으로 만든다. 달력은 콘솔 **공용 프리미티브**를 그대로 쓴다(CLAUDE.md §4a):
                30일 뷰는 **날짜**를 고르므로 `AdminDatePicker`, 월간 뷰는 **달**을 고르므로
                `AdminMonthPicker`. 월 선택기는 화살표를 스스로 들고 있어 그쪽에서는 우리 화살표를 접는다.
              */}
              {isRolling ? (
                <div className="scw-period">
                  <OpsNavLink aria-label={copy.prev} className="scw-arw" href={prevHref}>
                    <ChevronLeft aria-hidden="true" strokeWidth={2} />
                  </OpsNavLink>
                  <OpsCalendarJump
                    ariaLabel={dictionary.admin.shared.dateSelect}
                    display={rangeLabel}
                    labels={{
                      nextMonth: dictionary.admin.shared.dateNextMonth,
                      prevMonth: dictionary.admin.shared.datePrevMonth,
                      today: dictionary.admin.shared.dateToday,
                    }}
                    localeTag={localeTag}
                    params={{
                      cancelled: showCancelled ? "1" : undefined,
                      mode: data.mode,
                      property: data.selectedProperties,
                    }}
                    start={data.start}
                  />
                  <OpsNavLink aria-label={copy.next} className="scw-arw" href={nextHref}>
                    <ChevronRight aria-hidden="true" strokeWidth={2} />
                  </OpsNavLink>
                </div>
              ) : (
                <div className="scw-period">
                  <AdminMonthPicker
                    basePath="/admin/ops/calendar"
                    labels={{
                      nextMonth: dictionary.admin.shared.dateNextMonth,
                      nextYear: dictionary.admin.shared.dateNextYear,
                      open: dictionary.admin.shared.dateSelect,
                      prevMonth: dictionary.admin.shared.datePrevMonth,
                      prevYear: dictionary.admin.shared.datePrevYear,
                      thisMonth: dictionary.admin.shared.dateThisMonth,
                    }}
                    localeTag={localeTag}
                    preserveQueryKeys={["mode", "property", "cancelled"]}
                    ym={data.month}
                  />
                </div>
              )}
              <OpsNavLink className="scw-today" href={todayHref}>
                {copy.today}
              </OpsNavLink>
            </>
          }
          properties={data.selectedProperties}
          propertyPicker={
            /* 건물 — 그냥 누르면 그 건물만, 체크 · Ctrl/⌘ + 클릭은 여러 건물 함께(2026-09-30). */
            <OpsPropertyTabs
              allHref={hrefWith({ property: undefined })}
              copy={{
                allProperties: copy.allProperties,
                propertyAdd: copy.propertyAdd,
                propertyClear: copy.propertyClear,
                propertyGroupLabel: copy.propertyGroupLabel,
                propertyRemove: copy.propertyRemove,
                propertySelectedCount: copy.propertySelectedCount,
                propertyTabHint: copy.propertyTabHint,
                scwPropertyShow: copy.scwPropertyShow,
                scwScopeRoomsSome: copy.scwScopeRoomsSome,
              }}
              tabs={propertyTabs}
            />
          }
          rows={data.rows}
          showCancelled={showCancelled}
          status={{
            // 「N시간 전 기준」일 때만 「오래됐을 수 있음」을 붙인다(시안 SalesStates-PC ①).
            label:
              staleRates && !data.ratesPendingRefresh && data.ratesAgeMinutes !== null
                ? `${syncedLabel} · ${copy.syncedStale}`
                : syncedLabel,
            roomTotal: data.roomTotal,
            stale: staleRates,
          }}
          today={data.today}
        />
      </OpsNavScope>
    </AdminShell>
  );
}
