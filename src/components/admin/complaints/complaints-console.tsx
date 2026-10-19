import { LiveWash } from "@/components/shared/live-wash";
import Link from "next/link";
import { ChevronRight, MessageSquareWarning, Star } from "lucide-react";
import { ReviewSyncButton, type ReviewSyncButtonLabels } from "@/components/complaints/review-sync-button";
import type { ReviewSyncStatus } from "@/lib/beds24/reviews-sync-manual";
import { ReviewDetailPanel, type ReviewPanelLabels } from "@/components/admin/complaints/review-detail-panel";
import { ReviewDetailOverlay } from "@/components/admin/complaints/review-detail-overlay";
import { ManualComplaintList } from "@/components/admin/complaints/manual-complaint-list";
import { ComplaintDetailPanel } from "@/components/admin/complaints/complaint-detail-panel";
import { ComplaintCreateLauncher } from "@/components/admin/complaints/complaint-create-launcher";
import { ComplaintsViewbar, type ViewbarSelect } from "@/components/admin/complaints/complaints-viewbar";
import { PLATFORMS, type ComplaintPlatform } from "@/components/complaints/cx-platform";
import type { PlacePickRow, ReservationPickRow } from "@/lib/complaint-reservations";
import type { Complaint, ComplaintComment } from "@/lib/complaints";
import type {
  BuildingSummary,
  ExternalReview,
  ExternalReviewDetail,
  PlaceSummary,
  PlatformStat,
  ReviewListFilter,
} from "@/lib/external-reviews";
import { reviewRoomFallbackLabel } from "@/lib/external-review-rules";
import { REVIEW_SCALE } from "@/lib/external-reviews";
import { REVIEW_LIST_STEP } from "@/lib/external-review-pages";
import type { TranslationPart } from "@/lib/review-translate";
import type { Dictionary, Locale } from "@/lib/i18n";
import { tokyoDateOf } from "@/lib/tokyo-date";
import { getCanonicalPropertyName, localizePropertyName } from "@/lib/room-label-normalization";
import "./complaints-console.css";

// 게스트 피드백 콘솔 — 화이트 리디자인(2026-10-14, 시안 FB-PC · FBManual-PC · FBNewCx-PC · FBDelete-PC ·
// FBRooms-PC · FBRoomsByRoom-PC). 보기 셋(외부 리뷰 · 수동 컴플레인 · 건물 · 객실별)은 그대로, 상태는 전부
// 쿼리스트링이고 서버 렌더 한 번으로 끝난다. 상자 · 세로 구분선 없이 줄만 쓴다.
// 도메인 계약: docs/product/25-complaint-workflow.md → 「화이트 리디자인」.

type ConsoleView = "manual" | "reviews" | "rooms";
type Option = { value: string; label: string };

type Props = {
  copy: Dictionary["complaints"];
  sharedCopy: Dictionary["admin"]["shared"];
  /** `dictionary.cleaning.buildingLabels` — 캘린더·청소 콘솔과 같은 건물 표기. */
  buildingLabels: Record<string, string>;
  locale: Locale;
  view: ConsoleView;
  from: string;
  to: string;
  filter: ReviewListFilter;
  complaints: Complaint[];
  comments: ComplaintComment[];
  canComment: boolean;
  canChangeSelectedStatus: boolean;
  currentUserId: string;
  canModerate: boolean;
  canWrite: boolean;
  createReservations: ReservationPickRow[];
  createPlaces: PlacePickRow[];
  reviews: ExternalReview[];
  /** 필터를 적용한 전체 리뷰 수 — `reviews` 는 그중 앞쪽 일부만 담는다. */
  reviewTotal: number;
  /** 목록에 펼친 리뷰 수 한도(`?n=`). 필터를 바꾸면 기본값으로 돌아간다. */
  reviewLimit: number;
  summaries: BuildingSummary[];
  buildingOptions: Option[];
  building: string | null;
  roomLabel: string | null;
  roomsBy: "building" | "room";
  roomsSort: "ratio" | "count";
  manualStatus: "all" | "open" | "done";
  manualPlatform: string;
  manualAuthor: string;
  selectedReview: ExternalReviewDetail | null;
  selectedComplaint: Complaint | null;
  showTranslation: boolean;
  translations: Partial<Record<TranslationPart, string>>;
  canConvert: boolean;
  panelLabels: ReviewPanelLabels;
  reviewSync: (ReviewSyncStatus & { labels: ReviewSyncButtonLabels }) | null;
};

