import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { SplitList } from "@/components/shell/split-list";
import { ComplaintList } from "@/components/complaints/complaint-list";
import { FeedbackHead } from "@/components/complaints/feedback-head";
import {
  ReviewList,
  REVIEW_PAGE_SIZE,
  RANGE_PRESET_DAYS,
  type ReviewStats,
} from "@/components/complaints/review-list";
import { ReviewRoomsBoard } from "@/components/complaints/review-rooms-board";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getDictionary } from "@/lib/i18n";
import { getReviewSyncStatus } from "@/lib/beds24/reviews-sync-manual";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { listComplaints, canWriteComplaint } from "@/lib/complaints";
import { tokyoToday, ymdShift } from "@/lib/tokyo-date";
import { getCanonicalPropertyName } from "@/lib/room-label-normalization";
import {
  listExternalReviewPage,
  listExternalReviews,
  listReviewBuildingOptions,
  summarizeReviewsByPlace,
  type BuildingSummary,
  type ReviewListFilter,
  type ReviewProvider,
} from "@/lib/external-reviews";

// 세션 쿠키를 읽어 어차피 동적이지만, «지금»(기본 기간 계산)에 의존하므로 명시한다.
export const dynamic = "force-dynamic";

/** 기본 기간 — 최근 90일(오늘 포함, 도쿄 날짜). 리뷰 · 건물 · 객실별 공통(PC 콘솔과 같다, 화이트 리디자인 2026-10-14). */
function defaultRange(): { from: string; to: string } {
  const to = tokyoToday();
  return { from: ymdShift(to, -89), to };
}

/** 프리셋과 정확히 맞을 때만 «최근 N일» 로 쓴다. */
function matchPresetDays(from: string, to: string): number | null {
  if (to !== tokyoToday()) return null;
  return RANGE_PRESET_DAYS.find((days) => from === ymdShift(to, -(days - 1))) ?? null;
}

/** 기간 · 플랫폼 전체 평균 — 건물 집계를 리뷰 수로 가중(PC 콘솔과 같은 계산). */
function statsOf(summaries: BuildingSummary[]): ReviewStats {
  const of = (key: "airbnb" | "booking") => {
    let sum = 0;
    let n = 0;
    for (const building of summaries) {
      const stat = building[key];
      if (stat.average !== null) {
        sum += stat.average * stat.reviewCount;
        n += stat.reviewCount;
      }
    }
    return n ? sum / n : null;
  };
  return { airbnb: of("airbnb"), booking: of("booking"), risk: summaries.reduce((acc, b) => acc + b.riskCount, 0) };
}

type PageProps = {
  searchParams: Promise<{
    view?: string;
    provider?: string;
    risk?: string;
    page?: string;
    /** 객실 미연결 리뷰만 보기. */
    unmapped?: string;
    /** 정규화 건물명 · 표시 객실 라벨(화이트 리디자인 2026-10-14). */
    building?: string;
    rl?: string;
    /** 건물 · 객실별 집계 단위. */
    by?: string;
    /** 포함 (YYYY-MM-DD) */
    from?: string;
    to?: string;
  }>;
};

