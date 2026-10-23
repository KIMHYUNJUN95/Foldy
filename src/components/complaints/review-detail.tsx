"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Plus } from "lucide-react";
import "./feedback-mobile.css";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { getDictionary } from "@/lib/i18n";
import { tokyoDateOf } from "@/lib/tokyo-date";
import { haptic } from "@/lib/haptics";
import { getCanonicalPropertyName, localizePropertyName } from "@/lib/room-label-normalization";
import {
  REVIEW_SCALE,
  parseReviewBreakdown,
  reviewRoomFallbackLabel,
} from "@/lib/external-review-rules";
import type { ExternalReviewDetail } from "@/lib/external-reviews";
import type { TranslationPart } from "@/lib/review-translate";
import {
  convertReviewToComplaintAction,
  translateReviewPartAction,
} from "@/actions/complaints";

/** «10/8» — 도쿄 기준. */
function md(iso: string | null): string {
  const day = tokyoDateOf(iso);
  return day ? `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}` : "—";
}

/** 낮은 평점 경계 — 세부 점수 막대를 빨갛게 칠할 때만(서버 위험도 규칙과 같다). */
const LOW_AT = { airbnb: 3, booking: 7 } as const;

/** Only used to skip an obviously-redundant translate offer (Booking gives a source language). */
function isSameLanguage(sourceLanguageCode: string | null, locale: string): boolean {
  if (!sourceLanguageCode) return false;
  return sourceLanguageCode.trim().slice(0, 2).toLowerCase() === locale;
}