const LOCALE_TAG: Record<Locale, string> = { ko: "ko-KR", ja: "ja-JP", en: "en-US" };
const PROVIDER_LABEL: Record<"airbnb" | "booking", string> = { airbnb: "Airbnb", booking: "Booking.com" };

function fill(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((acc, [key, value]) => acc.replaceAll(`{${key}}`, String(value)), template);
}

/** 도쿄 날짜 기준 «M/D». */
function md(iso: string | null): string {
  const day = tokyoDateOf(iso);
  return day ? `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}` : "—";
}

export function platformName(platform: ComplaintPlatform, copy: Dictionary["complaints"]): string {
  if (platform === "direct") return copy.platformDirect;
  if (platform === "other") return copy.platformOther;
  return PLATFORMS[platform]?.name ?? platform;
}

/** 기간 · 플랫폼 전체 평균 — 건물 집계를 리뷰 수로 가중해 합친다(척도가 다른 두 플랫폼은 섞지 않는다). */
function overall(summaries: BuildingSummary[], key: "airbnb" | "booking") {
  let sum = 0;
  let n = 0;
  let risk = 0;
  let reviews = 0;
  for (const building of summaries) {
    const stat = building[key];
    if (stat.average !== null) {
      // average 는 점수가 있는 리뷰만의 평균이다 — 가중치도 그만큼(리뷰 수 − 미평가)이 맞지만 집계에 미평가 수가
      // 플랫폼별로 없어 리뷰 수로 근사한다. 평균 자체는 소수 한 자리로만 보여 차이가 드러나지 않는다.
      sum += stat.average * stat.reviewCount;
      n += stat.reviewCount;
    }
    risk += stat.riskCount;
    reviews += stat.reviewCount;
  }
  return { average: n ? sum / n : null, risk, reviews };
}

function PlatformCell({ stat, copy, digits }: { stat: PlatformStat; copy: Dictionary["complaints"]; digits: number }) {
  if (stat.reviewCount === 0) return <span className="cxw-rc is-none">{copy.wNoReviews}</span>;
  return (
    <span className="cxw-rc num">
      <b>{stat.average === null ? "—" : stat.average.toFixed(digits)}</b>
      <span>{` / ${fill(copy.wCountN, { n: stat.reviewCount })} / `}</span>
      <b className={stat.riskCount > 0 ? "is-bad" : "is-zero"}>{fill(copy.wCountN, { n: stat.riskCount })}</b>
    </span>
  );
}

function RatioCell({ place, href }: { place: PlaceSummary; href: string | null }) {
  const ratio = place.riskRatio ?? 0;
  const hot = ratio >= 20;
  const pct = place.riskRatio === null ? "—" : `${Math.round(ratio)}%`;
  return (
    <>
      <span className="cxw-bar" aria-hidden="true">
        <i className={hot ? "is-hot" : ""} style={{ width: `${Math.min(100, ratio)}%` }} />
      </span>
      {href && place.riskCount > 0 ? (
        <Link href={href} className={`cxw-pct num${hot ? " is-hot" : ""}`} scroll={false}>
          {pct}
        </Link>
      ) : (
        <span className={`cxw-pct num${hot ? " is-hot" : ""}${ratio === 0 ? " is-zero" : ""}`}>{pct}</span>
      )}
    </>
  );
}

