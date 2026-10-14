import Link from "next/link";
import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import "./feedback-mobile.css";
import { ReviewSyncButton } from "./review-sync-button";
import { FeedbackFilterDd } from "./feedback-filter-dd";
import type { ReviewSyncStatus } from "@/lib/beds24/reviews-sync-manual";
import { reviewSyncLabels } from "@/lib/review-sync-labels";
import { getDictionary, type Locale } from "@/lib/i18n";
import { tokyoDateOf } from "@/lib/tokyo-date";
import { getCanonicalPropertyName, localizePropertyName } from "@/lib/room-label-normalization";
import { REVIEW_SCALE, reviewRoomFallbackLabel } from "@/lib/external-review-rules";
import type { ExternalReview, ReviewProvider } from "@/lib/external-reviews";

/** 한 페이지에 보여줄 리뷰 수. */
export const REVIEW_PAGE_SIZE = 20;

/** 기간 시트 프리셋 — 7 / 30 / 90 / 1년. */
export const RANGE_PRESET_DAYS = [7, 30, 90, 365];

const PROVIDER_SHORT: Record<ReviewProvider, string> = { airbnb: "Airbnb", booking: "Booking" };
const PROVIDER_FULL: Record<ReviewProvider, string> = { airbnb: "Airbnb", booking: "Booking.com" };

function md(iso: string | null): string {
  const day = tokyoDateOf(iso);
  return day ? `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}` : "—";
}

export type ReviewStats = {
  airbnb: number | null;
  booking: number | null;
  risk: number;
};

type Props = {
  locale: Locale;
  reviews: ExternalReview[];
  total: number;
  page: number;
  provider: "all" | ReviewProvider;
  riskOnly: boolean;
  from: string;
  to: string;
  building: string | null;
  roomLabel: string | null;
  buildingOptions: { value: string; label: string }[];
  roomOptions: string[];
  stats: ReviewStats;
  /** 「지금 가져오기」 상태. 작성 권한이 없으면 `null`(그리지 않는다). */
  reviewSync?: ReviewSyncStatus | null;
};

/**
 * 외부 리뷰 — 모바일 목록. 화이트 리디자인(2026-10-14, 시안 FB-Phone):
 * 숫자 셋(Airbnb 평균 · Booking 평균 · 낮은 평점 — 누르면 낮은 평점만) → 고르기 셋(플랫폼 · 건물 · 객실) →
 * 「최신 리뷰 순 · N건 · 마지막 수집」 + 지금 가져오기 → 리뷰 줄(점수 · 줄 정보 · 제목 · 본문 두 줄) → 쪽 넘김.
 * 서버 컴포넌트 — 고르기 · 쪽은 전부 쿼리스트링. See docs/product/25-complaint-workflow.md → 「화이트 리디자인」.
 */
