import { redirect } from "next/navigation";
import { LinenLoadError } from "@/components/linen-return/linen-load-error";
import { LinenLedgerPeriod } from "@/components/linen-return/linen-ledger-period";
import { LinenLedgerView } from "@/components/linen-return/linen-ledger-view";
import { SplitList } from "@/components/shell/split-list";
import "@/components/linen-return/linen-mobile.css";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getDictionary, type Locale } from "@/lib/i18n";
import {
  getActiveLinenItems,
  getCurrentTokyoYearMonth,
  getLinenLedgerRecords,
  getLinenLedgerRecordsByRange,
  isKnownBuilding,
  isValidIsoDate,
  type LinenReturnRecord,
  type TokyoYearMonth,
} from "@/lib/linen-returns";
import { clampLinenRange } from "@/lib/linen-return-rules";
import { parseLedgerPeriod } from "@/lib/linen-mobile-form";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { localizeBuildingName } from "@/lib/room-label-normalization";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";

type PageProps = {
  searchParams: Promise<{
    building?: string;
    year?: string;
    month?: string;
    startDate?: string;
    endDate?: string;
  }>;
};

function monthLabel(period: TokyoYearMonth, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    timeZone: "Asia/Tokyo",
  }).format(new Date(Date.UTC(period.year, period.month - 1, 15)));
}

function rangeLabel(start: string, end: string, locale: Locale): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" }).format(
      new Date(y, m - 1, d),
    );
  };
  return start === end ? fmt(start) : `${fmt(start)} ~ ${fmt(end)}`;
}

export default async function LinenReturnLedgerPage({ searchParams }: PageProps) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  const building = (params.building ?? "").trim();

  if (state.status === "unauthenticated") {
    redirect(
      `/auth/login?next=${encodeURIComponent(`/mobile/linen-return/ledger?building=${encodeURIComponent(building)}`)}`,
    );
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }
  if (!building || !(await isKnownBuilding(session, building))) {
    redirect("/mobile/linen-return");
  }

  const locale = session.user.preferredLanguage;
  const dict = getDictionary(locale);
  const copy = dict.linenReturn;
  const buildingLabel = localizeBuildingName(building, dict.cleaning.buildingLabels);

  const current = getCurrentTokyoYearMonth();
  const startDate = (params.startDate ?? "").trim();
  const endDate = (params.endDate ?? "").trim();
  const rangeMode = isValidIsoDate(startDate) && isValidIsoDate(endDate);

  let records: LinenReturnRecord[];
  let periodLabel: string;
  let baseMonth: TokyoYearMonth;
  let rangeValue: { startDate?: string; endDate?: string };
  let periodKey: string;
  let loadFailed = false;

  if (rangeMode) {
    // 거꾸로면 바로잡고, 366일을 넘으면 끝 날짜 기준으로 자른다(서버 공용 규칙).
    const { from: s, to: e } = clampLinenRange(startDate, endDate);
    records = [];
    try {
      records = await getLinenLedgerRecordsByRange(session, building, s, e);
    } catch {
      loadFailed = true;
    }
    periodKey = `${s}~${e}`;
    periodLabel = rangeLabel(s, e, locale);
    baseMonth = { year: Number(s.slice(0, 4)), month: Number(s.slice(5, 7)) };
    rangeValue = { startDate: s, endDate: e };
  } else {
    const period: TokyoYearMonth = parseLedgerPeriod(params.year, params.month, current);
    records = [];
    try {
      records = await getLinenLedgerRecords(session, building, period);
    } catch {
      loadFailed = true;
    }
    periodKey = `${period.year}-${period.month}`;
    periodLabel = monthLabel(period, locale);
    baseMonth = period;
    rangeValue = {};
  }

  let catalog: Awaited<ReturnType<typeof getActiveLinenItems>> = [];
  try {
    catalog = await getActiveLinenItems(session, building);
  } catch {
    loadFailed = true;
  }
  const navBadges = await navBadgesPromise.catch(() => undefined);
  const retryHref = rangeMode
    ? `/mobile/linen-return/ledger?building=${encodeURIComponent(building)}&startDate=${startDate}&endDate=${endDate}`
    : `/mobile/linen-return/ledger?building=${encodeURIComponent(building)}&year=${baseMonth.year}&month=${baseMonth.month}`;
  // 현재 도쿄 월 이후의 미래로는 넘기지 못하게 한다.
  const canGoNext =
    baseMonth.year < current.year ||
    (baseMonth.year === current.year && baseMonth.month < current.month);

  if (loadFailed) {
    return (
      <MobileShell activeItem="linen-return" badges={navBadges} title={copy.ledgerTitle}>
        <LinenLoadError copy={copy} retryHref={retryHref} />
      </MobileShell>
    );
  }

  return (
    // 넓은 화면(2026-10-05): 태블릿 가로는 왼쪽 장부 · 오른쪽 그 기록의 상세 칸(`SplitList` — 린넨 기록 목록과 같다).
    <MobileShell activeItem="linen-return" badges={navBadges} split title={copy.ledgerTitle}>
      <SplitList detail="linen">
      {/* 화이트 리디자인(2026-10-14, 시안 LinenLedger-Phone): 건물 · 「장부」 + 달 이동(가운데 누르면 기간 고르기). */}
      <div className="lnw">
        <div className="lnw-ledger-head">
          <div className="lnw-head">
            <span className="lnw-kick">{buildingLabel}</span>
            <h1 className="lnw-title">{copy.ledgerTitle}</h1>
          </div>

          <LinenLedgerPeriod
            building={building}
            canGoNext={canGoNext}
            copy={copy}
            label={periodLabel}
            locale={locale}
            month={baseMonth.month}
            range={rangeValue}
            year={baseMonth.year}
          />
        </div>

        <LinenLedgerView
          key={periodKey}
          building={building}
          copy={copy}
          currentUserId={session.user.id}
          locale={locale}
          records={records}
          catalog={catalog}
        />
      </div>
      </SplitList>
    </MobileShell>
  );
}
