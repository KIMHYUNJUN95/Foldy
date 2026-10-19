import { redirect } from "next/navigation";
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
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { localizePropertyName } from "@/lib/room-label-normalization";
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
  const buildingLabel = localizePropertyName(building, dict.cleaning.buildingLabels);

  const current = getCurrentTokyoYearMonth();
  const startDate = (params.startDate ?? "").trim();
  const endDate = (params.endDate ?? "").trim();
  const rangeMode = isValidIsoDate(startDate) && isValidIsoDate(endDate);

  let records: LinenReturnRecord[];
  let periodLabel: string;
  let baseMonth: TokyoYearMonth;
  let rangeValue: { startDate?: string; endDate?: string };

  if (rangeMode) {
    const [s, e] = startDate <= endDate ? [startDate, endDate] : [endDate, startDate];
    records = await getLinenLedgerRecordsByRange(session, building, s, e);
    periodLabel = rangeLabel(s, e, locale);
    baseMonth = { year: Number(s.slice(0, 4)), month: Number(s.slice(5, 7)) };
    rangeValue = { startDate: s, endDate: e };
  } else {
    const year = Number(params.year);
    const month = Number(params.month);
    const period: TokyoYearMonth =
      Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12
        ? { year, month }
        : current;
    records = await getLinenLedgerRecords(session, building, period);
    periodLabel = monthLabel(period, locale);
    baseMonth = period;
    rangeValue = {};
  }

  const [navBadges, catalog] = await Promise.all([navBadgesPromise, getActiveLinenItems(session, building)]);
  // Do not allow paging into the future beyond the current Tokyo month.
  const canGoNext =
    baseMonth.year < current.year ||
    (baseMonth.year === current.year && baseMonth.month < current.month);

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