export function ComplaintsConsole(props: Props) {
  const {
    copy,
    sharedCopy,
    buildingLabels,
    locale,
    view,
    from,
    to,
    filter,
    complaints,
    summaries,
    buildingOptions,
    building,
    roomLabel,
    selectedReview,
    selectedComplaint,
  } = props;

  const openComplaints = complaints.filter((complaint) => complaint.status === "open").length;
  const airbnb = overall(summaries, "airbnb");
  const booking = overall(summaries, "booking");

  // 주소에 실리는 현재 상태 — 고르기 · 탭 · 패널 열기가 모두 여기서 시작한다.
  const query: Record<string, string> = {};
  const put = (key: string, value: string | null | undefined) => {
    if (value && value !== "all") query[key] = value;
  };
  put("view", view);
  put("from", from);
  put("to", to);
  put("provider", filter.provider);
  put("risk", filter.riskOnly ? "1" : null);
  put("building", building);
  put("rl", roomLabel);
  put("by", props.roomsBy === "room" ? "room" : null);
  put("sort", props.roomsSort === "count" ? "count" : null);
  put("st", props.manualStatus);
  put("mp", props.manualPlatform);
  put("author", props.manualAuthor);

  const href = (patch: Record<string, string | null | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...query, ...patch })) {
      if (value && value !== "all") next.set(key, value);
    }
    const text = next.toString();
    return `/admin/complaints${text ? `?${text}` : ""}`;
  };

  // 패널을 열고 닫아도 펼쳐 둔 목록이 접히지 않게 한도를 유지한다.
  const keepLimit = props.reviewLimit > REVIEW_LIST_STEP ? String(props.reviewLimit) : null;
  const closeHref = href({ n: keepLimit });
  const reviewHref = (reviewId: string) => href({ review: reviewId, n: keepLimit });
  const complaintHref = (complaintId: string) => href({ view: "manual", complaint: complaintId, st: null, mp: null, author: null });

  const buildingLabelOf = (name: string | null) =>
    name ? localizePropertyName(getCanonicalPropertyName(name), buildingLabels) : "—";

  // 건물을 골랐을 때만 객실 고르기 — 집계에서 그 건물의 객실 이름을 쓴다(리뷰 목록과 같은 표시 라벨).
  const summaryOfBuilding = building
    ? summaries.find((summary) => getCanonicalPropertyName(summary.name) === building) ?? null
    : null;

  const rangeLabels = {
    prevMonth: sharedCopy.datePrevMonth,
    nextMonth: sharedCopy.dateNextMonth,
    thisMonth: sharedCopy.dateThisMonth,
    reset: sharedCopy.dateReset,
    typeStart: sharedCopy.dateTypeStart,
    typeEnd: sharedCopy.dateTypeEnd,
    pickYear: sharedCopy.datePickYear,
    pickMonth: sharedCopy.datePickMonth,
    apply: sharedCopy.dateApply,
  };

  const buildingSelect: ViewbarSelect = {
    param: "building",
    value: building ?? "all",
    ariaLabel: copy.metaBuilding,
    resets: ["rl"],
    options: [{ value: "all", label: copy.allBuildings }, ...buildingOptions],
  };

  const selects: ViewbarSelect[] = [];
  let trailing: React.ReactNode = null;
  if (view === "reviews") {
    selects.push(buildingSelect);
    if (summaryOfBuilding && summaryOfBuilding.rooms.length > 0) {
      selects.push({
        param: "rl",
        value: roomLabel ?? "all",
        ariaLabel: copy.metaRoom,
        options: [
          { value: "all", label: copy.wAllRooms },
          ...summaryOfBuilding.rooms.map((room) => ({ value: room.name, label: room.name })),
        ],
      });
    }
    trailing = props.reviewSync ? (
      <ReviewSyncButton
        availableAt={props.reviewSync.availableAt}
        labels={props.reviewSync.labels}
        lastSyncedAt={props.reviewSync.lastSyncedAt}
        localeTag={LOCALE_TAG[locale]}
        running={props.reviewSync.running}
        variant="admin"
      />
    ) : null;
  } else if (view === "manual") {
    const platforms = [...new Set(complaints.map((complaint) => complaint.platform))];
    const authors = new Map(complaints.map((complaint) => [complaint.createdByUserId, complaint.authorName]));
    selects.push(
      {
        param: "mp",
        value: props.manualPlatform,
        ariaLabel: copy.wPlatform,
        options: [
          { value: "all", label: copy.allPlatforms },
          ...platforms.map((platform) => ({ value: platform, label: platformName(platform, copy) })),
        ],
      },
      buildingSelect,
      {
        param: "author",
        value: props.manualAuthor,
        ariaLabel: copy.authorLabel,
        options: [
          { value: "all", label: copy.wAllAuthors },
          ...[...authors.entries()].map(([id, name]) => ({ value: id, label: name || "—" })),
        ],
      },
    );
    trailing = props.canWrite ? (
      <ComplaintCreateLauncher
        label={copy.createAction}
        reservations={props.createReservations}
        places={props.createPlaces}
        labels={{
          createTitle: copy.wCreateTitle,
          createSub: copy.wCreateSub,
          fieldPlatform: copy.wPlatform,
          fieldRating: copy.fieldRating,
          fieldTitle: copy.fieldTitle,
          fieldBody: copy.wContent,
          fieldBodyPlaceholder: copy.fieldBodyPlaceholder,
          fieldLink: copy.wWhere,
          fieldGuestName: copy.fieldGuestName,
          fieldGuestPlaceholder: copy.fieldGuestPlaceholder,
          fieldImages: copy.photosTitle,
          imagesMax: copy.imagesMax,
          submit: copy.wSubmit,
          required: copy.required,
          optional: copy.wOptional,
          cancel: copy.cancel,
          close: props.panelLabels.close,
          linkModeReservation: copy.wLinkReservation,
          linkModePlace: copy.linkModePlace,
          linkModeNone: copy.linkModeNone,
          linkModeHint: copy.wLinkHint,
          pickBuilding: copy.pickBuilding,
          pickRoom: copy.pickRoom,
          pickerSearch: copy.pickerSearch,
          pickerStaying: copy.pickerStaying,
          pickerUpcoming: copy.pickerUpcoming,
          pickerLiveTag: copy.pickerLiveTag,
          ratingNone: copy.ratingNone,
          titleRequired: copy.titleRequired,
          createFailed: copy.createFailed,
          platformDirect: copy.platformDirect,
        }}
      />
    ) : null;
  } else {
    selects.push({
      param: "sort",
      value: props.roomsSort,
      ariaLabel: copy.sortRatio,
      options: [
        { value: "ratio", label: copy.sortRatio },
        { value: "count", label: copy.wSortCount },
      ],
    });
  }

  const tabs = [
    { id: "reviews", label: copy.viewReviews, href: href({ view: "reviews", st: null, mp: null, author: null, by: null, sort: null }) },
    { id: "manual", label: copy.viewManual, count: openComplaints, href: href({ view: "manual", provider: null, risk: null, rl: null, by: null, sort: null }) },
    { id: "rooms", label: copy.viewRooms, href: href({ view: "rooms", provider: null, risk: null, building: null, rl: null, st: null, mp: null, author: null }) },
  ];

  return (
    <div className="cxw">
      <ComplaintsViewbar
        tabs={tabs}
        activeTab={view}
        query={query}
        range={view === "manual" ? null : { from, to }}
        rangeLabels={rangeLabels}
        rangeAria={sharedCopy.pickRange}
        localeTag={LOCALE_TAG[locale]}
        selects={selects}
        trailing={
          view === "rooms" ? (
            <div className="cxw-seg" role="radiogroup" aria-label={copy.viewRooms}>
              <Link href={href({ by: null })} role="radio" aria-checked={props.roomsBy === "building"} className={props.roomsBy === "building" ? "on" : ""} scroll={false}>
                {copy.wByBuilding}
              </Link>
              <Link href={href({ by: "room" })} role="radio" aria-checked={props.roomsBy === "room"} className={props.roomsBy === "room" ? "on" : ""} scroll={false}>
                {copy.wByRoom}
              </Link>
            </div>
          ) : (
            trailing
          )
        }
      />

      {view === "reviews" ? (
        <ReviewsView
          {...props}
          airbnb={airbnb}
          booking={booking}
          openComplaints={openComplaints}
          href={href}
          reviewHref={reviewHref}
          buildingLabelOf={buildingLabelOf}
        />
      ) : null}

      {view === "manual" ? (
        <ManualView {...props} complaintHref={complaintHref} href={href} buildingLabelOf={buildingLabelOf} />
      ) : null}

      {view === "rooms" ? <RoomsView {...props} href={href} /> : null}

      {selectedReview ? (
        <ReviewDetailOverlay closeHref={closeHref}>
          <ReviewDetailPanel
            review={selectedReview}
            copy={copy}
            buildingLabels={buildingLabels}
            labels={props.panelLabels}
            closeHref={closeHref}
            showTranslation={props.showTranslation}
            originalHref={reviewHref(selectedReview.id)}
            translateRedirectTo={href({ review: selectedReview.id, tr: "1" })}
            translations={props.translations}
            canConvert={props.canConvert}
            convertRedirectTo={reviewHref(selectedReview.id)}
            linkedComplaintHref={selectedReview.linkedComplaintId ? complaintHref(selectedReview.linkedComplaintId) : null}
          />
        </ReviewDetailOverlay>
      ) : null}

      {selectedComplaint ? (
        <ReviewDetailOverlay closeHref={closeHref}>
          <ComplaintDetailPanel
            complaint={selectedComplaint}
            comments={props.comments}
            copy={copy}
            buildingLabels={buildingLabels}
            labels={props.panelLabels}
            closeHref={closeHref}
            canComment={props.canComment}
            canChangeStatus={props.canChangeSelectedStatus}
            canDelete={props.canModerate || selectedComplaint.createdByUserId === props.currentUserId}
            linkedReviewHref={null}
          />
        </ReviewDetailOverlay>
      ) : null}
    </div>
  );
}

