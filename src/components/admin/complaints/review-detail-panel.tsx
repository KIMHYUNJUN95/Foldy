import Link from "next/link";
import { X } from "lucide-react";
import { convertReviewAction, translateReviewAction } from "@/app/admin/complaints/actions";
import { REVIEW_SCALE, type ExternalReviewDetail, type ReviewProvider } from "@/lib/external-reviews";
import { parseReviewBreakdown, reviewRoomFallbackLabel } from "@/lib/external-review-rules";
import type { TranslationPart } from "@/lib/review-translate";
import type { Dictionary } from "@/lib/i18n";
import { tokyoDateOf } from "@/lib/tokyo-date";
import { getCanonicalPropertyName, localizePropertyName } from "@/lib/room-label-normalization";

// 외부 리뷰 상세 패널 — 서버 컴포넌트. 화이트 리디자인(2026-10-14, 시안 FB-PC 오른쪽):
// 큰 점수 → 제목 → 건물 · 객실 · 게스트 · 예약 → 세부 점수 막대 → 본문(번역) → 비공개 피드백 → 숙소 답글 →
// 아래 「컴플레인으로 등록」. 상태는 여전히 쿼리스트링(review/tr), 전환 · 번역은 서버 액션 폼.
// 도메인 계약: docs/product/25-complaint-workflow.md → "External Review Fields", "Review Translation"

const PROVIDER_LABEL: Record<ReviewProvider, string> = { airbnb: "Airbnb", booking: "Booking.com" };
/** 낮은 평점 경계(서버 위험도 규칙과 같다) — 세부 점수 막대를 빨갛게 칠할 때만 쓴다. */
const LOW_AT: Record<ReviewProvider, number> = { airbnb: 3, booking: 7 };

export type ReviewPanelLabels = {
  building: string;
  room: string;
  reservation: string;
  guest: string;
  close: string;
};

type Props = {
  review: ExternalReviewDetail;
  copy: Dictionary["complaints"];
  buildingLabels: Record<string, string>;
  labels: ReviewPanelLabels;
  closeHref: string;
  showTranslation: boolean;
  originalHref: string;
  translateRedirectTo: string;
  translations: Partial<Record<TranslationPart, string>>;
  canConvert: boolean;
  convertRedirectTo: string;
  linkedComplaintHref: string | null;
};

function textFor(
  part: TranslationPart,
  original: string | null,
  showTranslation: boolean,
  translations: Partial<Record<TranslationPart, string>>,
): string | null {
  if (!original) return null;
  if (showTranslation && translations[part]) return translations[part] as string;
  return original;
}