export function ReviewList({
  locale,
  reviews,
  total,
  page,
  provider,
  riskOnly,
  from,
  to,
  building,
  roomLabel,
  buildingOptions,
  roomOptions,
  stats,
  reviewSync = null,
}: Props) {
  const dict = getDictionary(locale);
  const t = dict.complaints;
  const buildingLabels = dict.cleaning.buildingLabels;

  const totalPages = Math.max(Math.ceil(total / REVIEW_PAGE_SIZE), 1);
  const currentPage = Math.min(page, totalPages);

  const base: Record<string, string> = { view: "reviews", from, to };
  if (provider !== "all") base.provider = provider;
  if (riskOnly) base.risk = "1";
  if (building) base.building = building;
  if (roomLabel) base.rl = roomLabel;

  function hrefWith(patch: Record<string, string | null>): string {
    const params = new URLSearchParams(base);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    return `/mobile/complaints?${params.toString()}`;
  }

  const buildingName = buildingOptions.find((option) => option.value === building)?.label;

  return (
    <div className="fbw fbw-reviews">
      <div className="fbw-stats">
        <div className="fbw-stat">
          <span>Airbnb</span>
          <b className="num">
            {stats.airbnb === null ? "—" : stats.airbnb.toFixed(2)}
            <small>/ 5</small>
          </b>
        </div>
        <div className="fbw-stat">
          <span>Booking.com</span>
          <b className="num">
            {stats.booking === null ? "—" : stats.booking.toFixed(1)}
            <small>/ 10</small>
          </b>
        </div>
        <Link
          href={hrefWith({ risk: riskOnly ? null : "1", page: null })}
          className={`fbw-stat is-btn${riskOnly ? " on" : ""}`}
          role="switch"
          aria-checked={riskOnly}
          scroll={false}
        >
          <span>{t.kpiRiskLabel}</span>
          <b className={`num${stats.risk > 0 ? " is-bad" : ""}`}>
            {stats.risk}
            {t.wUnitCount ? <small>{t.wUnitCount}</small> : null}
          </b>
        </Link>
      </div>

      <div className="fbw-filters">
        <FeedbackFilterDd
          ariaLabel={t.wPlatform}
          label={provider === "all" ? t.allPlatforms : PROVIDER_FULL[provider]}
          options={(["all", "airbnb", "booking"] as const).map((value) => ({
            label: value === "all" ? t.allPlatforms : PROVIDER_FULL[value],
            href: hrefWith({ provider: value === "all" ? null : value, page: null }),
            on: provider === value,
          }))}
        />
        <FeedbackFilterDd
          ariaLabel={t.metaBuilding}
          label={buildingName ?? t.allBuildings}
          options={[
            { label: t.allBuildings, href: hrefWith({ building: null, rl: null, page: null }), on: !building },
            ...buildingOptions.map((option) => ({
              label: option.label,
              href: hrefWith({ building: option.value, rl: null, page: null }),
              on: building === option.value,
            })),
          ]}
        />
        <FeedbackFilterDd
          ariaLabel={t.metaRoom}
          align="right"
          disabled={!building || roomOptions.length === 0}
          label={roomLabel ?? t.wAllRooms}
          options={[
            { label: t.wAllRooms, href: hrefWith({ rl: null, page: null }), on: !roomLabel },
            ...roomOptions.map((room) => ({ label: room, href: hrefWith({ rl: room, page: null }), on: roomLabel === room })),
          ]}
        />
      </div>

      <div className="fbw-countrow">
        <span>{t.wNewestCount.replace("{n}", String(total))}</span>
        {reviewSync ? (
          <ReviewSyncButton
            availableAt={reviewSync.availableAt}
            labels={reviewSyncLabels(t)}
            lastSyncedAt={reviewSync.lastSyncedAt}
            localeTag={locale === "ja" ? "ja-JP" : locale === "en" ? "en-US" : "ko-KR"}
            running={reviewSync.running}
            variant="mobile"
          />
        ) : null}
      </div>

      {reviews.length === 0 ? (
        <div className="fbw-empty">
          <span className="fbw-empty__ic">
            <Star aria-hidden="true" />
          </span>
          <b>{t.reviewsEmptyTitle}</b>
          <span>{t.reviewsEmptyBody}</span>
          {provider !== "all" || riskOnly || building ? (
            <Link className="fbw-empty__btn" href={`/mobile/complaints?view=reviews&from=${from}&to=${to}`}>
              {t.emptyReset}
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="fbw-rows">
          {reviews.map((review) => {
            const bad = review.riskLevel === "risk";
            const neg = review.negativeReviewText;
            const pos = review.positiveReviewText;
            // 두 줄로 줄일 때는 아쉬운 점을 먼저 — 운영에서 읽어야 할 쪽이다.
            const body = neg
              ? `${t.negativeLabel}: ${neg}`
              : pos
                ? `${t.positiveLabel}: ${pos}`
                : review.reviewText || t.scoreOnlyNote;
            const place = `${
              review.propertyName ? localizePropertyName(getCanonicalPropertyName(review.propertyName), buildingLabels) : "—"
            } · ${review.displayRoomLabel ?? reviewRoomFallbackLabel(review, t)}`;
            return (
              <Link key={review.id} href={`/mobile/complaints/reviews/${review.id}`} className="fbw-rv">
                <span className="fbw-rv__score">
                  <b className={`num${bad ? " is-bad" : ""}`}>{review.ratingValue ?? "—"}</b>
                  <span>{`/ ${REVIEW_SCALE[review.provider]}`}</span>
                </span>
                <span className="fbw-rv__main">
                  <span className="fbw-rv__meta">
                    {bad ? <em className="is-bad">{t.riskChip}</em> : null}
                    <b>{PROVIDER_SHORT[review.provider]}</b>
                    <span className="fbw-rv__place">{place}</span>
                    {review.linkedComplaintId ? <em className="is-linked">{t.wLinkedShort}</em> : null}
                    <time className="num">{md(review.reviewedAt)}</time>
                  </span>
                  {review.headline ? <span className="fbw-rv__hl">{review.headline}</span> : null}
                  <span className={`fbw-rv__body${!neg && !pos && !review.reviewText ? " is-dim" : ""}`}>{body}</span>
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {totalPages > 1 ? (
        <nav className="fbw-pager" aria-label={t.viewReviews}>
          {currentPage > 1 ? (
            <Link className="fbw-pager__btn" href={hrefWith({ page: currentPage - 1 === 1 ? null : String(currentPage - 1) })} aria-label={t.pagerPrev}>
              <ChevronLeft aria-hidden="true" />
            </Link>
          ) : (
            <span className="fbw-pager__btn is-off" aria-hidden="true">
              <ChevronLeft />
            </span>
          )}
          <span className="fbw-pager__pos num">
            {currentPage} / {totalPages}
          </span>
          {currentPage < totalPages ? (
            <Link className="fbw-pager__btn" href={hrefWith({ page: String(currentPage + 1) })} aria-label={t.pagerNext}>
              <ChevronRight aria-hidden="true" />
            </Link>
          ) : (
            <span className="fbw-pager__btn is-off" aria-hidden="true">
              <ChevronRight />
            </span>
          )}
        </nav>
      ) : null}
    </div>
  );
}