// ── 외부 리뷰 ─────────────────────────────────────────────

function ReviewsView({
  copy,
  filter,
  reviews,
  reviewTotal,
  reviewLimit,
  airbnb,
  booking,
  openComplaints,
  href,
  reviewHref,
  buildingLabelOf,
  selectedReview,
}: Props & {
  airbnb: ReturnType<typeof overall>;
  booking: ReturnType<typeof overall>;
  openComplaints: number;
  href: (patch: Record<string, string | null | undefined>) => string;
  reviewHref: (id: string) => string;
  buildingLabelOf: (name: string | null) => string;
}) {
  return (
    <>
      <div className="wkpis cxw-kpis">
        <div className="wkpi">
          <span className="wkpi__k">{copy.wKpiAirbnbAvg}</span>
          <span className="wkpi__v">
            {airbnb.average === null ? "—" : airbnb.average.toFixed(2)}
            <small>/ 5</small>
          </span>
          <span className="wkpi__d">{fill(copy.wKpiReviews, { n: airbnb.reviews })}</span>
        </div>
        <div className="wkpi">
          <span className="wkpi__k">{copy.wKpiBookingAvg}</span>
          <span className="wkpi__v">
            {booking.average === null ? "—" : booking.average.toFixed(1)}
            <small>/ 10</small>
          </span>
          <span className="wkpi__d">{fill(copy.wKpiReviews, { n: booking.reviews })}</span>
        </div>
        <div className="wkpi">
          <span className="wkpi__k">{copy.kpiRiskLabel}</span>
          <span className={`wkpi__v${airbnb.risk + booking.risk > 0 ? " is-danger" : ""}`}>
            {airbnb.risk + booking.risk}
            {copy.wUnitCount ? <small>{copy.wUnitCount}</small> : null}
          </span>
          <span className="wkpi__d">{`Airbnb ${airbnb.risk} · Booking ${booking.risk}`}</span>
        </div>
        <div className="wkpi">
          <span className="wkpi__k">{copy.wKpiOpen}</span>
          <span className="wkpi__v">
            {openComplaints}
            {copy.wUnitCount ? <small>{copy.wUnitCount}</small> : null}
          </span>
          <span className="wkpi__d">{copy.wKpiOpenSub}</span>
        </div>
      </div>

      <div className="cxw-sub">
        <div className="cxw-seg" role="radiogroup" aria-label={copy.wPlatform}>
          {([null, "airbnb", "booking"] as const).map((provider) => (
            <Link
              key={provider ?? "all"}
              href={href({ provider })}
              role="radio"
              aria-checked={(filter.provider ?? null) === provider}
              className={(filter.provider ?? null) === provider ? "on" : ""}
              scroll={false}
            >
              {provider ? PROVIDER_LABEL[provider] : copy.filterAll}
            </Link>
          ))}
        </div>
        <div className="cxw-seg" role="radiogroup" aria-label={copy.riskOnly}>
          <Link href={href({ risk: null })} role="radio" aria-checked={!filter.riskOnly} className={filter.riskOnly ? "" : "on"} scroll={false}>
            {copy.filterAll}
          </Link>
          <Link href={href({ risk: "1" })} role="radio" aria-checked={Boolean(filter.riskOnly)} className={filter.riskOnly ? "on" : ""} scroll={false}>
            {copy.riskOnly}
          </Link>
        </div>
        <span className="cxw-count">{fill(copy.wNewestCount, { n: reviewTotal })}</span>
      </div>

      {reviews.length === 0 ? (
        <div className="cxw-empty">
          <span className="cxw-empty__ic">
            <Star aria-hidden="true" />
          </span>
          <b>{copy.reviewsEmptyTitle}</b>
          <span>{copy.reviewsEmptyBody}</span>
        </div>
      ) : (
        <div className="cxw-rows">
          <LiveWash move sig={reviews.map((review) => review.id).join(",")}>{reviews.map((review) => {
            const scale = REVIEW_SCALE[review.provider];
            const risk = review.riskLevel === "risk";
            const pos = review.positiveReviewText;
            const neg = review.negativeReviewText;
            const hasBody = Boolean(review.reviewText || pos || neg);
            const room = review.displayRoomLabel ?? reviewRoomFallbackLabel(review, copy);
            return (
              <Link
                className={`cxw-rv${selectedReview?.id === review.id ? " on" : ""}`}
                href={reviewHref(review.id)}
                key={review.id} data-live={review.id}
                scroll={false}
              >
                <span className="cxw-rv__score">
                  <b className={`num${risk ? " is-bad" : ""}`}>{review.ratingValue === null ? "—" : review.ratingValue}</b>
                  <span>{`/ ${scale}`}</span>
                </span>
                <span className="cxw-rv__main">
                  <span className="cxw-rv__meta">
                    {risk ? <em className="is-bad">{copy.riskChip}</em> : null}
                    {review.riskLevel === "unrated" ? <em>{copy.unratedChip}</em> : null}
                    <b>{PROVIDER_LABEL[review.provider]}</b>
                    <span>{`${buildingLabelOf(review.propertyName)} · ${room}`}</span>
                    {review.guestDisplayName ? <span>{review.guestDisplayName}</span> : null}
                    {review.linkedComplaintId ? <em className="is-linked">{copy.wLinked}</em> : null}
                    <time className="num">{md(review.reviewedAt)}</time>
                  </span>
                  {review.headline ? <span className="cxw-rv__hl">{review.headline}</span> : null}
                  {!hasBody ? (
                    <span className="cxw-rv__dim">{copy.scoreOnlyNote}</span>
                  ) : pos || neg ? (
                    <span className={`cxw-rv__pn${pos && neg ? " is-two" : ""}`}>
                      {pos ? (
                        <span>
                          <small>{copy.positiveLabel}</small>
                          {pos}
                        </span>
                      ) : null}
                      {neg ? (
                        <span>
                          <small>{copy.negativeLabel}</small>
                          {neg}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="cxw-rv__txt">{review.reviewText}</span>
                  )}
                </span>
              </Link>
            );
          })}</LiveWash>
          {reviewTotal > reviews.length ? (
            <Link
              className="cxw-more"
              href={href({ n: String(reviewLimit + REVIEW_LIST_STEP) })}
              scroll={false}
            >
              {fill(copy.wLoadMore, { n: reviewTotal - reviews.length })}
            </Link>
          ) : null}
        </div>
      )}
    </>
  );
}

// ── 수동 컴플레인 ─────────────────────────────────────────

function ManualView({
  copy,
  complaints,
  building,
  manualStatus,
  manualPlatform,
  manualAuthor,
  selectedComplaint,
  complaintHref,
  href,
  buildingLabelOf,
}: Props & {
  complaintHref: (id: string) => string;
  href: (patch: Record<string, string | null | undefined>) => string;
  buildingLabelOf: (name: string | null) => string;
}) {
  const open = complaints.filter((complaint) => complaint.status === "open").length;
  const rows = complaints
    .filter((complaint) => {
      if (manualStatus === "open" && complaint.status !== "open") return false;
      if (manualStatus === "done" && complaint.status === "open") return false;
      if (manualPlatform !== "all" && complaint.platform !== manualPlatform) return false;
      if (manualAuthor !== "all" && complaint.createdByUserId !== manualAuthor) return false;
      if (building && (!complaint.propertyName || getCanonicalPropertyName(complaint.propertyName) !== building)) return false;
      return true;
    })
    // 미처리 먼저, 그 안에서 최근 등록 순.
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      return b.createdAt.localeCompare(a.createdAt);
    });

  return (
    <>
      <div className="cxw-sub">
        <div className="cxw-seg" role="radiogroup" aria-label={copy.wColStatus}>
          {(
            [
              ["all", copy.wStatusAll],
              ["open", fill(copy.wOpenN, { n: open })],
              ["done", copy.wDoneTab],
            ] as const
          ).map(([value, label]) => (
            <Link
              key={value}
              href={href({ st: value })}
              role="radio"
              aria-checked={manualStatus === value}
              className={manualStatus === value ? "on" : ""}
              scroll={false}
            >
              {label}
            </Link>
          ))}
        </div>
        <span className="cxw-count">{fill(copy.wManualSort, { n: rows.length })}</span>
      </div>
      {rows.length === 0 ? (
        <div className="cxw-empty">
          <span className="cxw-empty__ic">
            <MessageSquareWarning aria-hidden="true" />
          </span>
          <b>{copy.manualEmptyTitle}</b>
          <span>{copy.manualEmptySub}</span>
        </div>
      ) : (
        <ManualComplaintList
          rows={rows.map((complaint) => ({
            id: complaint.id,
            href: complaintHref(complaint.id),
            open: complaint.status === "open",
            title: complaint.title,
            description: complaint.description,
            platform: platformName(complaint.platform, copy),
            place: `${buildingLabelOf(complaint.propertyName)}${complaint.roomLabel ? ` · ${complaint.roomLabel}` : ""}`,
            byline: `${complaint.authorName || "—"} · ${md(complaint.createdAt)}`,
          }))}
          selectedId={selectedComplaint?.id ?? null}
          labels={{
            statusOpen: copy.statusOpen,
            statusDone: copy.wDoneTab,
            colStatus: copy.wColStatus,
            colTitle: copy.wColTitle,
            colPlatform: copy.wColPlatform,
            colPlace: copy.wFieldPlace,
            colAuthorDate: copy.wColAuthorDate,
          }}
        />
      )}
    </>
  );
}