// 게스트 피드백 — 보기 셋(외부 리뷰 / 수동 컴플레인 / 건물 · 객실별). 화이트 리디자인(2026-10-14, 시안 FB-Phone 외).
// See docs/product/25-complaint-workflow.md → 「화이트 리디자인」, docs/product/16-mobile-navigation.md.
// 외부 리뷰의 고르기 · 쪽은 전부 쿼리스트링이고 서버에서 거른다(누락 없음).
export default async function MobileComplaintsPage({ searchParams }: PageProps) {
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/complaints")}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const view = params.view === "manual" || params.view === "rooms" ? params.view : "reviews";
  const locale = session.user.preferredLanguage;
  const dict = getDictionary(locale);
  const isDate = (v?: string) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));
  const fallback = defaultRange();
  const from = isDate(params.from) ? params.from! : fallback.from;
  const to = isDate(params.to) ? params.to! : fallback.to;
  const rangeDays = matchPresetDays(from, to);
  const canCreate = canWriteComplaint(session.user.role);

  const [navBadges, complaints] = await Promise.all([getMobileNavBadges(), listComplaints({ session })]);
  const openCount = complaints.filter((c) => c.status === "open").length;

  const head = (baseParams: Record<string, string>, withRange: boolean) => (
    <FeedbackHead
      locale={locale}
      view={view}
      openCount={openCount}
      canCreate={canCreate}
      range={withRange ? { from, to, days: rangeDays } : null}
      baseParams={baseParams}
    />
  );

  if (view === "rooms") {
    const summaries = await summarizeReviewsByPlace({ session, from, to, locale });
    const by = params.by === "room" ? "room" : "building";
    return (
      <MobileShell activeItem="complaints" badges={navBadges} title={dict.complaints.pageTitle} split>
        <SplitList detail="complaints">
          {head(by === "room" ? { view, by } : { view }, true)}
          <ReviewRoomsBoard locale={locale} summaries={summaries} from={from} to={to} by={by} />
        </SplitList>
      </MobileShell>
    );
  }

  if (view === "reviews") {
    const provider: ReviewProvider | undefined =
      params.provider === "airbnb" || params.provider === "booking" ? params.provider : undefined;
    const riskOnly = params.risk === "1";
    const page = Math.max(Number(params.page ?? "1") || 1, 1);
    const canSync = canWriteComplaint(session.user.role);

    const [buildingOptions, summaries, reviewSync] = await Promise.all([
      listReviewBuildingOptions({ session, locale }),
      summarizeReviewsByPlace({ session, from, to, locale }),
      // 「지금 가져오기」 — 작성 권한자에게만(서버 액션이 같은 권한을 다시 본다).
      canSync ? getReviewSyncStatus(getSupabaseServiceClient(), session.organization.id) : Promise.resolve(null),
    ]);
    const building = buildingOptions.find((option) => option.value === params.building?.trim()) ?? null;
    const buildingSummary = building
      ? summaries.find((summary) => getCanonicalPropertyName(summary.name) === building.value) ?? null
      : null;
    const roomOptions = buildingSummary ? buildingSummary.rooms.map((room) => room.name) : [];
    const roomLabel = building && params.rl?.trim() && roomOptions.includes(params.rl.trim()) ? params.rl.trim() : null;

    const filter: ReviewListFilter = {
      provider,
      riskOnly,
      unmappedOnly: params.unmapped === "1",
      propertyIds: building?.propertyIds,
      from,
      to,
    };

    // 객실은 표시 라벨로 거른다(같은 방을 두 Beds24 어카운트가 나눠 쓴다) — 건물을 고른 뒤라 건수가 작아 메모리에서 쪽을 나눈다.
    let rows;
    let total;
    if (roomLabel) {
      const all = (await listExternalReviews({ session, filter })).filter((review) => review.displayRoomLabel === roomLabel);
      total = all.length;
      rows = all.slice((page - 1) * REVIEW_PAGE_SIZE, page * REVIEW_PAGE_SIZE);
    } else {
      ({ rows, total } = await listExternalReviewPage({ session, filter, page, pageSize: REVIEW_PAGE_SIZE }));
    }

    const keep: Record<string, string> = { view };
    if (provider) keep.provider = provider;
    if (riskOnly) keep.risk = "1";
    if (building) keep.building = building.value;
    if (roomLabel) keep.rl = roomLabel;

    return (
      <MobileShell activeItem="complaints" badges={navBadges} title={dict.complaints.pageTitle} split>
        <SplitList detail="complaints">
          {head(keep, true)}
          <ReviewList
            locale={locale}
            reviews={rows}
            total={total}
            page={page}
            provider={provider ?? "all"}
            riskOnly={riskOnly}
            from={from}
            to={to}
            building={building?.value ?? null}
            roomLabel={roomLabel}
            buildingOptions={buildingOptions.map(({ value, label }) => ({ value, label }))}
            roomOptions={roomOptions}
            stats={statsOf(summaries)}
            reviewSync={reviewSync}
          />
        </SplitList>
      </MobileShell>
    );
  }

  return (
    <MobileShell activeItem="complaints" badges={navBadges} title={dict.complaints.pageTitle} split>
      <SplitList detail="complaints">
        {head({ view }, false)}
        <ComplaintList locale={locale} complaints={complaints} />
      </SplitList>
    </MobileShell>
  );
}
