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
import { defaultReviewRange } from "@/lib/external-review-pages";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { AppSession } from "@/lib/session";
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

/**
 * 머리의 «미처리 N» — 목록 전체(+작성자 조회)를 읽지 않고 건수만 센다. RLS 서버 클라이언트 + 조직
 * 필터로 `listComplaints` 와 같은 범위다. 실패하면 0(목록 쪽 `listComplaints` 가 실패 시 빈 배열인 것과 같다).
 */
async function countOpenComplaints(session: AppSession & { organization: { id: string } }): Promise<number> {
  const supabase = await getSupabaseServerClient();
  const { count, error } = await supabase
    .from("customer_complaints")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", session.organization.id)
    .eq("status", "open");
  return error ? 0 : count ?? 0;
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
  // 기본 기간 — 최근 90일(오늘 포함, 도쿄 날짜). 리뷰 · 건물 · 객실별 · PC 콘솔 공통.
  const fallback = defaultReviewRange();
  const from = isDate(params.from) ? params.from! : fallback.from;
  const to = isDate(params.to) ? params.to! : fallback.to;
  const rangeDays = matchPresetDays(from, to);
  const canCreate = canWriteComplaint(session.user.role);

  // 보기마다 필요한 쿼리를 배지 · 미처리 건수와 같은 단계에서 시작한다(직렬로 기다리지 않는다).
  const navBadgesPromise = getMobileNavBadges();
  const complaintsPromise = view === "manual" ? listComplaints({ session }) : null;
  const openCountPromise = complaintsPromise
    ? complaintsPromise.then((list) => list.filter((c) => c.status === "open").length)
    : countOpenComplaints(session);
  const summariesPromise = view === "manual" ? null : summarizeReviewsByPlace({ session, from, to, locale });

  const head = (openCount: number, baseParams: Record<string, string>, withRange: boolean) => (
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
    const [navBadges, openCount, summaries] = await Promise.all([navBadgesPromise, openCountPromise, summariesPromise!]);
    const by = params.by === "room" ? "room" : "building";
    return (
      <MobileShell activeItem="complaints" badges={navBadges} title={dict.complaints.pageTitle} split>
        <SplitList detail="complaints">
          {head(openCount, by === "room" ? { view, by } : { view }, true)}
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

    // 목록은 건물 마스터만 기다린다. 객실(rl)을 고른 경우에만 그 건물의 객실 목록(집계)도 기다린다.
    const buildingOptionsPromise = listReviewBuildingOptions({ session, locale });
    const listPromise = buildingOptionsPromise.then(async (buildingOptions) => {
      const building = buildingOptions.find((option) => option.value === params.building?.trim()) ?? null;
      let roomOptions: string[] = [];
      let roomLabel: string | null = null;
      if (building && params.rl?.trim()) {
        const buildingSummary =
          (await summariesPromise!).find((summary) => getCanonicalPropertyName(summary.name) === building.value) ?? null;
        roomOptions = buildingSummary ? buildingSummary.rooms.map((room) => room.name) : [];
        roomLabel = roomOptions.includes(params.rl.trim()) ? params.rl.trim() : null;
      }
      const filter: ReviewListFilter = {
        provider,
        riskOnly,
        unmappedOnly: params.unmapped === "1",
        propertyIds: building?.propertyIds,
        from,
        to,
      };
      // 객실은 표시 라벨로 거른다(같은 방을 두 Beds24 어카운트가 나눠 쓴다) — 건물을 고른 뒤라 건수가 작아 메모리에서 쪽을 나눈다.
      if (roomLabel) {
        const all = (await listExternalReviews({ session, filter })).filter((review) => review.displayRoomLabel === roomLabel);
        return {
          building,
          roomLabel,
          rows: all.slice((page - 1) * REVIEW_PAGE_SIZE, page * REVIEW_PAGE_SIZE),
          total: all.length,
        };
      }
      return { building, roomLabel, ...(await listExternalReviewPage({ session, filter, page, pageSize: REVIEW_PAGE_SIZE })) };
    });

    const [navBadges, openCount, buildingOptions, summaries, reviewSync, { building, roomLabel, rows, total }] = await Promise.all([
      navBadgesPromise,
      openCountPromise,
      buildingOptionsPromise,
      summariesPromise!,
      // 「지금 가져오기」 — 작성 권한자에게만(서버 액션이 같은 권한을 다시 본다).
      canSync ? getReviewSyncStatus(getSupabaseServiceClient(), session.organization.id) : Promise.resolve(null),
      listPromise,
    ]);
    const buildingSummary = building
      ? summaries.find((summary) => getCanonicalPropertyName(summary.name) === building.value) ?? null
      : null;
    const roomOptions = buildingSummary ? buildingSummary.rooms.map((room) => room.name) : [];

    const keep: Record<string, string> = { view };
    if (provider) keep.provider = provider;
    if (riskOnly) keep.risk = "1";
    if (building) keep.building = building.value;
    if (roomLabel) keep.rl = roomLabel;

    return (
      <MobileShell activeItem="complaints" badges={navBadges} title={dict.complaints.pageTitle} split>
        <SplitList detail="complaints">
          {head(openCount, keep, true)}
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

  const [navBadges, openCount, complaints] = await Promise.all([navBadgesPromise, openCountPromise, complaintsPromise!]);
  return (
    <MobileShell activeItem="complaints" badges={navBadges} title={dict.complaints.pageTitle} split>
      <SplitList detail="complaints">
        {head(openCount, { view }, false)}
        <ComplaintList locale={locale} complaints={complaints} />
      </SplitList>
    </MobileShell>
  );
}