// 외부 리뷰 상세 — 모바일. 화이트 리디자인(2026-10-14, 시안 FBDetail-Phone): 낮은 평점 · 플랫폼 · 날짜 → 큰 점수 → 제목 →
// 건물 · 객실 · 게스트 · 예약 → 세부 점수 막대 → 리뷰 내용(번역) → 비공개 피드백 → 숙소 답글 → 「컴플레인으로 등록」.
// PC 리뷰 패널과 같은 순서. 번역은 이 리뷰 하나만, 누를 때만. See docs/product/25-complaint-workflow.md.
export function ReviewDetail({
  review,
  locale,
  canConvert,
  initialTranslations,
}: {
  review: ExternalReviewDetail;
  locale: string;
  canConvert: boolean;
  initialTranslations: Partial<Record<TranslationPart, string>>;
}) {
  const dict = getDictionary(locale);
  const t = dict.complaints;
  const buildingLabels = dict.cleaning.buildingLabels;
  const router = useRouter();

  const scale = REVIEW_SCALE[review.provider];
  const hasBody = Boolean(
    review.reviewText || review.positiveReviewText || review.negativeReviewText,
  );
  // Sub-score labels are localized from the dictionary; the stored keys stay as the platform sent them.
  const breakdown = parseReviewBreakdown(review.provider, review.ratingBreakdown, t.breakdownLabels);

  // 원문 언어를 안정적으로 아는 건 Booking.com뿐이다(source_language_code). Airbnb는 항상
  // 자동 감지로 넘긴다 — 번역 여부를 미리 판단할 수 없으므로 버튼은 그대로 노출한다.
  const rawParts: { part: TranslationPart; text: string | null }[] = [
    { part: "headline", text: review.headline },
    { part: "review", text: review.provider === "airbnb" ? review.reviewText : null },
    { part: "positive", text: review.provider === "booking" ? review.positiveReviewText : null },
    { part: "negative", text: review.provider === "booking" ? review.negativeReviewText : null },
    { part: "private", text: review.provider === "airbnb" ? review.privateFeedback : null },
  ];
  const parts = rawParts.filter(
    (p): p is { part: TranslationPart; text: string } => Boolean(p.text),
  );

  const offerTranslate = parts.length > 0 && !isSameLanguage(review.sourceLanguageCode, locale);

  const [translations, setTranslations] =
    useState<Partial<Record<TranslationPart, string>>>(initialTranslations);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translateError, setTranslateError] = useState(false);
  const [isTranslating, startTranslating] = useTransition();

  function textFor(part: TranslationPart, original: string | null): string | null {
    if (!original) return null;
    if (showTranslation && translations[part]) return translations[part] as string;
    return original;
  }

  function handleToggleTranslation() {
    if (showTranslation) {
      setShowTranslation(false);
      return;
    }
    const missing = parts.filter((p) => !translations[p.part]);
    if (missing.length === 0) {
      setShowTranslation(true);
      return;
    }
    setTranslateError(false);
    startTranslating(async () => {
      const results = await Promise.all(
        missing.map(async (p) => ({
          part: p.part,
          res: await translateReviewPartAction(review.id, p.part, p.text, review.sourceLanguageCode),
        })),
      );
      setTranslations((prev) => {
        const next = { ...prev };
        for (const { part, res } of results) {
          if (res.status === "ok") next[part] = res.text;
        }
        return next;
      });
      setShowTranslation(true);
      if (results.every((r) => r.res.status !== "ok")) setTranslateError(true);
    });
  }

  const headlineText = textFor("headline", review.headline);

  const [showConvert, setShowConvert] = useState(false);
  const [convertError, setConvertError] = useState(false);
  const [isConverting, startConverting] = useTransition();
  const convertTitleRef = useRef<HTMLInputElement>(null);
  const convertBodyRef = useRef<HTMLTextAreaElement>(null);

  function handleConvert(close: () => void) {
    const title =
      convertTitleRef.current?.value.trim() || review.headline || review.propertyName || "";
    if (!title) {
      setConvertError(true);
      return;
    }
    setConvertError(false);
    startConverting(async () => {
      const res = await convertReviewToComplaintAction(
        review.id,
        title,
        convertBodyRef.current?.value ?? "",
      );
      if ("id" in res) {
        haptic("success");
        close();
        router.push(`/mobile/complaints/${res.id}`);
      } else {
        setConvertError(true);
      }
    });
  }

  const translateLabel = t.wTranslate;
  const building = review.propertyName
    ? localizePropertyName(getCanonicalPropertyName(review.propertyName), buildingLabels)
    : "—";
  const room = review.displayRoomLabel ?? reviewRoomFallbackLabel(review, t);
  const risk = review.riskLevel === "risk";

  return (
    <div className="fbw fbw-detail">
      <div className="fbw-dh">
        <div className="fbw-dh__main">
          <span className="fbw-kick">
            {risk ? <em className="is-bad">{t.riskChip}</em> : null}
            {review.riskLevel === "unrated" ? <em>{t.unratedChip}</em> : null}
            <span>{review.provider === "airbnb" ? "Airbnb" : "Booking.com"}</span>
            <span className="num">{t.wReviewedOn.replace("{date}", md(review.reviewedAt))}</span>
          </span>
          <span className="fbw-score">
            <b className={`num${risk ? " is-bad" : ""}`}>{review.ratingValue == null ? "—" : review.ratingValue}</b>
            <span>{`/ ${scale}`}</span>
          </span>
          {headlineText ? <h1 className="fbw-dh__title is-md">{headlineText}</h1> : null}
          <span className="fbw-ctx">
            {`${building} · ${room}${review.guestDisplayName ? ` · ${review.guestDisplayName}` : ""}`}
            {review.sourceReservationId ? (
              <>
                <br />
                <span className="num">{t.wReservationNo.replace("{id}", review.sourceReservationId)}</span>
              </>
            ) : null}
          </span>
        </div>
      </div>

      {breakdown.length > 0 ? (
        <div className="fbw-bk">
          {breakdown.map((row) => {
            const value = Number(row.value);
            const known = Number.isFinite(value);
            return (
              <div className="fbw-bk__row" key={row.key}>
                <span>{row.label}</span>
                <span className="fbw-bk__bar" aria-hidden="true">
                  {known ? <i className={value <= LOW_AT[review.provider] ? "is-bad" : ""} style={{ width: `${Math.min(100, (value / scale) * 100)}%` }} /> : null}
                </span>
                <b className="num">{known ? value.toFixed(review.provider === "booking" ? 1 : 0) : "—"}</b>
              </div>
            );
          })}
        </div>
      ) : null}

      <section className="fbw-sec">
        <div className="fbw-sec__h">
          <b>{t.wReviewContent}</b>
          {offerTranslate ? (
            <button type="button" className="fbw-link" onClick={handleToggleTranslation} disabled={isTranslating} aria-busy={isTranslating}>
              {isTranslating ? t.translating : showTranslation ? t.originalAction : translateLabel}
            </button>
          ) : null}
        </div>
        {showTranslation ? <span className="fbw-trnote">{t.translatedBadge}</span> : null}
        {translateError ? (
          <p className="fbw-err" role="alert">
            {t.translateFailed}
          </p>
        ) : null}
        <div className={showTranslation ? "fbw-text is-tr" : "fbw-text"} key={showTranslation ? "tr" : "or"}>
          {!hasBody ? (
            <p className="fbw-p is-dim">{t.scoreOnlyNote}</p>
          ) : (
            <>
              {review.positiveReviewText ? (
                <div className="fbw-part">
                  <small>{t.positiveLabel}</small>
                  <p>{textFor("positive", review.positiveReviewText)}</p>
                </div>
              ) : null}
              {review.negativeReviewText ? (
                <div className="fbw-part">
                  <small>{t.negativeLabel}</small>
                  <p>{textFor("negative", review.negativeReviewText)}</p>
                </div>
              ) : null}
              {review.reviewText ? (
                <div className="fbw-part">
                  <p>{textFor("review", review.reviewText)}</p>
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>

      {/* 비공개 피드백 — Airbnb 전용. 공개 리뷰와 섞이지 않게 따로 이름을 단다(점수 · 위험도에 넣지 않는다). */}
      {review.provider === "airbnb" && review.privateFeedback ? (
        <section className="fbw-sec">
          <div className="fbw-part">
            <small>{t.wPrivateLabel}</small>
            <p>{textFor("private", review.privateFeedback)}</p>
          </div>
        </section>
      ) : null}

      {/* Booking.com 숙소 답글 — 읽기 전용(Foldy 는 답글을 쓰지 않는다). */}
      {review.provider === "booking" && review.otaReplyText ? (
        <section className="fbw-sec">
          <div className="fbw-part is-reply">
            <small>{t.wReply}</small>
            <p>{review.otaReplyText}</p>
          </div>
        </section>
      ) : null}

      <div className="fbw-convert">
        {review.linkedComplaintId ? (
          <Link href={`/mobile/complaints/${review.linkedComplaintId}`} className="fbw-btn is-soft is-big">
            <Check aria-hidden="true" />
            {t.wLinked} · {t.viewLinkedComplaint}
          </Link>
        ) : canConvert ? (
          <>
            <button type="button" className="fbw-btn is-pri is-big" onClick={() => setShowConvert(true)}>
              <Plus aria-hidden="true" />
              {t.convert}
            </button>
            <span className="fbw-convert__note">{t.wConvertNote}</span>
          </>
        ) : (
          // 권한이 없으면 버튼을 숨기지 않고 왜 못 하는지 말한다 — 없어진 버튼은 고장으로 읽힌다.
          <span className="fbw-convert__note">{t.noPermission}</span>
        )}
      </div>

      {showConvert ? (
        <BottomSheet ariaLabel={t.wConvertTitle} onClose={() => setShowConvert(false)}>
          {({ close }) => (
            <div className="fbw fbw-sheet">
              <div className="fbw-sheet__h">
                <h3>{t.wConvertTitle}</h3>
                <span>{t.wConvertNote}</span>
              </div>
              <label className="fbw-nf">
                <span className="fbw-nf__l">{t.fieldTitle}</span>
                <input ref={convertTitleRef} name="title" autoComplete="off" defaultValue={review.headline ?? ""} />
              </label>
              <label className="fbw-nf">
                <span className="fbw-nf__l">
                  {t.wContent} {t.wOptional}
                </span>
                <textarea ref={convertBodyRef} name="description" rows={3} placeholder={t.fieldBodyPlaceholder} />
              </label>
              {convertError ? (
                <p className="fbw-err" role="alert">
                  {t.convertFailed}
                </p>
              ) : null}
              <div className="fbw-sheet__btns">
                <button type="button" className="fbw-btn is-gray" onClick={close} disabled={isConverting}>
                  {t.cancel}
                </button>
                <button type="button" className="fbw-btn is-pri" disabled={isConverting} onClick={() => handleConvert(close)}>
                  {isConverting ? <span className="fbw-spin" aria-hidden="true" /> : null}
                  {t.wSubmit}
                </button>
              </div>
            </div>
          )}
        </BottomSheet>
      ) : null}
    </div>
  );
}