export function ReviewDetailPanel({
  review,
  copy,
  buildingLabels,
  labels,
  closeHref,
  showTranslation,
  originalHref,
  translateRedirectTo,
  translations,
  canConvert,
  convertRedirectTo,
  linkedComplaintHref,
}: Props) {
  const scale = REVIEW_SCALE[review.provider];
  const risk = review.riskLevel === "risk";
  const hasBody = Boolean(review.reviewText || review.positiveReviewText || review.negativeReviewText);
  const hasTranslatableText = Boolean(
    review.reviewText || review.positiveReviewText || review.negativeReviewText || review.headline || review.privateFeedback,
  );
  const breakdown = parseReviewBreakdown(review.provider, review.ratingBreakdown, copy.breakdownLabels);

  const headlineText = textFor("headline", review.headline, showTranslation, translations);
  const publicText = textFor("review", review.reviewText, showTranslation, translations);
  const positiveText = textFor("positive", review.positiveReviewText, showTranslation, translations);
  const negativeText = textFor("negative", review.negativeReviewText, showTranslation, translations);
  const privateText = textFor("private", review.privateFeedback, showTranslation, translations);

  const building = review.propertyName
    ? localizePropertyName(getCanonicalPropertyName(review.propertyName), buildingLabels)
    : "—";
  const room = review.displayRoomLabel ?? reviewRoomFallbackLabel(review, copy);
  const reviewedDay = tokyoDateOf(review.reviewedAt);

  return (
    <>
      <Link href={closeHref} className="panel-scrim" aria-label={labels.close} data-panel-close scroll={false} />
      <aside className="panel cxw-panel" role="dialog" aria-label={copy.viewReviews}>
        <div className="cxw-ph">
          <div className="cxw-ph__main">
            <span className="cxw-ph__kick">
              {risk ? <em className="is-bad">{copy.riskChip}</em> : null}
              {review.riskLevel === "unrated" ? <em>{copy.unratedChip}</em> : null}
              <span>{PROVIDER_LABEL[review.provider]}</span>
              {reviewedDay ? <span className="num">{reviewedDay.replaceAll("-", ".")}</span> : null}
            </span>
            <span className="cxw-ph__score">
              <b className={`num${risk ? " is-bad" : ""}`}>{review.ratingValue === null ? "—" : review.ratingValue}</b>
              <span>{`/ ${scale}`}</span>
            </span>
            {headlineText ? <h2 className="cxw-ph__title">{headlineText}</h2> : null}
            <span className="cxw-ph__ctx">
              {`${building} · ${room}${review.guestDisplayName ? ` · ${review.guestDisplayName}` : ""}`}
              {review.sourceReservationId ? (
                <>
                  <br />
                  <span className="num">{copy.wReservationNo.replace("{id}", review.sourceReservationId)}</span>
                </>
              ) : null}
            </span>
          </div>
          <Link href={closeHref} className="cxw-ph__x" aria-label={labels.close} data-panel-close scroll={false}>
            <X aria-hidden="true" />
          </Link>
        </div>

        <div className="panel__body cxw-pb">
          {breakdown.length > 0 ? (
            <div className="cxw-bk">
              {breakdown.map((row) => {
                const value = Number(row.value);
                const known = Number.isFinite(value);
                return (
                  <div className="cxw-bk__row" key={row.key}>
                    <span>{row.label}</span>
                    <span className="cxw-bk__bar" aria-hidden="true">
                      {known ? (
                        <i className={value <= LOW_AT[review.provider] ? "is-bad" : ""} style={{ width: `${Math.min(100, (value / scale) * 100)}%` }} />
                      ) : null}
                    </span>
                    <b className="num">{known ? value.toFixed(review.provider === "booking" ? 1 : 0) : "—"}</b>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="cxw-sec">
            {!hasBody ? (
              <p className="cxw-dim">{copy.scoreOnlyNote}</p>
            ) : (
              <div className={showTranslation ? "cxw-text is-tr" : "cxw-text"}>
                {review.provider === "booking" ? (
                  <>
                    {positiveText ? (
                      <div className="cxw-part">
                        <small>{copy.positiveLabel}</small>
                        <p>{positiveText}</p>
                      </div>
                    ) : null}
                    {negativeText ? (
                      <div className="cxw-part">
                        <small>{copy.negativeLabel}</small>
                        <p>{negativeText}</p>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="cxw-part">
                    <p>{publicText}</p>
                  </div>
                )}
              </div>
            )}
            {hasTranslatableText ? (
              showTranslation ? (
                <Link href={originalHref} className="cxw-link" scroll={false}>
                  {copy.wTranslatedNote}
                </Link>
              ) : (
                <form action={translateReviewAction}>
                  <input type="hidden" name="reviewId" value={review.id} />
                  <input type="hidden" name="redirectTo" value={translateRedirectTo} />
                  <button type="submit" className="cxw-link">
                    {copy.wTranslate}
                  </button>
                </form>
              )
            ) : null}
          </div>

          {/* 비공개 피드백 — Airbnb 전용. 공개 리뷰와 섞이지 않게 따로 이름을 단다(점수 · 위험도에는 넣지 않는다). */}
          {review.privateFeedback ? (
            <div className="cxw-sec">
              <div className="cxw-part">
                <small>{copy.wPrivateLabel}</small>
                <p>{privateText}</p>
              </div>
            </div>
          ) : null}

          {review.otaReplyText ? (
            <div className="cxw-sec">
              <div className="cxw-part is-reply">
                <small>{copy.wReply}</small>
                <p>{review.otaReplyText}</p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="cxw-pf">
          {review.linkedComplaintId && linkedComplaintHref ? (
            <Link href={linkedComplaintHref} className="cxw-btn is-soft" scroll={false}>
              {copy.wLinked} · {copy.viewLinkedComplaint}
            </Link>
          ) : canConvert ? (
            <form action={convertReviewAction} className="cxw-pf__form">
              <input type="hidden" name="reviewId" value={review.id} />
              <input type="hidden" name="redirectTo" value={convertRedirectTo} />
              <span className="cxw-pf__note">{copy.wConvertNote}</span>
              <button type="submit" className="cxw-btn is-pri">
                {copy.convert}
              </button>
            </form>
          ) : (
            <span className="cxw-pf__note">{copy.wConvertNote}</span>
          )}
        </div>
      </aside>
    </>
  );
}