// ── 건물 · 객실별 ─────────────────────────────────────────

function RoomsView({
  copy,
  summaries,
  roomsBy,
  roomsSort,
  href,
}: Props & { href: (patch: Record<string, string | null | undefined>) => string }) {
  const sortKey = (place: PlaceSummary) => (roomsSort === "count" ? place.riskCount : place.riskRatio ?? -1);
  const byKey = <T extends PlaceSummary>(list: T[]) => [...list].sort((a, b) => sortKey(b) - sortKey(a));
  // 낮은 평점 리뷰만 보는 링크 — 외부 리뷰 보기로, 그 건물(· 객실) + 낮은 평점.
  const drill = (buildingName: string, room?: string) =>
    href({ view: "reviews", building: getCanonicalPropertyName(buildingName), rl: room ?? null, risk: "1", by: null, sort: null });

  if (summaries.length === 0) {
    return (
      <div className="cxw-empty">
        <span className="cxw-empty__ic">
          <Star aria-hidden="true" />
        </span>
        <b>{copy.roomsEmptyTitle}</b>
        <span>{copy.roomsEmptyBody}</span>
      </div>
    );
  }

  const head = (
    <div className="cxw-rh">
      <span>{roomsBy === "room" ? copy.wColRoomPlace : copy.colPlace}</span>
      <span>
        Airbnb <small>{copy.wColAvgShort}</small>
      </span>
      <span>
        Booking.com <small>{copy.wColAvgShort}</small>
      </span>
      <span>{copy.colRiskRatio}</span>
      <span />
    </div>
  );

  if (roomsBy === "room") {
    // 객실별: 모든 건물의 객실을 한 줄로. 독채 · 객실이 없는 건물은 건물 한 줄로 든다.
    const flat = summaries.flatMap((building) =>
      building.rooms.length === 0
        ? [{ place: building as PlaceSummary, name: building.label || building.name, sub: building.standalone ? copy.standalone : "", link: drill(building.name) }]
        : building.rooms.map((room) => ({ place: room, name: room.name, sub: building.label || building.name, link: drill(building.name, room.name) })),
    );
    const sorted = [...flat].sort((a, b) => sortKey(b.place) - sortKey(a.place));
    return (
      <>
        {head}
        <div className="cxw-rows">
          {sorted.map((row) => (
            <div className="cxw-rr" key={`${row.sub}-${row.name}`}>
              <span className="cxw-rr__name">
                <b>{row.name}</b>
                {row.sub ? <small>{row.sub}</small> : null}
              </span>
              <PlatformCell stat={row.place.airbnb} copy={copy} digits={2} />
              <PlatformCell stat={row.place.booking} copy={copy} digits={1} />
              <RatioCell place={row.place} href={row.link} />
            </div>
          ))}
        </div>
        <p className="cxw-note">{copy.wRoomsNote}</p>
      </>
    );
  }

  return (
    <>
      {head}
      <div className="cxw-rows">
        {byKey(summaries).map((building, index) => (
          <details className="cxw-bd" key={building.key} open={index === 0 && building.rooms.length > 0}>
            <summary className="cxw-rr is-building">
              <span className="cxw-rr__name">
                {building.rooms.length > 0 ? <ChevronRight className="cxw-chev" aria-hidden="true" /> : <i className="cxw-chev-sp" />}
                <b>{building.label || building.name}</b>
                {building.standalone ? <small>{copy.standalone}</small> : null}
                {building.unmappedCount > 0 ? <small>{fill(copy.unmapped, { n: building.unmappedCount })}</small> : null}
              </span>
              <PlatformCell stat={building.airbnb} copy={copy} digits={2} />
              <PlatformCell stat={building.booking} copy={copy} digits={1} />
              <RatioCell place={building} href={drill(building.name)} />
            </summary>
            {byKey(building.rooms).map((room) => (
              <div className="cxw-rr is-room" key={room.key}>
                <span className="cxw-rr__name">
                  <b>{room.name}</b>
                </span>
                <PlatformCell stat={room.airbnb} copy={copy} digits={2} />
                <PlatformCell stat={room.booking} copy={copy} digits={1} />
                <RatioCell place={room} href={drill(building.name, room.name)} />
              </div>
            ))}
          </details>
        ))}
      </div>
      <p className="cxw-note">{copy.wRoomsNote}</p>
    </>
  );
}
